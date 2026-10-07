# backend/app/core/security.py
"""
Security utilities for authentication and authorization
"""

import jwt
import bcrypt
# Monkey patch for passlib 1.7.4 compatibility with bcrypt >= 4.0.0
if not hasattr(bcrypt, '__about__'):
    try:
        class About:
            __version__ = bcrypt.__version__
        bcrypt.__about__ = About()
    except Exception:
        pass
from datetime import datetime, timedelta
from typing import Optional, Dict, Any
import secrets
import hashlib
import hmac
import time
from passlib.context import CryptContext
from fastapi import HTTPException, status
import logging

from app.core.config import settings

logger = logging.getLogger(__name__)


def sign_oauth_state(user_id: str) -> str:
    """Bind an OAuth callback to one user for a short time."""
    issued = str(int(time.time()))
    payload = f"{user_id}.{issued}"
    signature = hmac.new(
        settings.JWT_SECRET_KEY.encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"{payload}.{signature}"


def read_oauth_state(state: str, max_age_seconds: int = 900) -> str:
    """Return the user id from a signed OAuth state, or raise ValueError."""
    parts = (state or "").split(".")
    if len(parts) != 3:
        raise ValueError("Invalid state")
    user_id, issued, signature = parts
    payload = f"{user_id}.{issued}"
    expected = hmac.new(
        settings.JWT_SECRET_KEY.encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise ValueError("Invalid state")
    if int(time.time()) - int(issued) > max_age_seconds:
        raise ValueError("State expired")
    if not user_id:
        raise ValueError("Invalid state")
    return user_id

# Password hashing context
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


class SecurityUtils:
    """Security utility functions"""
    
    @staticmethod
    def hash_password(password: str) -> str:
        """Hash a password using bcrypt"""
        return pwd_context.hash(password)
    
    @staticmethod
    def verify_password(plain_password: str, hashed_password: str) -> bool:
        """Verify a password against its hash"""
        return pwd_context.verify(plain_password, hashed_password)
    
    @staticmethod
    def generate_random_token(length: int = 32) -> str:
        """Generate a secure random token"""
        return secrets.token_urlsafe(length)
    
    @staticmethod
    def generate_numeric_code(length: int = 6) -> str:
        """Generate a numeric code for verification"""
        return ''.join([str(secrets.randbelow(10)) for _ in range(length)])
    
    @staticmethod
    def hash_data(data: str, salt: Optional[str] = None) -> str:
        """Hash data with optional salt"""
        if salt:
            data = f"{data}{salt}"
        return hashlib.sha256(data.encode()).hexdigest()


class JWTManager:
    """JWT token management"""
    
    @staticmethod
    def create_access_token(
        data: Dict[str, Any], 
        expires_delta: Optional[timedelta] = None
    ) -> str:
        """Create an access token"""
        to_encode = data.copy()
        
        if expires_delta:
            expire = datetime.utcnow() + expires_delta
        else:
            expire = datetime.utcnow() + timedelta(
                minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
            )
        
        to_encode.update({
            "exp": expire,
            "iat": datetime.utcnow(),
            "type": "access"
        })
        
        return jwt.encode(
            to_encode, 
            settings.JWT_SECRET_KEY, 
            algorithm=settings.JWT_ALGORITHM
        )
    
    @staticmethod
    def create_refresh_token(
        data: Dict[str, Any], 
        expires_delta: Optional[timedelta] = None
    ) -> str:
        """Create a refresh token"""
        to_encode = data.copy()
        
        if expires_delta:
            expire = datetime.utcnow() + expires_delta
        else:
            expire = datetime.utcnow() + timedelta(
                minutes=settings.REFRESH_TOKEN_EXPIRE_MINUTES
            )
        
        to_encode.update({
            "exp": expire,
            "iat": datetime.utcnow(),
            "type": "refresh"
        })
        
        return jwt.encode(
            to_encode, 
            settings.JWT_SECRET_KEY, 
            algorithm=settings.JWT_ALGORITHM
        )
    
    @staticmethod
    def create_verification_token(email: str) -> str:
        """Create an email verification token"""
        data = {
            "email": email,
            "type": "verification",
            "exp": datetime.utcnow() + timedelta(hours=24)
        }
        
        return jwt.encode(
            data, 
            settings.JWT_SECRET_KEY, 
            algorithm=settings.JWT_ALGORITHM
        )
    
    @staticmethod
    def create_password_reset_token(email: str) -> str:
        """Create a password reset token"""
        data = {
            "email": email,
            "type": "password_reset",
            "exp": datetime.utcnow() + timedelta(
                hours=settings.PASSWORD_RESET_TOKEN_EXPIRE_HOURS
            )
        }
        
        return jwt.encode(
            data, 
            settings.JWT_SECRET_KEY, 
            algorithm=settings.JWT_ALGORITHM
        )
    
    @staticmethod
    def verify_token(token: str, token_type: str = None) -> Optional[Dict[str, Any]]:
        """Verify and decode a JWT token"""
        try:
            payload = jwt.decode(
                token, 
                settings.JWT_SECRET_KEY, 
                algorithms=[settings.JWT_ALGORITHM]
            )
            
            # Check token type if specified
            if token_type and payload.get("type") != token_type:
                return None
            
            return payload
            
        except jwt.ExpiredSignatureError:
            logger.warning("Token has expired")
            return None
        except jwt.InvalidTokenError as e:
            logger.warning(f"Invalid token: {str(e)}")
            return None
        except Exception as e:
            logger.error(f"Token verification error: {str(e)}")
            return None


# Convenience functions using the classes above
def hash_password(password: str) -> str:
    """Hash a password"""
    return SecurityUtils.hash_password(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password"""
    return SecurityUtils.verify_password(plain_password, hashed_password)


def create_access_token(subject: str, expires_delta: Optional[timedelta] = None) -> str:
    """Create an access token"""
    return JWTManager.create_access_token(
        data={"sub": subject}, 
        expires_delta=expires_delta
    )


def create_refresh_token(subject: str, expires_delta: Optional[timedelta] = None) -> str:
    """Create a refresh token"""
    return JWTManager.create_refresh_token(
        data={"sub": subject}, 
        expires_delta=expires_delta
    )


def verify_access_token(token: str) -> Optional[Dict[str, Any]]:
    """Verify an access token"""
    result = JWTManager.verify_token(token, token_type=None)
    return result


def verify_refresh_token(token: str) -> Optional[Dict[str, Any]]:
    """Verify a refresh token"""
    return JWTManager.verify_token(token, token_type="refresh")


def create_verification_token(email: str) -> str:
    """Create an email verification token"""
    return JWTManager.create_verification_token(email)


def verify_verification_token(token: str) -> Optional[str]:
    """Verify an email verification token and return email"""
    payload = JWTManager.verify_token(token, token_type="verification")
    return payload.get("email") if payload else None


def create_password_reset_token(email: str) -> str:
    """Create a password reset token"""
    return JWTManager.create_password_reset_token(email)


def verify_password_reset_token(token: str) -> Optional[str]:
    """Verify a password reset token and return email"""
    payload = JWTManager.verify_token(token, token_type="password_reset")
    return payload.get("email") if payload else None


def generate_api_key() -> str:
    """Generate a secure API key"""
    return SecurityUtils.generate_random_token(32)


def generate_referral_code() -> str:
    """Generate a referral code"""
    return SecurityUtils.generate_random_token(8).upper()


class SecurityValidator:
    """Security validation utilities"""
    
    @staticmethod
    def validate_password_strength(password: str) -> Dict[str, Any]:
        """Validate password strength"""
        errors = []
        requirements = {
            "length": len(password) >= 8,
            "uppercase": any(c.isupper() for c in password),
            "lowercase": any(c.islower() for c in password),
            "digit": any(c.isdigit() for c in password),
            "special": any(c in "!@#$%^&*(),.?\":{}|<>" for c in password)
        }
        
        if not requirements["length"]:
            errors.append("Password must be at least 8 characters long")
        if not requirements["uppercase"]:
            errors.append("Password must contain at least one uppercase letter")
        if not requirements["lowercase"]:
            errors.append("Password must contain at least one lowercase letter")
        if not requirements["digit"]:
            errors.append("Password must contain at least one digit")
        if not requirements["special"]:
            errors.append("Password must contain at least one special character")
        
        score = sum(requirements.values())
        strength = "weak"
        if score >= 4:
            strength = "strong"
        elif score >= 3:
            strength = "medium"
        
        return {
            "valid": len(errors) == 0,
            "errors": errors,
            "strength": strength,
            "score": score,
            "requirements": requirements
        }
    
    @staticmethod
    def validate_email_format(email: str) -> bool:
        """Basic email format validation"""
        import re
        pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'
        return bool(re.match(pattern, email))
    
    @staticmethod
    def sanitize_filename(filename: str) -> str:
        """Sanitize filename to prevent path traversal"""
        import re
        import os
        
        # Remove path components
        filename = os.path.basename(filename)
        
        # Remove or replace dangerous characters
        filename = re.sub(r'[^\w\-_\.]', '_', filename)
        
        # Limit length
        if len(filename) > 255:
            name, ext = os.path.splitext(filename)
            filename = name[:255-len(ext)] + ext
        
        return filename
    
    @staticmethod
    def validate_file_type(filename: str, allowed_types: list) -> bool:
        """Validate file type based on extension"""
        import os
        
        file_ext = os.path.splitext(filename)[1].lower()
        return file_ext in allowed_types
    
    @staticmethod
    def check_suspicious_patterns(text: str) -> Dict[str, Any]:
        """Check for suspicious patterns in text input"""
        import re
        
        patterns = {
            "sql_injection": [
                r"(?i)(union|select|insert|update|delete|drop|create|alter|exec|execute)",
                r"(?i)(or|and)\s+\d+\s*=\s*\d+",
                r"(?i)';|';\s*--|';\s*#"
            ],
            "xss": [
                r"(?i)<script[^>]*>.*?</script>",
                r"(?i)javascript:",
                r"(?i)on\w+\s*=",
                r"(?i)<iframe[^>]*>.*?</iframe>"
            ],
            "path_traversal": [
                r"\.\./",
                r"\.\.\\",
                r"~/"
            ]
        }
        
        detected = {}
        for category, pattern_list in patterns.items():
            for pattern in pattern_list:
                if re.search(pattern, text):
                    detected[category] = True
                    break
            else:
                detected[category] = False
        
        return {
            "suspicious": any(detected.values()),
            "patterns_detected": detected
        }


# Rate limiting utilities
class RateLimitTracker:
    """Simple in-memory rate limit tracker"""
    
    def __init__(self):
        self.attempts = {}
    
    def is_rate_limited(self, key: str, max_attempts: int, window_minutes: int) -> bool:
        """Check if key is rate limited"""
        now = datetime.utcnow()
        window_start = now - timedelta(minutes=window_minutes)
        
        if key not in self.attempts:
            self.attempts[key] = []
        
        # Remove old attempts
        self.attempts[key] = [
            attempt for attempt in self.attempts[key] 
            if attempt > window_start
        ]
        
        # Check if rate limited
        if len(self.attempts[key]) >= max_attempts:
            return True
        
        # Record new attempt
        self.attempts[key].append(now)
        return False
    
    def reset_attempts(self, key: str):
        """Reset attempts for a key"""
        if key in self.attempts:
            del self.attempts[key]


# Global rate limiter instance
rate_limiter = RateLimitTracker()


# Security middleware helpers
def get_client_ip(request) -> str:
    """Get client IP from request, considering proxy headers"""
    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    
    real_ip = request.headers.get("X-Real-IP")
    if real_ip:
        return real_ip
    
    return request.client.host if request.client else "unknown"


def create_security_headers() -> Dict[str, str]:
    """Create standard security headers"""
    return {
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "X-XSS-Protection": "1; mode=block",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Permissions-Policy": "geolocation=(), microphone=(), camera=()"
    }