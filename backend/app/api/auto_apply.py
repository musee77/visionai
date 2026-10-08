# backend/app/api/auto_apply.py
"""
Auto-Apply API Endpoints
Premium feature for automatic job applications
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from typing import List, Optional
from datetime import datetime, timedelta
from bson import ObjectId
from pydantic import BaseModel, Field

from app.api.deps import get_current_user
from app.database import get_database
from app.models.user import User
from app.workers.auto_apply import (
    enable_auto_apply_for_user,
    trigger_single_user_test
)
from app.services.intelligence.matching_service import matching_service

from celery.result import AsyncResult
import logging

logger = logging.getLogger(__name__)

router = APIRouter(tags=["auto-apply"])


class AutoApplyEnableRequest(BaseModel):
    max_daily_applications: int = Field(default=5, ge=1, le=10)
    min_match_score: float = Field(default=0.7, ge=0.5, le=0.9)


class AutoApplySettingsUpdate(BaseModel):
    max_daily_applications: Optional[int] = Field(default=None, ge=1, le=10)
    min_match_score: Optional[float] = Field(default=None, ge=0.5, le=0.9)


def profile_gaps(user: dict) -> list:
    """Personal information fields that must be filled before auto-apply."""
    profile = (user or {}).get("profile") or {}
    personal = profile.get("personal_info") or {}
    location_prefs = profile.get("location_preferences") or {}
    first_name = (personal.get("first_name") or user.get("first_name") or "").strip()
    last_name = (personal.get("last_name") or user.get("last_name") or "").strip()
    full_name = (user.get("full_name") or f"{first_name} {last_name}").strip()
    country = personal.get("country") or ""
    pref_country = location_prefs.get("country")
    if not country and isinstance(pref_country, dict):
        country = pref_country.get("name") or ""
    elif not country and isinstance(pref_country, str):
        country = pref_country
    city = (personal.get("city") or personal.get("location") or location_prefs.get("city") or "").strip()
    phone = (personal.get("phone") or user.get("phone") or "").strip()
    missing = []
    if not (first_name and last_name) and len(full_name.split()) < 2:
        missing.append("full name")
    if not (user.get("email") or "").strip():
        missing.append("email")
    if not phone:
        missing.append("phone")
    if not city:
        missing.append("job location")
    if not str(country).strip():
        missing.append("country")
    return missing


def require_premium(user: dict) -> bool:
    """Auto-apply is included with Premium, or with unused referral applications."""
    subscription_tier = user.get("subscription_tier", "free")
    bonus = int(user.get("referral_bonus_auto_applications") or 0)
    if subscription_tier != "premium" and bonus <= 0:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Premium is required for auto-apply"
        )
    return True


@router.get("/status")
async def get_auto_apply_status(
    current_user: dict = Depends(get_current_user),
    db = Depends(get_database)
):
    """
    Get auto-apply status and settings for current user
    """
    preferences = current_user.get("preferences", {})
    missing = profile_gaps(current_user)
    
    return {
        "enabled": preferences.get("auto_apply_enabled", False),
        "profile_complete": not missing,
        "missing_fields": missing,
        "max_daily_applications": preferences.get("max_daily_applications", 5),
        "min_match_score": preferences.get("min_match_score", 0.7),
        "subscription_tier": current_user.get("subscription_tier", "free"),
        "is_premium": current_user.get("subscription_tier") == "premium" or int(current_user.get("referral_bonus_auto_applications") or 0) > 0
    }


@router.post("/enable")
async def enable_auto_apply(
    settings: AutoApplyEnableRequest,
    current_user: dict = Depends(get_current_user),
    db = Depends(get_database)
):
    """
    Enable auto-apply for current user (paid automated plan only)
    """
    require_premium(current_user)
    missing = profile_gaps(current_user)
    if missing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Complete your profile to 100% before turning on auto-apply. Still needed: " + ", ".join(missing) + "."
        )

    max_daily_applications = settings.max_daily_applications
    min_match_score = settings.min_match_score
    user_id = str(current_user["_id"])

    await db["users"].update_one(
        {"_id": current_user["_id"]},
        {"$set": {
            "preferences.auto_apply_enabled": True,
            "preferences.auto_monitor_enabled": True,
            "preferences.max_daily_applications": max_daily_applications,
            "preferences.min_match_score": min_match_score,
            "preferences.auto_apply_enabled_at": datetime.utcnow()
        }}
    )
    enable_auto_apply_for_user.delay(user_id, max_daily_applications, min_match_score)

    return {
        "success": True,
        "message": "Auto-apply enabled successfully",
        "settings": {
            "max_daily_applications": max_daily_applications,
            "min_match_score": min_match_score
        }
    }


@router.post("/disable")
async def disable_auto_apply(
    current_user: dict = Depends(get_current_user),
    db = Depends(get_database)
):
    """
    Disable auto-apply for current user
    """
    users_collection = db["users"]
    
    await users_collection.update_one(
        {"_id": current_user["_id"]},
        {"$set": {
            "preferences.auto_apply_enabled": False,
            "preferences.auto_apply_disabled_at": datetime.utcnow()
        }}
    )
    
    return {
        "success": True,
        "message": "Auto-apply disabled successfully"
    }


@router.post("/test")
async def test_auto_apply(
    current_user: dict = Depends(get_current_user),
    db = Depends(get_database)
):
    """
    Trigger a single test run of auto-apply for the current user.
    Useful for verifying that the automation finds jobs and applies correctly.
    """
    require_premium(current_user)
    
    user_id = str(current_user["_id"])
    
    # Trigger the task and wait for result (or return task_id if it takes too long, 
    # but for "Test" user usually wants immediate feedback)
    try:
        # Note: In production, we might want to just return task_id. 
        # But for this user feature, we'll wait briefly or return the task info.
        # Since workers are async, let's call the task. 
        # If we want synchronous-like behavior for "Test", we can use .get() but careful with timeouts.
        # Let's try to run it.
        
        task = trigger_single_user_test.delay(user_id)
        
        # We can return the task ID and have frontend poll, OR just return success 
        # "Test started". Given the user request "see results", polling might be best,
        # but let's assume it runs relatively fast (< 10s) for a few jobs.
        # For simplicity in this iteration, we will return success and let them check stats.
        
        # Better: wait for it if possible. 
        # result = task.get(timeout=30) 
        # But that blocks API worker. 
        
        # Compromise: Return success and tell frontend to poll stats or show "Running... check stats in a moment".
        
        return {
            "success": True,
            "message": "Test automation started. Please check stats in a few seconds.",
            "task_id": str(task.id)
        }
        
    except Exception as e:
         raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to start test: {str(e)}"
        )


@router.get("/test/status/{task_id}")
async def get_test_status(task_id: str, current_user: dict = Depends(get_current_user)):
    """
    Get status of test run task
    """
    task_result = AsyncResult(task_id)
    
    response = {
        "state": task_result.state,
        "current": 0,
        "total": 100,
        "status": "Pending..."
    }
    
    if task_result.state == 'PENDING':
        # Default pending state
        pass
    elif task_result.state == 'PROGRESS':
        response.update({
            "current": task_result.info.get('current', 0),
            "total": task_result.info.get('total', 100),
            "status": task_result.info.get('status', 'Processing...')
        })
    elif task_result.state == 'SUCCESS':
        # Result is typically {"success": True, "applications_sent": N, "message": "..."}
        result_data = task_result.result or {}
        response.update({
            "current": 100,
            "total": 100,
            "status": "Completed: " + str(result_data.get("message", "Test run finished")),
            "result": result_data,
            "message": result_data.get("message"),
            "applications_sent": result_data.get("applications_sent", 0),
            "stats": result_data.get("stats", {})
        })
    elif task_result.state == 'FAILURE':
         response.update({
            "current": 0,
            "total": 100,
            "status": "Failed: " + str(task_result.info), 
            "error": str(task_result.info)
        })
        
    return response


@router.get("/stats")
async def get_auto_apply_stats(
    current_user: dict = Depends(get_current_user),
    db = Depends(get_database)
):
    """
    Get auto-apply statistics for current user
    """
    user_id = str(current_user["_id"])
    applications_collection = db["applications"]
    
    # Get today's auto-applications
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    today_applications = await applications_collection.count_documents({
        "user_id": user_id,
        "auto_applied": True,
        "status": {"$nin": ["failed", "withdrawn", "awaiting_review"]},
        "created_at": {"$gte": today_start}
    })
    
    # Get total auto-applications
    total_applications = await applications_collection.count_documents({
        "user_id": user_id,
        "auto_applied": True
    })
    
    # Get average match score
    pipeline = [
        {"$match": {"user_id": user_id, "auto_applied": True, "match_score": {"$exists": True}}},
        {"$group": {"_id": None, "avg_score": {"$avg": "$match_score"}}}
    ]
    avg_result = await applications_collection.aggregate(pipeline).to_list(length=1)
    avg_match_score = avg_result[0]["avg_score"] if avg_result else 0
    
    # Get interview rate
    total_auto_apps = await applications_collection.count_documents({
        "user_id": user_id,
        "auto_applied": True
    })
    
    interviews = await applications_collection.count_documents({
        "user_id": user_id,
        "auto_applied": True,
        "status": {"$in": ["interview_scheduled", "interview_completed", "interviewed"]}
    })
    
    interview_rate = (interviews / total_auto_apps) if total_auto_apps > 0 else 0
    
    # Get preferences
    preferences = current_user.get("preferences", {})
    
    return {
        "today_applications": today_applications,
        "total_applications": total_applications,
        "avg_match_score": round(avg_match_score, 2),
        "interview_rate": round(interview_rate, 2),
        "daily_limit": preferences.get("max_daily_applications", 5),
        "remaining_today": max(0, preferences.get("max_daily_applications", 5) - today_applications)
    }


@router.get("/suggested-roles")
async def get_suggested_roles(
    current_user: dict = Depends(get_current_user),
    db = Depends(get_database)
):
    """
    Get AI-suggested job roles based on CV analysis
    """
    user_id = str(current_user["_id"])
    cv_data = current_user.get("cv_data", {})
    
    # If cv_data is empty on user profile, try to get it from documents collection
    if not cv_data:
        documents_collection = db["documents"]
        cv_doc = await documents_collection.find_one({
            "user_id": user_id,
            "document_type": "cv",
            "cv_data": {"$exists": True, "$ne": {}}
        }, sort=[("uploaded_at", -1)])
        
        if cv_doc and cv_doc.get("cv_data"):
            cv_data = cv_doc.get("cv_data", {})
    
    if not cv_data:
        return {"suggested_roles": [], "message": "Please upload your CV first"}
    
    suggested_roles = await matching_service.get_suggested_roles(cv_data)
    
    # Calculate stats for response
    skills = cv_data.get("skills", {})
    if isinstance(skills, dict):
        skill_count = len(skills.get("technical", [])) + len(skills.get("soft", []))
    else:
        skill_count = len(skills) if isinstance(skills, list) else 0
        
    return {
        "suggested_roles": suggested_roles,
        "skills_analyzed": skill_count,
        "experience_count": len(cv_data.get("experience", []))
    }


@router.get("/cv-data")
async def get_cv_data(
    current_user: dict = Depends(get_current_user),
    db = Depends(get_database)
):
    """
    Get parsed CV data for current user
    """
    user_id = str(current_user["_id"])
    cv_data = current_user.get("cv_data", {})
    
    # If cv_data is empty on user profile, try to get it from documents collection
    if not cv_data:
        documents_collection = db["documents"]
        cv_doc = await documents_collection.find_one({
            "user_id": user_id,
            "document_type": "cv",
            "cv_data": {"$exists": True, "$ne": {}}
        }, sort=[("uploaded_at", -1)])
        
        if cv_doc and cv_doc.get("cv_data"):
            cv_data = cv_doc.get("cv_data", {})
            logger.info(f"CV data endpoint: Found CV data in documents for user {user_id}")
    
    return {
        "full_name": current_user.get("full_name", "") or cv_data.get("name", ""),
        "email": current_user.get("email", "") or cv_data.get("email", ""),
        "phone": cv_data.get("phone", ""),
        "location": cv_data.get("location", ""),
        "years_of_experience": cv_data.get("years_of_experience", 0),
        "education_level": cv_data.get("education_level", ""),
        "current_role": cv_data.get("current_role", ""),
        "skills": cv_data.get("skills", []),
        "summary": cv_data.get("summary", ""),
        "experience": cv_data.get("experience", []),
        "education": cv_data.get("education", [])
    }


def _format_salary(job: dict) -> str:
    salary_range = job.get("salary_range") or {}
    salary = job.get("salary") or ""
    if salary or not isinstance(salary_range, dict):
        return salary

    def _amount(value):
        try:
            return f"{float(value):,.0f}"
        except (TypeError, ValueError):
            return None

    minimum = _amount(salary_range.get("min_amount"))
    maximum = _amount(salary_range.get("max_amount"))
    currency = salary_range.get("currency") or ""
    if isinstance(currency, dict):
        currency = currency.get("value") or ""
    if minimum and maximum:
        return f"{currency} {minimum}–{maximum}".strip()
    if minimum:
        return f"{currency} {minimum}+".strip()
    return ""


def _format_matching_jobs(jobs: list) -> list:
    formatted_jobs = []
    for job in jobs:
        job_id = str(job["_id"])
        formatted_jobs.append({
            "_id": job_id,
            "id": job_id,
            "title": job.get("title", ""),
            "company": job.get("company_name") or job.get("company") or "",
            "company_name": job.get("company_name") or job.get("company") or "",
            "location": job.get("location", ""),
            "salary": _format_salary(job),
            "description": job.get("description") or "",
            "requirements": job.get("requirements", ""),
            "created_at": job.get("created_at") or job.get("posted_date"),
            "match_score": job.get("match_score", 0),
            "applied": False
        })
    return formatted_jobs


@router.get("/matching-jobs")
async def get_matching_jobs(
    limit: int = Query(default=10, ge=1, le=100),
    page: Optional[int] = Query(default=None, ge=1),
    current_user: dict = Depends(get_current_user),
    db = Depends(get_database)
):
    """
    Get jobs matching user's CV with AI-calculated scores
    """
    user_id = str(current_user["_id"])
    cv_data = current_user.get("cv_data", {})
    
    # If cv_data is empty on user profile, try to get it from documents collection
    if not cv_data:
        documents_collection = db["documents"]
        cv_doc = await documents_collection.find_one({
            "user_id": user_id,
            "document_type": "cv",
            "cv_data": {"$exists": True, "$ne": {}}
        }, sort=[("uploaded_at", -1)])
        
        if cv_doc and cv_doc.get("cv_data"):
            cv_data = cv_doc.get("cv_data", {})
            logger.info(f"Found CV data in documents collection for user {user_id}")
    
    if not cv_data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please upload your CV first"
        )
    
    matching_service.db = db
    if page is not None:
        pool = await matching_service.find_matching_jobs(user_id, cv_data, limit=100)
        start = (page - 1) * limit
        return {
            "jobs": _format_matching_jobs(pool[start:start + limit]),
            "total": len(pool),
            "page": page,
            "page_size": limit
        }

    matching_jobs = await matching_service.find_matching_jobs(user_id, cv_data, limit=limit)
    return _format_matching_jobs(matching_jobs)


@router.put("/settings")
async def update_auto_apply_settings(
    settings: AutoApplySettingsUpdate,
    current_user: dict = Depends(get_current_user),
    db = Depends(get_database)
):
    """
    Update auto-apply settings
    """
    require_premium(current_user)

    update_data = {}
    max_daily_applications = settings.max_daily_applications
    min_match_score = settings.min_match_score

    if max_daily_applications is not None:
        update_data["preferences.max_daily_applications"] = max_daily_applications

    if min_match_score is not None:
        update_data["preferences.min_match_score"] = min_match_score
    
    if update_data:
        users_collection = db["users"]
        await users_collection.update_one(
            {"_id": current_user["_id"]},
            {"$set": update_data}
        )
    
    return {
        "success": True,
        "message": "Settings updated successfully",
        "settings": {
            "max_daily_applications": max_daily_applications,
            "min_match_score": min_match_score
        }
    }
