"""
Job application management API routes with Phase 5 integration
Complete implementation with all endpoints
"""

from fastapi import APIRouter, HTTPException, Depends, Query, BackgroundTasks, status
from fastapi import status as fastapi_status
from typing import List, Optional, Dict, Any
from datetime import datetime
import logging
from bson import ObjectId
from pydantic import BaseModel
import re

from app.api.deps import (
    CurrentActiveUser, CurrentVerifiedUser, get_database, get_current_verified_user, get_current_active_user
)
from app.models.application import (
    Application, ApplicationCreate, ApplicationUpdate, ApplicationResponse,
    ApplicationListResponse, ApplicationStats, ApplicationStatus, EmailReplyRequest,
    ApplicationCommunication, CommunicationType
)
from app.services.emails.gmail_service import gmail_service
from app.models.user import GmailAuth
from app.models.common import SuccessResponse
from app.services.jobs.application_tracking_service import ApplicationTrackingService
from app.services.core.subscription_service import SubscriptionService

# Import Phase 5 services if available
try:
    from app.services.core.analytics_service import AnalyticsService
except ImportError:
    AnalyticsService = None
    
try:
    from app.services.core.notification_service import NotificationService
except ImportError:
    NotificationService = None

router = APIRouter()
logger = logging.getLogger(__name__)


# ==================== REQUEST MODELS ====================

class UpdateApplicationStatusRequest(BaseModel):
    status: ApplicationStatus
    notes: Optional[str] = None


class ScheduleInterviewRequest(BaseModel):
    interview_date: datetime
    interview_type: str = "phone"
    location: Optional[str] = None
    notes: Optional[str] = None


class SetFollowUpRequest(BaseModel):
    follow_up_date: datetime
    notes: Optional[str] = None


# ==================== CORE APPLICATION ENDPOINTS ====================

@router.post("/", response_model=ApplicationResponse)
async def create_application(
    application_create: ApplicationCreate,
    current_user: Dict[str, Any] = Depends(get_current_verified_user), 
    db = Depends(get_database)
):
    """Create a new job application with Phase 5 tracking"""
    try:
        # Prepare application data
        app_data = application_create.dict()
        app_data["user_id"] = str(current_user["_id"])
        
        # Check usage limits
        subscription_service = SubscriptionService(db)
        # Determine event type (manual vs auto)
        event_type = "manual_application" if app_data.get("source", "manual") == "manual" else "auto_application"
        
        allowed, _, _ = await subscription_service.check_usage_limit(
            str(current_user["_id"]), 
            event_type
        )
        
        if not allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Usage limit reached for {event_type.replace('_', ' ')}s. Please upgrade your plan."
            )
        
        # Create application using static method
        application_id = await ApplicationTrackingService.create_application(app_data, db)
        
        if not application_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to create application"
            )
        
        # Get created application
        application = await ApplicationTrackingService.get_application_by_id(application_id, db)
        
        if not application:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to retrieve created application"
            )
        
        # Initialize tracking service for timeline event
        tracking_service = ApplicationTrackingService(db)
        await tracking_service.add_timeline_event(
            application_id=application_id,
            event_type="created",
            description="Application created",
            metadata={"source": application.get("source", "manual")}
        )
        
        # Track usage after successful creation
        await subscription_service.track_usage(
            str(current_user["_id"]), 
            event_type
        )
        
        # Send notification if service available
        if NotificationService:
            try:
                notification_service = NotificationService(db)
                await notification_service.send_application_submitted(
                    user_id=str(current_user["_id"]),
                    job_title=application.get("job_title", "Unknown Position"),
                    company=application.get("company_name", "Unknown Company"),
                    application_id=application_id
                )
            except Exception as e:
                logger.warning(f"Failed to send notification: {e}")
        
        # Format response
        return ApplicationResponse(
            id=str(application["_id"]),
            job_id=str(application.get("job_id", "")),
            user_id=str(application["user_id"]),
            status=application.get("status", "draft"),
            source=application.get("source", "manual"),
            applied_date=application.get("applied_date"),
            job_title=application.get("job_title"),
            company_name=application.get("company_name"),
            location=application.get("location"),
            priority=application.get("priority", "medium"),
            documents_count=len(application.get("documents", [])),
            communications_count=len(application.get("communications", [])),
            interviews_count=len(application.get("interviews", [])),
            tasks_count=len(application.get("tasks", [])),
            has_custom_cv=bool(application.get("custom_cv_content")),
            has_cover_letter=bool(application.get("cover_letter_content")),
            last_activity=application.get("updated_at"),
            created_at=application["created_at"],
            updated_at=application["updated_at"]
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating application: {str(e)}")
        raise HTTPException(
            status_code=fastapi_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create application"
        )


@router.get("/", response_model=ApplicationListResponse)
async def list_applications(
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=1000),
    status: Optional[str] = None,
    company: Optional[str] = None,
    priority: Optional[str] = None,
    applied_after: Optional[str] = None,
    applied_before: Optional[str] = None,
    has_interviews: Optional[bool] = None,
    has_response: Optional[bool] = None,
    needs_follow_up: Optional[bool] = None,
    sort_by: Optional[str] = "created_at",
    sort_order: Optional[str] = "desc",
    search: Optional[str] = None,
    current_user: Dict[str, Any] = Depends(get_current_active_user),
    db = Depends(get_database)
):
    """List user's applications with filtering and pagination"""
    try:
        # DEBUG: Log incoming parameters
        logger.info(f"list_applications called: has_response={has_response} (type={type(has_response).__name__})")
        
        filters = {}
        status_groups = {
            "screening": ["under_review"],
            "interview": [
                "interview_scheduled",
                "interview_completed",
                "second_round",
                "final_round",
                "interviewed",
            ],
            "offer": ["offer_received", "offer_declined"],
            "accepted": ["offer_accepted"],
        }
        if status:
            grouped = status_groups.get(status)
            filters["status"] = {"$in": grouped} if grouped else status
        if company and company.strip():
            pattern = re.escape(company.strip())
            matched_jobs = await db.jobs.find(
                {
                    "$or": [
                        {"company_name": {"$regex": pattern, "$options": "i"}},
                        {"company": {"$regex": pattern, "$options": "i"}},
                    ]
                },
                {"_id": 1},
            ).to_list(length=200)
            job_ids = [str(job["_id"]) for job in matched_jobs]
            object_ids = []
            for job_id in job_ids:
                try:
                    object_ids.append(ObjectId(job_id))
                except Exception:
                    pass
            company_match = {
                "$or": [
                    {"company_name": {"$regex": pattern, "$options": "i"}},
                    {"job_id": {"$in": job_ids + object_ids}},
                ]
            }
            filters.setdefault("$and", []).append(company_match)
        if priority:
            filters["priority"] = priority
        
        if applied_after or applied_before:
            date_filter = {}
            if applied_after:
                try:
                    date_filter["$gte"] = datetime.fromisoformat(applied_after)
                except ValueError:
                    raise HTTPException(
                        status_code=fastapi_status.HTTP_400_BAD_REQUEST,
                        detail="Invalid applied_after date format. Use YYYY-MM-DD"
                    )
            if applied_before:
                try:
                    date_filter["$lte"] = datetime.fromisoformat(applied_before)
                except ValueError:
                    raise HTTPException(
                        status_code=fastapi_status.HTTP_400_BAD_REQUEST,
                        detail="Invalid applied_before date format. Use YYYY-MM-DD"
                    )
            filters["applied_date"] = date_filter
        
        if has_interviews is not None:
            if has_interviews:
                filters["interviews.0"] = {"$exists": True}
            else:
                filters["interviews"] = {"$size": 0}
        
        if needs_follow_up is not None:
            if needs_follow_up:
                filters["follow_up_date"] = {"$lte": datetime.utcnow()}
            else:
                filters["follow_up_date"] = {"$gt": datetime.utcnow()}
        
        if has_response is not None:
            # Response statuses are statuses that indicate the company has responded
            response_statuses = [
                "interview_scheduled", "interview_completed", "second_round", "final_round",
                "offer_received", "offer_accepted", "offer_declined", 
                "rejected"
            ]
            
            if has_response:
                # Only include apps that have:
                # 1. Status indicating a response (most reliable), OR
                # 2. At least one received/inbound communication
                # Note: Removed broad conditions like `email_analysis_history.0` which may include auto-confirmations
                filters["$or"] = [
                    {"status": {"$in": response_statuses}},
                    {"communications": {"$elemMatch": {"direction": "received"}}},
                    {"communications": {"$elemMatch": {"direction": "inbound"}}},
                    {"communications": {"$elemMatch": {"type": "response"}}}
                ]
            else:
                filters["has_response"] = {"$ne": True}
                filters["email_analysis_history"] = {"$size": 0}
                # For "no response", we generally expect "applied", "submitted", "under_review", "pending"
                # But strictly speaking, it's just NOT in the response list AND no history.
                # However, simplifying to just excluding known markers is safer to match the "else" of the above.
                filters["status"] = {"$nin": response_statuses}
        
        if "status" not in filters:
            filters["status"] = {"$ne": "awaiting_review"}

        # Log the filter for debugging
        if has_response is not None:
            logger.info(f"has_response filter applied: has_response={has_response}, filters=$or={filters.get('$or', 'N/A')}")
        
        # Get applications using static method
        applications = await ApplicationTrackingService.get_user_applications(
            user_id=str(current_user["_id"]),
            db=db,
            filters=filters,
            page=page,
            size=size,
            sort_by=sort_by,
            sort_order=sort_order,
            search=search
        )
        
        # Log results count
        logger.info(f"list_applications returned {len(applications.get('applications', []))} apps for user {str(current_user['_id'])[:8]}..., filters={filters}")
        
        # Get status counts using instance method
        tracking_service = ApplicationTrackingService(db)
        status_counts = await tracking_service.get_application_status_counts(
            str(current_user["_id"])
        )
        
        return ApplicationListResponse(
            applications=applications["applications"],
            total=applications["total"],
            page=page,
            size=size,
            pages=applications["pages"],
            has_next=applications["has_next"],
            has_prev=applications["has_prev"],
            status_counts=status_counts
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error listing applications: {str(e)}")
        raise HTTPException(
            status_code=fastapi_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve applications"
        )


@router.get("/stats/overview", response_model=ApplicationStats)
async def get_application_stats(
    period_days: Optional[int] = Query(None, description="Analyze last N days"),
    current_user: Dict[str, Any] = Depends(get_current_active_user),
    db = Depends(get_database)
):
    """Get application statistics overview"""
    try:
        # Create instance of tracking service
        tracking_service = ApplicationTrackingService(db)
        
        # Get stats using instance method
        stats = await tracking_service.get_user_application_stats(str(current_user["_id"]))
        
        # Get enhanced stats if period specified and service available
        if period_days and AnalyticsService:
            try:
                analytics_service = AnalyticsService(db)
                enhanced_stats = await analytics_service.get_application_stats(
                    user_id=str(current_user["_id"]),
                    period_days=period_days
                )
                stats.update(enhanced_stats)
            except Exception as e:
                logger.warning(f"Analytics service not available: {e}")
        
        return ApplicationStats(**stats)
        
    except Exception as e:
        logger.error(f"Error getting stats: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve statistics"
        )


# ==================== AGGREGATION ENDPOINTS ====================

@router.get("/follow-ups/needed")
async def get_follow_ups_needed(
    current_user: Dict[str, Any] = Depends(get_current_active_user),
    db = Depends(get_database)
):
    """Get applications needing follow-up"""
    try:
        tracking_service = ApplicationTrackingService(db)
        applications = await tracking_service.get_applications_needing_follow_up(
            user_id=str(current_user["_id"])
        )
        
        # Convert ObjectIds to strings
        for app in applications:
            app["_id"] = str(app["_id"])
            if app.get("job_id"):
                app["job_id"] = str(app["job_id"])
        
        return {
            "applications": applications,
            "count": len(applications)
        }
        
    except Exception as e:
        logger.error(f"Error getting follow-ups: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.get("/upcoming-interviews")
async def get_upcoming_interviews(
    days_ahead: int = Query(7, ge=1, le=30),
    current_user: Dict[str, Any] = Depends(get_current_active_user),
    db = Depends(get_database)
):
    """Get upcoming interviews"""
    try:
        tracking_service = ApplicationTrackingService(db)
        interviews = await tracking_service.get_upcoming_interviews(
            user_id=str(current_user["_id"]),
            days_ahead=days_ahead
        )
        
        # Convert ObjectIds to strings
        for interview in interviews:
            interview["_id"] = str(interview["_id"])
            if interview.get("job_id"):
                interview["job_id"] = str(interview["job_id"])
        
        return {
            "interviews": interviews,
            "count": len(interviews),
            "days_ahead": days_ahead
        }
        
    except Exception as e:
        logger.error(f"Error getting interviews: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.get("/by-status/{status}")
async def get_applications_by_status(
    status: ApplicationStatus,
    current_user: Dict[str, Any] = Depends(get_current_active_user),
    db = Depends(get_database)
):
    """Get applications filtered by status"""
    try:
        tracking_service = ApplicationTrackingService(db)
        applications = await tracking_service.get_applications_by_status(
            user_id=str(current_user["_id"]),
            status=status.value
        )
        
        # Convert ObjectIds to strings
        for app in applications:
            app["_id"] = str(app["_id"])
            if app.get("job_id"):
                app["job_id"] = str(app["job_id"])
        
        return {
            "applications": applications,
            "count": len(applications),
            "status": status.value
        }
        
    except Exception as e:
        logger.error(f"Error getting by status: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.get("/{application_id}")
async def get_application(
    application_id: str,
    current_user: Dict[str, Any] = Depends(get_current_active_user),
    db = Depends(get_database)
):
    """Get application details by ID"""
    try:
        # Validate ObjectId
        try:
            ObjectId(application_id)
        except:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid application ID format"
            )
        
        # Get application using static method
        application = await ApplicationTrackingService.get_application_by_id(application_id, db)
        
        if not application:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Application not found"
            )
        
        # Check ownership
        if application["user_id"] != str(current_user["_id"]):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't have permission to view this application"
            )
        
        # Return raw dict instead of validating through Pydantic model
        # The model expects complex nested structures that don't match our simple schema
        return application
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting application: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve application"
        )


@router.put("/{application_id}", response_model=ApplicationResponse)
async def update_application(
    application_id: str,
    application_update: ApplicationUpdate,
    current_user: Dict[str, Any] = Depends(get_current_active_user),
    db = Depends(get_database)
):
    """Update application with Phase 5 tracking"""
    try:
        # Validate ObjectId
        try:
            ObjectId(application_id)
        except:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid application ID format"
            )
        
        # Get existing application
        application = await ApplicationTrackingService.get_application_by_id(application_id, db)
        
        if not application:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Application not found"
            )
        
        # Check ownership
        if application["user_id"] != str(current_user["_id"]):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't have permission to update this application"
            )
        
        # Update application
        update_data = application_update.dict(exclude_unset=True)
        success = await ApplicationTrackingService.update_application(
            application_id,
            update_data,
            db
        )
        
        if not success:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to update application"
            )
        
        # Add timeline event
        tracking_service = ApplicationTrackingService(db)
        await tracking_service.add_timeline_event(
            application_id=application_id,
            event_type="updated",
            description="Application details updated",
            metadata={"updated_fields": list(update_data.keys())}
        )
        
        # Get updated application
        updated_application = await ApplicationTrackingService.get_application_by_id(application_id, db)
        
        return ApplicationResponse(
            id=str(updated_application["_id"]),
            job_id=str(updated_application.get("job_id", "")),
            user_id=str(updated_application["user_id"]),
            status=updated_application.get("status", "draft"),
            source=updated_application.get("source", "manual"),
            applied_date=updated_application.get("applied_date"),
            job_title=updated_application.get("job_title"),
            company_name=updated_application.get("company_name"),
            location=updated_application.get("location"),
            priority=updated_application.get("priority", "medium"),
            documents_count=len(updated_application.get("documents", [])),
            communications_count=len(updated_application.get("communications", [])),
            interviews_count=len(updated_application.get("interviews", [])),
            tasks_count=len(updated_application.get("tasks", [])),
            has_custom_cv=bool(updated_application.get("custom_cv_content")),
            has_cover_letter=bool(updated_application.get("cover_letter_content")),
            last_activity=updated_application.get("updated_at"),
            created_at=updated_application["created_at"],
            updated_at=updated_application["updated_at"]
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating application: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update application"
        )


@router.delete("/{application_id}", response_model=SuccessResponse)
async def delete_application(
    application_id: str,
    current_user: Dict[str, Any] = Depends(get_current_active_user),
    db = Depends(get_database)
):
    """Delete application (soft delete)"""
    try:
        # Validate ObjectId
        try:
            ObjectId(application_id)
        except:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid application ID format"
            )
        
        # Get application
        application = await ApplicationTrackingService.get_application_by_id(application_id, db)
        
        if not application:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Application not found"
            )
        
        # Check ownership
        if application["user_id"] != str(current_user["_id"]):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't have permission to delete this application"
            )
        
        # Soft delete
        success = await ApplicationTrackingService.delete_application(application_id, db)
        
        if not success:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to delete application"
            )
        
        return SuccessResponse(message="Application deleted successfully")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting application: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete application"
        )


# ==================== REVIEW BEFORE SUBMISSION ====================

def _document_preview(document: Optional[Dict[str, Any]]) -> str:
    if not document:
        return ""
    content = document.get("content")
    if isinstance(content, str) and content.strip():
        return content.strip()[:6000]
    if isinstance(content, dict):
        nested = content.get("content") if isinstance(content.get("content"), dict) else {}
        full_text = nested.get("full_text") or content.get("summary") or content.get("professional_summary")
        if full_text:
            return str(full_text).strip()[:6000]
    text = document.get("text_content") or ""
    cv_data = document.get("cv_data") if isinstance(document.get("cv_data"), dict) else {}
    if not text and cv_data:
        text = cv_data.get("summary") or cv_data.get("professional_summary") or ""
    return str(text or "").strip()[:6000]


async def _owned_document(db, document_id: Optional[str], user_id: str):
    if not document_id or not ObjectId.is_valid(str(document_id)):
        return None
    document = await db.documents.find_one({"_id": ObjectId(str(document_id))})
    if not document:
        return None
    owner = str(document.get("user_id") or "")
    if owner and owner != str(user_id):
        return None
    return document


@router.get("/{application_id}/review")
async def get_application_review(
    application_id: str,
    current_user: Dict[str, Any] = Depends(get_current_active_user),
    db = Depends(get_database)
):
    """Job documents and the submission waiting for review."""
    try:
        ObjectId(application_id)
    except Exception:
        raise HTTPException(status_code=fastapi_status.HTTP_400_BAD_REQUEST, detail="Invalid application ID")

    application = await db.applications.find_one({"_id": ObjectId(application_id), "deleted_at": None})
    if not application:
        raise HTTPException(status_code=fastapi_status.HTTP_404_NOT_FOUND, detail="Application not found")
    if str(application.get("user_id")) != str(current_user["_id"]):
        raise HTTPException(status_code=fastapi_status.HTTP_403_FORBIDDEN, detail="Not allowed")
    if application.get("status") != "awaiting_review":
        raise HTTPException(status_code=fastapi_status.HTTP_400_BAD_REQUEST, detail="This application is not waiting for review")

    user_id = str(current_user["_id"])
    review = application.get("review") or {}
    job = None
    job_id = application.get("job_id")
    if job_id and ObjectId.is_valid(str(job_id)):
        job = await db.jobs.find_one({"_id": ObjectId(str(job_id))})
    description = ""
    if job:
        raw_description = job.get("description") or ""
        description = raw_description if isinstance(raw_description, str) else str(raw_description)
        description = description.strip()[:6000]

    documents = []
    cv_document = await _owned_document(db, application.get("cv_document_id"), user_id)
    if cv_document:
        file_info = cv_document.get("file_info") or {}
        documents.append({
            "label": "CV",
            "name": file_info.get("original_filename") or "CV",
            "text": _document_preview(cv_document) or "No CV text is stored for this file."
        })
    letter = await _owned_document(db, application.get("cover_letter_document_id"), user_id)
    if letter:
        documents.append({
            "label": "Cover letter",
            "name": "Cover letter",
            "text": _document_preview(letter) or "No cover letter text is stored."
        })
    elif application.get("additional_message") or (application.get("form_data") or {}).get("cover_letter"):
        documents.append({
            "label": "Cover letter",
            "name": "Cover letter",
            "text": application.get("additional_message") or application.get("form_data", {}).get("cover_letter")
        })

    return {
        "id": application_id,
        "job_title": application.get("job_title"),
        "company_name": application.get("company_name"),
        "location": application.get("location"),
        "match_score": application.get("match_score"),
        "job_description": description,
        "documents": documents,
        "submission": {
            "channel": review.get("channel"),
            "recipient_email": review.get("recipient_email"),
            "apply_url": review.get("apply_url"),
            "message": review.get("message") or ""
        }
    }


@router.post("/{application_id}/submit")
async def submit_reviewed_application(
    application_id: str,
    current_user: Dict[str, Any] = Depends(get_current_active_user),
    db = Depends(get_database)
):
    """Send an automated application after the user reviews it."""
    try:
        ObjectId(application_id)
    except Exception:
        raise HTTPException(status_code=fastapi_status.HTTP_400_BAD_REQUEST, detail="Invalid application ID")

    application = await db.applications.find_one({"_id": ObjectId(application_id), "deleted_at": None})
    if not application:
        raise HTTPException(status_code=fastapi_status.HTTP_404_NOT_FOUND, detail="Application not found")
    if str(application.get("user_id")) != str(current_user["_id"]):
        raise HTTPException(status_code=fastapi_status.HTTP_403_FORBIDDEN, detail="Not allowed")
    if application.get("status") != "awaiting_review":
        raise HTTPException(status_code=fastapi_status.HTTP_400_BAD_REQUEST, detail="This application is not waiting for review")

    review = application.get("review") or {}
    channel = review.get("channel")
    user_id = str(current_user["_id"])
    now = datetime.utcnow()

    if channel == "email":
        recipient = review.get("recipient_email")
        if not recipient:
            raise HTTPException(status_code=fastapi_status.HTTP_400_BAD_REQUEST, detail="This application has no recipient email")
        usage_type = application.get("usage_type") or "auto_application"
        if not application.get("usage_reserved"):
            allowed, _, _ = await SubscriptionService(db).check_usage_limit(user_id, usage_type)
            if not allowed:
                raise HTTPException(status_code=fastapi_status.HTTP_403_FORBIDDEN, detail="You have no applications left on this plan")
        from app.services.emails.email_agent_service import email_agent_service
        from app.workers.email_sender import send_application_email
        stored_form = application.get("form_data") if isinstance(application.get("form_data"), dict) else None
        form_data = dict(stored_form) if stored_form else await email_agent_service.extract_form_data_from_cv(user_id, db=db)
        form_data["message"] = review.get("message") or f"Please find attached my CV and cover letter for the {application.get('job_title')} position."
        send_application_email.delay(
            user_id=user_id,
            job_id=str(application.get("job_id")),
            application_id=application_id,
            recipient_email=recipient,
            form_data=form_data,
            cv_document_id=application.get("cv_document_id"),
            cover_letter_document_id=application.get("cover_letter_document_id"),
            additional_message=None
        )
        await db.applications.update_one(
            {"_id": application["_id"]},
            {
                "$set": {
                    "status": "submitted",
                    "email_status": "queued",
                    "email_monitoring_enabled": True,
                    "applied_date": now,
                    "updated_at": now
                },
                "$push": {"timeline": {"status": "submitted", "timestamp": now, "note": "Submitted after review"}}
            }
        )
        if not application.get("usage_reserved"):
            await SubscriptionService(db).track_usage(user_id, application.get("usage_type") or "auto_application")
        return {"success": True, "status": "submitted"}

    if channel == "browser":
        from app.services.automation.browser_automation_service import BrowserAutomationService
        browser_result = await BrowserAutomationService.auto_apply_to_job(
            user_id=user_id,
            application_id=application_id,
            job_id=str(application.get("job_id")),
            cv_id=application.get("cv_document_id")
        )
        result_status = (browser_result or {}).get("status")
        sent = bool(browser_result and browser_result.get("success") and result_status == "completed")
        if not sent:
            error = (browser_result or {}).get("error") or "The application was not submitted"
            await db.applications.update_one(
                {"_id": application["_id"]},
                {"$set": {
                    "status": "awaiting_review",
                    "automation_status": "failed",
                    "automation_error": error,
                    "updated_at": now
                }}
            )
            raise HTTPException(status_code=fastapi_status.HTTP_400_BAD_REQUEST, detail=error)
        await db.applications.update_one(
            {"_id": application["_id"]},
            {
                "$set": {"status": "submitted", "applied_date": now, "updated_at": now},
                "$push": {"timeline": {"status": "submitted", "timestamp": now, "note": "Submitted after review"}}
            }
        )
        return {"success": True, "status": "submitted"}

    raise HTTPException(status_code=fastapi_status.HTTP_400_BAD_REQUEST, detail="This application has no send method")


@router.post("/{application_id}/skip-review")
async def skip_reviewed_application(
    application_id: str,
    current_user: Dict[str, Any] = Depends(get_current_active_user),
    db = Depends(get_database)
):
    """Leave an automated application unsent."""
    try:
        ObjectId(application_id)
    except Exception:
        raise HTTPException(status_code=fastapi_status.HTTP_400_BAD_REQUEST, detail="Invalid application ID")

    application = await db.applications.find_one({"_id": ObjectId(application_id), "deleted_at": None})
    if not application:
        raise HTTPException(status_code=fastapi_status.HTTP_404_NOT_FOUND, detail="Application not found")
    if str(application.get("user_id")) != str(current_user["_id"]):
        raise HTTPException(status_code=fastapi_status.HTTP_403_FORBIDDEN, detail="Not allowed")
    if application.get("status") != "awaiting_review":
        raise HTTPException(status_code=fastapi_status.HTTP_400_BAD_REQUEST, detail="This application is not waiting for review")

    now = datetime.utcnow()
    await db.applications.update_one(
        {"_id": application["_id"]},
        {
            "$set": {"status": "withdrawn", "updated_at": now},
            "$push": {"timeline": {"status": "withdrawn", "timestamp": now, "note": "Skipped during review"}}
        }
    )
    if application.get("usage_reserved"):
        await SubscriptionService(db).release_usage(
            str(current_user["_id"]),
            application.get("usage_type") or "auto_application"
        )
    return {"success": True, "status": "withdrawn"}


# ==================== STATUS & TRACKING ENDPOINTS ====================

@router.put("/{application_id}/status", response_model=SuccessResponse)
async def update_application_status(
    application_id: str,
    status_update: UpdateApplicationStatusRequest,
    current_user: Dict[str, Any] = Depends(get_current_active_user),
    db = Depends(get_database)
):
    """Update application status with tracking and notification"""
    try:
        # Validate ObjectId
        try:
            ObjectId(application_id)
        except:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid application ID format"
            )
        
        # Get application
        application = await ApplicationTrackingService.get_application_by_id(application_id, db)
        
        if not application:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Application not found"
            )
        
        # Check ownership
        if application["user_id"] != str(current_user["_id"]):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't have permission to update this application"
            )
        
        # Update status using instance method
        tracking_service = ApplicationTrackingService(db)
        success = await tracking_service.update_application_status(
            application_id=application_id,
            new_status=status_update.status.value,
            notes=status_update.notes
        )
        
        if not success:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to update status"
            )
        
        # Send notification if available
        if NotificationService:
            try:
                notification_service = NotificationService(db)
                await notification_service.send_status_update(
                    user_id=str(current_user["_id"]),
                    job_title=application.get("job_title", "Unknown Position"),
                    new_status=status_update.status.value
                )
            except Exception as e:
                logger.warning(f"Failed to send notification: {e}")
        
        return SuccessResponse(
            message="Application status updated successfully",
            data={"application_id": application_id, "new_status": status_update.status.value}
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating status: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.post("/{application_id}/schedule-interview", response_model=SuccessResponse)
async def schedule_interview(
    application_id: str,
    interview_data: ScheduleInterviewRequest,
    current_user: Dict[str, Any] = Depends(get_current_active_user),
    db = Depends(get_database)
):
    """Schedule interview with automatic reminder"""
    try:
        # Validate ObjectId
        try:
            ObjectId(application_id)
        except:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid application ID format"
            )
        
        # Get application
        application = await ApplicationTrackingService.get_application_by_id(application_id, db)
        
        if not application:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Application not found"
            )
        
        # Check ownership
        if application["user_id"] != str(current_user["_id"]):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't have permission to update this application"
            )
        
        # Schedule interview
        tracking_service = ApplicationTrackingService(db)
        success = await tracking_service.schedule_interview(
            application_id=application_id,
            interview_date=interview_data.interview_date,
            interview_type=interview_data.interview_type,
            location=interview_data.location,
            notes=interview_data.notes
        )
        
        if not success:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to schedule interview"
            )
        
        # Send reminder if service available
        if NotificationService:
            try:
                notification_service = NotificationService(db)
                await notification_service.send_interview_reminder(
                    user_id=str(current_user["_id"]),
                    job_title=application.get("job_title", "Unknown"),
                    company=application.get("company_name", "Unknown"),
                    interview_date=interview_data.interview_date,
                    application_id=application_id
                )
            except Exception as e:
                logger.warning(f"Failed to send reminder: {e}")
        
        return SuccessResponse(
            message="Interview scheduled successfully",
            data={
                "application_id": application_id,
                "interview_date": interview_data.interview_date.isoformat()
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error scheduling interview: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.post("/{application_id}/set-follow-up", response_model=SuccessResponse)
async def set_follow_up_reminder(
    application_id: str,
    follow_up_data: SetFollowUpRequest,
    current_user: Dict[str, Any] = Depends(get_current_active_user),
    db = Depends(get_database)
):
    """Set follow-up reminder"""
    try:
        # Validate ObjectId
        try:
            ObjectId(application_id)
        except:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid application ID format"
            )
        
        # Get application
        application = await ApplicationTrackingService.get_application_by_id(application_id, db)
        
        if not application:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Application not found"
            )
        
        # Check ownership
        if application["user_id"] != str(current_user["_id"]):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't have permission to update this application"
            )
        
        # Set follow-up reminder
        tracking_service = ApplicationTrackingService(db)
        success = await tracking_service.set_follow_up_reminder(
            application_id=application_id,
            follow_up_date=follow_up_data.follow_up_date,
            notes=follow_up_data.notes
        )
        
        if not success:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to set follow-up reminder"
            )
        
        return SuccessResponse(
            message="Follow-up reminder set successfully",
            data={
                "application_id": application_id,
                "follow_up_date": follow_up_data.follow_up_date.isoformat()
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error setting follow-up: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.get("/{application_id}/timeline")
async def get_application_timeline(
    application_id: str,
    current_user: Dict[str, Any] = Depends(get_current_active_user),
    db = Depends(get_database)
):
    """Get application timeline"""
    try:
        # Validate ObjectId
        try:
            ObjectId(application_id)
        except:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid application ID format"
            )
        
        # Get application
        application = await ApplicationTrackingService.get_application_by_id(application_id, db)
        
        if not application:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Application not found"
            )
        
        # Check ownership
        if application["user_id"] != str(current_user["_id"]):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't have permission to view this application"
            )
        
        # Get timeline
        tracking_service = ApplicationTrackingService(db)
        timeline = await tracking_service.get_application_timeline(application_id)
        
        return {
            "application_id": application_id,
            "timeline": timeline,
            "count": len(timeline)
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting timeline: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


# ==================== DOCUMENT & COMMUNICATION ENDPOINTS ====================

@router.post("/{application_id}/documents/upload", response_model=SuccessResponse)
async def upload_application_document(
    application_id: str,
    document_type: str,
    document_url: str,
    document_name: str,
    current_user: Dict[str, Any] = Depends(get_current_active_user),
    db = Depends(get_database)
):
    """Upload application document"""
    try:
        # Validate ObjectId
        try:
            ObjectId(application_id)
        except:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid application ID format"
            )
        
        # Get application
        application = await ApplicationTrackingService.get_application_by_id(application_id, db)
        
        if not application:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Application not found"
            )
        
        # Check ownership
        if application["user_id"] != str(current_user["_id"]):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't have permission to update this application"
            )
        
        # Prepare document data
        document = {
            "type": document_type,
            "url": document_url,
            "name": document_name,
            "uploaded_at": datetime.utcnow()
        }
        
        # Add document
        success = await ApplicationTrackingService.add_application_document(
            application_id,
            document,
            db
        )
        
        if not success:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to upload document"
            )
        
        # Add timeline event
        tracking_service = ApplicationTrackingService(db)
        await tracking_service.add_timeline_event(
            application_id=application_id,
            event_type="document_uploaded",
            description=f"Document uploaded: {document_name}",
            metadata={"document_type": document_type, "document_name": document_name}
        )
        
        return SuccessResponse(
            message="Document uploaded successfully",
            data={"application_id": application_id, "document": document}
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error uploading document: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to upload document"
        )


@router.post("/{application_id}/communications/add", response_model=SuccessResponse)
async def add_communication(
    application_id: str,
    communication_type: str,
    subject: str,
    message: str,
    direction: str = "outbound",
    current_user: Dict[str, Any] = Depends(get_current_active_user),
    db = Depends(get_database)
):
    """Add communication record"""
    try:
        # Validate ObjectId
        try:
            ObjectId(application_id)
        except:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid application ID format"
            )
        
        # Get application
        application = await ApplicationTrackingService.get_application_by_id(application_id, db)
        
        if not application:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Application not found"
            )
        
        # Check ownership
        if application["user_id"] != str(current_user["_id"]):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't have permission to update this application"
            )
        
        # Prepare communication data
        communication = {
            "type": communication_type,
            "subject": subject,
            "message": message,
            "direction": direction,
            "date": datetime.utcnow()
        }
        
        # Add communication
        success = await ApplicationTrackingService.add_communication(
            application_id,
            communication,
            db
        )
        
        if not success:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to add communication"
            )
        
        # Add timeline event
        tracking_service = ApplicationTrackingService(db)
        await tracking_service.add_timeline_event(
            application_id=application_id,
            event_type="communication",
            description=f"{direction.capitalize()} {communication_type}: {subject}",
            metadata={"type": communication_type, "direction": direction}
        )
        
        return SuccessResponse(
            message="Communication added successfully",
            data={"application_id": application_id, "communication": communication}
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error adding communication: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to add communication"
        )


@router.post("/{id}/email-reply", response_model=SuccessResponse)
async def send_email_reply(
    id: str,
    email_req: EmailReplyRequest,
    current_user: Dict[str, Any] = Depends(get_current_active_user),
    db = Depends(get_database)
):
    """
    Send an email reply via Gmail agent
    """
    # 1. Get Application (verify user ownership)
    app = await db.applications.find_one({
        "_id": ObjectId(id),
        "user_id": str(current_user["_id"])
    })
    if not app:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Application not found"
        )
    
    # 2. Check Gmail Auth
    # We need to fetch the full user object to get sensitive tokens if they are stripped in current_user
    user = await db.users.find_one({"_id": ObjectId(current_user["_id"])})
    
    if not user or "gmail_auth" not in user or not user["gmail_auth"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Gmail account not connected. Please connect Gmail in settings."
        )
    
    try:
        auth = GmailAuth(**user["gmail_auth"])
        
        # 3. Determine Recipient
        recipient = email_req.to_email
        if not recipient:
            # Fallback to existing contacts
            recipient = app.get("contact_email")
            if not recipient and app.get("communications"):
                # Try to find last inbound email
                for comm in reversed(app["communications"]):
                    if comm.get("direction") == "inbound" and comm.get("contact_email"):
                        recipient = comm["contact_email"]
                        break
        
        if not recipient:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No recipient email found. Please specify 'to_email'."
            )
            
        # 4. Send Email
        result = gmail_service.send_email(
            auth=auth,
            to=recipient,
            subject=email_req.subject,
            body=email_req.content
        )
        
        # 5. Record Communication
        comm_entry = {
            "type": "email",
            "direction": "outbound",
            "subject": email_req.subject,
            "content": email_req.content,
            "contact_email": recipient,
            "timestamp": datetime.utcnow(),
            "message_id": result.get("id"),
            "thread_id": result.get("threadId")
        }
        
        update_data = {
            "$push": {"communications": comm_entry},
            "$set": {
                "last_activity": datetime.utcnow(),
                "updated_at": datetime.utcnow()
            }
        }
        
        await db.applications.update_one(
            {"_id": ObjectId(id)},
            update_data
        )

        # Log timeline event
        tracking_service = ApplicationTrackingService(db)
        await tracking_service.add_timeline_event(
            application_id=id,
            event_type="communication",
            description=f"Sent email reply: {email_req.subject}",
            metadata={"direction": "outbound", "recipient": recipient}
        )
        
        return SuccessResponse(
            success=True,
            message="Email sent successfully",
            data={"message_id": result.get("id")}
        )
        
    except Exception as e:
        logger.error(f"Failed to send email reply: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to send email: {str(e)}"
        )


# ==================== TASK MANAGEMENT ENDPOINTS ====================

@router.post("/{application_id}/tasks/add", response_model=SuccessResponse)
async def add_application_task(
    application_id: str,
    task_title: str,
    task_description: Optional[str] = None,
    due_date: Optional[datetime] = None,
    priority: str = "medium",
    current_user: Dict[str, Any] = Depends(get_current_active_user),
    db = Depends(get_database)
):
    """Add task to application"""
    try:
        # Validate ObjectId
        try:
            ObjectId(application_id)
        except:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid application ID format"
            )
        
        # Get application
        application = await ApplicationTrackingService.get_application_by_id(application_id, db)
        
        if not application:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Application not found"
            )
        
        # Check ownership
        if application["user_id"] != str(current_user["_id"]):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't have permission to update this application"
            )
        
        # Prepare task data
        task = {
            "title": task_title,
            "description": task_description,
            "due_date": due_date,
            "priority": priority,
            "is_completed": False,
            "created_at": datetime.utcnow()
        }
        
        # Add task
        success = await ApplicationTrackingService.add_task(
            application_id,
            task,
            db
        )
        
        if not success:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to add task"
            )
        
        # Add timeline event
        tracking_service = ApplicationTrackingService(db)
        await tracking_service.add_timeline_event(
            application_id=application_id,
            event_type="task_created",
            description=f"Task created: {task_title}",
            metadata={"task_priority": priority}
        )
        
        return SuccessResponse(
            message="Task added successfully",
            data={"application_id": application_id, "task": task}
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error adding task: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to add task"
        )


@router.get("/{application_id}/tasks")
async def get_application_tasks(
    application_id: str,
    current_user: Dict[str, Any] = Depends(get_current_active_user),
    db = Depends(get_database)
):
    """Get all tasks for an application"""
    try:
        # Validate ObjectId
        try:
            ObjectId(application_id)
        except:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid application ID format"
            )
        
        # Get application
        application = await ApplicationTrackingService.get_application_by_id(application_id, db)
        
        if not application:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Application not found"
            )
        
        # Check ownership
        if application["user_id"] != str(current_user["_id"]):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't have permission to view this application"
            )
        
        tasks = application.get("tasks", [])
        
        return {
            "application_id": application_id,
            "tasks": tasks,
            "count": len(tasks),
            "completed_count": sum(1 for task in tasks if task.get("is_completed", False))
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting tasks: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve tasks"
        )


@router.put("/{application_id}/tasks/{task_index}/complete", response_model=SuccessResponse)
async def complete_task(
    application_id: str,
    task_index: int,
    current_user: Dict[str, Any] = Depends(get_current_active_user),
    db = Depends(get_database)
):
    """Mark task as complete"""
    try:
        # Validate ObjectId
        try:
            ObjectId(application_id)
        except:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid application ID format"
            )
        
        # Get application
        application = await ApplicationTrackingService.get_application_by_id(application_id, db)
        
        if not application:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Application not found"
            )
        
        # Check ownership
        if application["user_id"] != str(current_user["_id"]):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't have permission to update this application"
            )
        
        # Check task exists
        tasks = application.get("tasks", [])
        if task_index < 0 or task_index >= len(tasks):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Task not found"
            )
        
        # Complete task
        success = await ApplicationTrackingService.complete_task(
            application_id,
            task_index,
            db
        )
        
        if not success:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to complete task"
            )
        
        # Add timeline event
        tracking_service = ApplicationTrackingService(db)
        task_title = tasks[task_index].get("title", "Unknown task")
        await tracking_service.add_timeline_event(
            application_id=application_id,
            event_type="task_completed",
            description=f"Task completed: {task_title}",
            metadata={"task_index": task_index}
        )
        
        return SuccessResponse(
            message="Task marked as complete",
            data={"application_id": application_id, "task_index": task_index}
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error completing task: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to complete task"
        )


# ==================== NOTES & PRIORITY ENDPOINTS ====================

@router.put("/{application_id}/notes", response_model=SuccessResponse)
async def update_application_notes(
    application_id: str,
    notes: str,
    current_user: Dict[str, Any] = Depends(get_current_active_user),
    db = Depends(get_database)
):
    """Update application notes"""
    try:
        # Validate ObjectId
        try:
            ObjectId(application_id)
        except:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid application ID format"
            )
        
        # Get application
        application = await ApplicationTrackingService.get_application_by_id(application_id, db)
        
        if not application:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Application not found"
            )
        
        # Check ownership
        if application["user_id"] != str(current_user["_id"]):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't have permission to update this application"
            )
        
        # Update notes
        success = await ApplicationTrackingService.update_notes(
            application_id,
            notes,
            db
        )
        
        if not success:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to update notes"
            )
        
        # Add timeline event
        tracking_service = ApplicationTrackingService(db)
        await tracking_service.add_timeline_event(
            application_id=application_id,
            event_type="notes_updated",
            description="Application notes updated",
            metadata={}
        )
        
        return SuccessResponse(
            message="Notes updated successfully",
            data={"application_id": application_id}
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating notes: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update notes"
        )


@router.put("/{application_id}/priority", response_model=SuccessResponse)
async def update_application_priority(
    application_id: str,
    priority: str,
    current_user: Dict[str, Any] = Depends(get_current_active_user),
    db = Depends(get_database)
):
    """Update application priority"""
    try:
        # Validate priority
        if priority not in ["low", "medium", "high"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid priority level. Must be 'low', 'medium', or 'high'"
            )
        
        # Validate ObjectId
        try:
            ObjectId(application_id)
        except:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid application ID format"
            )
        
        # Get application
        application = await ApplicationTrackingService.get_application_by_id(application_id, db)
        
        if not application:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Application not found"
            )
        
        # Check ownership
        if application["user_id"] != str(current_user["_id"]):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't have permission to update this application"
            )
        
        # Update priority
        success = await ApplicationTrackingService.update_priority(
            application_id,
            priority,
            db
        )
        
        if not success:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to update priority"
            )
        
        # Add timeline event
        tracking_service = ApplicationTrackingService(db)
        await tracking_service.add_timeline_event(
            application_id=application_id,
            event_type="priority_changed",
            description=f"Priority changed to {priority}",
            metadata={"new_priority": priority, "old_priority": application.get("priority")}
        )
        
        return SuccessResponse(
            message="Priority updated successfully",
            data={"application_id": application_id, "priority": priority}
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating priority: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update priority"
        )

# ==================== EMAIL MONITORING ENDPOINTS ====================
@router.post("/{application_id}/enable-monitoring", response_model=SuccessResponse)
async def enable_email_monitoring(
    application_id: str,
    current_user: Dict[str, Any] = Depends(get_current_active_user),
    db = Depends(get_database)
):
    """Enable email monitoring for an application"""
    try:
        from app.services.emails.email_agent_service import email_agent_service
        
        try:
            ObjectId(application_id)
        except:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid application ID")
        
        user = await db.users.find_one({"_id": ObjectId(str(current_user["_id"]))})
        if not user or not user.get("gmail_auth"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Gmail not connected")
        
        application = await ApplicationTrackingService.get_application_by_id(application_id, db)
        if not application:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
        if application["user_id"] != str(current_user["_id"]):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied")
        
        await db.applications.update_one(
            {"_id": ObjectId(application_id)},
            {"$set": {"email_monitoring_enabled": True, "updated_at": datetime.utcnow()}}
        )
        
        return SuccessResponse(message="Email monitoring enabled", data={"application_id": application_id})
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error enabling monitoring: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
@router.post("/{application_id}/disable-monitoring", response_model=SuccessResponse)
async def disable_email_monitoring(
    application_id: str,
    current_user: Dict[str, Any] = Depends(get_current_active_user),
    db = Depends(get_database)
):
    """Disable email monitoring for an application"""
    try:
        try:
            ObjectId(application_id)
        except:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid application ID")
        
        application = await ApplicationTrackingService.get_application_by_id(application_id, db)
        if not application:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
        if application["user_id"] != str(current_user["_id"]):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied")
        
        await db.applications.update_one(
            {"_id": ObjectId(application_id)},
            {"$set": {"email_monitoring_enabled": False, "updated_at": datetime.utcnow()}}
        )
        
        return SuccessResponse(message="Email monitoring disabled", data={"application_id": application_id})
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error disabling monitoring: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
@router.post("/{application_id}/check-responses", response_model=SuccessResponse)
async def check_application_responses(
    application_id: str,
    current_user: Dict[str, Any] = Depends(get_current_active_user),
    db = Depends(get_database)
):
    """Manually check for email responses"""
    try:
        from app.services.emails.email_agent_service import email_agent_service
        
        try:
            ObjectId(application_id)
        except:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid application ID")
        
        application = await ApplicationTrackingService.get_application_by_id(application_id, db)
        if not application:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
        if application["user_id"] != str(current_user["_id"]):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied")
        
        # Check for responses (monitoring ALL types now)
        responses = await email_agent_service.monitor_application_responses(
            str(current_user["_id"]), 
            days_back=30,
            application_id=str(application_id)
        )
        
        await db.applications.update_one(
            {"_id": ObjectId(application_id)},
            {
                "$set": {"last_response_check": datetime.utcnow(), "updated_at": datetime.utcnow()},
                "$inc": {"response_check_count": 1}
            }
        )
        
        app_responses = [r for r in responses if r.get("application_id") == application_id]
        
        return SuccessResponse(
            message=f"Found {len(app_responses)} response(s)" if app_responses else "No responses found",
            data={"application_id": application_id, "responses_found": len(app_responses)}
        )
    except HTTPException:
        raise
    except ValueError as e:
        if "Gmail authentication expired" in str(e):
             raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Gmail authentication expired. Please reconnect.")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error(f"Error checking responses: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
@router.get("/monitoring/status")
async def get_monitoring_status(
    current_user: Dict[str, Any] = Depends(get_current_active_user),
    db = Depends(get_database)
):
    """Get overall email monitoring status"""
    try:
        user_id = str(current_user["_id"])
        user = await db.users.find_one({"_id": ObjectId(user_id)})
        gmail_connected = bool(user and user.get("gmail_auth"))
        
        monitored_count = await db.applications.count_documents({
            "user_id": user_id,
            "email_monitoring_enabled": True,
            "deleted_at": None
        })
        
        last_check = await db.applications.find_one(
            {"user_id": user_id, "last_response_check": {"$exists": True}, "deleted_at": None},
            sort=[("last_response_check", -1)]
        )
        
        return {
            "gmail_connected": gmail_connected,
            "monitored_applications_count": monitored_count,
            "last_check": last_check.get("last_response_check") if last_check else None
        }
    except Exception as e:
        logger.error(f"Error getting monitoring status: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))