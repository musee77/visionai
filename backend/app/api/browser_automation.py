# backend/app/api/browser_automation.py
"""
Quick Apply / Email Agent API
Handles intelligent form prefilling and email-based application submission
"""

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import Dict, Any, Optional
import logging
from datetime import datetime
from bson import ObjectId

from app.database import get_database
from app.api.deps import get_current_user, get_current_active_user
from app.services.emails.email_agent_service import email_agent_service
from app.services.core.subscription_service import SubscriptionService
from app.schemas.quick_apply import (
    QuickApplyPrefillResponse,
    QuickApplySubmission,
    QuickApplySubmissionResponse,
    QuickApplyStatusResponse,
    AutofillStartResponse,
    AutofillStatusResponse
)

class BrowserAutomationStart(BaseModel):
    job_id: str
    cv_id: Optional[str] = None
    cover_letter_id: Optional[str] = None

router = APIRouter()
logger = logging.getLogger(__name__)


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
        
        # Check for generated cover letter (Robustly)
        try:
            saved_job = await db.saved_jobs.find_one({
                "user_id": user_id,
                "job_id": job_id
            })
            
            if saved_job and saved_job.get("generated_cover_letter_id"):
                gen_cl_id = saved_job.get("generated_cover_letter_id")
                # Ensure it's a valid ObjectId
                if ObjectId.is_valid(gen_cl_id):
                    gen_cl = await db.generated_documents.find_one({"_id": ObjectId(gen_cl_id)})
                    if gen_cl and "content" in gen_cl:
                        # Structure is content -> content -> full_text based on service
                        full_text = gen_cl.get("content", {}).get("content", {}).get("full_text")
                        if full_text:
                            form_data["cover_letter"] = full_text
                            logger.info(f"Injected generated cover letter text for user {user_id}")
                else:
                    logger.warning(f"Invalid generated_cover_letter_id format: {gen_cl_id}")
        except Exception as e:
            logger.warning(f"Failed to lookup generated cover letter: {e}")

        logger.info(f"Extracted form data keys: {list(form_data.keys())}")
        logger.debug(f"Form data values: {form_data}")
        
        # Determine recipient email (prioritize application_email as per model)
        recipient_email = (
            job.get("application_email") or 
            job.get("contact_email") or 
            job.get("recruiter_email")
        )
        
        response_data = QuickApplyPrefillResponse(
            success=True,
            form_data=form_data,
            job_title=job.get("title", ""),
            company_name=job.get("company_name", ""),
            recipient_email=recipient_email,
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
            "cover_letter_document_id": request.cover_letter_id,
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
