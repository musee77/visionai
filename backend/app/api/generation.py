# backend/app/api/generation.py
"""
Content Generation API - Phase 3
Endpoints for CV customization, cover letter generation, and PDF creation
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime
import logging

from app.models.user import User
from app.api.deps import get_current_active_user
from app.database import get_database
from app.services.documents.cv_customization_service import cv_customization_service
from app.services.documents.cover_letter_service import cover_letter_service
from app.services.documents.pdf_service import pdf_service
from bson import ObjectId

logger = logging.getLogger(__name__)

router = APIRouter()


# Request/Response Models
class CVCustomizationRequest(BaseModel):
    document_id: str = Field(..., description="CV document ID")
    job_id: str = Field(..., description="Job posting ID")
    template: Optional[str] = Field("professional", description="PDF template style")
    include_cover_letter: bool = Field(True, description="Generate cover letter too")
    cover_letter_tone: Optional[str] = Field("professional", description="Cover letter tone")


class BatchCustomizationRequest(BaseModel):
    document_id: str
    job_ids: List[str] = Field(..., max_items=10, description="Max 10 jobs at once")
    template: Optional[str] = "professional"


class GenerationResponse(BaseModel):
    success: bool
    message: str
    cv_document_id: Optional[str] = None
    cover_letter_id: Optional[str] = None
    cv_pdf_url: Optional[str] = None
    cover_letter_pdf_url: Optional[str] = None
    match_score: Optional[float] = None


class BatchGenerationResponse(BaseModel):
    success: bool
    results: List[GenerationResponse]
    total_generated: int
    failed_count: int


class RegenerationRequest(BaseModel):
    document_id: str
    feedback: str = Field(..., min_length=10, max_length=500)


@router.post("/customize-cv", response_model=GenerationResponse)
async def customize_cv_for_job(
    request: CVCustomizationRequest,
    current_user: Dict[str, Any] = Depends(get_current_active_user)
):
    """
    Generate customized CV and optionally cover letter for a specific job
    
    - Checks subscription limits
    - Customizes CV content using AI
    - Generates cover letter if requested
    - Creates PDF documents
    - Returns download URLs
    """
    try:
        user_id = str(current_user["_id"])
        db = await get_database()
        
        # Customize and cover letters start on Basic
        subscription_tier = current_user.get("subscription_tier", "free")
        if str(subscription_tier).lower() not in {"basic", "premium"}:
            raise HTTPException(
                status_code=403,
                detail="Customizing a CV and selecting a cover letter are included on Basic and Premium."
            )
        if not await _check_generation_limit(user_id, subscription_tier, db):
            raise HTTPException(
                status_code=403,
                detail="Generation limit reached for your subscription tier. Please upgrade."
            )
        
        # Get CV document
        cv_doc = await db.documents.find_one({
            "_id": ObjectId(request.document_id),
            "user_id": user_id
        })
        
        if not cv_doc:
            raise HTTPException(status_code=404, detail="CV document not found")
        
        # Get cv_data and handle different formats
        cv_data = cv_doc.get("cv_data")
        
        # Handle if cv_data is stored as JSON string
        if isinstance(cv_data, str):
            import json
            try:
                cv_data = json.loads(cv_data)
            except json.JSONDecodeError:
                raise HTTPException(
                    status_code=400,
                    detail="CV data is corrupted. Please re-upload your CV."
                )
        
        # Ensure cv_data is a dict and not empty
        if not cv_data or not isinstance(cv_data, dict):
            raise HTTPException(
                status_code=400,
                detail="CV has not been parsed yet. Please re-upload or re-parse your CV."
            )
        
        # Get job details
        job = await db.jobs.find_one({"_id": ObjectId(request.job_id)})
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        
        # Customize CV
        cv_result = await cv_customization_service.customize_cv_for_job(
            cv_data=cv_data,
            job_data=job
        )
        
        # Handle if cv_result is not a dict (shouldn't happen, but defensive programming)
        if not isinstance(cv_result, dict):
            logger.error(f"cv_result is not a dict: {type(cv_result)}, value: {cv_result}")
            raise HTTPException(
                status_code=500,
                detail=f"CV customization failed: Invalid response type"
            )
        
        if not cv_result.get("success"):
            error_msg = cv_result.get('error', 'Unknown error')
            logger.error(f"CV customization failed: {error_msg}")
            raise HTTPException(
                status_code=500,
                detail=f"CV customization failed: {error_msg}"
            )
        
        customized_cv = cv_result["customized_cv"]
        match_score = cv_result["job_match_score"]
        
        # Debug logging
        logger.info(f"customized_cv type: {type(customized_cv)}")
        logger.info(f"customized_cv keys: {customized_cv.keys() if isinstance(customized_cv, dict) else 'NOT A DICT'}")
        
        # Generate CV PDF
        should_watermark = subscription_tier == "free"
        cv_pdf = await pdf_service.generate_cv_pdf(
            cv_content=customized_cv,
            template=request.template,
            watermark=should_watermark,
            user_id=user_id
        )
        
        # Save CV PDF
        cv_pdf_path = await pdf_service.save_pdf(
            cv_pdf,
            user_id,
            request.job_id,
            "cv"
        )
        cv_pdf_url = await pdf_service.get_pdf_url(cv_pdf_path)
        
        # Store customized CV
        cv_doc_id = await cv_customization_service._store_generated_cv(
            user_id=user_id,
            job_id=request.job_id,
            customized_cv=customized_cv,
            match_score=match_score
        )
        
        # Update with PDF URL
        await db.generated_documents.update_one(
            {"_id": ObjectId(cv_doc_id)},
            {"$set": {"pdf_url": cv_pdf_url}}
        )
        
        cover_letter_id = None
        cover_letter_pdf_url = None
        
        # Generate cover letter if requested
        if request.include_cover_letter:
            letter_result = await cover_letter_service.generate_cover_letter(
                cv_data=customized_cv,
                job_data=job,
                tone=request.cover_letter_tone
            )
            
            if letter_result["success"]:
                letter_data = letter_result["cover_letter"]
                
                # Generate cover letter PDF
                letter_pdf = await pdf_service.generate_cover_letter_pdf(
                    letter_content=letter_data,
                    template=request.template,
                    watermark=should_watermark
                )
                
                # Save cover letter PDF
                letter_pdf_path = await pdf_service.save_pdf(
                    letter_pdf,
                    user_id,
                    request.job_id,
                    "cover_letter"
                )
                cover_letter_pdf_url = await pdf_service.get_pdf_url(letter_pdf_path)
                
                # Store cover letter
                cover_letter_id = await cover_letter_service.store_generated_letter(
                    user_id=user_id,
                    job_id=request.job_id,
                    letter_data=letter_data,
                    tone=request.cover_letter_tone
                )
                
                # Update with PDF URL
                await db.generated_documents.update_one(
                    {"_id": ObjectId(cover_letter_id)},
                    {"$set": {"pdf_url": cover_letter_pdf_url}}
                )
        
        # Track usage
        await _track_generation_usage(user_id, db)
        
        return GenerationResponse(
            success=True,
            message="Documents generated successfully",
            cv_document_id=cv_doc_id,
            cover_letter_id=cover_letter_id,
            cv_pdf_url=cv_pdf_url,
            cover_letter_pdf_url=cover_letter_pdf_url,
            match_score=match_score
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Generation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/batch-customize", response_model=BatchGenerationResponse)
async def batch_customize_cvs(
    request: BatchCustomizationRequest,
    current_user: User = Depends(get_current_active_user)
):
    """
    Generate customized CVs for multiple jobs in batch
    
    - Max 10 jobs per request
    - Premium feature (Basic/Premium tiers only)
    """
    try:
        user_id = str(current_user["_id"])
        subscription_tier = current_user.get("subscription_tier", "free")
        
        # Check if user has access to batch generation
        if subscription_tier == "free":
            raise HTTPException(
                status_code=403,
                detail="Batch generation requires Basic or Premium subscription"
            )
        
        db = await get_database()
        
        # Get CV document
        cv_doc = await db.documents.find_one({
            "_id": ObjectId(request.document_id),
            "user_id": user_id
        })
        
        if not cv_doc:
            raise HTTPException(status_code=404, detail="CV document not found")
        
        cv_data = cv_doc.get("cv_data", {})
        
        # Get all jobs
        jobs = []
        for job_id in request.job_ids:
            job = await db.jobs.find_one({"_id": ObjectId(job_id)})
            if job:
                jobs.append(job)
        
        if not jobs:
            raise HTTPException(status_code=404, detail="No valid jobs found")
        
        # Generate customized CVs
        results = await cv_customization_service.generate_multiple_versions(
            cv_data=cv_data,
            jobs=jobs,
            user_id=user_id
        )
        
        # Convert to response format
        response_results = []
        success_count = 0
        
        for result in results:
            if result.get("success"):
                success_count += 1
                
                # Generate PDF if successful
                should_watermark = subscription_tier == "free"
                try:
                    cv_pdf = await pdf_service.generate_cv_pdf(
                        cv_content=result["customized_cv"],
                        template=request.template,
                        watermark=should_watermark,
                        user_id=user_id
                    )
                    
                    cv_pdf_path = await pdf_service.save_pdf(
                        cv_pdf,
                        user_id,
                        result["job_id"],
                        "cv"
                    )
                    cv_pdf_url = await pdf_service.get_pdf_url(cv_pdf_path)
                    
                    # Update document with PDF URL
                    await db.generated_documents.update_one(
                        {"_id": ObjectId(result["document_id"])},
                        {"$set": {"pdf_url": cv_pdf_url}}
                    )
                    
                except Exception as e:
                    logger.error(f"PDF generation failed for job {result['job_id']}: {e}")
                    cv_pdf_url = None
            else:
                cv_pdf_url = None
            
            response_results.append(GenerationResponse(
                success=result.get("success", False),
                message=result.get("message", "Generated"),
                cv_document_id=result.get("document_id"),
                cv_pdf_url=cv_pdf_url,
                match_score=result.get("job_match_score")
            ))
        
        # Track usage
        for _ in range(success_count):
            await _track_generation_usage(user_id, db)
        
        return BatchGenerationResponse(
            success=True,
            results=response_results,
            total_generated=success_count,
            failed_count=len(results) - success_count
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Batch generation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/download/{document_id}")
async def download_generated_document(
    document_id: str,
    doc_type: str = Query(..., description="cv or cover_letter"),
    current_user: User = Depends(get_current_active_user)
):
    """
    Download generated PDF document
    """
    try:
        user_id = str(current_user["_id"])
        db = await get_database()
        
        # Get document
        doc = await db.generated_documents.find_one({
            "_id": ObjectId(document_id),
            "user_id": user_id,
            "type": doc_type.replace("_", " ") if doc_type == "cover_letter" else "customized_cv"
        })
        
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")
        
        pdf_url = doc.get("pdf_url")
        if not pdf_url:
            raise HTTPException(status_code=404, detail="PDF not available")
        
        # Return PDF file
        from pathlib import Path
        filename = Path(pdf_url).name
        filepath = Path(settings.UPLOAD_DIR) / filename
        
        if not filepath.exists():
            raise HTTPException(status_code=404, detail="PDF file not found")
        
        return StreamingResponse(
            open(filepath, "rb"),
            media_type="application/pdf",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Download failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/regenerate-cover-letter", response_model=GenerationResponse)
async def regenerate_cover_letter(
    request: RegenerationRequest,
    current_user: User = Depends(get_current_active_user)
):
    """
    Regenerate cover letter with user feedback
    """
    try:
        user_id = str(current_user["_id"])
        
        result = await cover_letter_service.regenerate_with_feedback(
            document_id=request.document_id,
            user_id=user_id,
            feedback=request.feedback
        )
        
        if not result["success"]:
            raise HTTPException(status_code=500, detail=result.get("error", "Regeneration failed"))
        
        return GenerationResponse(
            success=True,
            message="Cover letter regenerated successfully",
            cover_letter_id=result["document_id"]
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Regeneration failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/history")
async def get_generation_history(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    doc_type: Optional[str] = Query(None, description="Filter by document type"),
    current_user: User = Depends(get_current_active_user)
):
    """
    Get user's generation history
    """
    try:
        user_id = str(current_user["_id"])
        db = await get_database()
        
        query = {"user_id": user_id}
        if doc_type:
            query["type"] = doc_type
        
        cursor = db.generated_documents.find(query).sort(
            "generated_at", -1
        ).skip((page - 1) * size).limit(size)
        
        documents = await cursor.to_list(length=size)
        total = await db.generated_documents.count_documents(query)
        
        # Convert ObjectId to string
        for doc in documents:
            doc["_id"] = str(doc["_id"])
            if doc.get("job_id"):
                # Get job title
                job = await db.jobs.find_one({"_id": ObjectId(doc["job_id"])})
                doc["job_title"] = job.get("title") if job else "Unknown"
        
        return {
            "documents": documents,
            "total": total,
            "page": page,
            "size": size,
            "pages": (total + size - 1) // size
        }
        
    except Exception as e:
        logger.error(f"Failed to fetch history: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# Helper functions
async def _check_generation_limit(user_id: str, tier: str, db) -> bool:
    """Check if user has remaining generations"""
    from app.core.config import settings
    
    # Get usage this month
    now = datetime.utcnow()
    start_of_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    
    usage_count = await db.usage_tracking.count_documents({
        "user_id": user_id,
        "action": "generation",
        "timestamp": {"$gte": start_of_month}
    })
    
    # Check limits based on tier
    if tier == "free":
        return usage_count < settings.FREE_TIER_MONTHLY_ATTEMPTS
    elif tier == "basic":
        return usage_count < settings.BASIC_TIER_MONTHLY_ATTEMPTS
    elif tier == "premium":
        return usage_count < settings.PREMIUM_TIER_MONTHLY_ATTEMPTS
    
    return False


async def _track_generation_usage(user_id: str, db):
    """Track generation usage"""
    await db.usage_tracking.insert_one({
        "user_id": user_id,
        "action": "generation",
        "timestamp": datetime.utcnow()
    })