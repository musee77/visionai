# backend/app/models/application.py
"""
Job Application-related Pydantic models
"""

from pydantic import BaseModel, Field, field_validator, HttpUrl
from typing import Optional, List, Dict, Any, Union
from datetime import datetime, date
from enum import Enum

from .common import TimeStampedModel, SoftDeleteModel, FileInfo, Priority


class ApplicationStatus(str, Enum):
    DRAFT = "draft"
    PENDING = "pending"  # Used by automation service
    SUBMITTED = "submitted"
    APPLIED = "applied"
    UNDER_REVIEW = "under_review"
    INTERVIEW_SCHEDULED = "interview_scheduled"
    INTERVIEW_COMPLETED = "interview_completed"
    SECOND_ROUND = "second_round"
    FINAL_ROUND = "final_round"
    OFFER_RECEIVED = "offer_received"
    OFFER_ACCEPTED = "offer_accepted"
    OFFER_DECLINED = "offer_declined"
    REJECTED = "rejected"
    WITHDRAWN = "withdrawn"
    ON_HOLD = "on_hold"
    ARCHIVED = "archived"
    NEEDS_AUTHENTICATION = "needs_authentication"
    MANUAL_ACTION_REQUIRED = "manual_action_required"
    PENDING_VERIFICATION = "pending_verification"
    PROCESSING = "processing"
    FAILED = "failed"


class ApplicationSource(str, Enum):
    MANUAL = "manual"
    PLATFORM = "platform"
    AUTO_APPLY = "auto_apply"
    BROWSER_AUTOMATION = "browser_automation"  # Used by automation service
    REFERRAL = "referral"
    DIRECT = "direct"
    RECRUITER = "recruiter"


class InterviewType(str, Enum):
    PHONE_SCREENING = "phone_screening"
    VIDEO_CALL = "video_call"
    IN_PERSON = "in_person"
    TECHNICAL = "technical"
    BEHAVIORAL = "behavioral"
    PANEL = "panel"
    GROUP = "group"
    PRESENTATION = "presentation"
    CASE_STUDY = "case_study"
    CODING_CHALLENGE = "coding_challenge"


class DocumentType(str, Enum):
    RESUME = "resume"
    CV = "cv"
    COVER_LETTER = "cover_letter"
    PORTFOLIO = "portfolio"
    TRANSCRIPT = "transcript"
    CERTIFICATE = "certificate"
    REFERENCE = "reference"
    WRITING_SAMPLE = "writing_sample"
    OTHER = "other"


class CommunicationType(str, Enum):
    EMAIL = "email"
    PHONE = "phone"
    SMS = "sms"
    IN_PERSON = "in_person"
    VIDEO_CALL = "video_call"
    LINKEDIN = "linkedin"
    PLATFORM_MESSAGE = "platform_message"
    OTHER = "other"


# Document Models
class ApplicationDocument(BaseModel):
    """Application document model"""
    id: Optional[str] = None
    type: DocumentType
    filename: str
    file_path: str
    file_size: int
    content_type: str
    version: int = 1
    is_customized: bool = False
    customization_notes: Optional[str] = None
    generated_by_ai: bool = False
    upload_date: datetime = Field(default_factory=datetime.utcnow)
    last_modified: datetime = Field(default_factory=datetime.utcnow)
    checksum: Optional[str] = None
    download_url: Optional[str] = None


class CustomCV(BaseModel):
    """Custom CV model for specific job applications"""
    original_cv_id: str
    job_id: str
    customized_content: str
    customization_prompt: str
    ai_model_used: Optional[str] = "gpt-4"
    customization_score: Optional[float] = Field(None, ge=0, le=1)
    highlighted_skills: List[str] = []
    emphasized_experience: List[str] = []
    created_at: datetime = Field(default_factory=datetime.utcnow)
    performance_metrics: Optional[Dict[str, Any]] = None


class CoverLetter(BaseModel):
    """Cover letter model"""
    job_id: str
    user_id: str
    content: str
    tone: str = "professional"  # professional, casual, enthusiastic, formal
    template_used: Optional[str] = None
    ai_generated: bool = False
    ai_model_used: Optional[str] = "gpt-4"
    generation_prompt: Optional[str] = None
    word_count: Optional[int] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    last_modified: datetime = Field(default_factory=datetime.utcnow)
    performance_score: Optional[float] = Field(None, ge=0, le=1)


# Communication and Timeline Models
class ApplicationCommunication(BaseModel):
    """Communication record for application"""
    type: CommunicationType
    direction: str = "outbound"  # inbound, outbound
    subject: Optional[str] = None
    content: str
    contact_person: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    attachments: List[str] = []  # File IDs
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    follow_up_required: bool = False
    follow_up_date: Optional[datetime] = None
    tags: List[str] = []


class Interview(BaseModel):
    """Interview model"""
    type: InterviewType
    scheduled_date: datetime
    duration_minutes: Optional[int] = None
    location: Optional[str] = None
    meeting_link: Optional[HttpUrl] = None
    interviewer_name: Optional[str] = None
    interviewer_email: Optional[str] = None
    interviewer_title: Optional[str] = None
    round: int = 1
    status: str = "scheduled"  # scheduled, completed, cancelled, rescheduled
    preparation_notes: Optional[str] = None
    interview_notes: Optional[str] = None
    feedback: Optional[str] = None
    rating: Optional[int] = Field(None, ge=1, le=5)
    questions_asked: List[str] = []
    answers_given: List[str] = []
    technical_assessment: Optional[Dict[str, Any]] = None
    follow_up_actions: List[str] = []
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class ApplicationTimeline(BaseModel):
    """Application timeline event"""
    event_type: Optional[str] = None  # status_change, communication, interview, document_upload, etc.
    status_from: Optional[ApplicationStatus] = None
    status_to: Optional[ApplicationStatus] = None
    description: str
    details: Optional[Dict[str, Any]] = None
    created_by: Optional[str] = None  # User ID or "system"
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    is_milestone: bool = False
    icon: Optional[str] = None
    color: Optional[str] = None


# Task and Reminder Models
class ApplicationTask(BaseModel):
    """Task related to application"""
    title: str
    description: Optional[str] = None
    priority: Priority = Priority.MEDIUM
    due_date: Optional[datetime] = None
    is_completed: bool = False
    completed_at: Optional[datetime] = None
    category: str = "general"  # follow_up, preparation, document, research
    assigned_to: Optional[str] = None  # User ID
    tags: List[str] = []
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ApplicationReminder(BaseModel):
    """Reminder for application"""
    title: str
    description: Optional[str] = None
    remind_at: datetime
    is_sent: bool = False
    sent_at: Optional[datetime] = None
    reminder_type: str = "email"  # email, sms, push, in_app
    snooze_count: int = 0
    created_at: datetime = Field(default_factory=datetime.utcnow)


# Analytics and Tracking Models
class ApplicationMetrics(BaseModel):
    """Application performance metrics"""
    views: int = 0
    downloads: int = 0
    responses: int = 0
    interview_requests: int = 0
    response_rate: float = 0.0
    average_response_time_days: Optional[float] = None
    time_to_hire_days: Optional[float] = None
    salary_negotiation_rounds: int = 0
    last_updated: datetime = Field(default_factory=datetime.utcnow)


class ApplicationFeedback(BaseModel):
    """Feedback received for application"""
    source: str  # recruiter, hiring_manager, interview, automated
    feedback_type: str = "general"  # general, technical, cultural, experience
    rating: Optional[int] = Field(None, ge=1, le=5)
    comments: Optional[str] = None
    strengths: List[str] = []
    areas_for_improvement: List[str] = []
    specific_skills_mentioned: List[str] = []
    recommendations: List[str] = []
    is_constructive: bool = True
    received_at: datetime = Field(default_factory=datetime.utcnow)
    contact_person: Optional[str] = None


# Core Application Models
class ApplicationBase(BaseModel):
    """Base application model"""
    job_id: str
    user_id: str
    status: ApplicationStatus = ApplicationStatus.DRAFT
    source: ApplicationSource = ApplicationSource.MANUAL
    applied_date: Optional[datetime] = None
    custom_cv_content: Optional[str] = None
    cover_letter_content: Optional[str] = None
    additional_notes: Optional[str] = None
    salary_expectation: Optional[float] = None
    availability_date: Optional[date] = None
    referral_source: Optional[str] = None
    priority: Priority = Priority.MEDIUM


class ApplicationCreate(ApplicationBase):
    """Model for creating a new application"""
    documents: List[ApplicationDocument] = []
    auto_apply_settings: Optional[Dict[str, Any]] = None


class ApplicationUpdate(BaseModel):
    """Model for updating an existing application"""
    status: Optional[ApplicationStatus] = None
    custom_cv_content: Optional[str] = None
    cover_letter_content: Optional[str] = None
    additional_notes: Optional[str] = None
    salary_expectation: Optional[float] = None
    availability_date: Optional[date] = None
    priority: Optional[Priority] = None


class Application(ApplicationBase, TimeStampedModel):
    """Complete application model"""
    id: Optional[str] = Field(alias="_id")
    
    # Documents and content
    documents: List[ApplicationDocument] = []
    custom_cv: Optional[CustomCV] = None
    cover_letter: Optional[CoverLetter] = None
    
    # Communication and timeline
    communications: List[ApplicationCommunication] = []
    interviews: List[Interview] = []
    timeline: List[ApplicationTimeline] = []
    
    # Tasks and reminders
    tasks: List[ApplicationTask] = []
    reminders: List[ApplicationReminder] = []
    
    # Analytics and feedback
    metrics: ApplicationMetrics = ApplicationMetrics()
    feedback: List[ApplicationFeedback] = []
    
    # Auto-application data
    auto_apply_used: bool = False
    auto_apply_data: Optional[Dict[str, Any]] = None
    form_fields_filled: Optional[Dict[str, str]] = None
    
    # Tracking and metadata
    application_url: Optional[HttpUrl] = None
    application_domain: Optional[str] = None  # Domain extracted from application URL for email monitoring
    confirmation_number: Optional[str] = None
    job_title: Optional[str] = None  # Cached from job
    company_name: Optional[str] = None  # Cached from job
    location: Optional[str] = None  # Cached from job
    
    # Email Application Tracking
    application_method: str = "external"  # "email" | "external"
    email_thread_id: Optional[str] = None
    last_email_at: Optional[datetime] = None
    email_status: Optional[str] = None  # "sent" | "delivered" | "replied"

        
    # Email Agent Monitoring
    email_monitoring_enabled: bool = False
    last_response_check: Optional[datetime] = None
    response_check_count: int = 0

    
    # Follow-up tracking
    last_follow_up: Optional[datetime] = None
    next_follow_up: Optional[datetime] = None
    follow_up_count: int = 0
    
    # Outcome tracking
    rejection_reason: Optional[str] = None
    offer_details: Optional[Dict[str, Any]] = None
    final_salary: Optional[float] = None
    start_date: Optional[date] = None
    
    class Config:
        populate_by_name = True
        json_encoders = {
            datetime: lambda v: v.isoformat() if v else None,
            date: lambda v: v.isoformat() if v else None
        }


class ApplicationResponse(BaseModel):
    """Application response model for API"""
    id: str
    job_id: str
    user_id: str
    status: ApplicationStatus
    source: ApplicationSource
    applied_date: Optional[datetime]
    job_title: Optional[str]
    company_name: Optional[str]
    location: Optional[str]
    priority: Priority
    documents_count: int
    communications_count: int
    interviews_count: int
    tasks_count: int
    has_custom_cv: bool
    has_cover_letter: bool
    last_activity: Optional[datetime]
    created_at: datetime
    updated_at: datetime

    @field_validator("id", "job_id", "user_id", mode="before")
    @classmethod
    def stringify_id(cls, value):
        return "" if value is None else str(value)

    @field_validator("status", mode="before")
    @classmethod
    def normalize_status(cls, value):
        raw = getattr(value, "value", value)
        raw = str(raw or "draft")
        aliases = {
            "interviewed": "interview_completed",
            "accepted": "offer_accepted",
            "declined": "offer_declined",
            "screening": "under_review",
        }
        raw = aliases.get(raw, raw)
        try:
            return ApplicationStatus(raw).value
        except ValueError:
            return ApplicationStatus.PENDING.value

    @field_validator("source", mode="before")
    @classmethod
    def normalize_source(cls, value):
        raw = getattr(value, "value", value)
        raw = str(raw or "manual")
        try:
            return ApplicationSource(raw).value
        except ValueError:
            return ApplicationSource.MANUAL.value

    @field_validator("priority", mode="before")
    @classmethod
    def normalize_priority(cls, value):
        raw = getattr(value, "value", value)
        raw = str(raw or "medium")
        try:
            return Priority(raw).value
        except ValueError:
            return Priority.MEDIUM.value

    @field_validator("location", mode="before")
    @classmethod
    def normalize_location(cls, value):
        if value is None or isinstance(value, str):
            return value or None
        if isinstance(value, dict):
            parts = [
                value.get("city"),
                value.get("region") or value.get("state"),
                value.get("country"),
            ]
            text = ", ".join(part for part in parts if part)
            return text or None
        return str(value)

    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat() if v else None
        }


class ApplicationListResponse(BaseModel):
    """Application list response with pagination"""
    applications: List[ApplicationResponse]
    total: int
    page: int
    size: int
    pages: int
    has_next: bool
    has_prev: bool
    status_counts: Dict[str, int] = {}
    total_time_ms: Optional[float] = None


# Application Statistics Models
class ApplicationStats(BaseModel):
    """Application statistics"""
    total_applications: int = 0
    applications_today: int = 0
    active_applications: int = 0
    applications_this_week: int = 0
    applications_this_month: int = 0
    response_rate: float = 0.0
    interview_rate: float = 0.0
    offer_rate: float = 0.0
    acceptance_rate: float = 0.0
    average_response_time_days: Optional[float] = None
    status_distribution: Dict[str, int] = {}
    top_companies_applied: List[Dict[str, Any]] = []
    success_by_source: Dict[str, Dict[str, Any]] = {}


# Search and Filter Models
class ApplicationFilter(BaseModel):
    """Application search filter"""
    status: Optional[List[ApplicationStatus]] = None
    source: Optional[List[ApplicationSource]] = None
    priority: Optional[List[Priority]] = None
    applied_after: Optional[date] = None
    applied_before: Optional[date] = None
    company_name: Optional[str] = None
    job_title: Optional[str] = None
    location: Optional[str] = None
    has_interviews: Optional[bool] = None
    has_offers: Optional[bool] = None
    needs_follow_up: Optional[bool] = None


class ApplicationSearch(BaseModel):
    """Application search request"""
    query: Optional[str] = None
    filters: Optional[ApplicationFilter] = None
    page: int = Field(default=1, ge=1)
    size: int = Field(default=20, ge=1, le=100)
    sort_by: str = "created_at"  # created_at, applied_date, updated_at, priority
    sort_order: str = "desc"  # asc, desc


# Tracking and Analytics Models
class ApplicationTracking(BaseModel):
    """Application tracking data"""
    application_id: str
    event_type: str
    event_data: Dict[str, Any]
    user_agent: Optional[str] = None
    ip_address: Optional[str] = None
    referrer: Optional[str] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class ApplicationTemplate(BaseModel):
    """Application template for reuse"""
    id: Optional[str] = Field(alias="_id")
    user_id: str
    name: str
    description: Optional[str] = None
    cover_letter_template: Optional[str] = None
    additional_notes_template: Optional[str] = None
    document_templates: List[str] = []  # Document IDs
    auto_apply_settings: Optional[Dict[str, Any]] = None
    is_default: bool = False
    usage_count: int = 0
    created_at: datetime = Field(default_factory=datetime.utcnow)
    last_used: Optional[datetime] = None
    
    class Config:
        populate_by_name = True


# Bulk Operations Models
class BulkApplicationUpdate(BaseModel):
    """Bulk application update model"""
    application_ids: List[str]
    updates: ApplicationUpdate
    reason: Optional[str] = None


class BulkApplicationAction(BaseModel):
    """Bulk application action model"""
    application_ids: List[str]
    action: str  # archive, delete, change_status, add_tag, etc.
    action_data: Optional[Dict[str, Any]] = None
    reason: Optional[str] = None



class EmailReplyRequest(BaseModel):
    """Request model for sending an email reply via Gmail agent"""
    subject: str
    content: str
    to_email: Optional[str] = None


# Export all application-related models
__all__ = [
    "ApplicationStatus", "ApplicationSource", "InterviewType", "DocumentType", 
    "CommunicationType", "ApplicationDocument", "CustomCV", "CoverLetter",
    "ApplicationCommunication", "Interview", "ApplicationTimeline", 
    "ApplicationTask", "ApplicationReminder", "ApplicationMetrics", 
    "ApplicationFeedback", "ApplicationBase", "ApplicationCreate", 
    "ApplicationUpdate", "Application", "ApplicationResponse", 
    "ApplicationListResponse", "ApplicationStats", "ApplicationFilter", 
    "ApplicationSearch", "ApplicationTracking", "ApplicationTemplate",
    "BulkApplicationUpdate", "BulkApplicationAction", "EmailReplyRequest"
]