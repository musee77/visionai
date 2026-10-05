# backend/app/api/auth.py
"""
CVision Authentication API - Frontend Compatible
"""

from fastapi import APIRouter, HTTPException, status, Depends, Request
from fastapi.security import HTTPBearer
from pydantic import BaseModel, EmailStr
from datetime import datetime, timedelta
from typing import Optional
from bson import ObjectId
from fastapi.responses import RedirectResponse

# Import centralized security functions
from app.core.security import (
    hash_password,
    verify_password,
    create_access_token,
    create_password_reset_token,
    verify_password_reset_token,
    get_client_ip
)
from app.dependencies import get_current_user, get_current_active_user
from app.services.auth.oauth_service import OAuthService
from app.core.config import settings
from app.database import get_users_collection
from app.services.emails.email_service import EmailService
from app.services.emails.gmail_service import gmail_service
from app.services.auth.password_service import PasswordService
from app.models.user import GmailAuth

import logging
logger = logging.getLogger(__name__)

router = APIRouter()
security = HTTPBearer()


def _clean_referral_code(code: Optional[str]) -> Optional[str]:
    cleaned = (code or "").strip()
    if not cleaned or len(cleaned) > 32:
        return None
    if not all(ch.isalnum() or ch in "-_" for ch in cleaned):
        return None
    return cleaned


async def _attach_signup_referral(user_id: str, email: str, code: Optional[str]) -> None:
    cleaned = _clean_referral_code(code)
    if not cleaned:
        return
    try:
        from app.database import get_database
        from app.services.core.referral_service import ReferralService
        db = await get_database()
        await ReferralService(db).record_signup(
            referee_user_id=str(user_id),
            referee_email=email,
            code=cleaned
        )
    except Exception as referral_error:
        logger.warning(f"Referral was not recorded for {email}: {referral_error}")


# Pydantic models
class UserRegister(BaseModel):
    email: EmailStr
    password: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    referral_code: Optional[str] = None


class LocationData(BaseModel):
    code: str
    name: str
    currency: str

class UserLogin(BaseModel):
    email: EmailStr
    password: str
    remember_me: Optional[bool] = False
    location: Optional[LocationData] = None


class UserResponse(BaseModel):
    id: str
    email: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    full_name: Optional[str] = None  # Added for frontend compatibility
    subscription_tier: str
    created_at: str
    gmail_connected: bool = False


class APIResponse(BaseModel):
    success: bool
    message: str
    data: Optional[dict] = None


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str


class VerifyEmailRequest(BaseModel):
    token: str


class ResendVerificationRequest(BaseModel):
    email: EmailStr


# API Routes
@router.post("/register", response_model=APIResponse)
async def register(user_data: UserRegister, request: Request):
    """Register new user in CVision"""
    try:
        users_collection = await get_users_collection()
        
        # Check if user exists
        existing_user = await users_collection.find_one({"email": user_data.email})
        if existing_user:
            return APIResponse(
                success=False,
                message="Email already registered"
            )
            
        # Check IP Registration Limit using reusable service
        from app.services.auth.security_service import SecurityService
        client_ip = get_client_ip(request)
        
        if not await SecurityService.check_registration_ip_limit(client_ip):
            return APIResponse(
                success=False,
                message="Maximum number of accounts reached for this device/network."
            )
        
        # Generate unique referral code
        def generate_unique_referral_code():
            import random
            import string
            return ''.join(random.choices(string.ascii_uppercase + string.digits, k=8))
        
        # Ensure referral code is unique
        referral_code = None
        max_attempts = 5
        for attempt in range(max_attempts):
            temp_code = generate_unique_referral_code()
            existing_referral = await users_collection.find_one({"referral_code": temp_code})
            if not existing_referral:
                referral_code = temp_code
                break
        
        # If we couldn't generate a unique code, leave it as None (will be handled by partial index)
        if not referral_code:
            logger.warning("Could not generate unique referral code after 5 attempts")
        
        # Create user document with verification pending
        user_doc = {
            "email": user_data.email,
            "password": hash_password(user_data.password),
            "first_name": user_data.first_name or "",
            "last_name": user_data.last_name or "",
            "referral_code": referral_code,
            "subscription_tier": "free",
            "is_active": True,
            "is_verified": False,   # Require verification
            "created_at": datetime.utcnow(),
            "registration_ip": client_ip,
            "usage_stats": {
                "monthly_searches": 0,
                "total_applications": 0
            }
        }
        
        result = await users_collection.insert_one(user_doc)
        user_doc["_id"] = result.inserted_id

        if user_data.referral_code:
            await _attach_signup_referral(
                str(result.inserted_id),
                user_data.email,
                user_data.referral_code
            )
        
        # detailed user creation for auth service hook? No, keep it simple here or use AuthService
        
        # Create verification token and send email
        from app.services.auth.auth_service import AuthService
        verification_token = AuthService.create_verification_token(user_data.email)
        
        # Send verification email
        full_name = f"{user_doc['first_name']} {user_doc['last_name']}".strip()
        await EmailService.send_verification_email(
            email=user_data.email,
            full_name=full_name,
            verification_token=verification_token
        )
        
        return APIResponse(
            success=True,
            message="Registration successful. Please check your email to verify your account.",
            data=None # No tokens returned until verification
        )
        
    except Exception as e:
        # Handle specific MongoDB duplicate key errors
        if "E11000" in str(e) and "referral_code" in str(e):
            return APIResponse(
                success=False,
                message="Registration temporarily unavailable. Please try again."
            )
        elif "E11000" in str(e) and "email" in str(e):
            return APIResponse(
                success=False,
                message="Email already registered"
            )
        else:
            # Log the full error for debugging but return user-friendly message
            logger.error(f"Registration error: {str(e)}")
            return APIResponse(
                success=False,
                message="Registration failed. Please try again."
            )


@router.post("/login", response_model=APIResponse)
async def login(login_data: UserLogin):
    """Login to CVision"""
    try:
        users_collection = await get_users_collection()
        
        # Find user
        user = await users_collection.find_one({"email": login_data.email})
        if not user or not verify_password(login_data.password, user["password"]):
            return APIResponse(
                success=False,
                message="Invalid email or password"
            )
            
        # Check if user is verified
        if not user.get("is_verified", False):
            return APIResponse(
                success=False,
                message="Email not verified. Please check your inbox or request a new verification link."
            )
        
        # Determine token expiration based on remember_me
        if login_data.remember_me:
            # Remember Me: 1 day access token, 30 days refresh token
            access_token_expires = timedelta(minutes=settings.REMEMBER_ME_ACCESS_TOKEN_EXPIRE_MINUTES)
            refresh_token_expires = timedelta(minutes=settings.REMEMBER_ME_REFRESH_TOKEN_EXPIRE_MINUTES)
        else:
            # Regular: 30 min access token, 7 days refresh token
            access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
            refresh_token_expires = timedelta(minutes=settings.REFRESH_TOKEN_EXPIRE_MINUTES)
        
        # Update location if provided and different/missing
        if login_data.location:
            current_location = user.get("profile", {}).get("location_preferences", {}).get("country")
            should_update_location = False
            
            if not current_location:
                 should_update_location = True
            elif isinstance(current_location, dict) and current_location.get("code") != login_data.location.code:
                 should_update_location = True
            
            if should_update_location:
                try:
                    await users_collection.update_one(
                        {"_id": user["_id"]},
                        {
                            "$set": {
                                "profile.location_preferences.country": login_data.location.dict()
                            }
                        }
                    )
                except Exception as ex:
                     logger.warning(f"Failed to update location for user {user['_id']}: {ex}")

        # Create tokens using centralized function with custom expiration
        from app.core.security import create_refresh_token
        access_token = create_access_token(str(user["_id"]), expires_delta=access_token_expires)
        refresh_token = create_refresh_token(str(user["_id"]), expires_delta=refresh_token_expires)
        
        # Create full_name for frontend compatibility
        full_name = f"{user.get('first_name', '')} {user.get('last_name', '')}".strip()
        if not full_name:
            full_name = user["email"].split("@")[0]  # Fallback to email prefix
        
        user_response = {
            "id": str(user["_id"]),
            "email": user["email"],
            "first_name": user.get("first_name", ""),
            "last_name": user.get("last_name", ""),
            "full_name": full_name,
            "role": user.get("role", "user"),
            "subscription_tier": user["subscription_tier"],
            "created_at": user["created_at"].isoformat(),
            "gmail_connected": bool(user.get("gmail_auth"))
        }
        
        return APIResponse(
            success=True,
            message="Login successful",
            data={
                "access_token": access_token,
                "refresh_token": refresh_token,
                "token_type": "bearer",
                "user": user_response,
                "remember_me": login_data.remember_me
            }
        )
        
    except Exception as e:
        logger.error(f"Login error: {str(e)}")
        return APIResponse(
            success=False,
            message=f"Login failed: {str(e)}"
        )


class RefreshTokenRequest(BaseModel):
    refresh_token: str


@router.post("/refresh", response_model=APIResponse)
async def refresh_token_endpoint(request: RefreshTokenRequest):
    """Refresh access token using refresh token"""
    try:
        from app.core.security import verify_refresh_token
        
        # Verify refresh token
        payload = verify_refresh_token(request.refresh_token)
        if not payload:
            return APIResponse(
                success=False,
                message="Invalid or expired refresh token"
            )
        
        user_id = payload.get("sub")
        if not user_id:
            return APIResponse(
                success=False,
                message="Invalid token payload"
            )
        
        # Verify user still exists
        users_collection = await get_users_collection()
        user = await users_collection.find_one({"_id": ObjectId(user_id)})
        if not user:
            return APIResponse(
                success=False,
                message="User not found"
            )
        
        # Create new access token with same expiration as original
        # Check if this was a "remember me" token by checking expiration
        token_exp = payload.get("exp")
        token_iat = payload.get("iat")
        
        if token_exp and token_iat:
            token_lifetime_minutes = (token_exp - token_iat) / 60
            # If refresh token lifetime is ~30 days, it's a remember_me token
            is_remember_me = token_lifetime_minutes > 20000  # > ~14 days
            
            if is_remember_me:
                access_token_expires = timedelta(minutes=settings.REMEMBER_ME_ACCESS_TOKEN_EXPIRE_MINUTES)
            else:
                access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
        else:
            # Default to regular expiration
            access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
        
        new_access_token = create_access_token(user_id, expires_delta=access_token_expires)
        
        return APIResponse(
            success=True,
            message="Token refreshed successfully",
            data={
                "access_token": new_access_token,
                "token_type": "bearer"
            }
        )
        
    except Exception as e:
        logger.error(f"Token refresh error: {str(e)}")
        return APIResponse(
            success=False,
            message="Failed to refresh token"
        )


@router.post("/logout", response_model=APIResponse)
async def logout(current_user: dict = Depends(get_current_user)):
    """Logout user"""
    return APIResponse(
        success=True,
        message="Logged out successfully"
    )


@router.get("/me", response_model=APIResponse)
async def get_current_user_info(current_user: dict = Depends(get_current_active_user)):
    """Get current user info"""
    try:
        # Create full_name for frontend compatibility
        full_name = f"{current_user.get('first_name', '')} {current_user.get('last_name', '')}".strip()
        if not full_name:
            full_name = current_user["email"].split("@")[0]  # Fallback to email prefix
        
        user_response = {
            "id": str(current_user["_id"]),
            "email": current_user["email"],
            "first_name": current_user.get("first_name", ""),
            "last_name": current_user.get("last_name", ""),
            "full_name": full_name,
            "subscription_tier": current_user["subscription_tier"],
            "created_at": current_user["created_at"].isoformat(),
            "gmail_connected": bool(current_user.get("gmail_auth"))
        }
        
        return APIResponse(
            success=True,
            message="Profile retrieved successfully",
            data={"user": user_response}
        )
        
    except Exception as e:
        logger.error(f"Get user info error: {str(e)}")
        return APIResponse(
            success=False,
            message=f"Failed to retrieve profile: {str(e)}"
        )


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


@router.post("/change-password", response_model=APIResponse)
async def change_password(
    request: ChangePasswordRequest,
    current_user: dict = Depends(get_current_active_user)
):
    """Change user password"""
    result = await PasswordService.change_password(
        user_id=str(current_user["_id"]),
        current_password=request.current_password,
        new_password=request.new_password
    )
    
    return APIResponse(
        success=result["success"],
        message=result["message"]
    )


@router.post("/forgot-password", response_model=APIResponse)
async def forgot_password(request: ForgotPasswordRequest):
    """Initiate password reset flow"""
    # Service handles the logic (including fake delays for security)
    success = await PasswordService.request_password_reset(request.email)
    
    if success:
        return APIResponse(
            success=True,
            message="If an account exists with this email, a password reset link has been sent."
        )
    else:
        return APIResponse(
            success=False,
            message="An error occurred while processing your request"
        )


@router.post("/reset-password", response_model=APIResponse)
async def reset_password(request: ResetPasswordRequest):
    """Reset password using token"""
    result = await PasswordService.reset_password(request.token, request.new_password)
    
    return APIResponse(
        success=result["success"],
        message=result["message"]
    )



@router.post("/verify-email", response_model=APIResponse)
async def verify_email(request: VerifyEmailRequest):
    """Verify user email with token"""
    from app.services.auth.auth_service import AuthService
    
    # Verify token
    email = AuthService.verify_verification_token(request.token)
    if not email:
        return APIResponse(
            success=False,
            message="Invalid or expired verification token"
        )
        
    # Mark user as verified
    user = await AuthService.verify_user_email(email)
    if not user:
        return APIResponse(
            success=False,
            message="User not found or already verified"
        )
        
    return APIResponse(
        success=True,
        message="Email verified successfully. You can now login."
    )


@router.post("/resend-verification", response_model=APIResponse)
async def resend_verification(request: ResendVerificationRequest):
    """Resend email verification link"""
    users_collection = await get_users_collection()
    user = await users_collection.find_one({"email": request.email})
    
    if not user:
        # Return success to prevent email enumeration, but do nothing
        return APIResponse(
            success=True,
            message="If an account exists, a verification link has been sent."
        )
        
    if user.get("is_verified", False):
        return APIResponse(
            success=True,
            message="Account is already verified. Please login."
        )
        
    # Generate new token and send email
    from app.services.auth.auth_service import AuthService
    verification_token = AuthService.create_verification_token(request.email)
    
    full_name = f"{user.get('first_name', '')} {user.get('last_name', '')}".strip()
    await EmailService.send_verification_email(
        email=request.email,
        full_name=full_name,
        verification_token=verification_token
    )
    
    return APIResponse(
        success=True,
        message="Verification link sent. Please check your email."
    )


# ============ GOOGLE OAUTH ROUTES ============

import json

@router.get("/google/login")
async def google_login(location: Optional[str] = None, ref: Optional[str] = None):
    """Initiate Google OAuth flow"""
    try:
        location_data = None
        if location:
            try:
                location_data = json.loads(location)
            except Exception:
                pass
                
        auth_url, state = OAuthService.get_google_auth_url(
            location_data=location_data,
            referral_code=_clean_referral_code(ref)
        )
        return {
            "success": True,
            "auth_url": auth_url,
            "state": state
        }
    except Exception as e:
        logger.error(f"Google login failed: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to initiate Google login")


@router.get("/google/callback")
async def google_callback(code: str, state: str, request: Request):
    """Handle Google OAuth callback"""
    try:
        is_valid, metadata = OAuthService.verify_state_token(state)
        if not is_valid:
            return RedirectResponse(url=f"{settings.FRONTEND_URL}/login.html?error=invalid_state")
        
        tokens = await OAuthService.exchange_google_code(code)
        if not tokens:
            return RedirectResponse(url=f"{settings.FRONTEND_URL}/login.html?error=token_failed")
        
        user_info = await OAuthService.get_google_user_info(tokens["access_token"])
        if not user_info:
            return RedirectResponse(url=f"{settings.FRONTEND_URL}/login.html?error=user_info_failed")
            
        # Get client IP for registration limit check
        client_ip = get_client_ip(request)
        
        user, token, is_new = await OAuthService.handle_oauth_user(
            email=user_info["email"],
            first_name=user_info.get("given_name", ""),
            last_name=user_info.get("family_name", ""),
            oauth_provider="google",
            oauth_id=user_info["id"],
            location_data=metadata.get("location") if metadata else None,
            registration_ip=client_ip
        )
        if is_new and metadata and metadata.get("referral_code"):
            await _attach_signup_referral(
                str(user["_id"]),
                user_info["email"],
                metadata.get("referral_code")
            )
        
        redirect_url = f"{settings.FRONTEND_URL}/auth-callback.html?token={token}&provider=google"
        if is_new:
            redirect_url += "&new_user=true"
        
        return RedirectResponse(url=redirect_url)
        
    except Exception as e:
        logger.error(f"Google callback error: {str(e)}")
        return RedirectResponse(url=f"{settings.FRONTEND_URL}/login.html?error=auth_failed")


# ============ LINKEDIN OAUTH ROUTES ============

@router.get("/linkedin/login")
async def linkedin_login(ref: Optional[str] = None):
    """Initiate LinkedIn OAuth flow"""
    try:
        auth_url, state = OAuthService.get_linkedin_auth_url(
            referral_code=_clean_referral_code(ref)
        )
        logger.info(f"LinkedIn login URL: {auth_url}")
        return {
            "success": True,
            "auth_url": auth_url,
            "state": state
        }
    except Exception as e:
        logger.error(f"LinkedIn login failed: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to initiate LinkedIn login")


@router.get("/linkedin/callback")
async def linkedin_callback(code: str, state: str):
    """Handle LinkedIn OAuth callback"""
    try:
        is_valid, metadata = OAuthService.verify_state_token(state)
        if not is_valid:
            return RedirectResponse(url=f"{settings.FRONTEND_URL}/login.html?error=invalid_state")
        
        tokens = await OAuthService.exchange_linkedin_code(code)
        if not tokens:
            return RedirectResponse(url=f"{settings.FRONTEND_URL}/login.html?error=token_failed")
        
        user_info = await OAuthService.get_linkedin_user_info(tokens["access_token"])
        if not user_info:
            return RedirectResponse(url=f"{settings.FRONTEND_URL}/login.html?error=user_info_failed")
        
        user, token, is_new = await OAuthService.handle_oauth_user(
            email=user_info["email"],
            first_name=user_info.get("given_name", ""),
            last_name=user_info.get("family_name", ""),
            oauth_provider="linkedin",
            oauth_id=user_info["sub"]
        )
        if is_new and metadata and metadata.get("referral_code"):
            await _attach_signup_referral(
                str(user["_id"]),
                user_info["email"],
                metadata.get("referral_code")
            )
        
        redirect_url = f"{settings.FRONTEND_URL}/auth-callback.html?token={token}&provider=linkedin"
        if is_new:
            redirect_url += "&new_user=true"
        
        return RedirectResponse(url=redirect_url)
        
    except Exception as e:
        logger.error(f"LinkedIn callback error: {str(e)}")
        return RedirectResponse(url=f"{settings.FRONTEND_URL}/login.html?error=auth_failed")


# ============ GMAIL INTEGRATION ROUTES ============

@router.get("/gmail/connect")
async def connect_gmail(current_user: dict = Depends(get_current_active_user)):
    """Initiate Gmail connection flow"""
    try:
        # Pass user ID in state to verify on callback
        state = str(current_user["_id"])
        auth_url = gmail_service.get_authorization_url(state=state)
        
        return APIResponse(
            success=True,
            message="Gmail connection initiated",
            data={"auth_url": auth_url}
        )
    except Exception as e:
        logger.error(f"Gmail connect failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to initiate Gmail connection: {str(e)}")


@router.get("/gmail/callback")
async def gmail_callback(code: str, state: Optional[str] = None):
    """Handle Gmail OAuth callback"""
    try:
        # Exchange code for tokens
        token_data = gmail_service.exchange_code_for_token(code)
        
        # Create GmailAuth object
        gmail_auth = GmailAuth(**token_data)
        
        # Get user email address from Gmail API to confirm
        profile = gmail_service.get_profile(gmail_auth)
        gmail_auth.email_address = profile.get("emailAddress")
        
        # We need to identify the user. 
        # Since this is a callback, we might not have the auth header.
        # We should ideally pass the user ID in the 'state' parameter.
        # For now, let's assume the state contains the user ID.
        if not state:
             return RedirectResponse(url=f"{settings.FRONTEND_URL}/dashboard.html?error=invalid_state")

        user_id = state
        users_collection = await get_users_collection()
        
        # Update user with gmail_auth
        await users_collection.update_one(
            {"_id": ObjectId(user_id)},
            {"$set": {"gmail_auth": gmail_auth.dict()}}
        )
        
        return RedirectResponse(url=f"{settings.FRONTEND_URL}/dashboard.html?gmail_connected=true")
        
    except Exception as e:
        logger.error(f"Gmail callback error: {str(e)}")
        return RedirectResponse(url=f"{settings.FRONTEND_URL}/dashboard.html?error=gmail_connection_failed&details={str(e)}")