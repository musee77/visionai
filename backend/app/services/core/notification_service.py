# backend/app/services/notification_service.py
"""
Notification Service
Handles multi-channel notifications (Email, In-app, SMS, Push)
"""
from motor.motor_asyncio import AsyncIOMotorDatabase
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from bson import ObjectId
import logging
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from app.core.config import settings

logger = logging.getLogger(__name__)


class NotificationService:
    """Service for sending and managing notifications"""
    
    def __init__(self, db: AsyncIOMotorDatabase):
        self.db = db
        self.notifications = db.notifications
        self.users = db.users
    
    async def create_notification(
        self,
        user_id: str,
        notification_type: str,
        title: str,
        message: str,
        data: Optional[Dict[str, Any]] = None,
        channels: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """Create a new notification"""
        try:
            notification = {
                "user_id": user_id,
                "type": notification_type,
                "title": title,
                "message": message,
                "data": data or {},
                "channels": channels or ["in_app"],
                "is_read": False,
                "created_at": datetime.utcnow(),
                "sent_at": None,
                "read_at": None
            }
            
            result = await self.notifications.insert_one(notification)
            notification["_id"] = str(result.inserted_id)
            
            # Send through specified channels
            await self._send_notification(notification)
            
            logger.info(f"Notification created for user {user_id}: {notification_type}")
            return notification
            
        except Exception as e:
            logger.error(f"Error creating notification: {e}")
            raise
    
    async def _send_notification(self, notification: Dict[str, Any]) -> None:
        """Send notification through specified channels"""
        try:
            channels = notification.get("channels", ["in_app"])
            
            if "email" in channels:
                await self._send_email_notification(notification)
            
            if "sms" in channels or "push" in channels:
                logger.debug("SMS and push are not connected. The in-app notification is the message the user receives.")
            
            # Update sent_at timestamp
            await self.notifications.update_one(
                {"_id": ObjectId(notification["_id"])},
                {"$set": {"sent_at": datetime.utcnow()}}
            )
            
        except Exception as e:
            logger.error(f"Error sending notification: {e}")
    
    async def _send_email_notification(self, notification: Dict[str, Any]) -> None:
        """Send email notification"""
        try:
            # Get user email
            user = await self.users.find_one({"_id": ObjectId(notification["user_id"])})
            if not user or not user.get("email"):
                logger.warning(f"No email found for user {notification['user_id']}")
                return
            
            # Check if email is enabled
            smtp_host = getattr(settings, "SMTP_HOST", None)
            if not smtp_host:
                logger.warning("SMTP not configured, skipping email notification")
                return
            
            # Create email
            msg = MIMEMultipart("alternative")
            msg["Subject"] = notification["title"]
            msg["From"] = getattr(settings, "SMTP_FROM_EMAIL", "noreply@cvision.ai")
            msg["To"] = user["email"]
            
            # Create HTML body
            html_body = f"""
            <html>
              <body>
                <h2>{notification["title"]}</h2>
                <p>{notification["message"]}</p>
                <hr>
                <p style="color: gray; font-size: 12px;">
                  This is an automated notification from JobsApply.
                </p>
              </body>
            </html>
            """
            
            msg.attach(MIMEText(notification["message"], "plain"))
            msg.attach(MIMEText(html_body, "html"))
            
            # Send email
            smtp_port = getattr(settings, "SMTP_PORT", 587)
            smtp_username = getattr(settings, "SMTP_USERNAME", None)
            smtp_password = getattr(settings, "SMTP_PASSWORD", None)
            
            with smtplib.SMTP(smtp_host, smtp_port) as server:
                server.starttls()
                if smtp_username and smtp_password:
                    server.login(smtp_username, smtp_password)
                server.send_message(msg)
            
            logger.info(f"Email notification sent to {user['email']}")
            
        except Exception as e:
            logger.error(f"Error sending email notification: {e}")
    
    async def _send_sms_notification(self, notification: Dict[str, Any]) -> None:
        """Send SMS notification (placeholder - integrate with SMS provider)"""
        logger.info(f"SMS notification would be sent: {notification['title']}")
        # TODO: Integrate with Twilio, AWS SNS, or other SMS provider
    
    async def _send_push_notification(self, notification: Dict[str, Any]) -> None:
        """Send push notification (placeholder - integrate with push service)"""
        logger.info(f"Push notification would be sent: {notification['title']}")
        # TODO: Integrate with Firebase Cloud Messaging or similar
    
    async def get_user_notifications(
        self,
        user_id: str,
        unread_only: bool = False,
        limit: int = 50,
        skip: int = 0
    ) -> List[Dict[str, Any]]:
        """Get notifications for a user"""
        try:
            query = {"user_id": user_id}
            if unread_only:
                query["is_read"] = False
            
            notifications = await self.notifications.find(query)\
                .sort("created_at", -1)\
                .skip(skip)\
                .limit(limit)\
                .to_list(length=limit)
            
            logger.debug(f"Found {len(notifications)} notifications for user {user_id}")
            
            # Convert ObjectId to string
            for notif in notifications:
                notif["_id"] = str(notif["_id"])
            
            return notifications
            
        except Exception as e:
            logger.error(f"Error getting user notifications: {e}")
            return []
    
    async def mark_as_read(self, notification_id: str) -> bool:
        """Mark a notification as read"""
        try:
            result = await self.notifications.update_one(
                {"_id": ObjectId(notification_id)},
                {
                    "$set": {
                        "is_read": True,
                        "read_at": datetime.utcnow()
                    }
                }
            )
            
            return result.modified_count > 0
            
        except Exception as e:
            logger.error(f"Error marking notification as read: {e}")
            return False
    
    async def mark_all_as_read(self, user_id: str) -> int:
        """Mark all notifications as read for a user"""
        try:
            result = await self.notifications.update_many(
                {"user_id": user_id, "is_read": False},
                {
                    "$set": {
                        "is_read": True,
                        "read_at": datetime.utcnow()
                    }
                }
            )
            
            return result.modified_count
            
        except Exception as e:
            logger.error(f"Error marking all notifications as read: {e}")
            return 0
    
    async def get_unread_count(self, user_id: str) -> int:
        """Get count of unread notifications"""
        try:
            count = await self.notifications.count_documents({
                "user_id": user_id,
                "is_read": False
            })
            
            return count
            
        except Exception as e:
            logger.error(f"Error getting unread count: {e}")
            return 0
    
    async def delete_notification(self, notification_id: str) -> bool:
        """Delete a notification"""
        try:
            result = await self.notifications.delete_one({"_id": ObjectId(notification_id)})
            return result.deleted_count > 0
            
        except Exception as e:
            logger.error(f"Error deleting notification: {e}")
            return False
    
    async def delete_old_notifications(self, days: int = 90) -> int:
        """Delete notifications older than specified days"""
        try:
            cutoff_date = datetime.utcnow() - timedelta(days=days)
            
            result = await self.notifications.delete_many({
                "created_at": {"$lt": cutoff_date}
            })
            
            logger.info(f"Deleted {result.deleted_count} old notifications")
            return result.deleted_count
            
        except Exception as e:
            logger.error(f"Error deleting old notifications: {e}")
            return 0
    
    # Specific notification methods
    
    async def send_application_submitted(
        self,
        user_id: str,
        job_title: str,
        company: str,
        application_id: str
    ) -> Dict[str, Any]:
        """Send notification when application is submitted"""
        return await self.create_notification(
            user_id=user_id,
            notification_type="application_submitted",
            title="Application Submitted",
            message=f"Your application for {job_title} at {company} has been submitted successfully.",
            data={
                "application_id": application_id,
                "job_title": job_title,
                "company": company
            },
            channels=["in_app", "email"]
        )
    
    async def send_status_update(
        self,
        user_id: str,
        job_title: str,
        new_status: str
    ) -> Dict[str, Any]:
        """Send notification when application status changes"""
        status_messages = {
            "under_review": "is now under review",
            "interview_scheduled": "has an interview scheduled",
            "interviewed": "interview completed",
            "offer_received": "congratulations! You received an offer",
            "rejected": "has been updated",
            "accepted": "offer accepted",
            "withdrawn": "has been withdrawn"
        }
        
        message = f"Your application for {job_title} {status_messages.get(new_status, 'has been updated')}."
        
        return await self.create_notification(
            user_id=user_id,
            notification_type="status_update",
            title="Application Status Update",
            message=message,
            data={
                "job_title": job_title,
                "new_status": new_status
            },
            channels=["in_app", "email"]
        )
    
    async def send_interview_reminder(
        self,
        user_id: str,
        job_title: str,
        company: str,
        interview_date: datetime,
        application_id: str
    ) -> Dict[str, Any]:
        """Send interview reminder notification"""
        formatted_date = interview_date.strftime("%B %d, %Y at %I:%M %p")
        
        return await self.create_notification(
            user_id=user_id,
            notification_type="interview_reminder",
            title="Upcoming Interview Reminder",
            message=f"Reminder: You have an interview for {job_title} at {company} on {formatted_date}.",
            data={
                "application_id": application_id,
                "job_title": job_title,
                "company": company,
                "interview_date": interview_date.isoformat()
            },
            channels=["in_app", "email"]
        )
    
    async def send_follow_up_reminder(
        self,
        user_id: str,
        job_title: str,
        company: str,
        application_id: str
    ) -> Dict[str, Any]:
        """Send follow-up reminder notification"""
        return await self.create_notification(
            user_id=user_id,
            notification_type="follow_up_reminder",
            title="Follow-up Reminder",
            message=f"Don't forget to follow up on your application for {job_title} at {company}.",
            data={
                "application_id": application_id,
                "job_title": job_title,
                "company": company
            },
            channels=["in_app", "email"]
        )
    
    async def send_deadline_reminder(
        self,
        user_id: str,
        job_title: str,
        company: str,
        deadline: datetime,
        application_id: str
    ) -> Dict[str, Any]:
        """Send application deadline reminder"""
        formatted_date = deadline.strftime("%B %d, %Y")
        
        return await self.create_notification(
            user_id=user_id,
            notification_type="deadline_reminder",
            title="Application Deadline Approaching",
            message=f"Reminder: The deadline for {job_title} at {company} is on {formatted_date}.",
            data={
                "application_id": application_id,
                "job_title": job_title,
                "company": company,
                "deadline": deadline.isoformat()
            },
            channels=["in_app", "email"]
        )
    
    async def send_weekly_summary(
        self,
        user_id: str,
        summary_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Send weekly application summary"""
        applications_count = summary_data.get("applications_this_week", 0)
        interviews_count = summary_data.get("interviews_this_week", 0)
        
        message = f"This week: {applications_count} applications submitted"
        if interviews_count > 0:
            message += f", {interviews_count} interviews scheduled"
        
        return await self.create_notification(
            user_id=user_id,
            notification_type="weekly_summary",
            title="Your Weekly Application Summary",
            message=message,
            data=summary_data,
            channels=["in_app", "email"]
        )
    
    async def send_monthly_report(
        self,
        user_id: str,
        report_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Send monthly application report"""
        total = report_data.get("total_applications", 0)
        interviews = report_data.get("interviews_count", 0)
        offers = report_data.get("offers_count", 0)
        
        message = f"Monthly Report: {total} applications, {interviews} interviews, {offers} offers"
        
        return await self.create_notification(
            user_id=user_id,
            notification_type="monthly_report",
            title="Your Monthly Application Report",
            message=message,
            data=report_data,
            channels=["in_app", "email"]
        )