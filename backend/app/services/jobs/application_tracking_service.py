"""
Application Tracking Service - Complete Implementation
Handles application timeline events and status tracking
"""
from motor.motor_asyncio import AsyncIOMotorDatabase
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from bson import ObjectId
import html
import logging
import re

logger = logging.getLogger(__name__)


class ApplicationTrackingService:
    """Service for tracking application lifecycle events"""
    
    def __init__(self, db: AsyncIOMotorDatabase):
        self.db = db
        self.applications = db.applications
        self.timeline_events = db.timeline_events

    @staticmethod
    def _location_text(value: Any) -> Optional[str]:
        if value is None or value == "":
            return None
        if isinstance(value, str):
            return value
        if isinstance(value, dict):
            parts = [
                value.get("city"),
                value.get("region") or value.get("state"),
                value.get("country"),
            ]
            text = ", ".join(part for part in parts if part)
            return text or None
        return str(value)

    @staticmethod
    def _description_preview(raw: Any, limit: int = 220) -> Optional[str]:
        if not isinstance(raw, str) or not raw.strip():
            return None
        text = re.sub(r"<\s*br\s*/?>", " ", raw, flags=re.I)
        text = re.sub(r"</(p|div|li|h[1-6]|tr|section)>", " ", text, flags=re.I)
        text = re.sub(r"<[^>]+>", " ", text)
        text = html.unescape(text)
        text = re.sub(r"\s+", " ", text).strip()
        if not text:
            return None
        if len(text) <= limit:
            return text
        cut = text[:limit].rsplit(" ", 1)[0].strip()
        return f"{cut or text[:limit].strip()}…"

    @staticmethod
    def _job_display(job: Dict[str, Any]) -> Dict[str, Optional[str]]:
        return {
            "job_title": job.get("title") or job.get("job_title"),
            "company_name": job.get("company_name") or job.get("company"),
            "location": ApplicationTrackingService._location_text(job.get("location")),
            "description_preview": ApplicationTrackingService._description_preview(job.get("description")),
        }

    @staticmethod
    async def _find_job(db: AsyncIOMotorDatabase, job_id: Any) -> Optional[Dict[str, Any]]:
        if not job_id:
            return None
        key = str(job_id)
        clauses = [{"_id": key}]
        try:
            clauses.append({"_id": ObjectId(key)})
        except Exception:
            pass
        return await db.jobs.find_one({"$or": clauses})

    @staticmethod
    async def _attach_jobs(db: AsyncIOMotorDatabase, applications: List[Dict[str, Any]]) -> None:
        """Fill title, company, and location from the jobs collection."""
        keys = []
        for app in applications:
            if app.get("job_id"):
                keys.append(str(app["job_id"]))
        if not keys:
            return

        object_ids = []
        for key in keys:
            try:
                object_ids.append(ObjectId(key))
            except Exception:
                pass

        found = await db.jobs.find(
            {"$or": [{"_id": {"$in": object_ids}}, {"_id": {"$in": keys}}]}
        ).to_list(length=None)
        by_id = {str(job["_id"]): job for job in found}

        for app in applications:
            job = by_id.get(str(app.get("job_id") or ""))
            display = ApplicationTrackingService._job_display(job) if job else {}
            app["job_title"] = display.get("job_title") or app.get("job_title")
            app["company_name"] = display.get("company_name") or app.get("company_name")
            app["location"] = display.get("location") or ApplicationTrackingService._location_text(app.get("location"))
            if display.get("description_preview"):
                app["description_preview"] = display["description_preview"]
    
    # ==================== INSTANCE METHODS ====================
    
    async def add_timeline_event(
        self,
        application_id: str,
        event_type: str,
        description: str,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Add a timeline event to an application"""
        try:
            event = {
                "timestamp": datetime.utcnow(),
                "type": event_type,
                "description": description,
                "metadata": metadata or {}
            }
            
            result = await self.applications.update_one(
                {"_id": ObjectId(application_id)},
                {
                    "$push": {"timeline": event},
                    "$set": {"updated_at": datetime.utcnow()}
                }
            )
            
            if result.modified_count > 0:
                logger.info(f"Timeline event added to application {application_id}: {event_type}")
                return event
            
            return None
            
        except Exception as e:
            logger.error(f"Error adding timeline event: {e}")
            raise
    
    async def update_application_status(
        self,
        application_id: str,
        new_status: str,
        notes: Optional[str] = None
    ) -> bool:
        """Update application status and add timeline event"""
        try:
            # Get current application
            application = await self.applications.find_one({"_id": ObjectId(application_id)})
            if not application:
                return False
            
            old_status = application.get("status", "unknown")
            
            # Update status
            update_data = {
                "status": new_status,
                "updated_at": datetime.utcnow()
            }
            
            if notes:
                update_data["notes"] = notes
            
            # Add status-specific fields
            if new_status == "interview_scheduled":
                update_data["interview_date"] = None  # To be set separately
            elif new_status in ["rejected", "offer_received", "accepted", "declined"]:
                update_data["completion_date"] = datetime.utcnow()
            
            result = await self.applications.update_one(
                {"_id": ObjectId(application_id)},
                {"$set": update_data}
            )
            
            if result.modified_count > 0:
                # Add timeline event
                await self.add_timeline_event(
                    application_id,
                    "status_change",
                    f"Status changed from {old_status} to {new_status}",
                    {"old_status": old_status, "new_status": new_status, "notes": notes}
                )
                return True
            
            return False
            
        except Exception as e:
            logger.error(f"Error updating application status: {e}")
            raise
    
    async def schedule_interview(
        self,
        application_id: str,
        interview_date: datetime,
        interview_type: str = "phone",
        location: Optional[str] = None,
        notes: Optional[str] = None
    ) -> bool:
        """Schedule an interview for an application"""
        try:
            update_data = {
                "status": "interview_scheduled",
                "interview_date": interview_date,
                "interview_type": interview_type,
                "interview_location": location,
                "interview_notes": notes,
                "updated_at": datetime.utcnow()
            }
            
            result = await self.applications.update_one(
                {"_id": ObjectId(application_id)},
                {"$set": update_data}
            )
            
            if result.modified_count > 0:
                await self.add_timeline_event(
                    application_id,
                    "interview_scheduled",
                    f"{interview_type.title()} interview scheduled for {interview_date.strftime('%Y-%m-%d %H:%M')}",
                    {
                        "interview_date": interview_date.isoformat(),
                        "interview_type": interview_type,
                        "location": location
                    }
                )
                return True
            
            return False
            
        except Exception as e:
            logger.error(f"Error scheduling interview: {e}")
            raise
    
    async def set_follow_up_reminder(
        self,
        application_id: str,
        follow_up_date: datetime,
        notes: Optional[str] = None
    ) -> bool:
        """Set a follow-up reminder for an application"""
        try:
            result = await self.applications.update_one(
                {"_id": ObjectId(application_id)},
                {
                    "$set": {
                        "follow_up_date": follow_up_date,
                        "follow_up_notes": notes,
                        "updated_at": datetime.utcnow()
                    }
                }
            )
            
            if result.modified_count > 0:
                await self.add_timeline_event(
                    application_id,
                    "follow_up_scheduled",
                    f"Follow-up reminder set for {follow_up_date.strftime('%Y-%m-%d')}",
                    {"follow_up_date": follow_up_date.isoformat(), "notes": notes}
                )
                return True
            
            return False
            
        except Exception as e:
            logger.error(f"Error setting follow-up reminder: {e}")
            raise
    
    async def get_application_timeline(
        self,
        application_id: str
    ) -> List[Dict[str, Any]]:
        """Get complete timeline for an application"""
        try:
            application = await self.applications.find_one({"_id": ObjectId(application_id)})
            if not application:
                return []
            
            return application.get("timeline", [])
            
        except Exception as e:
            logger.error(f"Error getting application timeline: {e}")
            return []
    
    async def get_applications_needing_follow_up(
        self,
        user_id: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Get applications that need follow-up today or are overdue"""
        try:
            today = datetime.utcnow().replace(hour=23, minute=59, second=59)
            
            query = {
                "follow_up_date": {"$lte": today},
                "deleted_at": None,
                "status": {"$nin": ["rejected", "offer_accepted", "offer_declined", "withdrawn", "archived"]}
            }
            
            if user_id:
                query["user_id"] = user_id
            
            applications = await self.applications.find(query).to_list(length=100)
            await self._attach_jobs(self.db, applications)
            for app in applications:
                app["id"] = str(app["_id"])
                app["_id"] = str(app["_id"])
                app["next_follow_up"] = app.get("follow_up_date")
                if app.get("job_id"):
                    app["job_id"] = str(app["job_id"])
            return applications
            
        except Exception as e:
            logger.error(f"Error getting follow-up applications: {e}")
            return []
    
    async def get_upcoming_interviews(
        self,
        user_id: Optional[str] = None,
        days_ahead: int = 7
    ) -> List[Dict[str, Any]]:
        """Get upcoming interviews within specified days or needing scheduling"""
        try:
            start_date = datetime.utcnow()
            end_date = start_date + timedelta(days=days_ahead)
            
            # Query for:
            # 1. Scheduled interviews within the date range
            # 2. Applications marked as 'interview_scheduled' but with NO date (scheduling required)
            query = {
                "status": "interview_scheduled",
                "$or": [
                    {"interview_date": {"$gte": start_date, "$lte": end_date}},
                    {"interview_date": None},
                    {"interview_date": {"$exists": False}}
                ]
            }
            
            if user_id:
                query["user_id"] = user_id
            
            # Sort: Put scheduling needed (null date) first, then nearest dates
            # MongoDB sorts nulls first in ascending order
            interviews = await self.applications.find(query).sort("interview_date", 1).to_list(length=100)
            await self._attach_jobs(self.db, interviews)
            for interview in interviews:
                interview["id"] = str(interview["_id"])
                interview["_id"] = str(interview["_id"])
                if interview.get("job_id"):
                    interview["job_id"] = str(interview["job_id"])
            return interviews
            
        except Exception as e:
            logger.error(f"Error getting upcoming interviews: {e}")
            return []
    
    async def get_applications_by_status(
        self,
        user_id: str,
        status: str
    ) -> List[Dict[str, Any]]:
        """Get all applications with a specific status"""
        try:
            applications = await self.applications.find({
                "user_id": user_id,
                "status": status
            }).to_list(length=1000)
            
            return applications
            
        except Exception as e:
            logger.error(f"Error getting applications by status: {e}")
            return []
    
    async def bulk_update_status(
        self,
        application_ids: List[str],
        new_status: str,
        notes: Optional[str] = None
    ) -> int:
        """Update status for multiple applications"""
        try:
            count = 0
            for app_id in application_ids:
                success = await self.update_application_status(app_id, new_status, notes)
                if success:
                    count += 1
            
            return count
            
        except Exception as e:
            logger.error(f"Error in bulk status update: {e}")
            return 0
    
    async def get_user_application_stats(
        self,
        user_id: str
    ) -> Dict[str, Any]:
        """Get application statistics for a user"""
        try:
            # Get total count
            total_count = await self.applications.count_documents({
                "user_id": user_id,
                "deleted_at": None
            })
            
            # Get status counts
            pipeline = [
                {
                    "$match": {
                        "user_id": user_id,
                        "deleted_at": None
                    }
                },
                {
                    "$group": {
                        "_id": "$status",
                        "count": {"$sum": 1}
                    }
                }
            ]
            
            status_results = await self.applications.aggregate(pipeline).to_list(length=None)
            status_counts = {item["_id"]: item["count"] for item in status_results}
            
            # Get applications by priority
            priority_pipeline = [
                {
                    "$match": {
                        "user_id": user_id,
                        "deleted_at": None
                    }
                },
                {
                    "$group": {
                        "_id": "$priority",
                        "count": {"$sum": 1}
                    }
                }
            ]
            
            priority_results = await self.applications.aggregate(priority_pipeline).to_list(length=None)
            priority_counts = {item["_id"]: item["count"] for item in priority_results}
            
            # Get recent activity stats (last 30 days)
            thirty_days_ago = datetime.utcnow() - timedelta(days=30)
            recent_applications = await self.applications.count_documents({
                "user_id": user_id,
                "created_at": {"$gte": thirty_days_ago},
                "deleted_at": None
            })
            
            # Get interview count
            interview_count = await self.applications.count_documents({
                "user_id": user_id,
                "status": "interview_scheduled",
                "deleted_at": None
            })
            
            # Get response rate
            applied_count = await self.applications.count_documents({
                "user_id": user_id,
                "status": {"$ne": "draft"},
                "deleted_at": None
            })
            
            responded_count = await self.applications.count_documents({
                "user_id": user_id,
                "status": {"$in": ["interview_scheduled", "rejected", "offer_received", "offer_accepted", "offer_declined"]},
                "deleted_at": None
            })
            
            response_rate = (responded_count / applied_count * 100) if applied_count > 0 else 0
            
            # Calculate this week, month and TODAY stats
            today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
            week_ago = datetime.utcnow() - timedelta(days=7)
            month_ago = datetime.utcnow() - timedelta(days=30)
            
            applications_today = await self.applications.count_documents({
                "user_id": user_id,
                "created_at": {"$gte": today_start},
                "deleted_at": None
            })

            applications_this_week = await self.applications.count_documents({
                "user_id": user_id,
                "created_at": {"$gte": week_ago},
                "deleted_at": None
            })
            
            applications_this_month = await self.applications.count_documents({
                "user_id": user_id,
                "created_at": {"$gte": month_ago},
                "deleted_at": None
            })
            
            # Calculate rates
            interview_rate = (status_counts.get("interview_scheduled", 0) / total_count * 100) if total_count > 0 else 0
            offer_rate = (status_counts.get("offer_received", 0) / total_count * 100) if total_count > 0 else 0
            
            return {
                "total_applications": total_count,
                "applications_today": applications_today,
                "active_applications": total_count - sum(
                status_counts.get(name, 0)
                for name in ("archived", "withdrawn", "rejected", "offer_declined")
            ),
                "applications_this_week": applications_this_week,
                "applications_this_month": applications_this_month,
                "status_counts": status_counts,
                "status_distribution": status_counts,
                "priority_counts": priority_counts,
                "recent_applications_30d": recent_applications,
                "pending_interviews": interview_count,
                "response_rate": round(response_rate, 2),
                "interview_rate": round(interview_rate, 2),
                "offer_rate": round(offer_rate, 2),
                "applications_sent": applied_count,
                "responses_received": responded_count
            }
            
        except Exception as e:
            logger.error(f"Error getting user application stats: {e}")
            return {
                "total_applications": 0,
                "active_applications": 0,
                "applications_this_week": 0,
                "applications_this_month": 0,
                "status_counts": {},
                "status_distribution": {},
                "priority_counts": {},
                "recent_applications_30d": 0,
                "pending_interviews": 0,
                "response_rate": 0.0,
                "interview_rate": 0.0,
                "offer_rate": 0.0,
                "applications_sent": 0,
                "responses_received": 0
            }
    
    async def get_application_status_counts(
        self,
        user_id: str
    ) -> Dict[str, int]:
        """Get count of applications by status"""
        try:
            pipeline = [
                {
                    "$match": {
                        "user_id": user_id,
                        "deleted_at": None
                    }
                },
                {
                    "$group": {
                        "_id": "$status",
                        "count": {"$sum": 1}
                    }
                }
            ]
            
            results = await self.applications.aggregate(pipeline).to_list(length=None)
            return {item["_id"]: item["count"] for item in results}
            
        except Exception as e:
            logger.error(f"Error getting status counts: {e}")
            return {}
    
    # ==================== STATIC METHODS FOR API ====================
    
    @staticmethod
    async def create_application(
        application_data: Dict[str, Any],
        db: AsyncIOMotorDatabase
    ) -> Optional[str]:
        """Create a new application (static method for API use)"""
        try:
            applications = db.applications

            job = await ApplicationTrackingService._find_job(db, application_data.get("job_id"))
            if job:
                display = ApplicationTrackingService._job_display(job)
                application_data["job_id"] = str(job["_id"])
                application_data["job_title"] = display.get("job_title") or application_data.get("job_title")
                application_data["company_name"] = display.get("company_name") or application_data.get("company_name")
                application_data["location"] = display.get("location") or ApplicationTrackingService._location_text(
                    application_data.get("location")
                )
            
            # Prepare application document
            application = {
                "user_id": application_data.get("user_id"),
                "job_id": application_data.get("job_id"),
                "status": application_data.get("status", "draft"),
                "source": application_data.get("source", "manual"),
                "applied_date": application_data.get("applied_date"),
                "job_title": application_data.get("job_title"),
                "company_name": application_data.get("company_name"),
                "location": application_data.get("location"),
                "priority": application_data.get("priority", "medium"),
                "custom_cv_content": application_data.get("custom_cv_content"),
                "cover_letter_content": application_data.get("cover_letter_content"),
                "additional_notes": application_data.get("additional_notes"),
                "salary_expectation": application_data.get("salary_expectation"),
                "availability_date": application_data.get("availability_date"),
                "referral_source": application_data.get("referral_source"),
                "timeline": [],
                "documents": application_data.get("documents", []),
                "communications": [],
                "interviews": [],
                "tasks": [],
                "created_at": datetime.utcnow(),
                "updated_at": datetime.utcnow(),
                "deleted_at": None
            }
            
            result = await applications.insert_one(application)
            return str(result.inserted_id) if result.inserted_id else None
            
        except Exception as e:
            logger.error(f"Error creating application: {e}")
            return None
    
    @staticmethod
    async def get_application_by_id(
        application_id: str,
        db: AsyncIOMotorDatabase
    ) -> Optional[Dict[str, Any]]:
        """Get application by ID (static method for API use)"""
        try:
            applications = db.applications
            application = await applications.find_one({
                "_id": ObjectId(application_id),
                "deleted_at": None
            })
            
            if application:
                application["id"] = str(application["_id"])
                application["_id"] = str(application["_id"])
                if application.get("job_id"):
                    application["job_id"] = str(application["job_id"])
                await ApplicationTrackingService._attach_jobs(db, [application])
            
            return application
            
        except Exception as e:
            logger.error(f"Error getting application: {e}")
            return None
    
    @staticmethod
    async def get_user_applications(
        user_id: str,
        db: AsyncIOMotorDatabase,
        filters: Optional[Dict[str, Any]] = None,
        page: int = 1,
        size: int = 50,
        sort_by: str = "created_at",
        sort_order: str = "desc",
        search: Optional[str] = None
    ) -> Dict[str, Any]:
        """Get user applications with pagination (static method for API use)"""
        try:
            applications = db.applications
            
            # Build query
            query = {"user_id": user_id, "deleted_at": None}
            if filters:
                query.update(filters)
            
            # Add search if provided
            if search:
                safe_search = re.escape(search)
                query.setdefault("$and", []).append({
                    "$or": [
                        {"job_title": {"$regex": safe_search, "$options": "i"}},
                        {"company_name": {"$regex": safe_search, "$options": "i"}},
                        {"location": {"$regex": safe_search, "$options": "i"}}
                    ]
                })
            
            # Calculate pagination
            skip = (page - 1) * size
            sort_direction = -1 if sort_order == "desc" else 1
            
            # Get total count
            total = await applications.count_documents(query)
            
            # Get paginated results
            cursor = applications.find(query).sort(sort_by, sort_direction).skip(skip).limit(size)
            apps_list = await cursor.to_list(length=size)
            await ApplicationTrackingService._attach_jobs(db, apps_list)
            
            # Convert to response format
            formatted_apps = []
            for app in apps_list:
                formatted_apps.append({
                    "id": str(app["_id"]),
                    "job_id": str(app.get("job_id", "")),
                    "user_id": str(app["user_id"]),
                    "status": app.get("status", "draft"),
                    "source": app.get("source", "manual"),
                    "applied_date": app.get("applied_date"),
                    "job_title": app.get("job_title"),
                    "company_name": app.get("company_name"),
                    "location": ApplicationTrackingService._location_text(app.get("location")),
                    "description_preview": app.get("description_preview"),
                    "priority": app.get("priority", "medium"),
                    "documents_count": len(app.get("documents", [])),
                    "communications_count": len(app.get("communications", [])),
                    "interviews_count": len(app.get("interviews", [])),
                    "tasks_count": len(app.get("tasks", [])),
                    "has_custom_cv": bool(app.get("custom_cv_content")),
                    "has_cover_letter": bool(app.get("cover_letter_content")),
                    "last_activity": app.get("updated_at"),
                    "created_at": app["created_at"],
                    "updated_at": app["updated_at"]
                })
            
            pages = (total + size - 1) // size if size > 0 else 0
            
            return {
                "applications": formatted_apps,
                "total": total,
                "pages": pages,
                "has_next": page < pages,
                "has_prev": page > 1
            }
            
        except Exception as e:
            logger.error(f"Error getting user applications: {e}")
            return {
                "applications": [],
                "total": 0,
                "pages": 0,
                "has_next": False,
                "has_prev": False
            }
    
    @staticmethod
    async def update_application(
        application_id: str,
        update_data: Dict[str, Any],
        db: AsyncIOMotorDatabase
    ) -> bool:
        """Update application (static method for API use)"""
        try:
            applications = db.applications
            
            # Remove None values and prepare update
            clean_update = {k: v for k, v in update_data.items() if v is not None}
            clean_update["updated_at"] = datetime.utcnow()
            
            result = await applications.update_one(
                {"_id": ObjectId(application_id)},
                {"$set": clean_update}
            )
            
            return result.modified_count > 0
            
        except Exception as e:
            logger.error(f"Error updating application: {e}")
            return False
    
    @staticmethod
    async def delete_application(
        application_id: str,
        db: AsyncIOMotorDatabase
    ) -> bool:
        """Soft delete application (static method for API use)"""
        try:
            applications = db.applications
            
            result = await applications.update_one(
                {"_id": ObjectId(application_id)},
                {
                    "$set": {
                        "deleted_at": datetime.utcnow(),
                        "updated_at": datetime.utcnow()
                    }
                }
            )
            
            return result.modified_count > 0
            
        except Exception as e:
            logger.error(f"Error deleting application: {e}")
            return False
    
    # Additional helper methods for documents, communications, tasks, etc.
    
    @staticmethod
    async def add_application_document(
        application_id: str,
        document: Dict[str, Any],
        db: AsyncIOMotorDatabase
    ) -> bool:
        """Add document to application"""
        try:
            applications = db.applications
            result = await applications.update_one(
                {"_id": ObjectId(application_id)},
                {
                    "$push": {"documents": document},
                    "$set": {"updated_at": datetime.utcnow()}
                }
            )
            return result.modified_count > 0
        except Exception as e:
            logger.error(f"Error adding document: {e}")
            return False
    
    @staticmethod
    async def add_communication(
        application_id: str,
        communication: Dict[str, Any],
        db: AsyncIOMotorDatabase
    ) -> bool:
        """Add communication to application"""
        try:
            applications = db.applications
            result = await applications.update_one(
                {"_id": ObjectId(application_id)},
                {
                    "$push": {"communications": communication},
                    "$set": {"updated_at": datetime.utcnow()}
                }
            )
            return result.modified_count > 0
        except Exception as e:
            logger.error(f"Error adding communication: {e}")
            return False
    
    @staticmethod
    async def add_task(
        application_id: str,
        task: Dict[str, Any],
        db: AsyncIOMotorDatabase
    ) -> bool:
        """Add task to application"""
        try:
            applications = db.applications
            result = await applications.update_one(
                {"_id": ObjectId(application_id)},
                {
                    "$push": {"tasks": task},
                    "$set": {"updated_at": datetime.utcnow()}
                }
            )
            return result.modified_count > 0
        except Exception as e:
            logger.error(f"Error adding task: {e}")
            return False
    
    @staticmethod
    async def complete_task(
        application_id: str,
        task_index: int,
        db: AsyncIOMotorDatabase
    ) -> bool:
        """Complete a task"""
        try:
            applications = db.applications
            result = await applications.update_one(
                {"_id": ObjectId(application_id)},
                {
                    "$set": {
                        f"tasks.{task_index}.is_completed": True,
                        f"tasks.{task_index}.completed_at": datetime.utcnow(),
                        "updated_at": datetime.utcnow()
                    }
                }
            )
            return result.modified_count > 0
        except Exception as e:
            logger.error(f"Error completing task: {e}")
            return False
    
    @staticmethod
    async def add_interview_feedback(
        application_id: str,
        interview_index: int,
        feedback_data: Dict[str, Any],
        db: AsyncIOMotorDatabase
    ) -> bool:
        """Add feedback to interview"""
        try:
            applications = db.applications
            result = await applications.update_one(
                {"_id": ObjectId(application_id)},
                {
                    "$set": {
                        f"interviews.{interview_index}.feedback": feedback_data.get("feedback"),
                        f"interviews.{interview_index}.rating": feedback_data.get("rating"),
                        "updated_at": datetime.utcnow()
                    }
                }
            )
            return result.modified_count > 0
        except Exception as e:
            logger.error(f"Error adding interview feedback: {e}")
            return False
    
    @staticmethod
    async def update_notes(
        application_id: str,
        notes: str,
        db: AsyncIOMotorDatabase
    ) -> bool:
        """Update application notes"""
        try:
            applications = db.applications
            result = await applications.update_one(
                {"_id": ObjectId(application_id)},
                {
                    "$set": {
                        "additional_notes": notes,
                        "updated_at": datetime.utcnow()
                    }
                }
            )
            return result.modified_count > 0
        except Exception as e:
            logger.error(f"Error updating notes: {e}")
            return False
    
    @staticmethod
    async def update_priority(
        application_id: str,
        priority: str,
        db: AsyncIOMotorDatabase
    ) -> bool:
        """Update application priority"""
        try:
            applications = db.applications
            result = await applications.update_one(
                {"_id": ObjectId(application_id)},
                {
                    "$set": {
                        "priority": priority,
                        "updated_at": datetime.utcnow()
                    }
                }
            )
            return result.modified_count > 0
        except Exception as e:
            logger.error(f"Error updating priority: {e}")
            return False