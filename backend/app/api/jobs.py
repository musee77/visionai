# backend/app/api/jobs.py
"""
Job-related API endpoints
"""

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Query, Body
from fastapi.responses import JSONResponse
from fastapi.encoders import jsonable_encoder
from typing import Optional, List
from datetime import datetime

from app.models.job import (
    JobSearch, JobResponse, 
    JobCreate, JobUpdate, JobFilter,
    SavedJobResponse
)
from app.models.user import User
from app.services.jobs.job_service import get_job_service
from app.services.intelligence.matching_service import matching_service
from app.api.deps import get_current_user, get_current_active_user, get_db_session as get_db
from app.workers.job_scraper import scrape_jobs_task
import logging

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/search")
async def search_jobs(
    search_request: JobSearch,
    db = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user)
):
    """Search jobs with filters and pagination - returns dict to avoid Pydantic validation issues"""
    
    job_service = get_job_service(db)
    
    try:
        result = await job_service.search_jobs(
            query=search_request.query,
            location=search_request.location,
            filters=search_request.filters,
            page=search_request.page,
            size=search_request.size,
            user_id=str(current_user["_id"]) if current_user else None
        )
        
        # If user is authenticated, add match scores
        if current_user:
            jobs = result.get("jobs", [])
            # Note: matching_service.score_jobs should also work with dicts
            try:
                scored_jobs = await matching_service.score_jobs(current_user, jobs)
                result["jobs"] = scored_jobs
            except Exception as e:
                logger.warning(f"Failed to score jobs: {e}")
                # Continue without scoring
        
        # Return as JSONResponse to avoid FastAPI Pydantic validation
        return JSONResponse(content=result)
        
    except Exception as e:
        logger.error(f"Job search failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Search failed: {str(e)}")


# Literal GET paths are registered before /{job_id}. FastAPI matches in
# registration order, and a one-segment parameter captures a later literal
# on that same segment (for example /featured).
@router.get("/matched/me")
async def get_my_matched_jobs(
    limit: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_active_user),
    db = Depends(get_db)
):
    """Get personalized matched jobs for current user"""
    
    try:
        jobs = await matching_service.get_matched_jobs(
            user=current_user,
            db=db,
            limit=limit
        )
        
        return JSONResponse(content={"jobs": jobs})
    except Exception as e:
        logger.error(f"Failed to get matched jobs: {e}", exc_info=True)
        return JSONResponse(content={"jobs": []})


@router.get("/saved/me")
async def get_saved_jobs(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_active_user),
    db = Depends(get_db)
):
    """Get user's saved jobs"""
    
    job_service = get_job_service(db)
    
    cursor = db.saved_jobs.find(
        {"user_id": str(current_user["_id"])}
    ).sort("saved_at", -1).skip((page - 1) * size).limit(size)
    
    saved_jobs = await cursor.to_list(length=size)
    job_ids = [s["job_id"] for s in saved_jobs]
    
    jobs = []
    for saved_item in saved_jobs:
        job_id = saved_item["job_id"]
        job = await job_service.get_job_by_id(job_id)
        if job:
            # Convert to SavedJobResponse format
            job_dict = job if isinstance(job, dict) else job.dict()
            job_dict["saved_at"] = saved_item["saved_at"]
            job_dict["generated_cv_path"] = saved_item.get("generated_cv_path")
            job_dict["generated_cover_letter_path"] = saved_item.get("generated_cover_letter_path")
            job_dict["generated_cv_id"] = saved_item.get("generated_cv_id")
            job_dict["generated_cover_letter_id"] = saved_item.get("generated_cover_letter_id")
            jobs.append(job_dict)

    
    return JSONResponse(content={"jobs": jsonable_encoder(jobs)})


@router.get("/stats/overview")
async def get_job_stats(
    db = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Get job statistics and analytics"""
    
    from datetime import timedelta
    
    now = datetime.utcnow()
    week_ago = now - timedelta(days=7)
    month_ago = now - timedelta(days=30)
    
    total = await db.jobs.count_documents({"status": "active"})
    
    week_count = await db.jobs.count_documents({
        "status": "active",
        "created_at": {"$gte": week_ago}
    })
    
    month_count = await db.jobs.count_documents({
        "status": "active",
        "created_at": {"$gte": month_ago}
    })
    
    top_companies = await db.jobs.aggregate([
        {"$match": {"status": "active"}},
        {"$group": {"_id": "$company_name", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 10}
    ]).to_list(10)
    
    top_locations = await db.jobs.aggregate([
        {"$match": {"status": "active"}},
        {"$group": {"_id": "$location", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 10}
    ]).to_list(10)
    
    return {
        "total_jobs": total,
        "jobs_this_week": week_count,
        "jobs_this_month": month_count,
        "top_companies": top_companies,
        "top_locations": top_locations
    }


@router.get("/{job_id}")
async def get_job(
    job_id: str,
    db = Depends(get_db)
):
    """Get job details by ID - returns dict"""
    
    job_service = get_job_service(db)
    job = await job_service.get_job_by_id(job_id)
    
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    await job_service.increment_view_count(job_id)
    
    return JSONResponse(content=job)


@router.post("/save/{job_id}")
async def save_job(
    job_id: str,
    data: Optional[dict] = Body(None),
    current_user: User = Depends(get_current_active_user),
    db = Depends(get_db)
):
    """Save/bookmark a job or update saved job details"""
    
    # Check if already saved
    existing = await db.saved_jobs.find_one({
        "user_id": str(current_user["_id"]),
        "job_id": job_id
    })
    
    update_data = {}
    if data:
        if "generated_cv_path" in data:
            update_data["generated_cv_path"] = data["generated_cv_path"]
        if "generated_cover_letter_path" in data:
            update_data["generated_cover_letter_path"] = data["generated_cover_letter_path"]
        if "generated_cv_id" in data:
            update_data["generated_cv_id"] = data["generated_cv_id"]
        if "generated_cover_letter_id" in data:
            update_data["generated_cover_letter_id"] = data["generated_cover_letter_id"]
    
    if existing:
        if update_data:
            await db.saved_jobs.update_one(
                {"_id": existing["_id"]},
                {"$set": update_data}
            )
            return {"message": "Saved job updated", "job_id": job_id}
        return {"message": "Job already saved", "job_id": job_id}
    
    doc = {
        "user_id": str(current_user["_id"]),
        "job_id": job_id,
        "saved_at": datetime.utcnow()
    }
    doc.update(update_data)
    
    await db.saved_jobs.insert_one(doc)
    
    return {"message": "Job saved successfully", "job_id": job_id}


@router.delete("/save/{job_id}")
async def unsave_job(
    job_id: str,
    current_user: User = Depends(get_current_active_user),
    db = Depends(get_db)
):
    """Remove job from saved jobs"""
    
    result = await db.saved_jobs.delete_one({
        "user_id": str(current_user["_id"]),
        "job_id": job_id
    })
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Saved job not found")
    
    return {"message": "Job removed from saved"}


@router.post("/trigger-scrape")
async def trigger_manual_scrape(
    query: str,
    location: str,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_active_user)
):
    """Trigger manual job scraping (authenticated users only)"""
    
    task = scrape_jobs_task.delay(query, location)
    
    return {
        "message": "Scraping task started",
        "task_id": task.id,
        "query": query,
        "location": location
    }


@router.post("/")
async def create_job(
    job_data: JobCreate,
    current_user: User = Depends(get_current_active_user),
    db = Depends(get_db)
):
    """Create a new job posting (admin/employer only)"""
    
    job_service = get_job_service(db)
    
    job_data.posted_by = str(current_user["_id"])
    
    job = await job_service.create_job(job_data)
    
    return JSONResponse(content=job.dict())


@router.put("/{job_id}")
async def update_job(
    job_id: str,
    updates: JobUpdate,
    current_user: User = Depends(get_current_active_user),
    db = Depends(get_db)
):
    """Update job details"""
    
    job_service = get_job_service(db)
    
    # Get existing job
    job = await job_service.get_job_by_id(job_id)
    
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    # Update fields
    update_dict = updates.dict(exclude_unset=True)
    update_dict["updated_at"] = datetime.utcnow()
    
    from bson import ObjectId
    await db.jobs.update_one(
        {"_id": ObjectId(job_id)},
        {"$set": update_dict}
    )
    
    # Get updated job
    updated_job = await job_service.get_job_by_id(job_id)
    
    return JSONResponse(content=updated_job)