# backend/app/services/oauth_service.py
"""
OAuth service for Google and LinkedIn authentication
Save this file in: backend/app/services/oauth_service.py
"""

import secrets
import httpx
from typing import Dict, Optional, Tuple
from datetime import datetime, timedelta
import logging

from app.core.config import settings
from app.database import get_users_collection
from .auth_service import AuthService

logger = logging.getLogger(__name__)


class OAuthService:
    """Service for handling OAuth authentication"""
    
    # In-memory storage for OAuth state tokens (simple approach)
    # For production, use Redis or database
    _state_tokens = {}
    
    @staticmethod
    def generate_state_token(metadata: Optional[Dict] = None) -> str:
        """Generate OAuth state token with optional metadata"""
        state = secrets.token_urlsafe(32)
        OAuthService._state_tokens[state] = {
            "created_at": datetime.utcnow(),
            "metadata": metadata or {}
        }
        return state
    
    @staticmethod
    def verify_state_token(state: str) -> Tuple[bool, Optional[Dict]]:
        """Verify OAuth state token and return metadata"""
        if state in OAuthService._state_tokens:
            token_data = OAuthService._state_tokens.pop(state) # Remove after use
            # Check expiration (e.g. 10 mins)
            if datetime.utcnow() - token_data["created_at"] > timedelta(minutes=10):
                return False, None
            return True, token_data.get("metadata")
        return False, None
        
    # Re-implementing correct return type hint helper if needed or just use logic in caller
    # ideally verify_state_token returns (is_valid, metadata)
    
    # ============ GOOGLE OAUTH ============
    
    @staticmethod
    def get_google_auth_url(location_data: Optional[Dict] = None, referral_code: Optional[str] = None) -> Tuple[str, str]:
        """Generate Google OAuth authorization URL"""
        state = OAuthService.generate_state_token(metadata={
            "location": location_data,
            "referral_code": (referral_code or "").strip() or None
        })
        
        params = {
            "client_id": settings.GOOGLE_CLIENT_ID,
            "redirect_uri": settings.GOOGLE_REDIRECT_URI,
            "response_type": "code",
            "scope": "openid email profile",
            "access_type": "offline",
            "state": state,
            "prompt": "select_account"
        }
        
        from urllib.parse import urlencode
        auth_url = f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}"
        return auth_url, state
    
    @staticmethod
    async def exchange_google_code(code: str) -> Optional[Dict]:
        """Exchange Google authorization code for tokens"""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    "https://oauth2.googleapis.com/token",
                    data={
                        "code": code,
                        "client_id": settings.GOOGLE_CLIENT_ID,
                        "client_secret": settings.GOOGLE_CLIENT_SECRET,
                        "redirect_uri": settings.GOOGLE_REDIRECT_URI,
                        "grant_type": "authorization_code"
                    }
                )
                
                if response.status_code == 200:
                    return response.json()
                else:
                    logger.error(f"Google token exchange failed: {response.text}")
                    return None
                    
        except Exception as e:
            logger.error(f"Error exchanging Google code: {str(e)}")
            return None
    
    @staticmethod
    async def get_google_user_info(access_token: str) -> Optional[Dict]:
        """Get user info from Google"""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    "https://www.googleapis.com/oauth2/v2/userinfo",
                    headers={"Authorization": f"Bearer {access_token}"}
                )
                
                if response.status_code == 200:
                    return response.json()
                else:
                    logger.error(f"Google user info failed: {response.text}")
                    return None
                    
        except Exception as e:
            logger.error(f"Error getting Google user info: {str(e)}")
            return None
    
    # ============ LINKEDIN OAUTH ============
    
    @staticmethod
    def get_linkedin_auth_url(referral_code: Optional[str] = None) -> Tuple[str, str]:
        """Generate LinkedIn OAuth authorization URL"""
        state = OAuthService.generate_state_token(metadata={
            "referral_code": (referral_code or "").strip() or None
        })
        
        params = {
        "response_type": "code",
        "client_id": settings.LINKEDIN_CLIENT_ID,
        "redirect_uri": settings.LINKEDIN_REDIRECT_URI,
        "scope": "openid profile email",  
        "state": state
    }
        
        from urllib.parse import urlencode
        auth_url = f"https://www.linkedin.com/oauth/v2/authorization?{urlencode(params)}"
        return auth_url, state
    
    @staticmethod
    async def exchange_linkedin_code(code: str) -> Optional[Dict]:
        """Exchange LinkedIn authorization code for tokens"""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    "https://www.linkedin.com/oauth/v2/accessToken",
                    data={
                        "grant_type": "authorization_code",
                        "code": code,
                        "client_id": settings.LINKEDIN_CLIENT_ID,
                        "client_secret": settings.LINKEDIN_CLIENT_SECRET,
                        "redirect_uri": settings.LINKEDIN_REDIRECT_URI
                    },
                    headers={"Content-Type": "application/x-www-form-urlencoded"}
                )
                
                if response.status_code == 200:
                    return response.json()
                else:
                    logger.error(f"LinkedIn token exchange failed: {response.text}")
                    return None
                    
        except Exception as e:
            logger.error(f"Error exchanging LinkedIn code: {str(e)}")
            return None
    
    @staticmethod
    async def get_linkedin_user_info(access_token: str) -> Optional[Dict]:
        """Get user info from LinkedIn"""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    "https://api.linkedin.com/v2/userinfo",
                    headers={"Authorization": f"Bearer {access_token}"}
                )
                
                if response.status_code == 200:
                    return response.json()
                else:
                    logger.error(f"LinkedIn user info failed: {response.text}")
                    return None
                    
        except Exception as e:
            logger.error(f"Error getting LinkedIn user info: {str(e)}")
            return None
    
    # ============ USER HANDLING ============
    
    @staticmethod
    async def handle_oauth_user(
        email: str,
        first_name: str,
        last_name: str,
        oauth_provider: str,
        oauth_id: str,
        location_data: Optional[Dict] = None,
        registration_ip: Optional[str] = None
    ) -> Tuple[Dict, str, bool]:
        """
        Handle OAuth user - create or login
        Returns: (user, token, is_new_user)
        """
        users_collection = await get_users_collection()
        
        # Check if user exists
        user = await users_collection.find_one({"email": email})
        is_new_user = False
        
        # Helper to construct location update
        location_update = {}
        if location_data:
            location_update = {"profile.location_preferences.country": location_data}

        if user:
            update_data = {
                f"oauth.{oauth_provider}": {
                    "id": oauth_id,
                    "connected_at": datetime.utcnow()
                },
                "last_login": datetime.utcnow(),
                "is_verified": True
            }
            
            # Update location if missing in current profile
            current_country = user.get("profile", {}).get("location_preferences", {}).get("country")
            if location_data and (not current_country or current_country.get("code") != location_data.get("code")):
                 update_data["profile.location_preferences.country"] = location_data

            # Update OAuth info and last login
            await users_collection.update_one(
                {"_id": user["_id"]},
                {"$set": update_data}
            )
            user = await users_collection.find_one({"_id": user["_id"]})
        else:
            # Create new user
            
            # Check Registration IP Limit
            if registration_ip:
                from .security_service import SecurityService
                if not await SecurityService.check_registration_ip_limit(registration_ip):
                     from fastapi import HTTPException
                     raise HTTPException(status_code=400, detail="Maximum number of accounts reached for this device/network.")

            is_new_user = True
            
            # Generate unique referral code
            import random
            import string
            referral_code = ''.join(random.choices(string.ascii_uppercase + string.digits, k=8))
            
            user_doc = {
                "email": email,
                "first_name": first_name,
                "last_name": last_name,
                "password": None,  # OAuth users don't have password initially
                "is_active": True,
                "is_verified": True,
                "verified_at": datetime.utcnow(),
                "role": "user",
                "subscription_tier": "free",
                "oauth": {
                    oauth_provider: {
                        "id": oauth_id,
                        "connected_at": datetime.utcnow()
                    }
                },
                "referral_code": referral_code,
                "created_at": datetime.utcnow(),
                "registration_ip": registration_ip,
                "updated_at": datetime.utcnow(),
                "last_login": datetime.utcnow(),
                # Initialize profile with location if provided
                "profile": {
                     "location_preferences": {
                          "country": location_data
                     }
                } if location_data else {},
                "usage_stats": {
                    "total_searches": 0,
                    "total_applications": 0,
                    "monthly_searches": 0
                }
            }
            
            result = await users_collection.insert_one(user_doc)
            user = await users_collection.find_one({"_id": result.inserted_id})
        
        # Create access token using your existing auth service
        from app.core.security import create_access_token
        token = create_access_token(str(user["_id"]))
        
        return user, token, is_new_user