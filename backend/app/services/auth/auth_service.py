# backend/app/services/auth_service.py
"""
Authentication service with business logic
"""

from datetime import datetime, timedelta
from typing import Optional, Dict, Any
from bson import ObjectId
import logging

from app.core.security import (
    hash_password, verify_password, create_access_token, create_refresh_token,
    create_verification_token, verify_verification_token,
    create_password_reset_token, verify_password_reset_token,
    generate_referral_code, SecurityValidator
)
from app.database import get_users_collection
from app.models.user import UserCreate, SubscriptionTier, UserUsageStats, UserPreferences
from app.core.config import settings

logger = logging.getLogger(__name__)


class AuthService:
    """Authentication service class"""
    
    ACCESS_TOKEN_EXPIRE_MINUTES = settings.ACCESS_TOKEN_EXPIRE_MINUTES
    REFRESH_TOKEN_EXPIRE_MINUTES = settings.REFRESH_TOKEN_EXPIRE_MINUTES
    
    @classmethod
    async def create_user(cls, user_data: UserCreate) -> Dict[str, Any]:
        """Create a new user account"""
        users_collection = await get_users_collection()
        
        # Validate password strength
        password_validation = SecurityValidator.validate_password_strength(user_data.password)
        if not password_validation["valid"]:
            raise ValueError(f"Password validation failed: {', '.join(password_validation['errors'])}")
        
        # Validate email format
        if not SecurityValidator.validate_email_format(user_data.email):
            raise ValueError("Invalid email format")
        
        # Hash password
        hashed_password = hash_password(user_data.password)
        
        # Generate referral code
        referral_code = generate_referral_code()
        
        # Ensure referral code is unique
        while await users_collection.find_one({"referral_code": referral_code}):
            referral_code = generate_referral_code()
        
        # Create user document
        user_doc = {
            "email": user_data.email.lower(),
            "password": hashed_password,
            "first_name": user_data.first_name,
            "last_name": user_data.last_name,
            "phone": user_data.phone,
            "is_active": True,
            "is_verified": False,
            "role": "user",
            "subscription_tier": SubscriptionTier.FREE,
            "profile": None,
            "usage_stats": UserUsageStats().dict(),
            "preferences": UserPreferences().dict(),
            "referral_code": referral_code,
            "referred_by": None,
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
            "last_login": None,
            "verified_at": None,
            "cv_uploaded_at": None,
            "terms_accepted": user_data.terms_accepted,
            "newsletter_subscription": user_data.newsletter_subscription
        }
        
        # Insert user
        result = await users_collection.insert_one(user_doc)
        user_doc["_id"] = result.inserted_id
        
        logger.info(f"User created: {user_data.email}")
        return user_doc
    
    @classmethod
    async def authenticate_user(cls, email: str, password: str) -> Optional[Dict[str, Any]]:
        """Authenticate user with email and password"""
        users_collection = await get_users_collection()
        
        # Find user by email
        user = await users_collection.find_one({"email": email.lower()})
        if not user:
            return None
        
        # Verify password
        if not verify_password(password, user["password"]):
            return None
        
        return user
    
    @classmethod
    async def get_user_by_email(cls, email: str) -> Optional[Dict[str, Any]]:
        """Get user by email address"""
        users_collection = await get_users_collection()
        return await users_collection.find_one({"email": email.lower()})
    
    @classmethod
    async def get_user_by_id(cls, user_id: str) -> Optional[Dict[str, Any]]:
        """Get user by ID"""
        users_collection = await get_users_collection()
        try:
            object_id = ObjectId(user_id)
            return await users_collection.find_one({"_id": object_id})
        except Exception:
            return None
    
    @classmethod
    async def get_user_by_referral_code(cls, referral_code: str) -> Optional[Dict[str, Any]]:
        """Get user by referral code"""
        users_collection = await get_users_collection()
        return await users_collection.find_one({"referral_code": referral_code.upper()})
    
    @classmethod
    def create_access_token(cls, user_id: str) -> str:
        """Create access token for user"""
        expires_delta = timedelta(minutes=cls.ACCESS_TOKEN_EXPIRE_MINUTES)
        return create_access_token(subject=user_id, expires_delta=expires_delta)
    
    @classmethod
    def create_refresh_token(cls, user_id: str) -> str:
        """Create refresh token for user"""
        expires_delta = timedelta(minutes=cls.REFRESH_TOKEN_EXPIRE_MINUTES)
        return create_refresh_token(subject=user_id, expires_delta=expires_delta)
    
    @classmethod
    def create_verification_token(cls, email: str) -> str:
        """Create email verification token"""
        return create_verification_token(email)
    
    @classmethod
    def verify_verification_token(cls, token: str) -> Optional[str]:
        """Verify email verification token"""
        return verify_verification_token(token)
    
    @classmethod
    def create_password_reset_token(cls, email: str) -> str:
        """Create password reset token"""
        return create_password_reset_token(email)
    
    @classmethod
    def verify_password_reset_token(cls, token: str) -> Optional[str]:
        """Verify password reset token"""
        return verify_password_reset_token(token)
    
    @classmethod
    def verify_password(cls, plain_password: str, hashed_password: str) -> bool:
        """Verify password against hash"""
        return verify_password(plain_password, hashed_password)
    
    @classmethod
    async def update_last_login(cls, user_id: str) -> bool:
        """Update user's last login timestamp"""
        users_collection = await get_users_collection()
        try:
            object_id = ObjectId(user_id)
            result = await users_collection.update_one(
                {"_id": object_id},
                {
                    "$set": {
                        "last_login": datetime.utcnow(),
                        "updated_at": datetime.utcnow()
                    }
                }
            )
            return result.modified_count > 0
        except Exception as e:
            logger.error(f"Failed to update last login: {str(e)}")
            return False
    
    @classmethod
    async def verify_user_email(cls, email: str) -> Optional[Dict[str, Any]]:
        """Mark user email as verified"""
        users_collection = await get_users_collection()
        
        result = await users_collection.update_one(
            {"email": email.lower()},
            {
                "$set": {
                    "is_verified": True,
                    "verified_at": datetime.utcnow(),
                    "updated_at": datetime.utcnow()
                }
            }
        )
        
        if result.modified_count > 0:
            return await users_collection.find_one({"email": email.lower()})
        return None
    
    @classmethod
    async def reset_user_password(cls, email: str, new_password: str) -> Optional[Dict[str, Any]]:
        """Reset user password"""
        users_collection = await get_users_collection()
        
        # Validate new password
        password_validation = SecurityValidator.validate_password_strength(new_password)
        if not password_validation["valid"]:
            raise ValueError(f"Password validation failed: {', '.join(password_validation['errors'])}")
        
        # Hash new password
        hashed_password = hash_password(new_password)
        
        result = await users_collection.update_one(
            {"email": email.lower()},
            {
                "$set": {
                    "password": hashed_password,
                    "updated_at": datetime.utcnow()
                }
            }
        )
        
        if result.modified_count > 0:
            logger.info(f"Password reset for user: {email}")
            return await users_collection.find_one({"email": email.lower()})
        return None
    
    @classmethod
    async def update_user_password(cls, user_id: str, new_password: str) -> bool:
        """Update user password"""
        users_collection = await get_users_collection()
        
        # Validate new password
        password_validation = SecurityValidator.validate_password_strength(new_password)
        if not password_validation["valid"]:
            raise ValueError(f"Password validation failed: {', '.join(password_validation['errors'])}")
        
        # Hash new password
        hashed_password = hash_password(new_password)
        
        try:
            object_id = ObjectId(user_id)
            result = await users_collection.update_one(
                {"_id": object_id},
                {
                    "$set": {
                        "password": hashed_password,
                        "updated_at": datetime.utcnow()
                    }
                }
            )
            
            if result.modified_count > 0:
                logger.info(f"Password updated for user: {user_id}")
                return True
            return False
            
        except Exception as e:
            logger.error(f"Failed to update password: {str(e)}")
            return False
    
    @classmethod
    async def deactivate_user(cls, user_id: str) -> bool:
        """Deactivate user account"""
        users_collection = await get_users_collection()
        
        try:
            object_id = ObjectId(user_id)
            result = await users_collection.update_one(
                {"_id": object_id},
                {
                    "$set": {
                        "is_active": False,
                        "updated_at": datetime.utcnow()
                    }
                }
            )
            
            if result.modified_count > 0:
                logger.info(f"User deactivated: {user_id}")
                return True
            return False
            
        except Exception as e:
            logger.error(f"Failed to deactivate user: {str(e)}")
            return False
    
    @classmethod
    async def reactivate_user(cls, user_id: str) -> bool:
        """Reactivate user account"""
        users_collection = await get_users_collection()
        
        try:
            object_id = ObjectId(user_id)
            result = await users_collection.update_one(
                {"_id": object_id},
                {
                    "$set": {
                        "is_active": True,
                        "updated_at": datetime.utcnow()
                    }
                }
            )
            
            if result.modified_count > 0:
                logger.info(f"User reactivated: {user_id}")
                return True
            return False
            
        except Exception as e:
            logger.error(f"Failed to reactivate user: {str(e)}")
            return False
    
    @classmethod
    async def update_user_profile(cls, user_id: str, profile_data: Dict[str, Any]) -> bool:
        """Update user profile information"""
        users_collection = await get_users_collection()
        
        try:
            object_id = ObjectId(user_id)
            
            # Prepare update data
            update_data = {
                "updated_at": datetime.utcnow()
            }
            
            # Update allowed fields
            allowed_fields = [
                "first_name", "last_name", "full_name", "phone", "profile",
                "preferences", "newsletter_subscription"
            ]
            
            for field in allowed_fields:
                if field in profile_data:
                    update_data[field] = profile_data[field]
            
            result = await users_collection.update_one(
                {"_id": object_id},
                {"$set": update_data}
            )
            
            return result.modified_count > 0
            
        except Exception as e:
            logger.error(f"Failed to update user profile: {str(e)}")
            return False
    
    @classmethod
    async def update_usage_stats(cls, user_id: str, stats_update: Dict[str, Any]) -> bool:
        """Update user usage statistics"""
        users_collection = await get_users_collection()
        
        try:
            object_id = ObjectId(user_id)
            
            # Use MongoDB $inc to increment numeric fields
            inc_fields = {}
            set_fields = {"updated_at": datetime.utcnow()}
            
            for field, value in stats_update.items():
                if isinstance(value, (int, float)) and field != "success_rate":
                    inc_fields[f"usage_stats.{field}"] = value
                else:
                    set_fields[f"usage_stats.{field}"] = value
            
            update_operations = {}
            if inc_fields:
                update_operations["$inc"] = inc_fields
            if set_fields:
                update_operations["$set"] = set_fields
            
            if update_operations:
                result = await users_collection.update_one(
                    {"_id": object_id},
                    update_operations
                )
                return result.modified_count > 0
            
            return False
            
        except Exception as e:
            logger.error(f"Failed to update usage stats: {str(e)}")
            return False
    
    @classmethod
    async def set_referrer(cls, user_id: str, referrer_code: str) -> bool:
        """Set the user who referred this user"""
        users_collection = await get_users_collection()
        
        # Find referrer
        referrer = await cls.get_user_by_referral_code(referrer_code)
        if not referrer:
            return False
        
        try:
            object_id = ObjectId(user_id)
            result = await users_collection.update_one(
                {"_id": object_id, "referred_by": None},  # Only if not already set
                {
                    "$set": {
                        "referred_by": str(referrer["_id"]),
                        "updated_at": datetime.utcnow()
                    }
                }
            )
            
            if result.modified_count > 0:
                logger.info(f"User {user_id} referred by {referrer['_id']}")
                return True
            return False
            
        except Exception as e:
            logger.error(f"Failed to set referrer: {str(e)}")
            return False
    
    @classmethod
    async def get_user_stats(cls, user_id: str) -> Optional[Dict[str, Any]]:
        """Get comprehensive user statistics"""
        users_collection = await get_users_collection()
        
        try:
            object_id = ObjectId(user_id)
            user = await users_collection.find_one(
                {"_id": object_id},
                {"usage_stats": 1, "created_at": 1, "last_login": 1, "subscription_tier": 1}
            )
            
            if not user:
                return None
            
            # Calculate additional stats
            days_since_signup = (datetime.utcnow() - user["created_at"]).days
            usage_stats = user.get("usage_stats", {})
            
            return {
                "basic_stats": usage_stats,
                "account_age_days": days_since_signup,
                "last_login": user.get("last_login"),
                "subscription_tier": user.get("subscription_tier"),
                "avg_daily_searches": usage_stats.get("total_searches", 0) / max(days_since_signup, 1)
            }
            
        except Exception as e:
            logger.error(f"Failed to get user stats: {str(e)}")
            return None

