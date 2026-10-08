# backend/app/schemas/quick_apply.py
"""
Pydantic models for Quick Apply Form functionality
"""

from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List
from datetime import datetime


class QuickApplyFormData(BaseModel):
    """Form data for quick apply submission"""
    first_name: str = Field(default="", max_length=100)
    last_name: str = Field(default="", max_length=100)
    email: EmailStr
    phone: Optional[str] = Field(None, max_length=20)
    address: Optional[str] = Field(None, max_length=200)
    city: Optional[str] = Field(None, max_length=100)
    state: Optional[str] = Field(None, max_length=100)
    country: Optional[str] = Field(None, max_length=100)
    postal_code: Optional[str] = Field(None, max_length=20)
    linkedin_url: Optional[str] = None
    portfolio_url: Optional[str] = None
    github_url: Optional[str] = None
    years_of_experience: Optional[int] = Field(None, ge=0, le=50)
    current_position: Optional[str] = Field(None, max_length=200)
    current_company: Optional[str] = Field(None, max_length=200)
    education_level: Optional[str] = Field(None, max_length=200)
    university: Optional[str] = Field(None, max_length=200)
    skills: Optional[List[str]] = []
    cover_letter: Optional[str] = Field(None, max_length=10000)
    additional_info: Optional[str] = Field(None, max_length=2000)


class CompanyFieldAnswer(BaseModel):
    label: str = ""
    field_type: str = "unknown"
    value: str = ""


class QuickApplySubmission(BaseModel):
    """Quick apply submission request"""
    job_id: str
    form_data: QuickApplyFormData
    cv_document_id: str
    cover_letter_document_id: Optional[str] = None
    recipient_email: EmailStr
    additional_message: Optional[str] = Field(None, max_length=10000)
    company_fields: Optional[List[CompanyFieldAnswer]] = None


class DetectedFieldOption(BaseModel):
    value: str = ""
    label: str = ""


class DetectedFormField(BaseModel):
    """A field read from the company application page."""
    label: str = ""
    name: str = ""
    field_type: str = "unknown"
    input_type: str = "text"
    required: bool = False
    placeholder: str = ""
    value: str = ""
    options: List[DetectedFieldOption] = []


class QuickApplyPrefillResponse(BaseModel):
    """Response for prefill request"""
    success: bool
    form_data: QuickApplyFormData
    job_title: str
    company_name: str
    recipient_email: Optional[str] = None
    apply_url: Optional[str] = None
    detected_fields: List[DetectedFormField] = []
    message: Optional[str] = None


class QuickApplySubmissionResponse(BaseModel):
    """Response for application submission"""
    success: bool
    application_id: str
    gmail_message_id: Optional[str] = None
    sent_at: Optional[datetime] = None
    recipient: Optional[str] = None
    error: Optional[str] = None
    message: str


class QuickApplyStatusResponse(BaseModel):
    """Response for application status check"""
    application_id: str
    status: str
    email_sent_via: Optional[str] = None
    gmail_message_id: Optional[str] = None
    email_sent_at: Optional[datetime] = None
    recipient_email: Optional[str] = None
    response_received: Optional[bool] = False
    response_at: Optional[datetime] = None
    error_message: Optional[str] = None


class AutofillStartResponse(BaseModel):
    """Response for browser automation start"""
    success: bool
    session_id: str
    message: Optional[str] = None


class AutofillStatusResponse(BaseModel):
    """Response for browser automation status"""
    status: str
    filled_fields: Optional[List[str]] = []
    error: Optional[str] = None
    message: Optional[str] = None
