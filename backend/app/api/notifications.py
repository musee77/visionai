# backend/app/api/notifications.py
"""
Notifications API Router
Handles notification-related endpoints
"""
from fastapi import APIRouter, HTTPException, status, Depends, Query
from typing import List, Optional
from datetime import datetime
import logging
from app.api.deps import get_current_user, get_current_active_user, get_database
from app.services.core.notification_service import NotificationService
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter()


class NotificationResponse(BaseModel):
    id: str
    user_id: str
    type: str
    title: str
    message: str
    data: dict = {}
    channels: List[str] = []
    is_read: bool
    created_at: datetime
    sent_at: Optional[datetime] = None
    read_at: Optional[datetime] = None


class UnreadCountResponse(BaseModel):
    unread_count: int


@router.get("/", response_model=List[NotificationResponse])
async def get_notifications(
    unread_only: bool = Query(False, description="Get only unread notifications"),
    limit: int = Query(50, ge=1, le=100),
    skip: int = Query(0, ge=0),
    current_user: dict = Depends(get_current_active_user),
    db = Depends(get_database)
):
    """
    Get user notifications
    
    - **unread_only**: Filter to show only unread notifications
    - **limit**: Maximum number of notifications to return
    - **skip**: Number of notifications to skip (for pagination)
    """
    try:
        notification_service = NotificationService(db)
        
        notifications = await notification_service.get_user_notifications(
            user_id=str(current_user["_id"]),
            unread_only=unread_only,
            limit=limit,
            skip=skip
        )
        
        return [
            NotificationResponse(
                id=str(n["_id"]),
                user_id=n["user_id"],
                type=n["type"],
                title=n["title"],
                message=n["message"],
                data=n.get("data", {}),
                channels=n.get("channels", []),
                is_read=n.get("is_read", False),
                created_at=n["created_at"],
                sent_at=n.get("sent_at"),
                read_at=n.get("read_at")
            )
            for n in notifications
        ]
        
    except Exception as e:
        logger.error(f"Error fetching notifications: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch notifications"
        )


@router.get("/unread-count", response_model=UnreadCountResponse)
async def get_unread_count(
    current_user: dict = Depends(get_current_active_user),
    db = Depends(get_database)
):
    """Get count of unread notifications"""
    try:
        notification_service = NotificationService(db)
        
        count = await notification_service.get_unread_count(
            user_id=str(current_user["_id"])
        )
        
        return UnreadCountResponse(unread_count=count)
        
    except Exception as e:
        logger.error(f"Error getting unread count: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to get unread count"
        )


@router.put("/{notification_id}/read")
async def mark_notification_as_read(
    notification_id: str,
    current_user: dict = Depends(get_current_active_user),
    db = Depends(get_database)
):
    """Mark a notification as read"""
    try:
        notification_service = NotificationService(db)
        
        success = await notification_service.mark_as_read(notification_id)
        
        if not success:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Notification not found"
            )
        
        return {"message": "Notification marked as read", "success": True}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error marking notification as read: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to mark notification as read"
        )


@router.put("/mark-all-read")
async def mark_all_notifications_as_read(
    current_user: dict = Depends(get_current_active_user),
    db = Depends(get_database)
):
    """Mark all notifications as read for the current user"""
    try:
        notification_service = NotificationService(db)
        
        count = await notification_service.mark_all_as_read(
            user_id=str(current_user["_id"])
        )
        
        return {
            "message": f"Marked {count} notifications as read",
            "count": count,
            "success": True
        }
        
    except Exception as e:
        logger.error(f"Error marking all notifications as read: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to mark all notifications as read"
        )


@router.delete("/{notification_id}")
async def delete_notification(
    notification_id: str,
    current_user: dict = Depends(get_current_active_user),
    db = Depends(get_database)
):
    """Delete a notification"""
    try:
        notification_service = NotificationService(db)
        
        success = await notification_service.delete_notification(notification_id)
        
        if not success:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Notification not found"
            )
        
        return {"message": "Notification deleted", "success": True}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting notification: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete notification"
        )


@router.post("/test")
async def create_test_notification(
    current_user: dict = Depends(get_current_active_user),
    db = Depends(get_database)
):
    """
    Create a test notification (for development/testing)
    """
    try:
        notification_service = NotificationService(db)
        
        notification = await notification_service.create_notification(
            user_id=str(current_user["_id"]),
            notification_type="test",
            title="Test Notification",
            message="This is a test notification from JobsApply.",
            data={"test": True},
            channels=["in_app", "email"]
        )
        
        return {
            "message": "Test notification created",
            "notification": notification,
            "success": True
        }
        
    except Exception as e:
        logger.error(f"Error creating test notification: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create test notification"
        )