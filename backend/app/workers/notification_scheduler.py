# backend/app/workers/notification_scheduler.py
"""
Celery Worker for Background Tasks and Scheduled Notifications
"""
from app.workers.celery_app import celery_app
from datetime import datetime, timedelta
import asyncio
import logging
from motor.motor_asyncio import AsyncIOMotorClient
from app.core.config import settings
from app.services.core.notification_service import NotificationService
from app.services.jobs.application_tracking_service import ApplicationTrackingService
from app.services.core.analytics_service import AnalyticsService

logger = logging.getLogger(__name__)

_open_clients = []


async def get_database():
    """Get database connection"""
    client = AsyncIOMotorClient(settings.MONGODB_URL)
    _open_clients.append(client)
    return client[settings.DATABASE_NAME]


def run_async(coro):
    """Helper to run async functions in Celery tasks"""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(coro)
    finally:
        for client in _open_clients:
            try:
                client.close()
            except Exception:
                logger.warning("Failed to close Mongo client", exc_info=True)
        _open_clients.clear()
        try:
            loop.run_until_complete(loop.shutdown_asyncgens())
        except Exception:
            pass
        loop.close()


@celery_app.task(name="app.workers.notification_scheduler.send_interview_reminders")
def send_interview_reminders():
    """
    Send reminders for interviews scheduled in the next 24 hours
    """
    async def _send_reminders():
        try:
            db = await get_database()
            tracking_service = ApplicationTrackingService(db)
            notification_service = NotificationService(db)
            
            # Get interviews in next 24 hours
            interviews = await tracking_service.get_upcoming_interviews(days_ahead=1)
            
            reminder_count = 0
            for interview in interviews:
                interview_date = interview.get("interview_date")
                if not interview_date:
                    continue
                
                # Check if interview is within 20-28 hours (send once per day)
                hours_until = (interview_date - datetime.utcnow()).total_seconds() / 3600
                if 20 <= hours_until <= 28:
                    await notification_service.send_interview_reminder(
                        user_id=interview["user_id"],
                        job_title=interview.get("job_title", "Unknown Position"),
                        company=interview.get("company", "Unknown Company"),
                        interview_date=interview_date,
                        application_id=str(interview["_id"])
                    )
                    reminder_count += 1
            
            logger.info(f"Sent {reminder_count} interview reminders")
            return {"success": True, "reminders_sent": reminder_count}
            
        except Exception as e:
            logger.error(f"Error sending interview reminders: {e}")
            return {"success": False, "error": str(e)}
    
    return run_async(_send_reminders())


@celery_app.task(name="app.workers.notification_scheduler.send_follow_up_reminders")
def send_follow_up_reminders():
    """
    Send reminders for applications that need follow-up
    """
    async def _send_reminders():
        try:
            db = await get_database()
            tracking_service = ApplicationTrackingService(db)
            notification_service = NotificationService(db)
            
            # Get applications needing follow-up
            applications = await tracking_service.get_applications_needing_follow_up()
            
            reminder_count = 0
            for app in applications:
                await notification_service.send_follow_up_reminder(
                    user_id=app["user_id"],
                    job_title=app.get("job_title", "Unknown Position"),
                    company=app.get("company", "Unknown Company"),
                    application_id=str(app["_id"])
                )
                reminder_count += 1
            
            logger.info(f"Sent {reminder_count} follow-up reminders")
            return {"success": True, "reminders_sent": reminder_count}
            
        except Exception as e:
            logger.error(f"Error sending follow-up reminders: {e}")
            return {"success": False, "error": str(e)}
    
    return run_async(_send_reminders())


@celery_app.task(name="app.workers.notification_scheduler.send_weekly_summaries")
def send_weekly_summaries():
    """
    Send weekly application summary to all active users
    """
    async def _send_summaries():
        try:
            db = await get_database()
            analytics_service = AnalyticsService(db)
            notification_service = NotificationService(db)
            
            # Get all active users (users who applied in last 30 days)
            thirty_days_ago = datetime.utcnow() - timedelta(days=30)
            active_users = await db.applications.distinct(
                "user_id",
                {"created_at": {"$gte": thirty_days_ago}}
            )
            
            summary_count = 0
            for user_id in active_users:
                # Get stats for the last 7 days
                stats = await analytics_service.get_application_stats(
                    user_id=user_id,
                    period_days=7
                )
                
                # Get upcoming interviews
                tracking_service = ApplicationTrackingService(db)
                interviews = await tracking_service.get_upcoming_interviews(
                    user_id=user_id,
                    days_ahead=7
                )
                
                summary_data = {
                    "applications_this_week": stats["total_applications"],
                    "interviews_this_week": len(interviews),
                    "status_breakdown": stats["status_breakdown"],
                    "period": "last_7_days"
                }
                
                # Only send if there's activity
                if stats["total_applications"] > 0 or len(interviews) > 0:
                    await notification_service.send_weekly_summary(
                        user_id=user_id,
                        summary_data=summary_data
                    )
                    summary_count += 1
            
            logger.info(f"Sent {summary_count} weekly summaries")
            return {"success": True, "summaries_sent": summary_count}
            
        except Exception as e:
            logger.error(f"Error sending weekly summaries: {e}")
            return {"success": False, "error": str(e)}
    
    return run_async(_send_summaries())


@celery_app.task(name="app.workers.notification_scheduler.send_monthly_reports")
def send_monthly_reports():
    """
    Send monthly application report to all active users
    """
    async def _send_reports():
        try:
            db = await get_database()
            analytics_service = AnalyticsService(db)
            notification_service = NotificationService(db)
            
            # Get previous month
            now = datetime.utcnow()
            if now.month == 1:
                year = now.year - 1
                month = 12
            else:
                year = now.year
                month = now.month - 1
            
            # Get all users with applications in the previous month
            start_date = datetime(year, month, 1)
            if month == 12:
                end_date = datetime(year + 1, 1, 1)
            else:
                end_date = datetime(year, month + 1, 1)
            
            active_users = await db.applications.distinct(
                "user_id",
                {
                    "created_at": {
                        "$gte": start_date,
                        "$lt": end_date
                    }
                }
            )
            
            report_count = 0
            for user_id in active_users:
                # Generate monthly report
                report = await analytics_service.generate_monthly_report(
                    user_id=user_id,
                    year=year,
                    month=month
                )
                
                if report["total_applications"] > 0:
                    await notification_service.send_monthly_report(
                        user_id=user_id,
                        report_data=report
                    )
                    report_count += 1
            
            logger.info(f"Sent {report_count} monthly reports")
            return {"success": True, "reports_sent": report_count}
            
        except Exception as e:
            logger.error(f"Error sending monthly reports: {e}")
            return {"success": False, "error": str(e)}
    
    return run_async(_send_reports())


@celery_app.task(name="app.workers.notification_scheduler.cleanup_old_notifications")
def cleanup_old_notifications():
    """
    Delete notifications older than 90 days
    """
    async def _cleanup():
        try:
            db = await get_database()
            notification_service = NotificationService(db)
            
            deleted_count = await notification_service.delete_old_notifications(days=90)
            
            logger.info(f"Cleaned up {deleted_count} old notifications")
            return {"success": True, "deleted_count": deleted_count}
            
        except Exception as e:
            logger.error(f"Error cleaning up notifications: {e}")
            return {"success": False, "error": str(e)}
    
    return run_async(_cleanup())