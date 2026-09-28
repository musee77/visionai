# backend/app/workers/email_sender.py
"""
Celery Worker for Asynchronous Email Sending
Handles background email sending with retry logic
"""

from app.workers.celery_app import celery_app
from app.services.emails.email_agent_service import email_agent_service
from motor.motor_asyncio import AsyncIOMotorClient
from app.core.config import settings
import asyncio
import logging
from datetime import datetime
from bson import ObjectId

logger = logging.getLogger(__name__)


async def get_database():
    """Get database connection"""
    client = AsyncIOMotorClient(settings.MONGODB_URL)
    return client[settings.DATABASE_NAME]


def run_async(coro):
    """Helper to run async functions in Celery tasks"""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


@celery_app.task(
    name="app.workers.email_sender.send_application_email",
    bind=True,
    max_retries=3,
    default_retry_delay=60  # Retry after 1 minute
)
def send_application_email(
    self,
    user_id: str,
    job_id: str,
    application_id: str,
    recipient_email: str,
    form_data: dict,
    cv_document_id: str,
    cover_letter_document_id: str = None,
    additional_message: str = None
):
    """
    Send job application email in background
    Allows quick response to user while email sends
    
    Features:
    - Automatic retry on failure (up to 3 times)
    - Updates application status on success/failure
    - Logs all attempts
    """
    async def _send():
        db = await get_database()
        
        try:
            # Update application status to "sending"
            await db.applications.update_one(
                {"_id": ObjectId(application_id)},
                {
                    "$set": {
                        "email_status": "sending",
                        "last_email_attempt": datetime.utcnow()
                    }
                }
            )
            
            # Send email via Gmail API
            logger.info(f"Sending application email for job {job_id}")
            result = await email_agent_service.send_application_via_gmail(
                user_id=user_id,
                job_id=job_id,
                application_id=application_id,
                recipient_email=recipient_email,
                form_data=form_data,
                cv_document_id=cv_document_id,
                cover_letter_document_id=cover_letter_document_id,
                additional_message=additional_message,
                db=db
            )
            
            # Update application status to "sent"
            await db.applications.update_one(
                {"_id": ObjectId(application_id)},
                {
                    "$set": {
                        "status": "submitted",
                        "email_status": "sent",
                        "updated_at": datetime.utcnow()
                    },
                    "$push": {
                        "timeline": {
                            "status": "submitted",
                            "timestamp": datetime.utcnow(),
                            "note": "Application email sent"
                        }
                    }
                }
            )
            
            logger.info(f"Application email sent successfully for job {job_id}")
            
            # Immediately trigger monitoring to catch "Application Received" emails
            from app.workers.email_monitor import scan_user_inbox
            scan_user_inbox.delay(user_id)
            
            return {
                "success": True,
                "application_id": application_id,
                "message_id": result.get("message_id"),
                "thread_id": result.get("thread_id")
            }
            
        except Exception as e:
            logger.error(f"Failed to send application email: {e}")
            
            # Update application status to "failed"
            retries_exhausted = self.request.retries >= self.max_retries
            await db.applications.update_one(
                {"_id": ObjectId(application_id)},
                {
                    "$set": {
                        "status": "failed" if retries_exhausted else "pending",
                        "email_status": "failed" if retries_exhausted else "retrying",
                        "email_error": str(e),
                        "last_email_attempt": datetime.utcnow()
                    }
                }
            )
            
            # Retry the task
            raise self.retry(exc=e)
    
    return run_async(_send())


@celery_app.task(name="app.workers.email_sender.send_bulk_application_emails")
def send_bulk_application_emails(applications: list):
    """
    Send multiple application emails in batch
    Useful for scheduled bulk applications
    
    Args:
        applications: List of application data dicts
    """
    async def _send_bulk():
        results = {
            "total": len(applications),
            "sent": 0,
            "failed": 0,
            "errors": []
        }
        
        for app_data in applications:
            try:
                # Trigger individual send task
                send_application_email.delay(
                    user_id=app_data["user_id"],
                    job_id=app_data["job_id"],
                    application_id=app_data["application_id"],
                    recipient_email=app_data["recipient_email"],
                    form_data=app_data["form_data"],
                    cv_document_id=app_data["cv_document_id"],
                    cover_letter_document_id=app_data.get("cover_letter_document_id"),
                    additional_message=app_data.get("additional_message")
                )
                results["sent"] += 1
                
            except Exception as e:
                logger.error(f"Failed to queue email for application {app_data.get('application_id')}: {e}")
                results["failed"] += 1
                results["errors"].append({
                    "application_id": app_data.get("application_id"),
                    "error": str(e)
                })
        
        logger.info(f"Bulk email send queued: {results['sent']} sent, {results['failed']} failed")
        return results
    
    return run_async(_send_bulk())


@celery_app.task(name="app.workers.email_sender.retry_failed_emails")
def retry_failed_emails():
    """
    Retry sending emails that failed in the last 24 hours
    Runs daily to catch any failed sends
    """
    async def _retry():
        try:
            db = await get_database()
            
            # Find applications with failed email status from last 24 hours
            from datetime import timedelta
            yesterday = datetime.utcnow() - timedelta(days=1)
            
            failed_apps = await db.applications.find({
                "email_status": "failed",
                "last_email_attempt": {"$gte": yesterday},
                "retry_count": {"$lt": 3}  # Max 3 retries
            }).to_list(length=100)
            
            if not failed_apps:
                logger.info("No failed emails to retry")
                return {"success": True, "retried": 0}
            
            retried_count = 0
            for app in failed_apps:
                try:
                    # Get application details
                    job = await db.jobs.find_one({"_id": ObjectId(app["job_id"])})
                    user = await db.users.find_one({"_id": ObjectId(app["user_id"])})
                    
                    if not job or not user:
                        continue
                    
                    # Increment retry count
                    await db.applications.update_one(
                        {"_id": app["_id"]},
                        {"$inc": {"retry_count": 1}}
                    )
                    
                    # Queue for retry
                    send_application_email.delay(
                        user_id=str(app["user_id"]),
                        job_id=str(app["job_id"]),
                        application_id=str(app["_id"]),
                        recipient_email=app.get("recipient_email"),
                        form_data=app.get("form_data", {}),
                        cv_document_id=app.get("cv_document_id"),
                        cover_letter_document_id=app.get("cover_letter_document_id"),
                        additional_message=app.get("additional_message")
                    )
                    
                    retried_count += 1
                    
                except Exception as e:
                    logger.error(f"Error retrying email for application {app['_id']}: {e}")
                    continue
            
            logger.info(f"Queued {retried_count} failed emails for retry")
            return {"success": True, "retried": retried_count}
            
        except Exception as e:
            logger.error(f"Error in retry_failed_emails: {e}")
            return {"success": False, "error": str(e)}
    
    return run_async(_retry())
