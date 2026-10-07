# backend/app/api/email_applications.py
from fastapi import APIRouter, HTTPException, status, Depends, BackgroundTasks
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
from bson import ObjectId

from app.database import get_applications_collection, get_jobs_collection, get_users_collection, get_database
from app.models.application import Application, ApplicationStatus, ApplicationSource
from app.models.common import SuccessResponse
from app.models.user import User
from app.services.emails.gmail_service import gmail_service
from app.dependencies import get_current_active_user
from app.models.email_log import EmailLog, EmailDirection, EmailStatus
from app.services.core.subscription_service import SubscriptionService

import logging
logger = logging.getLogger(__name__)

router = APIRouter()

class EmailApplicationRequest(BaseModel):
    job_id: str
    cv_id: Optional[str] = None # ID of the CV document to attach
    cover_letter: Optional[str] = None # Text content
    subject_template: Optional[str] = "Application for {job_title} - {full_name}"

class EmailApplicationResponse(BaseModel):
    success: bool
    message: str
    application_id: Optional[str] = None
    thread_id: Optional[str] = None

@router.post("/apply", response_model=EmailApplicationResponse)
async def apply_via_email(
    request: EmailApplicationRequest,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_active_user)
):
    """
    Apply for a job via email using the user's connected Gmail account.
    """
    try:
        logger.info(f"=== Email Application Request Started ===")
        logger.info(f"Request data: job_id={request.job_id}, cv_id={request.cv_id}")
        logger.info(f"Current user type: {type(current_user)}, value: {current_user is not None}")
        
        # 1. Validate User has Gmail Connected
        if not current_user:
            raise HTTPException(
                status_code=401,
                detail="Authentication required"
            )
            
        if not current_user.get("gmail_auth"):
            logger.warning(f"User {current_user.get('_id')} has no gmail_auth")
            raise HTTPException(
                status_code=400, 
                detail="Gmail account not connected. Please connect your Gmail account first."
            )
        
        # 1.5. Check Usage Limits (Auto Application)
        subscription_service = SubscriptionService(await get_database())
        can_apply, _, _ = await subscription_service.check_usage_limit(
            str(current_user["_id"]),
            "auto_application"
        )
        
        if not can_apply:
             raise HTTPException(
                status_code=403,
                detail="Monthly auto-application limit reached. Please upgrade your plan."
            )

        # 2. Get Job Details
        jobs_collection = await get_jobs_collection()
        logger.info(f"Looking up job: {request.job_id}")
        
        job = await jobs_collection.find_one({"_id": ObjectId(request.job_id)})
        logger.info(f"Job found: {job is not None}")
        
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        
        # 3. Get employer email with fallbacks
        employer_email = (
            job.get("application_email") or 
            job.get("contact_email") or 
            job.get("company_info", {}).get("contact", {}).get("email")
        )
        
        if not employer_email:
            # If no email, suggest using the application URL instead
            application_url = job.get("application_url") or job.get("external_url")
            if application_url:
                raise HTTPException(
                    status_code=400, 
                    detail=f"This job doesn't support email applications. Please apply directly at: {application_url}"
                )
            else:
                raise HTTPException(
                    status_code=400, 
                    detail="This job doesn't have an email address or application URL. Please contact the employer directly."
                )


        applications_collection = await get_applications_collection()
        job_title = job.get("title", "Job")
        now = datetime.utcnow()
        message = request.cover_letter or f"Please find attached my CV and cover letter for the {job_title} position."
        user_id = str(current_user["_id"])
        existing = await applications_collection.find_one({
            "job_id": request.job_id,
            "user_id": user_id,
            "deleted_at": None,
        })
        if existing and existing.get("status") not in ("withdrawn", "failed"):
            detail = "This application is already waiting in review" if existing.get("status") == "awaiting_review" else "You have already applied to this job"
            raise HTTPException(status_code=409, detail=detail)

        application_doc = {
            "job_id": request.job_id,
            "user_id": user_id,
            "status": ApplicationStatus.AWAITING_REVIEW.value,
            "source": ApplicationSource.DIRECT.value,
            "application_method": "email",
            "job_title": job.get("title") or job_title,
            "company_name": job.get("company_name") or job.get("company"),
            "location": job.get("location") if isinstance(job.get("location"), str) else None,
            "cv_document_id": request.cv_id,
            "cover_letter_content": request.cover_letter,
            "usage_type": "auto_application",
            "usage_reserved": True,
            "review": {
                "channel": "email",
                "recipient_email": employer_email,
                "apply_url": job.get("application_url") or job.get("external_url") or job.get("apply_url"),
                "message": message,
            },
            "created_at": now,
            "updated_at": now,
            "deleted_at": None,
            "timeline": [{
                "status": "awaiting_review",
                "timestamp": now,
                "note": "Ready for review before the email is sent",
            }],
        }
        if existing:
            await applications_collection.update_one({"_id": existing["_id"]}, {"$set": application_doc})
            application_id = str(existing["_id"])
        else:
            result = await applications_collection.insert_one(application_doc)
            application_id = str(result.inserted_id)

        await subscription_service.track_usage(user_id, "auto_application")

        return EmailApplicationResponse(
            success=True,
            message="Application is ready for review. Open Applications and choose In Review to send it.",
            application_id=application_id,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Email application failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to prepare application: {str(e)}")


class ManualTrackRequest(BaseModel):
    job_id: str
    application_url: Optional[str] = None
    notes: Optional[str] = None

@router.post("/track", response_model=EmailApplicationResponse)
async def track_external_application(
    request: ManualTrackRequest,
    current_user: dict = Depends(get_current_active_user)
):
    """
    Manually track a job application submitted externally.
    """
    try:
        # 1. Get Job Details
        jobs_collection = await get_jobs_collection()
        job = await jobs_collection.find_one({"_id": ObjectId(request.job_id)})
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")



        apply_url = request.application_url or job.get("application_url") or job.get("external_url") or job.get("apply_url")
        applications_collection = await get_applications_collection()
        user_id = str(current_user["_id"])
        now = datetime.utcnow()
        existing = await applications_collection.find_one({
            "job_id": request.job_id,
            "user_id": user_id,
            "deleted_at": None,
            "status": {"$nin": ["withdrawn", "failed"]},
        })
        if existing:
            channel = (existing.get("review") or {}).get("channel")
            if existing.get("application_method") == "external" or channel == "external" or existing.get("status") != ApplicationStatus.AWAITING_REVIEW.value:
                await applications_collection.update_one(
                    {"_id": existing["_id"]},
                    {"$set": {
                        "status": ApplicationStatus.APPLIED.value,
                        "application_method": "external",
                        "application_url": apply_url,
                        "review": None,
                        "updated_at": now,
                    }},
                )
            return EmailApplicationResponse(
                success=True,
                message="This application is saved. It does not need a review.",
                application_id=str(existing["_id"]),
            )

        subscription_service = SubscriptionService(await get_database())
        can_apply, _, _ = await subscription_service.check_usage_limit(user_id, "manual_application")
        if not can_apply:
            raise HTTPException(
                status_code=403,
                detail="Monthly manual application limit reached. Please upgrade your plan.",
            )

        location = job.get("location")
        if isinstance(location, dict):
            location = ", ".join(
                part for part in [
                    location.get("city"),
                    location.get("region") or location.get("state"),
                    location.get("country"),
                ] if part
            ) or None

        result = await applications_collection.insert_one({
            "job_id": request.job_id,
            "user_id": user_id,
            "status": ApplicationStatus.APPLIED.value,
            "source": ApplicationSource.MANUAL.value,
            "application_method": "external",
            "application_url": apply_url,
            "job_title": job.get("title", "Job"),
            "company_name": job.get("company_name") or job.get("company"),
            "location": location if isinstance(location, str) else None,
            "additional_notes": request.notes,
            "usage_type": "manual_application",
            "usage_reserved": False,
            "review": None,
            "created_at": now,
            "updated_at": now,
            "applied_date": now,
            "deleted_at": None,
            "timeline": [{
                "status": "applied",
                "timestamp": now,
                "note": "Opened the company application page",
            }],
        })
        await subscription_service.track_usage(user_id, "manual_application")
        return EmailApplicationResponse(
            success=True,
            message="Application saved. Opening a company link does not need a review.",
            application_id=str(result.inserted_id),
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Manual tracking failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to track application: {str(e)}")

@router.get("/sync", response_model=SuccessResponse)
async def sync_inbox(
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_active_user),
    db = Depends(get_database)
):
    """
    Trigger a background scan of the user's inbox for application updates.
    """
    try:
        from app.services.emails.email_intelligence import EmailIntelligenceService
        service = EmailIntelligenceService(db)
        
        # Run in background to avoid timeout
        background_tasks.add_task(service.scan_inbox_for_replies, str(current_user["_id"]))
        
        return SuccessResponse(message="Inbox sync started in background")
    except Exception as e:
        logger.error(f"Sync failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to start sync: {str(e)}")
