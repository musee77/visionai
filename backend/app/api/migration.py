"""
Quick migration endpoint to fix existing applications
Run this once via: curl http://localhost:8000/api/v1/migrate-applications
"""
from fastapi import APIRouter, Depends
from app.database import get_database
from app.api.deps import require_admin
from datetime import datetime

router = APIRouter()

@router.post("/migrate-applications")
async def migrate_applications(
    db = Depends(get_database),
    current_admin = Depends(require_admin),
):
    """Add deleted_at field to all applications missing it"""
    
    # Find applications without deleted_at field
    missing_deleted_at = await db.applications.count_documents({"deleted_at": {"$exists": False}})
    
    if missing_deleted_at > 0:
        # Add deleted_at: None to all applications missing it
        result = await db.applications.update_many(
            {"deleted_at": {"$exists": False}},
            {"$set": {
                "deleted_at": None,
                "updated_at": datetime.utcnow()
            }}
        )
        updated_count = result.modified_count
    else:
        updated_count = 0
    
    # Add other missing fields
    migrations = {}
    
    # Add empty arrays for missing list fields
    for field in ["documents", "communications", "interviews", "tasks", "timeline"]:
        missing = await db.applications.count_documents({field: {"$exists": False}})
        if missing > 0:
            result = await db.applications.update_many(
                {field: {"$exists": False}},
                {"$set": {field: []}}
            )
            migrations[field] = result.modified_count
    
    # Add priority if missing
    missing_priority = await db.applications.count_documents({"priority": {"$exists": False}})
    if missing_priority > 0:
        result = await db.applications.update_many(
            {"priority": {"$exists": False}},
            {"$set": {"priority": "medium"}}
        )
        migrations["priority"] = result.modified_count
    
    # Verify
    total = await db.applications.count_documents({})
    with_deleted_at = await db.applications.count_documents({"deleted_at": {"$exists": True}})
    
    return {
        "success": True,
        "total_applications": total,
        "applications_with_deleted_at": with_deleted_at,
        "deleted_at_added": updated_count,
        "other_migrations": migrations
    }
