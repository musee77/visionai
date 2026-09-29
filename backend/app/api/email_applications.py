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


        # 4. Create Application Record FIRST (needed for email agent)
        applications_collection = await get_applications_collection()
        job_title = job.get("title", "Job")
        
        application_doc = Application(
            job_id=request.job_id,
            user_id=str(current_user["_id"]),
            status=ApplicationStatus.DRAFT,  # Start as draft
            source=ApplicationSource.DIRECT,
            application_method="email",
            applied_date=datetime.utcnow(),
            job_title=job.get("title") or job_title,
            company_name=job.get("company_name") or job.get("company"),
            location=job.get("location") if isinstance(job.get("location"), str) else None
        )
        
        result = await applications_collection.insert_one(application_doc.dict(by_alias=True, exclude={"id"}))
        application_id = str(result.inserted_id)
        
        # 5. Prepare form data
        form_data = {
            "first_name": current_user.get('first_name', ''),
            "last_name": current_user.get('last_name', ''),
            "email": current_user.get('email', ''),
            "phone": current_user.get('phone', ''),
        }
        
        
        # 6. Send via Email Agent Service
        from app.services.emails.email_agent_service import email_agent_service
        
        try:
            logger.info(f"Sending application via email agent for user {current_user['_id']} to job {request.job_id}")
            
            send_result = await email_agent_service.send_application_via_gmail(
                user_id=str(current_user["_id"]),
                job_id=request.job_id,
                application_id=application_id,
                recipient_email=employer_email,
                form_data=form_data,
                cv_document_id=request.cv_id,
                cover_letter_document_id=None,
                additional_message=request.cover_letter
            )
            
            logger.info(f"Email agent result: {send_result}")
            
            # Handle None or missing result
            if send_result is None:
                logger.error("Email agent returned None")
                raise HTTPException(
                    status_code=500,
                    detail="Email service returned no response. Please check your Gmail connection and try again."
                )
            
            if not send_result.get("success"):
                error_msg = send_result.get("error", "Unknown error occurred")
                logger.error(f"Email agent failed: {error_msg}")
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to send application: {error_msg}"
                )
            

        
            # Track usage
            await subscription_service.track_usage(
                 str(current_user["_id"]),
                 "auto_application"
            )

            # Success! Application status already updated by email agent
            return EmailApplicationResponse(
                success=True,
                message="Application sent successfully",
                application_id=application_id,
                thread_id=send_result.get("gmail_message_id")
            )
            
        except HTTPException:
            raise
        except Exception as email_error:
            logger.error(f"Email agent exception: {str(email_error)}", exc_info=True)
            # Update application to failed
            await applications_collection.update_one(
                {"_id": result.inserted_id},
                {"$set": {
                    "status": ApplicationStatus.FAILED,
                    "error_message": str(email_error)
                }}
            )
            raise HTTPException(
                status_code=500,
                detail=f"Failed to send application: {str(email_error)}"
            )

    except Exception as e:
        logger.error(f"Email application failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to send application: {str(e)}")


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



        # 1.5 Check Usage Limits (Manual Application)
        subscription_service = SubscriptionService(await get_database())
        can_apply, _, _ = await subscription_service.check_usage_limit(
            str(current_user["_id"]),
            "manual_application"
        )
        
        if not can_apply:
             raise HTTPException(
                status_code=403,
                detail="Monthly manual application limit reached. Please upgrade your plan."
            )

        # 2. Create Application Record
        applications_collection = await get_applications_collection()
        
        # Check if already applied
        existing = await applications_collection.find_one({
            "job_id": request.job_id,
            "user_id": str(current_user["_id"])
        })
        
        if existing:
             raise HTTPException(status_code=400, detail="You have already applied to this job.")

        application_doc = Application(
            job_id=request.job_id,
            user_id=str(current_user["_id"]),
            status=ApplicationStatus.SUBMITTED,
            source=ApplicationSource.MANUAL,
            application_method="external",
            application_url=request.application_url or job.get("application_url"),
            applied_date=datetime.utcnow(),
            job_title=job.get("title", "Job"),
            company_name=job.get("company_name") or job.get("company"),
            location=job.get("location") if isinstance(job.get("location"), str) else None,
            additional_notes=request.notes
        )
        
        result = await applications_collection.insert_one(application_doc.dict(by_alias=True, exclude={"id"}))
        

        
        # Track usage
        await subscription_service.track_usage(
             str(current_user["_id"]),
             "manual_application"
        )
        
        return EmailApplicationResponse(
            success=True,
            message="Application tracked successfully",
            application_id=str(result.inserted_id)
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
