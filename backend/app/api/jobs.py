# backend/app/api/jobs.py
"""
Job-related API endpoints
"""

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Query, Body, File, Form, UploadFile
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
import re
from pathlib import Path

logger = logging.getLogger(__name__)

_ROLE_WORDS = (
    "engineer", "developer", "designer", "manager", "analyst", "specialist",
    "consultant", "architect", "lead", "director", "officer", "coordinator",
    "assistant", "nurse", "teacher", "accountant", "marketer", "writer",
    "scientist", "technician", "administrator", "representative",
)
_SKILL_TERMS = (
    "python", "javascript", "typescript", "react", "node", "java", "sql",
    "excel", "sales", "marketing", "figma", "aws", "docker", "kubernetes",
    "accounting", "customer service", "project management", "data analysis",
    "photoshop", "seo", "nursing", "teaching", "recruitment", "finance",
    "product management", "ux", "ui", "c++", "c#", "php", "golang", "swift",
)

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


def _profile_from_cv_text(text: str, job_title: Optional[str]) -> tuple:
    """Pull a short role and skill list from CV text. Nothing is stored."""
    lines = [re.sub(r"\s+", " ", line).strip() for line in text.splitlines() if line.strip()]
    title = (job_title or "").strip()[:80]
    if not title:
        for line in lines[:25]:
            lowered = line.lower()
            if "@" in line or not (4 < len(line) < 70):
                continue
            if any(word in lowered for word in _ROLE_WORDS):
                title = line
                break

    lowered_text = text.lower()
    skills = [
        skill for skill in _SKILL_TERMS
        if re.search(rf"\b{re.escape(skill)}\b", lowered_text)
    ]

    skills_heading = re.search(r"skills?\s*[:\n](.{0,400})", text, flags=re.IGNORECASE)
    if skills_heading:
        for part in re.split(r"[,•|\n]", skills_heading.group(1)):
            token = part.strip(" .-–—")
            if 2 < len(token) < 40 and token.lower() not in skills:
                skills.append(token)
            if len(skills) >= 12:
                break

    return title, skills[:12]


@router.post("/match-cv")
async def match_jobs_from_cv(
    file: UploadFile = File(...),
    job_title: Optional[str] = Form(None),
    location: Optional[str] = Form(None),
    db=Depends(get_db),
):
    """Match live jobs to an uploaded CV without saving the file."""
    from app.services.documents.document_service import document_service

    filename = file.filename or ""
    extension = Path(filename).suffix.lower()
    if extension not in {".pdf", ".docx", ".doc", ".txt"}:
        raise HTTPException(status_code=400, detail="Upload a PDF, DOCX, or TXT file")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="The CV file is empty")
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File size must be less than 10MB")

    try:
        text = document_service._extract_text(content, extension)
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("CV text extraction failed: %s", exc)
        raise HTTPException(status_code=400, detail="Could not read that CV. Try a text-based PDF, DOCX, or TXT file.")

    title, skills = _profile_from_cv_text(text[:20000], job_title)
    search_terms = []
    if title:
        search_terms.append(title)
    search_terms.extend(skills[:4])

    job_service = get_job_service(db)
    found = {}
    relaxed = False

    async def collect(query: Optional[str], search_location: Optional[str]):
        safe_query = re.escape(query) if query else None
        result = await job_service.search_jobs(
            query=safe_query,
            location=search_location or None,
            page=1,
            size=20,
        )
        for job in result.get("jobs", []):
            if hasattr(job, "model_dump"):
                payload = job.model_dump(mode="json")
            elif hasattr(job, "dict"):
                payload = job.dict()
            else:
                payload = dict(job)
            job_id = str(payload.get("id") or payload.get("_id") or "")
            if job_id:
                found[job_id] = payload

    place = (location or "").strip() or None
    for term in search_terms or [None]:
        await collect(term, place)

    if not found and place:
        relaxed = True
        for term in search_terms or [None]:
            await collect(term, None)

    if not found:
        relaxed = True
        await collect(None, None)

    cv_data = {
        "skills": skills,
        "experience": [{"title": title}] if title else [],
    }
    ranked = []
    for job in found.values():
        score = matching_service._calculate_simple_match_score(cv_data, job)
        if title or skills:
            job["match_score"] = round(score, 2)
            job["cv_matched"] = True
        ranked.append(job)

    ranked.sort(key=lambda job: job.get("match_score") or 0, reverse=True)

    return JSONResponse(content=jsonable_encoder({
        "jobs": ranked[:40],
        "query": title or (skills[0] if skills else ""),
        "matched": bool(title or skills),
        "relaxed": relaxed and bool(search_terms),
    }))


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