# backend/app/database.py
"""
CVision Database Configuration
"""

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo import IndexModel, ASCENDING, DESCENDING, TEXT
import logging
from typing import Optional

from app.core.config import settings

logger = logging.getLogger(__name__)


class Database:
    client: Optional[AsyncIOMotorClient] = None
    database: Optional[AsyncIOMotorDatabase] = None


db = Database()


async def get_database() -> AsyncIOMotorDatabase:
    """Get CVision database instance"""
    return db.database


async def init_database():
    """Initialize CVision database connection and create indexes"""
    try:
        # Create MongoDB client
        db.client = AsyncIOMotorClient(
            settings.MONGODB_URL,
            maxPoolSize=10,
            minPoolSize=1,
            maxIdleTimeMS=30000,
            serverSelectionTimeoutMS=5000
        )
        
        # Get CVision database
        db.database = db.client[settings.DATABASE_NAME]
        
        # Test connection
        await db.client.admin.command('ping')
        logger.info(f"Successfully connected to CVision database: {settings.DATABASE_NAME}")
        
        # DEBUG: Check jobs count at startup
        jobs_count = await db.database.jobs.count_documents({})
        active_jobs_count = await db.database.jobs.count_documents({"status": "active"})
        logger.info(f"[DEBUG] Database startup - Total jobs: {jobs_count}, Active jobs: {active_jobs_count}")
        
        # Create indexes for CVision collections
        await create_cvision_indexes()
        
    except Exception as e:
        logger.error(f"Failed to connect to CVision database: {e}")
        raise


async def close_database_connection():
    """Close CVision database connection"""
    if db.client:
        db.client.close()
        logger.info("CVision database connection closed")


async def create_cvision_indexes():
    """Create indexes for CVision collections"""
    try:
        # Users collection indexes
        users_indexes = [
            IndexModel([("email", ASCENDING)], unique=True, name="email_unique"),
            IndexModel([("referral_code", ASCENDING)], unique=True, name="referral_code_unique"),
            IndexModel([("created_at", DESCENDING)], name="created_at_desc"),
            IndexModel([("subscription_tier", ASCENDING)], name="subscription_tier"),
            IndexModel([("is_active", ASCENDING)], name="is_active")
        ]
        await db.database.users.create_indexes(users_indexes)
        
        # Documents collection indexes
        documents_indexes = [
            IndexModel([("user_id", ASCENDING), ("document_type", ASCENDING)], name="user_document_type"),
            IndexModel([("created_at", DESCENDING)], name="created_at_desc"),
            IndexModel([("is_active", ASCENDING)], name="is_active")
        ]
        await db.database.documents.create_indexes(documents_indexes)
        
        # Jobs collection indexes (for future use)
        jobs_indexes = [
            IndexModel([("title", TEXT), ("description", TEXT), ("company", TEXT)], name="job_text_search"),
            IndexModel([("location", ASCENDING)], name="location"),
            IndexModel([("posted_date", DESCENDING)], name="posted_date_desc"),
            IndexModel([("status", ASCENDING)], name="status"),
            IndexModel([("skills_required", ASCENDING)], name="skills_required")
        ]
        await db.database.jobs.create_indexes(jobs_indexes)
        
        # Applications collection indexes (for future use)
        applications_indexes = [
            IndexModel([("user_id", ASCENDING), ("applied_date", DESCENDING)], name="user_applied_date"),
            IndexModel([("job_id", ASCENDING)], name="job_id"),
            IndexModel([("status", ASCENDING)], name="status"),
            IndexModel([("user_id", ASCENDING), ("job_id", ASCENDING)], unique=True, name="user_job_unique")
        ]
        await db.database.applications.create_indexes(applications_indexes)
        
        logger.info("CVision database indexes created successfully")
        
    except Exception as e:
        logger.error(f"Failed to create CVision indexes: {e}")
        raise

    # Add these indexes to your existing create_cvision_indexes() function

    # Phase 2: Enhanced Jobs collection indexes
    jobs_indexes_phase2 = [
        IndexModel([("external_id", ASCENDING)], name="external_id"),
        IndexModel([("source", ASCENDING)], name="source"),
        IndexModel([("source", ASCENDING), ("external_id", ASCENDING)], unique=True, sparse=True, name="source_external_unique"),
        IndexModel([("status", ASCENDING), ("created_at", DESCENDING)], name="status_created"),
        IndexModel([("work_arrangement", ASCENDING)], name="work_arrangement"),
        IndexModel([("employment_type", ASCENDING)], name="employment_type"),
        IndexModel([("created_at", ASCENDING)], expireAfterSeconds=7776000, name="ttl_90days")  # Auto-delete after 90 days
    ]
    await db.database.jobs.create_indexes(jobs_indexes_phase2)

    # Phase 2: Saved jobs collection indexes
    saved_jobs_indexes = [
        IndexModel([("user_id", ASCENDING), ("job_id", ASCENDING)], unique=True, name="user_job_unique"),
        IndexModel([("user_id", ASCENDING), ("saved_at", DESCENDING)], name="user_saved_date"),
        IndexModel([("saved_at", DESCENDING)], name="saved_at_desc")
    ]
    await db.database.saved_jobs.create_indexes(saved_jobs_indexes)

    # Phase 2: Job matches collection indexes
    job_matches_indexes = [
        IndexModel([("user_id", ASCENDING), ("job_id", ASCENDING)], name="user_job_match"),
        IndexModel([("match_score", DESCENDING)], name="match_score_desc"),
        IndexModel([("created_at", DESCENDING)], name="created_at_desc")
    ]
    await db.database.job_matches.create_indexes(job_matches_indexes)

    # Phase 2: Job alerts collection indexes
    job_alerts_indexes = [
        IndexModel([("user_id", ASCENDING)], name="user_id"),
        IndexModel([("is_active", ASCENDING)], name="is_active"),
        IndexModel([("last_sent", DESCENDING)], name="last_sent_desc")
    ]
    await db.database.job_alerts.create_indexes(job_alerts_indexes)

    logger.info("Phase 2 job indexes created successfully")

    # Subscriptions indexes
    subscriptions_indexes = [
        IndexModel([("user_id", ASCENDING)], unique=True, name="user_id_unique"),
        IndexModel([("stripe_subscription_id", ASCENDING)], name="stripe_subscription_id"),
        IndexModel([("status", ASCENDING)], name="status"),
        IndexModel([("current_period_end", ASCENDING)], name="current_period_end")
    ]
    await db.database.subscriptions.create_indexes(subscriptions_indexes)

    # One person can refer many friends, so the share code is not unique here.
    try:
        await db.database.referrals.drop_index("referral_code_unique")
    except Exception:
        pass

    referrals_indexes = [
        IndexModel([("referrer_user_id", ASCENDING)], name="referrer_user_id"),
        IndexModel([("referrer_code", ASCENDING)], name="referrer_code"),
        IndexModel([("referral_code", ASCENDING)], name="referral_code"),
        IndexModel([("referee_email", ASCENDING)], name="referee_email"),
        IndexModel([("status", ASCENDING)], name="status")
    ]
    await db.database.referrals.create_indexes(referrals_indexes)

    # Usage events indexes
    usage_indexes = [
        IndexModel([("user_id", ASCENDING), ("timestamp", DESCENDING)], name="user_timestamp"),
        IndexModel([("subscription_id", ASCENDING)], name="subscription_id"),
        IndexModel([("event_type", ASCENDING)], name="event_type")
    ]
    await db.database.usage_events.create_indexes(usage_indexes)

    # Notifications collection indexes
    notifications_indexes = [
        IndexModel([("user_id", ASCENDING), ("is_read", ASCENDING)], name="user_read_status"),
        IndexModel([("user_id", ASCENDING), ("created_at", DESCENDING)], name="user_created"),
        IndexModel([("type", ASCENDING)], name="notification_type"),
        IndexModel([("created_at", ASCENDING)], expireAfterSeconds=7776000, name="ttl_90days")
    ]
    await db.database.notifications.create_indexes(notifications_indexes)

    # Application timeline indexes
    timeline_indexes = [
        IndexModel([("user_id", ASCENDING), ("timeline.timestamp", DESCENDING)], name="user_timeline"),
        IndexModel([("follow_up_date", ASCENDING)], name="follow_up_date"),
        IndexModel([("response_deadline", ASCENDING)], name="response_deadline")
    ]
    await db.database.applications.create_indexes(timeline_indexes)


# Collection getters
async def get_users_collection():
    """Get CVision users collection"""
    return db.database.users


async def get_documents_collection():
    """Get CVision documents collection"""
    return db.database.documents


async def get_jobs_collection():
    """Get CVision jobs collection"""
    return db.database.jobs

async def get_applications_collection():
    """Get CVision applications collection"""
    return db.database.applications

async def get_subscriptions_collection():
    """Get subscriptions collection"""
    db = await get_database()
    return db.subscriptions

async def get_usage_tracking_collection():
    """Get usage tracking collection"""
    db = await get_database()
    return db.usage_tracking