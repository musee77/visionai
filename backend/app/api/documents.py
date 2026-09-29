"""
Documents API - Simplified for Phase 1 testing
"""

from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Depends
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime

# Simplified imports - only what we need
from app.services.documents.document_service import document_service
from app.dependencies import get_current_active_user
from app.models.user import User
from app.database import get_database
from app.services.core.subscription_service import SubscriptionService

router = APIRouter()


# Pydantic models for API responses
class DocumentResponse(BaseModel):
    id: str
    filename: str
    document_type: str = "cv"
    file_size: int
    upload_date: datetime
    status: str
    cv_data: Optional[Dict[str, Any]] = None
    
    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }


class CVParseResponse(BaseModel):
    success: bool
    document_id: str
    cv_data: Dict[str, Any]
    status: str
    message: str


class DocumentListResponse(BaseModel):
    documents: List[DocumentResponse]
    total: int


# API Endpoints
@router.post("/upload", response_model=CVParseResponse)
async def upload_cv(
    file: UploadFile = File(..., description="CV file (PDF, DOCX, DOC, TXT)"),
    document_type: str = Form("cv"),
    current_user: User = Depends(get_current_active_user)
):
    """
    Upload and parse CV with AI
    """
    try:
        if document_type not in {"cv", "cover_letter"}:
            raise HTTPException(status_code=400, detail="document_type must be cv or cover_letter")

        user_id = str(current_user["_id"])
        if document_type == "cover_letter":
            db = await get_database()
            service = SubscriptionService(db)
            subscription = await service.get_user_subscription(user_id)
            plan = await service.get_plan(subscription.plan_id) if subscription else None
            has_cover_letter_access = plan and (
                plan.metadata.get("entitlement") == "manual_plus"
                or plan.tier.value in {"basic", "premium"}
            )
            if not has_cover_letter_access:
                raise HTTPException(
                    status_code=402,
                    detail="Selecting a cover letter is included on Basic and Premium."
                )
            result = await document_service.process_cover_letter_upload(file, user_id)
        else:
            result = await document_service.process_cv_upload(file, user_id)
        
        return CVParseResponse(
            success=result["success"],
            document_id=result["document_id"],
            cv_data=result["cv_data"],
            status=result["status"],
            message=result["message"]
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Unexpected error during CV upload: {str(e)}"
        )


@router.get("/", response_model=DocumentListResponse)
async def list_documents(
    document_type: Optional[str] = None,
    current_user: User = Depends(get_current_active_user)
):
    """
    List user's documents
    """
    try:
        documents = await document_service.get_user_documents(
            user_id=str(current_user["_id"]),
            document_type=document_type
        )
        
        document_responses = []
        for doc in documents:
            document_responses.append(DocumentResponse(
                id=doc["_id"],
                filename=doc.get("file_info", {}).get("original_filename", "Unknown file"),
                document_type=doc.get("document_type", "cv"),
                file_size=doc.get("file_info", {}).get("file_size", 0),
                upload_date=doc.get("file_info", {}).get("upload_date", datetime.utcnow()),
                status=doc.get("status", "completed"),
                cv_data=doc.get("cv_data")
            ))
        
        return DocumentListResponse(
            documents=document_responses,
            total=len(document_responses)
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch documents: {str(e)}"
        )


@router.get("/{document_id}", response_model=DocumentResponse)
async def get_document(
    document_id: str,
    current_user: User = Depends(get_current_active_user)
):
    """
    Get specific document details
    """
    try:
        document = await document_service.get_document(document_id, str(current_user["_id"]))
        
        if not document:
            raise HTTPException(status_code=404, detail="Document not found")
        
        return DocumentResponse(
            id=document["_id"],
            filename=document.get("file_info", {}).get("original_filename", "Unknown file"),
            document_type=document.get("document_type", "cv"),
            file_size=document.get("file_info", {}).get("file_size", 0),
            upload_date=document.get("file_info", {}).get("upload_date", datetime.utcnow()),
            status=document.get("status", "completed"),
            cv_data=document.get("cv_data")
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch document: {str(e)}"
        )


@router.delete("/{document_id}")
async def delete_document(
    document_id: str,
    current_user: User = Depends(get_current_active_user)
):
    """
    Delete document
    """
    try:
        success = await document_service.delete_document(document_id, str(current_user["_id"]))
        
        if not success:
            raise HTTPException(status_code=404, detail="Document not found")
        
        return {"message": "Document deleted successfully"}
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to delete document: {str(e)}"
        )


@router.post("/{document_id}/reparse")
async def reparse_document(
    document_id: str,
    current_user: User = Depends(get_current_active_user)
):
    """
    Re-parse document with latest AI models
    """
    try:
        # Get document
        document = await document_service.get_document(document_id, str(current_user["_id"]))
        
        if not document:
            raise HTTPException(status_code=404, detail="Document not found")
        
        # Re-process with AI if text content is available
        text_content = document.get("text_content", "")
        if not text_content:
            raise HTTPException(
                status_code=400, 
                detail="Document text content not available for re-parsing"
            )
        
        from app.services.intelligence.ai_service import ai_service
        from app.database import get_database
        
        # Re-parse with AI
        ai_result = await ai_service.process_cv_with_ai(text_content, str(current_user["_id"]))
        
        # Update document in database
        db = await get_database()
        from bson import ObjectId
        
        await db.documents.update_one(
            {"_id": ObjectId(document_id)},
            {
                "$set": {
                    "cv_data": ai_result.get("cv_data", {}),
                    "processing_metadata": ai_result.get("metadata", {}),
                    "status": ai_result.get("status", "completed"),
                    "updated_at": datetime.utcnow()
                }
            }
        )
        
        return {
            "success": True,
            "cv_data": ai_result.get("cv_data", {}),
            "status": ai_result.get("status", "completed"),
            "message": "Document re-parsed successfully"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to re-parse document: {str(e)}"
        )


# Health check endpoint
@router.get("/health")
async def health_check():
    """
    Health check for document processing service
    """
    return {
        "status": "healthy",
        "service": "document-processing",
        "timestamp": datetime.utcnow().isoformat(),
        "features": {
            "cv_parsing": True,
            "ai_integration": True,
            "file_upload": True
        }
    }