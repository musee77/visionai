# backend/app/models/user.py
"""
User-related Pydantic models
"""

from pydantic import BaseModel, EmailStr, Field, validator, model_validator
from typing import Optional, List, Dict, Any
from datetime import datetime
from enum import Enum
from pydantic import root_validator


class SubscriptionTier(str, Enum):
    FREE = "free"
    BASIC = "basic"
    PREMIUM = "premium"


class UserRole(str, Enum):
    USER = "user"
    ADMIN = "admin"
    MODERATOR = "moderator"


class Country(BaseModel):
    code: str
    name: str
    currency: str


class LocationPreference(BaseModel):
    city: Optional[str] = None
    state: Optional[str] = None
    country: Country
    remote_ok: bool = False
    radius_miles: int = Field(default=50, ge=1, le=500)
    coordinates: Optional[Dict[str, float]] = None  # lat, lng


class JobPreferences(BaseModel):
    job_titles: List[str] = []
    industries: List[str] = []
    company_sizes: List[str] = []  # startup, small, medium, large, enterprise
    employment_types: List[str] = []  # full-time, part-time, contract, internship
    experience_levels: List[str] = []  # entry, mid, senior, executive
    salary_min: Optional[int] = None
    salary_max: Optional[int] = None
    salary_currency: str = "USD"
    benefits_required: List[str] = []
    work_arrangements: List[str] = []  # remote, hybrid, on-site


class PersonalInfo(BaseModel):
    first_name: Optional[str] = ""
    last_name: Optional[str] = ""
    phone: Optional[str] = None
    location: Optional[str] = None  # Added for frontend compatibility
    linkedin: Optional[str] = None  # Added for frontend compatibility
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    country: Optional[str] = None
    postal_code: Optional[str] = None
    linkedin_url: Optional[str] = None
    portfolio_url: Optional[str] = None
    github_url: Optional[str] = None


class UserProfile(BaseModel):
    personal_info: Optional[PersonalInfo] = None
    location_preferences: Optional[LocationPreference] = None
    job_preferences: Optional[JobPreferences] = None
    bio: Optional[str] = None
    skills: List[str] = []
    experience_years: int = 0
    education_level: Optional[str] = None  # high_school, bachelor, master, phd
    availability: Optional[str] = None  # immediate, 2_weeks, 1_month, 3_months
    cover_letter_tone: str = "professional"  # professional, casual, creative
    timezone: Optional[str] = None


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=100)
    first_name: str = Field(..., min_length=1, max_length=50)
    last_name: str = Field(..., min_length=1, max_length=50)
    phone: Optional[str] = None
    terms_accepted: bool = True
    newsletter_subscription: bool = False
    
    @validator('password')
    def validate_password(cls, v):
        if not any(c.isupper() for c in v):
            raise ValueError('Password must contain at least one uppercase letter')
        if not any(c.islower() for c in v):
            raise ValueError('Password must contain at least one lowercase letter')
        if not any(c.isdigit() for c in v):
            raise ValueError('Password must contain at least one digit')
        return v


class UserLogin(BaseModel):
    email: EmailStr
    password: str
    remember_me: bool = False


class UserUpdate(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    full_name: Optional[str] = None
    phone: Optional[str] = None
    profile: Optional[UserProfile] = None
    newsletter_subscription: Optional[bool] = None


class PasswordReset(BaseModel):
    email: EmailStr


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(..., min_length=8, max_length=100)
    
    @validator('new_password')
    def validate_password(cls, v):
        if not any(c.isupper() for c in v):
            raise ValueError('Password must contain at least one uppercase letter')
        if not any(c.islower() for c in v):
            raise ValueError('Password must contain at least one lowercase letter')
        if not any(c.isdigit() for c in v):
            raise ValueError('Password must contain at least one digit')
        return v


class PasswordResetConfirm(BaseModel):
    token: str
    new_password: str = Field(..., min_length=8, max_length=100)


class UserUsageStats(BaseModel):
    total_searches: int = 0
    total_applications: int = 0
    successful_applications: int = 0
    cv_customizations: int = 0
    cover_letters_generated: int = 0
    monthly_searches: int = 0
    daily_searches: int = 0
    success_rate: float = 0.0
    avg_applications_per_search: float = 0.0
    last_search_date: Optional[datetime] = None
    last_reset_date: Optional[datetime] = None
    browser_automations: int = 0


class UserPreferences(BaseModel):
    email_notifications: bool = True
    sms_notifications: bool = False
    push_notifications: bool = True
    marketing_emails: bool = False
    application_reminders: bool = True
    job_alerts: bool = True
    weekly_reports: bool = True
    default_template: str = "professional"
    default_tone: str = "professional"
    auto_generate_cover: bool = False
    notify_generation: bool = False
    language: str = "en"
    theme: str = "light"  # light, dark
    dashboard_layout: str = "default"


class GmailAuth(BaseModel):
    access_token: str
    refresh_token: str
    token_uri: str = "https://oauth2.googleapis.com/token"
    client_id: str
    client_secret: str
    scopes: List[str]
    expiry: Optional[datetime] = None
    connected_at: datetime = Field(default_factory=datetime.utcnow)
    email_address: Optional[str] = None


class User(BaseModel):
    id: Optional[str] = Field(alias="_id")
    email: EmailStr
    first_name: str
    last_name: str
    phone: Optional[str] = None
    is_active: bool = True
    is_verified: bool = False
    role: UserRole = UserRole.USER
    subscription_tier: SubscriptionTier = SubscriptionTier.FREE
    profile: UserProfile = Field(default_factory=UserProfile)
    usage_stats: UserUsageStats = Field(default_factory=UserUsageStats)
    preferences: UserPreferences = Field(default_factory=UserPreferences)
    gmail_auth: Optional[GmailAuth] = None
    referral_code: str
    referred_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    last_login: Optional[datetime] = None
    verified_at: Optional[datetime] = None
    cv_uploaded_at: Optional[datetime] = None
    paystack_customer_code: Optional[str] = None
    referral_bonus_searches: int = 0
    total_referrals: int = 0
    successful_referrals: int = 0
    subscription_started_at: Optional[datetime] = None
    subscription_cancelled_at: Optional[datetime] = None
    trial_ends_at: Optional[datetime] = None

    @root_validator(pre=True)
    def fill_defaults(cls, values):
        if values.get('profile') is None:
            values['profile'] = UserProfile()
        if values.get('usage_stats') is None:
            values['usage_stats'] = UserUsageStats()
        if values.get('preferences') is None:
            values['preferences'] = UserPreferences()
        return values
    
    class Config:
        populate_by_name = True
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }


class UserResponse(BaseModel):
    id: str
    email: str
    first_name: str
    last_name: str
    full_name: Optional[str] = None
    profile: Optional[UserProfile] = None 
    is_active: bool
    is_verified: bool
    subscription_tier: SubscriptionTier
    usage_stats: UserUsageStats
    referral_code: str
    created_at: datetime
    last_login: Optional[datetime] = None
    gmail_connected: bool = False
    cv_data: Optional[Dict[str, Any]] = None  # Parsed CV data for frontend access
    referral_bonus_auto_applications: int = 0

    @model_validator(mode='before')
    def generate_full_name(cls, values):
        if not isinstance(values, dict):
            return values
        first = values.get('first_name')
        last = values.get('last_name')
        email = values.get('email')

        if first and last:
            values['full_name'] = f"{first} {last}"
        elif first:
            values['full_name'] = first
        elif last:
            values['full_name'] = last
        elif email:
            values['full_name'] = f"User {email.split('@')[0]}"
        else:
            values['full_name'] = "User"

        return values
    
    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }


class UserListResponse(BaseModel):
    users: List[UserResponse]
    total: int
    page: int
    size: int
    pages: int


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserResponse


class RefreshTokenRequest(BaseModel):
    refresh_token: str