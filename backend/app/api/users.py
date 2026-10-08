# backend/app/api/users.py
"""
User management API routes
"""

from fastapi import APIRouter, HTTPException, status, Depends, BackgroundTasks, Query
from typing import List, Optional, Dict, Any
from datetime import datetime
import logging
from app.dependencies import (
    get_current_active_user,
    get_current_admin_user
)

from app.api.deps import (
    CurrentActiveUser, CurrentAdminUser, PaginationDep,
    get_user_by_id, check_user_ownership, CommonQueryParams,
    require_admin, require_verified_user, track_api_usage
)
from app.models.user import (
    UserUpdate, UserResponse, UserProfile, UserPreferences,
    UserListResponse, UserUsageStats, LocationPreference, JobPreferences,
    UserRole, SubscriptionTier, UserCreate
)
from app.models.common import SuccessResponse, PaginatedResponse
from app.services.auth.auth_service import AuthService
from app.services.emails.email_service import EmailService
from app.database import get_users_collection
from bson import ObjectId

router = APIRouter()
logger = logging.getLogger(__name__)


def _json_safe(value):
    """Make nested Mongo values safe to return as JSON."""
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def _text(value, default=""):
    return value if isinstance(value, str) else default


def build_user_response(current_user: Dict[str, Any]) -> UserResponse:
    first_name = _text(current_user.get("first_name"))
    last_name = _text(current_user.get("last_name"))
    full_name = _text(current_user.get("full_name")) or f"{first_name} {last_name}".strip() or "User"

    tier = _text(current_user.get("subscription_tier"), "free").lower() or "free"
    if tier not in {item.value for item in SubscriptionTier}:
        tier = SubscriptionTier.FREE.value

    usage = current_user.get("usage_stats")
    if not isinstance(usage, dict):
        usage = {}

    cv_data = current_user.get("cv_data")
    if isinstance(cv_data, dict):
        cv_data = _json_safe(cv_data)
    else:
        cv_data = None

    return UserResponse(
        id=str(current_user["_id"]),
        email=_text(current_user.get("email")),
        first_name=first_name,
        last_name=last_name,
        full_name=full_name,
        is_active=bool(current_user.get("is_active", True)),
        is_verified=bool(current_user.get("is_verified", False)),
        subscription_tier=tier,
        usage_stats=usage,
        referral_code=_text(current_user.get("referral_code")),
        created_at=current_user.get("created_at") or datetime.utcnow(),
        last_login=current_user.get("last_login"),
        gmail_connected=bool(current_user.get("gmail_auth")),
        cv_data=cv_data,
        referral_bonus_auto_applications=int(current_user.get("referral_bonus_auto_applications") or 0)
    )

@router.get("/me", response_model=UserResponse)
async def get_current_user_profile(
    current_user: Dict[str, Any] = Depends(get_current_active_user)
):
    """
    Get current user's profile information
    """
    try:
        # Track API usage (don't fail if tracking fails)
        try:
            await track_api_usage("get_profile", current_user)
        except Exception as e:
            logger.warning(f"Failed to track API usage: {str(e)}")

        return build_user_response(current_user)
        
    except KeyError as ke:
        logger.error(f"Missing required field in user object: {ke}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Missing required user field: {str(ke)}"
        )
    except Exception as e:
        logger.error(f"Error getting user profile: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve user profile"
        )

@router.put("/me", response_model=UserResponse)
async def update_current_user_profile(
    user_update: UserUpdate,
    current_user: Dict[str, Any] = Depends(get_current_active_user)
):
    """
    Update current user's profile information - WITH DEBUGGING
    """
    try:
        logger.info("="*60)
        logger.info("PUT /me - START")
        logger.info(f"User: {current_user.get('email')}")
        logger.info(f"Update data received: {user_update.dict(exclude_unset=True)}")
        
        # Track API usage
        try:
            await track_api_usage("update_profile", current_user)
        except Exception as e:
            logger.warning(f"Track usage failed: {str(e)}")
        
        # Get the update data
        update_data = user_update.dict(exclude_unset=True)
        full_name = (update_data.get("full_name") or "").strip()
        if full_name:
            name_parts = [part for part in full_name.split() if part]
            update_data["full_name"] = full_name
            update_data["first_name"] = name_parts[0]
            update_data["last_name"] = " ".join(name_parts[1:])
        logger.info(f"Fields to update: {list(update_data.keys())}")
        
        # Update user profile
        logger.info(f"Calling AuthService.update_user_profile...")
        success = await AuthService.update_user_profile(
            str(current_user["_id"]),
            update_data
        )
        
        logger.info(f"AuthService.update_user_profile returned: {success}")
        
        if not success:
            logger.error("Update failed - AuthService returned False")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to update profile"
            )
        
        # Get updated user
        logger.info(f"Fetching updated user...")
        updated_user = await AuthService.get_user_by_id(str(current_user["_id"]))
        
        if not updated_user:
            logger.error("Updated user not found after update!")
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found after update"
            )
        
        logger.info(f"Updated user fields: {list(updated_user.keys())}")
        
        # Helper to generate full_name if not present
        def get_full_name(user):
            if user.get("full_name"):
                return user["full_name"]
            first = user.get("first_name", "")
            last = user.get("last_name", "")
            return f"{first} {last}".strip() or "User"
        
        # Build response with safe field access
        response = UserResponse(
            id=str(updated_user["_id"]),
            email=updated_user.get("email", ""),
            first_name=updated_user.get("first_name", ""),
            last_name=updated_user.get("last_name", ""),
            full_name=get_full_name(updated_user),
            is_active=updated_user.get("is_active", True),
            is_verified=updated_user.get("is_verified", False),
            subscription_tier=updated_user.get("subscription_tier", "free"),
            usage_stats=updated_user.get("usage_stats", {}),
            referral_code=updated_user.get("referral_code", ""),
            created_at=updated_user.get("created_at"),
            last_login=updated_user.get("last_login"),
            gmail_connected=bool(updated_user.get("gmail_auth"))
        )
        
        logger.info(f"✓ Profile updated successfully")
        logger.info("PUT /me - SUCCESS")
        logger.info("="*60)
        
        return response
        
    except HTTPException:
        raise
    except KeyError as ke:
        logger.error("="*60)
        logger.error(f"KeyError in PUT /me: {str(ke)}")
        logger.error(f"Missing field: {ke}")
        if 'updated_user' in locals():
            logger.error(f"Available fields: {list(updated_user.keys())}")
        logger.error("="*60)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Missing required field: {str(ke)}"
        )
    except Exception as e:
        logger.error("="*60)
        logger.error(f"Error in PUT /me")
        logger.error(f"Error type: {type(e).__name__}")
        logger.error(f"Error message: {str(e)}")
        import traceback
        logger.error(f"Traceback:\n{traceback.format_exc()}")
        logger.error("="*60)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update profile"
        )

# @router.put("/me", response_model=UserResponse)
# async def update_current_user_profile(
#     user_update: UserUpdate,
#     current_user: Dict[str, Any] = Depends(get_current_active_user)
# ):
#     """
#     Update current user's profile information
#     """
#     try:
#         await track_api_usage("update_profile", current_user)
        
#         # Update user profile
#         success = await AuthService.update_user_profile(
#             str(current_user["_id"]),
#             user_update.dict(exclude_unset=True)
#         )
        
#         if not success:
#             raise HTTPException(
#                 status_code=status.HTTP_400_BAD_REQUEST,
#                 detail="Failed to update profile"
#             )
        
#         # Get updated user
#         updated_user = await AuthService.get_user_by_id(str(current_user["_id"]))
        
#         return UserResponse(
#             id=str(updated_user["_id"]),
#             email=updated_user["email"],
#             first_name=updated_user["first_name"],
#             last_name=updated_user["last_name"],
#             is_active=updated_user["is_active"],
#             is_verified=updated_user["is_verified"],
#             subscription_tier=updated_user["subscription_tier"],
#             usage_stats=updated_user.get("usage_stats", {}),
#             referral_code=updated_user["referral_code"],
#             created_at=updated_user["created_at"],
#             last_login=updated_user.get("last_login")
#             gmail_connected=bool(updated_user.get("gmail_auth"))
#         )
        
#     except HTTPException:
#         raise
#     except Exception as e:
#         logger.error(f"Error updating user profile: {str(e)}")
#         raise HTTPException(
#             status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
#             detail="Failed to update profile"
#         )


@router.get("/me/profile", response_model=UserProfile)
async def get_user_detailed_profile(
    current_user: Dict[str, Any] = Depends(get_current_active_user)
):
    """
    Get detailed user profile including preferences and settings
    """
    try:
        profile = current_user.get("profile", {})
        if not profile:
            # Return default empty profile
            return UserProfile()
        
        return UserProfile(**profile)
        
    except Exception as e:
        logger.error(f"Error getting detailed profile: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve detailed profile"
        )


@router.put("/me/profile", response_model=UserProfile)
async def update_user_detailed_profile(
    profile_update: UserProfile,
    current_user: Dict[str, Any] = Depends(get_current_active_user)
):
    """
    Update detailed user profile
    """
    try:
        await track_api_usage("update_detailed_profile", current_user)
        
        # Update profile
        success = await AuthService.update_user_profile(
            str(current_user["_id"]),
            {"profile": profile_update.dict(exclude_unset=True)}
        )
        
        if not success:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to update detailed profile"
            )
        
        return profile_update
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating detailed profile: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update detailed profile"
        )


@router.get("/me/preferences", response_model=UserPreferences)
async def get_user_preferences(
    current_user: Dict[str, Any] = Depends(get_current_active_user)
):
    """
    Get user preferences and settings
    """
    try:
        preferences = current_user.get("preferences", {})
        return UserPreferences(**preferences) if preferences else UserPreferences()
        
    except Exception as e:
        logger.error(f"Error getting user preferences: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve preferences"
        )


@router.put("/me/preferences", response_model=UserPreferences)
async def update_user_preferences(
    preferences_update: Dict[str, Any],
    current_user: Dict[str, Any] = Depends(get_current_active_user)
):
    """
    Update user preferences and settings
    """
    try:
        await track_api_usage("update_preferences", current_user)
        allowed = set(getattr(UserPreferences, "model_fields", None) or UserPreferences.__fields__)
        incoming = {key: value for key, value in preferences_update.items() if key in allowed}
        existing = current_user.get("preferences") or {}
        if not isinstance(existing, dict):
            existing = {}
        merged = UserPreferences(**{**existing, **incoming})

        success = await AuthService.update_user_profile(
            str(current_user["_id"]),
            {"preferences": merged.dict()}
        )
        
        if not success:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to update preferences"
            )
        
        return merged
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating preferences: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update preferences"
        )


@router.get("/me/stats", response_model=UserUsageStats)
async def get_user_usage_stats(
    current_user: Dict[str, Any] = Depends(get_current_active_user)
):
    """
    Get user usage statistics
    """
    try:
        stats = current_user.get("usage_stats", {})
        return UserUsageStats(**stats) if stats else UserUsageStats()
        
    except Exception as e:
        logger.error(f"Error getting usage stats: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve usage statistics"
        )


@router.get("/me/analytics")
async def get_user_analytics(
    days: int = Query(30, ge=1, le=365, description="Number of days for analytics"),
    current_user: Dict[str, Any] = Depends(get_current_active_user)
):
    """
    Get detailed user analytics
    """
    try:
        await track_api_usage("get_analytics", current_user)
        
        # Get comprehensive user stats
        user_stats = await AuthService.get_user_stats(str(current_user["_id"]))
        
        if not user_stats:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User statistics not found"
            )
        
        return user_stats
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting user analytics: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve analytics"
        )


@router.post("/me/deactivate", response_model=SuccessResponse)
async def deactivate_user_account(
    reason: Optional[str] = None,
    current_user: Dict[str, Any] = Depends(get_current_active_user)
):
    """
    Deactivate user account (soft delete)
    """
    try:
        await track_api_usage("deactivate_account", current_user)
        
        # Deactivate user
        success = await AuthService.deactivate_user(str(current_user["_id"]))
        
        if not success:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to deactivate account"
            )
        
        # Log deactivation reason
        if reason:
            logger.info(f"User {current_user['email']} deactivated account. Reason: {reason}")
        
        return SuccessResponse(
            message="Account deactivated successfully"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deactivating account: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to deactivate account"
        )



# Admin-only endpoints

@router.post("/", response_model=UserResponse)
async def create_user_admin(
    user_in: UserCreate,
    role: UserRole = UserRole.USER,
    tier: SubscriptionTier = SubscriptionTier.FREE,
    is_verified: bool = True,
    current_admin: Dict[str, Any] = Depends(get_current_admin_user)
):
    """
    Create a new user (admin only)
    """
    try:
        await track_api_usage("admin_create_user", current_admin)
        
        # Check if user exists
        existing_user = await AuthService.get_user_by_email(user_in.email)
        if existing_user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User with this email already exists"
            )
            
        # Create user using AuthService
        # Note: AuthService.register_user handles password hashing and basic setup
        new_user_token = await AuthService.register_user(user_in)
        
        # Get the new user
        user = await AuthService.get_user_by_email(user_in.email)
        
        # Post-creation updates (Role, Tier, Verified Status)
        update_data = {
            "role": role,
            "subscription_tier": tier,
            "is_verified": is_verified
        }
        
        # Apply updates directly to DB to bypass some checks if needed, 
        # or use update_user_profile but keys might need to be 'set' directly.
        users_collection = await get_users_collection()
        await users_collection.update_one(
            {"_id": user["_id"]},
            {"$set": update_data}
        )
        
        # Fetch updated user
        updated_user = await get_user_by_id(str(user["_id"]), current_admin)
        
        return UserResponse(
            id=str(updated_user["_id"]),
            email=updated_user["email"],
            first_name=updated_user["first_name"],
            last_name=updated_user["last_name"],
            is_active=updated_user["is_active"],
            is_verified=updated_user["is_verified"],
            subscription_tier=updated_user["subscription_tier"],
            usage_stats=updated_user.get("usage_stats", {}),
            referral_code=updated_user["referral_code"],
            created_at=updated_user["created_at"],
            last_login=updated_user.get("last_login")
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating user: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create user"
        )


@router.get("/", response_model=UserListResponse)
async def list_users(
    query_params: CommonQueryParams = Depends(),
    current_admin: Dict[str, Any] = Depends(get_current_admin_user)
):
    """
    List all users (admin only)
    """
    try:
        await track_api_usage("admin_list_users", current_admin)
        
        users_collection = await get_users_collection()
        
        # Build query
        query = {}
        if query_params.search:
            query["$or"] = [
                {"email": {"$regex": query_params.search, "$options": "i"}},
                {"first_name": {"$regex": query_params.search, "$options": "i"}},
                {"last_name": {"$regex": query_params.search, "$options": "i"}}
            ]
        
        # Get total count
        total = await users_collection.count_documents(query)
        
        # Calculate pagination
        skip = (query_params.page - 1) * query_params.size
        
        # Build sort
        sort_field = query_params.sort_by or "created_at"
        sort_direction = -1 if query_params.sort_order == "desc" else 1
        
        # Get users
        cursor = users_collection.find(query).sort(sort_field, sort_direction).skip(skip).limit(query_params.size)
        users = await cursor.to_list(length=query_params.size)
        
        # Convert to response models
        user_responses = []
        for user in users:
            user_responses.append(UserResponse(
                id=str(user["_id"]),
                email=user["email"],
                first_name=user["first_name"],
                last_name=user["last_name"],
                is_active=user["is_active"],
                is_verified=user["is_verified"],
                subscription_tier=user["subscription_tier"],
                usage_stats=user.get("usage_stats", {}),
                referral_code=user["referral_code"],
                created_at=user["created_at"],
                last_login=user.get("last_login")
            ))
        
        # Calculate pagination info
        pages = (total + query_params.size - 1) // query_params.size
        
        return UserListResponse(
            users=user_responses,
            total=total,
            page=query_params.page,
            size=query_params.size,
            pages=pages
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error listing users: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve users"
        )


@router.get("/{user_id}", response_model=UserResponse)
async def get_user_by_id_admin(
    user_id: str,
    current_admin: Dict[str, Any] = Depends(get_current_admin_user)
):
    """
    Get user by ID (admin only)
    """
    try:
        await track_api_usage("admin_get_user", current_admin)
        
        user = await get_user_by_id(user_id, current_admin)
        
        return UserResponse(
            id=str(user["_id"]),
            email=user["email"],
            first_name=user["first_name"],
            last_name=user["last_name"],
            is_active=user["is_active"],
            is_verified=user["is_verified"],
            subscription_tier=user["subscription_tier"],
            usage_stats=user.get("usage_stats", {}),
            referral_code=user["referral_code"],
            created_at=user["created_at"],
            last_login=user.get("last_login")
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting user by ID: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve user"
        )


@router.put("/{user_id}", response_model=UserResponse)
async def update_user_admin(
    user_id: str,
    user_update: UserUpdate,
    current_admin: Dict[str, Any] = Depends(get_current_admin_user)
):
    """
    Update user by ID (admin only)
    """
    try:
        await track_api_usage("admin_update_user", current_admin)
        
        # Get target user first
        user = await get_user_by_id(user_id, current_admin)
        
        # Update user
        success = await AuthService.update_user_profile(
            user_id,
            user_update.dict(exclude_unset=True)
        )
        
        if not success:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to update user"
            )
        
        # Get updated user
        updated_user = await AuthService.get_user_by_id(user_id)
        
        return UserResponse(
            id=str(updated_user["_id"]),
            email=updated_user["email"],
            first_name=updated_user["first_name"],
            last_name=updated_user["last_name"],
            is_active=updated_user["is_active"],
            is_verified=updated_user["is_verified"],
            subscription_tier=updated_user["subscription_tier"],
            usage_stats=updated_user.get("usage_stats", {}),
            referral_code=updated_user["referral_code"],
            created_at=updated_user["created_at"],
            last_login=updated_user.get("last_login"),
            gmail_connected=bool(updated_user.get("gmail_auth"))
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating user: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update user"
        )


@router.post("/{user_id}/activate", response_model=SuccessResponse)
async def activate_user_admin(
    user_id: str,
    current_admin: Dict[str, Any] = Depends(get_current_admin_user)
):
    """
    Activate user account (admin only)
    """
    try:
        await track_api_usage("admin_activate_user", current_admin)
        
        # Reactivate user
        success = await AuthService.reactivate_user(user_id)
        
        if not success:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to activate user"
            )
        
        logger.info(f"Admin {current_admin['email']} activated user {user_id}")
        
        return SuccessResponse(
            message="User activated successfully"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error activating user: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to activate user"
        )


@router.post("/{user_id}/deactivate", response_model=SuccessResponse)
async def deactivate_user_admin(
    user_id: str,
    reason: Optional[str] = None,
    current_admin: Dict[str, Any] = Depends(get_current_admin_user)
):
    """
    Deactivate user account (admin only)
    """
    try:
        await track_api_usage("admin_deactivate_user", current_admin)
        
        # Deactivate user
        success = await AuthService.deactivate_user(user_id)
        
        if not success:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to deactivate user"
            )
        
        logger.info(f"Admin {current_admin['email']} deactivated user {user_id}. Reason: {reason}")
        
        return SuccessResponse(
            message="User deactivated successfully"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deactivating user: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to deactivate user"
        )


@router.get("/{user_id}/stats")
async def get_user_stats_admin(
    user_id: str,
    current_admin: Dict[str, Any] = Depends(get_current_admin_user)
):
    """
    Get user statistics (admin only)
    """
    try:
        await track_api_usage("admin_get_user_stats", current_admin)
        
        # Get user stats
        user_stats = await AuthService.get_user_stats(user_id)
        
        if not user_stats:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User statistics not found"
            )
        
        return user_stats
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting user stats: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve user statistics"
        )


@router.post("/{user_id}/send-verification", response_model=SuccessResponse)
async def resend_verification_admin(
    user_id: str,
    background_tasks: BackgroundTasks,
    current_admin: Dict[str, Any] = Depends(get_current_admin_user)
):
    """
    Resend email verification (admin only)
    """
    try:
        await track_api_usage("admin_resend_verification", current_admin)
        
        # Get user
        user = await get_user_by_id(user_id, current_admin)
        
        if user["is_verified"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User is already verified"
            )
        
        # Generate verification token
        verification_token = AuthService.create_verification_token(user["email"])
        
        # Send verification email
        background_tasks.add_task(
            EmailService.send_verification_email,
            user["email"],
            user["first_name"],
            verification_token
        )
        
        return SuccessResponse(
            message="Verification email sent successfully"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error resending verification: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to send verification email"
        )


@router.get("/analytics/overview")
async def get_users_analytics_overview(
    days: int = Query(30, ge=1, le=365, description="Number of days for analytics"),
    current_admin: Dict[str, Any] = Depends(get_current_admin_user)
):
    """
    Get user analytics overview (admin only)
    """
    try:
        await track_api_usage("admin_users_analytics", current_admin)
        
        users_collection = await get_users_collection()
        
        # Get user statistics using aggregation
        from app.schemas.user import UserSchema
        
        # Get overall stats
        stats_pipeline = UserSchema.get_user_stats_pipeline()
        stats_result = await users_collection.aggregate(stats_pipeline).to_list(None)
        
        # Get recent registrations
        from datetime import datetime, timedelta
        start_date = datetime.utcnow() - timedelta(days=days)
        
        recent_registrations = await users_collection.count_documents({
            "created_at": {"$gte": start_date}
        })
        
        # Get verification stats
        verified_users = await users_collection.count_documents({"is_verified": True})
        total_users = await users_collection.count_documents({})
        
        # Get subscription distribution
        subscription_stats = await users_collection.aggregate([
            {
                "$group": {
                    "_id": "$subscription_tier",
                    "count": {"$sum": 1}
                }
            }
        ]).to_list(None)
        
        return {
            "total_users": total_users,
            "verified_users": verified_users,
            "verification_rate": verified_users / total_users if total_users > 0 else 0,
            "recent_registrations": recent_registrations,
            "subscription_distribution": {item["_id"]: item["count"] for item in subscription_stats},
            "tier_stats": stats_result,
            "period_days": days
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting users analytics: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve analytics"
        )


@router.get("/search")
async def search_users(
    q: str = Query(..., min_length=2, description="Search query"),
    limit: int = Query(20, ge=1, le=100, description="Maximum results"),
    current_admin: Dict[str, Any] = Depends(get_current_admin_user)
):
    """
    Search users (admin only)
    """
    try:
        await track_api_usage("admin_search_users", current_admin)
        
        users_collection = await get_users_collection()
        
        # Build search query
        search_query = {
            "$or": [
                {"email": {"$regex": q, "$options": "i"}},
                {"first_name": {"$regex": q, "$options": "i"}},
                {"last_name": {"$regex": q, "$options": "i"}},
                {"referral_code": {"$regex": q, "$options": "i"}}
            ]
        }
        
        # Get users
        cursor = users_collection.find(search_query).limit(limit)
        users = await cursor.to_list(length=limit)
        
        # Convert to response format
        results = []
        for user in users:
            results.append({
                "id": str(user["_id"]),
                "email": user["email"],
                "name": f"{user['first_name']} {user['last_name']}",
                "subscription_tier": user["subscription_tier"],
                "is_active": user["is_active"],
                "is_verified": user["is_verified"],
                "created_at": user["created_at"]
            })
        
        return {
            "query": q,
            "results": results,
            "count": len(results)
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error searching users: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to search users"
        )
