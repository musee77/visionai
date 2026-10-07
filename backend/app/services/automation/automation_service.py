# backend/app/services/automation/automation_service.py
"""
Main Automation Service - Intelligent routing between automation methods
This service automatically chooses the best automation method:
- QuickApplyService: Email-based applications (faster, preferred)
- BrowserAutomationService: Browser automation (fallback for portals)
"""

import logging
from typing import Dict, Any, Optional

from .browser_automation_service import BrowserAutomationService, get_browser_automation_config
from .quick_apply_service import QuickApplyService
from app.database import get_database
from bson import ObjectId

logger = logging.getLogger(__name__)


class AutomationService:
    """
    Main automation service that intelligently routes to the appropriate automation method
    
    Decision Logic:
    1. Check if job has recruiter email → Use QuickApplyService (email)
    2. Otherwise → Use BrowserAutomationService (browser automation)
    """
    
    @staticmethod
    async def prepare_customized_documents(
        user_id: str,
        job_id: str,
        cv_data: Dict[str, Any],
        tone: str = "professional"
    ) -> Dict[str, Any]:
        """
        Customize both CV and Cover Letter in parallel
        
        Returns:
            Dict containing customized documents and match score
        """
        try:
            db = await get_database()
            job = await db.jobs.find_one({"_id": ObjectId(job_id)})
            if not job:
                raise ValueError("Job not found")
                
            from app.services.documents.cv_customization_service import cv_customization_service
            from app.services.documents.cover_letter_service import cover_letter_service
            import asyncio
            
            logger.info(f"Parallel Customization: CV and Cover Letter for user {user_id}")
            
            # Run customizations in parallel
            cv_task = cv_customization_service.customize_cv_for_job(cv_data, job)
            cl_task = cover_letter_service.generate_cover_letter(cv_data, job, tone=tone)
            
            cv_result, cl_result = await asyncio.gather(cv_task, cl_task)
            
            return {
                "success": True,
                "cv": cv_result,
                "cover_letter": cl_result,
                "match_score": cv_result.get("job_match_score", 0)
            }
        except Exception as e:
            logger.error(f"Unified customization failed: {e}")
            return {"success": False, "error": str(e)}

    @staticmethod
    async def auto_apply_to_job(
        user_id: str,
        application_id: str,
        job_id: str,
        cv_id: Optional[str] = None,
        cover_letter_id: Optional[str] = None,
        usage_type: str = "auto_application"
    ) -> Dict[str, Any]:
        """
        Intelligently apply to job using the best available method
        
        Args:
            user_id: User ID
            application_id: Application record ID
            job_id: Job ID to apply for
            cv_id: Optional CV document ID
            cover_letter_id: Optional cover letter document ID
            
        Returns:
            Dict with automation result
        """
        try:
            db = await get_database()
            
            # Get job details
            job = await db.jobs.find_one({"_id": ObjectId(job_id)})
            if not job:
                return {
                    "success": False,
                    "error": f"Job {job_id} not found",
                    "method": "none"
                }
            
            application = await db.applications.find_one({"_id": ObjectId(application_id)}) if ObjectId.is_valid(str(application_id)) else None
            if application and application.get("status") == "awaiting_review":
                return {
                    "success": False,
                    "status": "awaiting_review",
                    "error": "This application is waiting for review",
                    "method": "review",
                }

            # Check if quick apply (email) is possible
            recipient_email = QuickApplyService.has_recruiter_email(job)
            
            if recipient_email and cv_id and cover_letter_id:
                # Use email-based quick apply (preferred method)
                logger.info(f"Using Quick Apply (email) for job {job_id}")
                
                # Get form data from CV
                from app.services.emails.email_agent_service import email_agent_service
                cv_doc = await db.documents.find_one({"_id": ObjectId(cv_id)})
                
                form_data = None
                if cv_doc and cv_doc.get("cv_data"):
                    form_data = await email_agent_service.extract_form_data_from_cv(
                        user_id=user_id,
                        cv_data=cv_doc["cv_data"],
                        db=db
                    )
                
                return await QuickApplyService.quick_apply_via_email(
                    user_id=user_id,
                    application_id=application_id,
                    job_id=job_id,
                    cv_id=cv_id,
                    cover_letter_id=cover_letter_id,
                    recipient_email=recipient_email,
                    form_data=form_data
                )
            else:
                # Use browser automation (fallback method)
                logger.info(f"Using Browser Automation for job {job_id}")
                return await BrowserAutomationService.auto_apply_to_job(
                    user_id=user_id,
                    application_id=application_id,
                    job_id=job_id,
                    cv_id=cv_id,
                    usage_type=usage_type
                )
                
        except Exception as e:
            logger.error(f"Error in auto_apply_to_job routing: {str(e)}")
            return {
                "success": False,
                "error": str(e),
                "method": "error"
            }
    
    # Delegate other methods to BrowserAutomationService
    check_application_status = BrowserAutomationService.check_application_status
    get_automation_status = BrowserAutomationService.get_automation_status
    cancel_automation = BrowserAutomationService.cancel_automation
    detect_application_platform = BrowserAutomationService.detect_application_platform
    check_automation_service_health = BrowserAutomationService.check_automation_service_health


# Export all services for direct access if needed
__all__ = [
    'AutomationService',
    'BrowserAutomationService',
    'QuickApplyService',
    'get_browser_automation_config'
]
