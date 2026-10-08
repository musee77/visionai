# backend/app/api/browser_automation.py
"""
Quick Apply / Email Agent API
Handles intelligent form prefilling and email-based application submission
"""

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Header
from pydantic import BaseModel
from typing import Dict, Any, Optional, List
import logging
from datetime import datetime
from bson import ObjectId
import httpx
import re

from app.database import get_database
from app.api.deps import get_current_user, get_current_active_user
from app.core.config import settings
from app.services.emails.email_agent_service import email_agent_service
from app.services.core.subscription_service import SubscriptionService
from app.schemas.quick_apply import (
    QuickApplyPrefillResponse,
    QuickApplySubmission,
    QuickApplySubmissionResponse,
    QuickApplyStatusResponse,
    AutofillStartResponse,
    AutofillStatusResponse,
    DetectedFormField,
)

class BrowserAutomationStart(BaseModel):
    job_id: str
    cv_id: Optional[str] = None
    cover_letter_id: Optional[str] = None

router = APIRouter()
logger = logging.getLogger(__name__)

PROFILE_FIELD_KEYS = {
    "first_name": "first_name",
    "last_name": "last_name",
    "email": "email",
    "phone": "phone",
    "address": "address",
    "city": "city",
    "state": "state",
    "zip_code": "postal_code",
    "country": "country",
    "linkedin": "linkedin_url",
    "portfolio": "portfolio_url",
    "github": "github_url",
    "website": "website",
    "cover_letter": "cover_letter",
}


def _profile_value_for_field(field_type: str, form_data: Dict[str, Any], label: str = "") -> str:
    if field_type == "cover_letter":
        return ""
    if field_type == "full_name":
        return f"{form_data.get('first_name') or ''} {form_data.get('last_name') or ''}".strip()
    key = PROFILE_FIELD_KEYS.get(field_type)
    if key:
        value = form_data.get(key)
        return "" if value is None else str(value)
    text = (label or "").lower()
    if "email" in text or "e-mail" in text:
        return str(form_data.get("email") or "")
    if "phone" in text or "telephone" in text or "mobile" in text:
        return str(form_data.get("phone") or "")
    if "name" in text and "company" not in text and "user" not in text and "file" not in text:
        return f"{form_data.get('first_name') or ''} {form_data.get('last_name') or ''}".strip()
    return ""


def _skip_detected_field(field: Dict[str, Any]) -> bool:
    """Name and search inputs are not turned into Quick Apply fields."""
    field_type = (field.get("field_type") or "").lower()
    if field_type in {"first_name", "last_name", "full_name"}:
        return True
    if (field.get("input_type") or "").lower() == "search":
        return True
    label = field.get("label") or ""
    text = " ".join([
        label,
        field.get("name") or "",
        field.get("placeholder") or "",
    ]).lower()
    if "search" in text:
        return True
    if re.search(r"\b(first name|last name|full name|your name|given name|surname|family name)\b", text):
        return True
    if re.search(r"\bname\b", label.lower()) and not re.search(r"company|user|file", label.lower()):
        return True
    return False


async def _read_company_form(url: str, form_data: Dict[str, Any]) -> List[DetectedFormField]:
    """Open the company link and return the application fields with profile values."""
    if not url:
        return []
    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            response = await client.post(
                f"{settings.BROWSER_AUTOMATION_URL}/api/automation/inspect-form",
                json={"url": url},
                headers={"Authorization": f"Bearer {settings.BROWSER_AUTOMATION_TOKEN}"},
            )
        if response.status_code != 200:
            logger.warning(f"Form inspect returned {response.status_code}")
            return []
        payload = response.json()
        detected = []
        for field in payload.get("fields") or []:
            if _skip_detected_field(field):
                continue
            field_type = field.get("field_type") or "unknown"
            input_type = (field.get("input_type") or "text").lower()
            if input_type == "select-one":
                input_type = "select"
            choice_controls = {"checkbox", "radio", "select", "select-multiple"}
            detected.append(DetectedFormField(
                label=field.get("label") or "Field",
                name=field.get("name") or "",
                field_type=field_type,
                input_type=input_type,
                required=bool(field.get("required")),
                placeholder=field.get("placeholder") or "",
                value="" if input_type in choice_controls else _profile_value_for_field(field_type, form_data, field.get("label") or ""),
                options=field.get("options") or [],
            ))
        logger.info(f"Read {len(detected)} fields from {url}")
        return detected
    except Exception as error:
        logger.warning(f"Could not read company form: {error}")
        return []


class OpenAnswerRequest(BaseModel):
    user_id: str
    job_id: str
    question: str


@router.post("/open-answer")
async def answer_open_question(
    body: OpenAnswerRequest,
    authorization: Optional[str] = Header(None),
):
    """Answer an open-ended application question. Used by the browser filler."""
    from app.core.config import settings
    token = (authorization or "").replace("Bearer ", "", 1).strip()
    if token != settings.BROWSER_AUTOMATION_TOKEN:
        raise HTTPException(status_code=401, detail="Unauthorized")
    db = await get_database()
    user = None
    if ObjectId.is_valid(body.user_id):
        user = await db.users.find_one({"_id": ObjectId(body.user_id)})
    job = await db.jobs.find_one({"_id": ObjectId(body.job_id)}) if ObjectId.is_valid(body.job_id) else None
    if not user or not job:
        raise HTTPException(status_code=404, detail="User or job not found")
    cv_doc = await db.documents.find_one(
        {"user_id": body.user_id, "document_type": "cv"},
        sort=[("created_at", -1)]
    )
    answer = await email_agent_service.answer_open_question(
        user, job, body.question, (cv_doc or {}).get("cv_data") or {}
    )
    return {"answer": answer}


def get_user_id(user: dict) -> str:
    """Extract user ID from user dict"""
    return str(user.get("id") or user.get("_id") or user.get("user_id", ""))


@router.post("/quick-apply/prefill", response_model=QuickApplyPrefillResponse)
async def prefill_quick_apply_form(
    job_id: str,
    current_user: dict = Depends(get_current_active_user)
):
    """
    Prefill quick apply form with user's CV data
    
    This endpoint extracts data from the user's CV and returns
    form-ready data for the quick apply form.
    """
    try:
        user_id = get_user_id(current_user)
        
        if not user_id:
            raise HTTPException(
                status_code=401,
                detail="Invalid user session"
            )
        
        logger.info(f"Prefilling form for user {user_id}, job {job_id}")
        
        db = await get_database()
        
        # Get job details
        job = await db.jobs.find_one({"_id": ObjectId(job_id)})
        if not job:
            raise HTTPException(
                status_code=404,
                detail=f"Job not found: {job_id}"
            )
        
        # Extract form data from CV
        logger.info(f"Extracting form data from CV for user {user_id}")
        form_data = await email_agent_service.extract_form_data_from_cv(user_id)
        form_data["cover_letter"] = ""

        skills = form_data.get("skills")
        if isinstance(skills, list):
            form_data["skills"] = [str(skill) for skill in skills if skill]
        else:
            form_data["skills"] = []
        years = form_data.get("years_of_experience")
        if years is not None:
            try:
                form_data["years_of_experience"] = int(years)
            except (TypeError, ValueError):
                form_data.pop("years_of_experience", None)
        phone = form_data.get("phone") or ""
        form_data["phone"] = phone[:20] or None
        if not form_data.get("email"):
            form_data["email"] = current_user.get("email") or ""

        logger.info(f"Extracted form data keys: {list(form_data.keys())}")
        logger.debug(f"Form data values: {form_data}")
        
        # Determine recipient email (prioritize application_email as per model)
        recipient_email = (
            job.get("application_email") or 
            job.get("contact_email") or 
            job.get("recruiter_email")
        )
        
        apply_url = job.get("application_url") or job.get("external_url") or job.get("apply_url") or ""
        detected_fields = await _read_company_form(apply_url, form_data)

        response_data = QuickApplyPrefillResponse(
            success=True,
            form_data=form_data,
            job_title=job.get("title", ""),
            company_name=job.get("company_name", ""),
            recipient_email=recipient_email,
            apply_url=apply_url or None,
            detected_fields=detected_fields,
            message="Form data loaded successfully"
        )
        
        logger.info(f"Returning prefill response with {len(form_data)} fields, recipient: {recipient_email}")
        return response_data
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error prefilling form: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to prefill form: {str(e)}"
        )


@router.post("/quick-apply/submit", response_model=QuickApplySubmissionResponse)
async def submit_quick_apply(
    submission: QuickApplySubmission,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_active_user)
):
    """
    Submit job application via email agent
    
    This endpoint:
    1. Creates an application record
    2. Composes a professional application email
    3. Sends via user's Gmail account
    4. Tracks the application
    """
    try:
        user_id = get_user_id(current_user)
        
        if not user_id:
            raise HTTPException(
                status_code=401,
                detail="Invalid user session"
            )
        
        logger.info(f"Submitting application for user {user_id}, job {submission.job_id}")
        
        db = await get_database()
        
        # Check if user has Gmail connected
        user = await db.users.find_one({"_id": ObjectId(user_id)})
        if not user or not user.get("gmail_auth"):
            raise HTTPException(
                status_code=400,
                detail="Gmail not connected. Please connect your Gmail account to send applications."
            )
        
        # Check subscription usage limits
        subscription_service = SubscriptionService(db)
        allowed, _, _ = await subscription_service.check_usage_limit(user_id, "manual_application")
        if not allowed:
            raise HTTPException(
                status_code=403,
                detail="Manual application limit reached. Please upgrade your plan to apply to more jobs."
            )
        
        # Get job details
        job = await db.jobs.find_one({"_id": ObjectId(submission.job_id)})
        if not job:
            raise HTTPException(
                status_code=404,
                detail=f"Job not found: {submission.job_id}"
            )
        
        # Check if application already exists
        existing_app = await db.applications.find_one({
            "user_id": user_id,
            "job_id": submission.job_id
        })
        
        if existing_app and existing_app.get("status") not in ("withdrawn", "failed"):
            detail = "This application is already waiting in review" if existing_app.get("status") == "awaiting_review" else "You have already applied to this job"
            raise HTTPException(status_code=409, detail=detail)

        letter = submission.additional_message or (submission.form_data.cover_letter if submission.form_data else None)
        message = letter or f"Please find attached my CV and cover letter for the {job.get('title')} position."
        company_answers = []
        for answer in submission.company_fields or []:
            text = (answer.value or "").strip()
            if not text or answer.field_type == "cover_letter":
                continue
            company_answers.append({"label": answer.label, "field_type": answer.field_type, "value": text})
        if company_answers:
            message = message + "\n\n" + "\n".join(f"{item['label']}: {item['value']}" for item in company_answers)
        now = datetime.utcnow()
        application_doc = {
            "user_id": user_id,
            "job_id": submission.job_id,
            "status": "awaiting_review",
            "source": "manual",
            "auto_applied": False,
            "job_title": job.get("title"),
            "company_name": job.get("company_name"),
            "location": job.get("location"),
            "form_data": submission.form_data.dict(),
            "cv_document_id": submission.cv_document_id,
            "cover_letter_document_id": submission.cover_letter_document_id,
            "additional_message": submission.additional_message,
            "company_fields": company_answers,
            "usage_type": "manual_application",
            "review": {
                "channel": "email",
                "recipient_email": submission.recipient_email,
                "apply_url": job.get("application_url") or job.get("external_url") or job.get("apply_url"),
                "message": message,
            },
            "email_monitoring_enabled": False,
            "created_at": now,
            "updated_at": now,
            "deleted_at": None,
            "timeline": [{
                "status": "awaiting_review",
                "timestamp": now,
                "note": "Ready for review before the email is sent"
            }]
        }
        
        try:
            if existing_app:
                await db.applications.update_one({"_id": existing_app["_id"]}, {"$set": application_doc})
                application_id = str(existing_app["_id"])
            else:
                result = await db.applications.insert_one(application_doc)
                application_id = str(result.inserted_id)

            await subscription_service.track_usage(user_id, "manual_application")
            await db.applications.update_one(
                {"_id": ObjectId(application_id)},
                {"$set": {"usage_reserved": True}}
            )
            logger.info(f"Prepared application {application_id} for review")

            return QuickApplySubmissionResponse(
                success=True,
                application_id=application_id,
                recipient=submission.recipient_email,
                message="Application is ready for review. Open Applications and choose In Review to send it."
            )

        except Exception as db_error:
            if "duplicate key error" in str(db_error):
                raise HTTPException(
                    status_code=409,
                    detail="You have already applied to this job"
                )
            raise db_error
                
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error submitting application: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to submit application: {str(e)}"
        )


@router.get("/quick-apply/status/{application_id}", response_model=QuickApplyStatusResponse)
async def get_application_status(
    application_id: str,
    current_user: dict = Depends(get_current_active_user)
):
    """
    Get application submission and tracking status
    """
    try:
        user_id = get_user_id(current_user)
        
        db = await get_database()
        
        # Get application
        application = await db.applications.find_one({
            "_id": ObjectId(application_id),
            "user_id": user_id
        })
        
        if not application:
            raise HTTPException(
                status_code=404,
                detail="Application not found"
            )
        
        return QuickApplyStatusResponse(
            application_id=application_id,
            status=application.get("status", "unknown"),
            email_sent_via=application.get("email_sent_via"),
            gmail_message_id=application.get("gmail_message_id"),
            email_sent_at=application.get("email_sent_at"),
            recipient_email=application.get("recipient_email"),
            response_received=application.get("response_received", False),
            response_at=application.get("response_at"),
            error_message=application.get("error_message")
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting status: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=str(e)
        )


# Browser Automation Endpoints
@router.post("/autofill/start", response_model=AutofillStartResponse)
async def legacy_autofill_start(
    request: BrowserAutomationStart,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_active_user)
):
    """
    Start browser automation for a job application
    Handles JSON body with job_id, cv_id, and cover_letter_id
    """
    try:
        user_id = get_user_id(current_user)
        
        logger.info(f"Starting browser automation for user {user_id}, job {request.job_id}")
        
        db = await get_database()
        
        # Get job details
        job = await db.jobs.find_one({"_id": ObjectId(request.job_id)})
        if not job:
            raise HTTPException(
                status_code=404,
                detail=f"Job not found: {request.job_id}"
            )
        
        # Check subscription usage limits
        subscription_service = SubscriptionService(db)
        allowed, _, _ = await subscription_service.check_usage_limit(user_id, "manual_application")
        if not allowed:
            raise HTTPException(
                status_code=403,
                detail="Manual application limit reached. Please upgrade your plan to use auto-apply."
            )
        
        # Check if application already exists
        application = await db.applications.find_one({
            "user_id": user_id,
            "job_id": request.job_id
        })
        
        if application and application.get("status") not in ("withdrawn", "failed"):
            detail = "This application is already waiting in review" if application.get("status") == "awaiting_review" else "You have already applied to this job"
            raise HTTPException(status_code=409, detail=detail)

        now = datetime.utcnow()
        apply_url = job.get("application_url") or job.get("external_url") or job.get("apply_url")
        application_doc = {
            "user_id": user_id,
            "job_id": request.job_id,
            "status": "awaiting_review",
            "source": "browser_automation",
            "auto_applied": False,
            "job_title": job.get("title"),
            "company_name": job.get("company_name"),
            "location": job.get("location"),
            "cv_document_id": request.cv_id,
            "cover_letter_document_id": None,
            "usage_type": "manual_application",
            "review": {
                "channel": "browser",
                "recipient_email": None,
                "apply_url": apply_url,
                "message": "Your name, email, and phone will be filled on the application form, then the form will be submitted.",
            },
            "created_at": now,
            "updated_at": now,
            "deleted_at": None,
            "timeline": [{
                "status": "awaiting_review",
                "timestamp": now,
                "note": "Ready for review before the form is submitted"
            }]
        }
        if application:
            await db.applications.update_one({"_id": application["_id"]}, {"$set": application_doc})
            application_id = str(application["_id"])
        else:
            result = await db.applications.insert_one(application_doc)
            application_id = str(result.inserted_id)

        await subscription_service.track_usage(user_id, "manual_application")
        await db.applications.update_one(
            {"_id": ObjectId(application_id)},
            {"$set": {"usage_reserved": True}}
        )

        return AutofillStartResponse(
            success=True,
            session_id=application_id,
            message="Application is ready for review. Open Applications and choose In Review to send it."
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error starting browser automation: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to start browser automation: {str(e)}"
        )


@router.get("/autofill/status/{session_id}", response_model=AutofillStatusResponse)
async def get_autofill_status(
    session_id: str,
    current_user: dict = Depends(get_current_active_user)
):
    """
    Get browser automation status
    """
    try:
        user_id = get_user_id(current_user)
        
        db = await get_database()
        
        # Get application
        application = await db.applications.find_one({
            "_id": ObjectId(session_id),
            "user_id": user_id
        })
        
        if not application:
            raise HTTPException(
                status_code=404,
                detail="Automation session not found"
            )
        
        # 1. Poll actual Node service if it's still in a transient state
        current_status = application.get("automation_status") or application.get("status")
        transient_states = ["initializing", "navigating", "detecting_forms", "filling_forms", "started", "pending", "processing"]
        
        node_status_data = None
        if current_status in transient_states:
            from app.services.automation.browser_automation_service import BrowserAutomationService
            node_status_data = await BrowserAutomationService.get_node_automation_status(session_id)
            
            if node_status_data and "status" in node_status_data:
                node_status = node_status_data["status"]
                
                # If status changed, update DB
                if node_status != current_status:
                    update_doc = {
                        "automation_status": node_status,
                        "updated_at": datetime.utcnow()
                    }
                    
                    if node_status == "completed":
                        update_doc["status"] = "applied"
                        update_doc["automation_completed_at"] = datetime.utcnow()
                        update_doc["applied_date"] = datetime.utcnow()
                        # Track usage only on REAL completion
                        usage_type = application.get("usage_type", "manual_application")
                        from app.services.core.subscription_service import SubscriptionService
                        subscription_service = SubscriptionService(db)
                        await subscription_service.track_usage(user_id, usage_type)
                        logger.info(f"Usage tracked for user {user_id} after REAL completion polled.")
                    elif node_status == "error" or node_status == "failed":
                        node_errors = node_status_data.get("errors")
                        if node_errors and len(node_errors) > 0:
                            update_doc["automation_error"] = node_errors[0].get("message")
                        else:
                            update_doc["automation_error"] = "Unknown automation error"
                    
                    if node_status_data.get("filled_fields"):
                        update_doc["automation_details.filled_fields"] = node_status_data["filled_fields"]
                        
                    await db.applications.update_one(
                        {"_id": ObjectId(session_id)},
                        {"$set": update_doc}
                    )
                    # Use updated status for response
                    status = node_status
                    filled_fields = node_status_data.get("filled_fields", [])
                else:
                    status = current_status
                    filled_fields = application.get("automation_details", {}).get("filled_fields", [])
            else:
                status = current_status
                filled_fields = application.get("automation_details", {}).get("filled_fields", [])
        else:
            status = current_status
            filled_fields = application.get("automation_details", {}).get("filled_fields", [])

        # Safer error extraction
        node_error_msg = None
        if node_status_data:
            node_errors = node_status_data.get("errors")
            if node_errors and len(node_errors) > 0:
                node_error_msg = node_errors[0].get("message")

        return AutofillStatusResponse(
            status=status,
            filled_fields=filled_fields,
            error=application.get("automation_error") or node_error_msg,
            message=application.get("message")
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting automation status: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=str(e)
        )
