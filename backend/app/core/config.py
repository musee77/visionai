"""
Configuration settings for the AI Job Application Platform
"""

from pydantic_settings import BaseSettings
from pydantic import Field, field_validator
from typing import List, Optional, Union
import os
import json
from pathlib import Path


def get_secret(secret_name: str, default: Optional[str] = None) -> Optional[str]:
    """
    Read secret from Docker secret file or environment variable.
    Priority:
    1. Docker secret at /run/secrets/SECRET_NAME
    2. Environment variable SECRET_NAME_FILE (path to file)
    3. Environment variable SECRET_NAME
    4. Default value
    """
    # First, try reading from Docker secret directly
    docker_secret_path = f"/run/secrets/{secret_name}"
    if os.path.exists(docker_secret_path):
        try:
            with open(docker_secret_path, 'r') as f:
                value = f.read().strip()
                if value:  # Only return if not empty
                    return value
        except Exception as e:
            print(f"Warning: Could not read Docker secret {secret_name}: {e}")
    
    # Second, try reading from *_FILE env var (for custom secret paths)
    file_path = os.getenv(f"{secret_name}_FILE")
    if file_path and os.path.exists(file_path):
        try:
            with open(file_path, 'r') as f:
                value = f.read().strip()
                if value:
                    return value
        except Exception as e:
            print(f"Warning: Could not read secret file {file_path}: {e}")
    
    # Third, try direct environment variable
    value = os.getenv(secret_name)
    if value:
        return value
    
    # Finally, return default
    return default


class Settings(BaseSettings):
    # Project information
    PROJECT_NAME: str = Field(default="Synovae", env="PROJECT_NAME")
    PROJECT_DESCRIPTION: str = "Comprehensive AI-powered job application automation platform"
    PROJECT_VERSION: str = Field(default="1.0.0", env="PROJECT_VERSION")
    
    # API settings
    API_V1_STR: str = "/api/v1"
    HOST: str = Field(default="0.0.0.0", env="HOST")
    PORT: int = Field(default=8000, env="PORT")
    DEBUG: bool = Field(default=False, env="DEBUG")
    ENVIRONMENT: str = Field(default="production", env="ENVIRONMENT")
    
    # Security - REQUIRED
    SECRET_KEY: str = Field(default_factory=lambda: get_secret("SECRET_KEY", "change-this-secret-key-in-production"))
    JWT_SECRET_KEY: str = Field(default_factory=lambda: get_secret("JWT_SECRET_KEY", "change-this-jwt-secret-in-production"))
    JWT_ALGORITHM: str = Field(default="HS256", env="JWT_ALGORITHM")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = Field(default=30, env="ACCESS_TOKEN_EXPIRE_MINUTES")
    REFRESH_TOKEN_EXPIRE_MINUTES: int = Field(default=10080, env="REFRESH_TOKEN_EXPIRE_MINUTES")  # 7 days
    PASSWORD_RESET_TOKEN_EXPIRE_HOURS: int = Field(default=24, env="PASSWORD_RESET_TOKEN_EXPIRE_HOURS")
    # Remember Me token expiration
    REMEMBER_ME_ACCESS_TOKEN_EXPIRE_MINUTES: int = Field(default=1440, env="REMEMBER_ME_ACCESS_TOKEN_EXPIRE_MINUTES")  # 1 day
    REMEMBER_ME_REFRESH_TOKEN_EXPIRE_MINUTES: int = Field(default=43200, env="REMEMBER_ME_REFRESH_TOKEN_EXPIRE_MINUTES")  # 30 days

    # CORS & Allowed Hosts
    CORS_ORIGINS_RAW: Union[str, List[str]] = Field(default='["http://localhost", "http://localhost:80", "http://localhost:3000", "https://synovae.io", "https://www.synovae.io"]', alias="CORS_ORIGINS")
    ALLOWED_HOSTS: List[str] = ["synovae.io", "www.synovae.io", "localhost", "localhost:80", "localhost:8000"]
    
    @property
    def CORS_ORIGINS(self) -> List[str]:
        """Parse and return CORS origins"""
        v = self.CORS_ORIGINS_RAW
        if isinstance(v, list):
            return v
        if isinstance(v, str):
            # Remove escaped quotes if present
            cleaned = v.replace('\\"', '"')
            try:
                return json.loads(cleaned)
            except json.JSONDecodeError:
                # If it's a simple comma-separated string
                return [origin.strip() for origin in cleaned.split(',')]
        return ["http://localhost", "http://localhost:80", "http://localhost:3000"]
    
    # Database - REQUIRED
    MONGODB_URL: str = Field(env="MONGODB_URL")
    DATABASE_NAME: str = Field(default="synovae_db", env="DATABASE_NAME")
    
    # Redis - REQUIRED
    REDIS_URL: str = Field(env="REDIS_URL")
    REDIS_HOST: str = Field(default="redis", env="REDIS_HOST")
    REDIS_PORT: int = Field(default=6379, env="REDIS_PORT")
    REDIS_DB: int = Field(default=0, env="REDIS_DB")
    CACHE_TTL: int = Field(default=3600, env="CACHE_TTL")
    
    # OpenAI API - REQUIRED
    OPENAI_API_KEY: str = Field(default_factory=lambda: get_secret("OPENAI_API_KEY", ""))
    OPENAI_MODEL: str = Field(default="gpt-4o-mini", env="OPENAI_MODEL")
    OPENAI_MAX_TOKENS: int = Field(default=2000, env="OPENAI_MAX_TOKENS")
    OPENAI_TEMPERATURE: float = Field(default=0.7, env="OPENAI_TEMPERATURE")
    
    # Paystack - REQUIRED for payments
    PAYSTACK_SECRET_KEY: str = Field(default_factory=lambda: get_secret("PAYSTACK_SECRET_KEY", ""))
    PAYSTACK_PUBLIC_KEY: str = Field(default_factory=lambda: get_secret("PAYSTACK_PUBLIC_KEY", ""))
    PAYSTACK_BASIC_PLAN_CODE: str = Field(default="", env="PAYSTACK_BASIC_PLAN_CODE")
    PAYSTACK_PREMIUM_PLAN_CODE: str = Field(default="", env="PAYSTACK_PREMIUM_PLAN_CODE")

    # Stripe - Optional
    STRIPE_PUBLIC_KEY: str = Field(default="", env="STRIPE_PUBLIC_KEY")
    STRIPE_SECRET_KEY: str = Field(default_factory=lambda: get_secret("STRIPE_SECRET_KEY", ""))
    STRIPE_WEBHOOK_SECRET: str = Field(default_factory=lambda: get_secret("STRIPE_WEBHOOK_SECRET", ""))

    # PayPal - Optional
    PAYPAL_CLIENT_ID: str = Field(default="", env="PAYPAL_CLIENT_ID")
    PAYPAL_CLIENT_SECRET: str = Field(default_factory=lambda: get_secret("PAYPAL_CLIENT_SECRET", ""))
    PAYPAL_MODE: str = Field(default="sandbox", env="PAYPAL_MODE") # sandbox or live

    # IntaSend - Optional
    INTASEND_PUBLIC_KEY: str = Field(default_factory=lambda: get_secret("INTASEND_PUBLIC_KEY", ""))
    INTASEND_SECRET_KEY: str = Field(default_factory=lambda: get_secret("INTASEND_SECRET_KEY", ""))
    INTASEND_IS_LIVE: bool = Field(default=False, env="INTASEND_IS_LIVE")

    # Email/SMTP Configuration
    MAIL_SERVER: Optional[str] = Field(default=None, env="MAIL_SERVER")
    MAIL_PORT: int = Field(default=587, env="MAIL_PORT")
    MAIL_USERNAME: Optional[str] = Field(default=None, env="MAIL_USERNAME")
    MAIL_PASSWORD: Optional[str] = Field(default=None, env="MAIL_PASSWORD")
    MAIL_FROM: str = Field(default="no-reply@synovae.io", env="MAIL_FROM")
    MAIL_FROM_NAME: str = Field(default="Synovae", env="MAIL_FROM_NAME")
    MAIL_STARTTLS: bool = Field(default=True, env="MAIL_STARTTLS")
    MAIL_SSL_TLS: bool = Field(default=False, env="MAIL_SSL_TLS")
    
    # Additional email settings
    SUPPORT_EMAIL: str = Field(default="support@synovae.io", env="SUPPORT_EMAIL")
    COMPANY_NAME: str = Field(default="Synovae", env="COMPANY_NAME")
    

    # OAuth - REQUIRED for Google/LinkedIn login
    GOOGLE_CLIENT_ID: str = Field(default_factory=lambda: get_secret("GOOGLE_CLIENT_ID", ""))
    GOOGLE_CLIENT_SECRET: str = Field(default_factory=lambda: get_secret("GOOGLE_CLIENT_SECRET", ""))
    GOOGLE_REDIRECT_URI: str = Field(default="https://synovae.io/api/v1/auth/google/callback", env="GOOGLE_REDIRECT_URI")
    
    LINKEDIN_CLIENT_ID: Optional[str] = Field(default_factory=lambda: get_secret("LINKEDIN_CLIENT_ID", ""))
    LINKEDIN_CLIENT_SECRET: Optional[str] = Field(default_factory=lambda: get_secret("LINKEDIN_CLIENT_SECRET", ""))
    LINKEDIN_REDIRECT_URI: str = Field(default=None, env="LINKEDIN_REDIRECT_URI")
    
    # Frontend URL
    FRONTEND_URL: str = Field(default="https://synovae.io", env="FRONTEND_URL")

    # Job board APIs - Optional (for job scraping)
    INDEED_PUBLISHER_ID: Optional[str] = Field(default=None, env="INDEED_PUBLISHER_ID")
    INDEED_API_KEY: Optional[str] = Field(default=None, env="INDEED_API_KEY")
    JOB_API_URLS: str = Field(default="", env="JOB_API_URLS")
    JOB_WEEKLY_MIN_POSTS: int = Field(default=10, env="JOB_WEEKLY_MIN_POSTS")
    JOB_WEEKLY_MAX_POSTS: int = Field(default=30, env="JOB_WEEKLY_MAX_POSTS")
    
    # File storage
    UPLOAD_DIR: str = Field(default="/app/uploads", env="UPLOAD_DIR")
    MAX_FILE_SIZE: int = Field(default=10485760, env="MAX_FILE_SIZE")  # 10MB
    MAX_UPLOAD_SIZE: int = Field(default=52428800, env="MAX_UPLOAD_SIZE")  # 50MB
    ALLOWED_FILE_TYPES: List[str] = [".pdf", ".docx", ".doc", ".txt"]
    
    # Rate limiting
    RATE_LIMIT_REQUESTS: int = Field(default=100, env="RATE_LIMIT_REQUESTS")
    RATE_LIMIT_PERIOD: int = Field(default=60, env="RATE_LIMIT_PERIOD")
    
    # Subscription limits - Free Tier
    FREE_TIER_MONTHLY_ATTEMPTS: int = Field(default=5, env="FREE_TIER_MONTHLY_ATTEMPTS")
    FREE_TIER_JOBS_PER_ATTEMPT: int = Field(default=10, env="FREE_TIER_JOBS_PER_ATTEMPT")
    
    # Subscription limits - Basic Tier
    BASIC_TIER_DAILY_ATTEMPTS: int = Field(default=3, env="BASIC_TIER_DAILY_ATTEMPTS")
    BASIC_TIER_MONTHLY_ATTEMPTS: int = Field(default=50, env="BASIC_TIER_MONTHLY_ATTEMPTS")
    BASIC_TIER_JOBS_PER_ATTEMPT: int = Field(default=50, env="BASIC_TIER_JOBS_PER_ATTEMPT")
    BASIC_TIER_PRICE: float = Field(default=9.99, env="BASIC_TIER_PRICE")
    
    # Subscription limits - Premium Tier
    PREMIUM_TIER_MONTHLY_ATTEMPTS: int = Field(default=500, env="PREMIUM_TIER_MONTHLY_ATTEMPTS")
    PREMIUM_TIER_JOBS_PER_ATTEMPT: int = Field(default=200, env="PREMIUM_TIER_JOBS_PER_ATTEMPT")
    PREMIUM_TIER_PRICE: float = Field(default=29.99, env="PREMIUM_TIER_PRICE")
    
    # Referral system
    REFERRALS_FOR_FREE_ATTEMPT: int = Field(default=3, env="REFERRALS_FOR_FREE_ATTEMPT")
    BASIC_REFERRAL_BONUS: float = Field(default=5.0, env="BASIC_REFERRAL_BONUS")
    PREMIUM_REFERRAL_BONUS: float = Field(default=10.0, env="PREMIUM_REFERRAL_BONUS")
    
    # Browser automation service - Optional
    BROWSER_AUTOMATION_URL: Optional[str] = Field(default=None, env="BROWSER_AUTOMATION_URL")
    BROWSER_AUTOMATION_TOKEN: str = Field(default="dev-automation-token", env="BROWSER_AUTOMATION_TOKEN")
    
    # Machine Learning
    ML_MODEL_PATH: str = Field(default="/app/models/classifier.pkl", env="ML_MODEL_PATH")
    ML_TRAINING_DATA_PATH: str = Field(default="/app/data/training", env="ML_TRAINING_DATA_PATH")
    ML_RETRAIN_INTERVAL_DAYS: int = Field(default=30, env="ML_RETRAIN_INTERVAL_DAYS")
    
    # Scraping Configuration
    SCRAPER_USER_AGENT: str = Field(default="Mozilla/5.0 (compatible; VisionAI/1.0)", env="SCRAPER_USER_AGENT")
    SCRAPER_DELAY_MIN: int = Field(default=1, env="SCRAPER_DELAY_MIN")
    SCRAPER_DELAY_MAX: int = Field(default=3, env="SCRAPER_DELAY_MAX")
    
    # Logging
    LOG_LEVEL: str = Field(default="INFO", env="LOG_LEVEL")
    LOG_FILE: str = Field(default="/app/logs/app.log", env="LOG_FILE")
    
    # Background tasks - REQUIRED
    CELERY_BROKER_URL: str = Field(env="CELERY_BROKER_URL")
    CELERY_RESULT_BACKEND: str = Field(env="CELERY_RESULT_BACKEND")
    
    # Webhooks
    WEBHOOK_SECRET: str = Field(default="change-this-webhook-secret", env="WEBHOOK_SECRET")
    
    def create_upload_dir(self) -> None:
        """Create upload directory if it doesn't exist"""
        try:
            Path(self.UPLOAD_DIR).mkdir(parents=True, exist_ok=True)
            Path("logs").mkdir(exist_ok=True)
            Path(self.ML_MODEL_PATH).parent.mkdir(parents=True, exist_ok=True)
            Path(self.ML_TRAINING_DATA_PATH).mkdir(parents=True, exist_ok=True)
        except Exception as e:
            print(f"Warning: Could not create directories: {e}")
    
    class Config:
        env_file_encoding = 'utf-8'
        secrets_dir = "/run/secrets"
        case_sensitive = True
        extra = "ignore"
        populate_by_name = True


# Create settings instance
settings = Settings()

# Create necessary directories
settings.create_upload_dir()

# Debug logging (remove after confirming it works)
if settings.ENVIRONMENT == "production":
    print("=" * 50)
    print("PRODUCTION SETTINGS LOADED")
    print(f"GOOGLE_CLIENT_ID present: {bool(settings.GOOGLE_CLIENT_ID)}")
    print(f"GOOGLE_CLIENT_ID length: {len(settings.GOOGLE_CLIENT_ID) if settings.GOOGLE_CLIENT_ID else 0}")
    print(f"GOOGLE_CLIENT_SECRET present: {bool(settings.GOOGLE_CLIENT_SECRET)}")
    print(f"GOOGLE_REDIRECT_URI: {settings.GOOGLE_REDIRECT_URI}")
    print("=" * 50)