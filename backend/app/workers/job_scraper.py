# backend/app/workers/job_scraper.py
"""
Celery tasks for job scraping and maintenance
"""

from app.workers.celery_app import celery_app
from app.database import get_database
from app.services.jobs.job_service import get_job_service
from app.services.core.cache_service import cache_service
import logging
import asyncio
import random
from app.core.config import settings

logger = logging.getLogger(__name__)


@celery_app.task(name="app.workers.job_scraper.scrape_jobs_task")
def scrape_jobs_task(query: str, location: str, sources: list = None):
    """Background task to scrape jobs from multiple sources"""
    
    if sources is None:
        sources = ["indeed", "linkedin"]
    
    async def _scrape():
        db = await get_database()
        job_service = get_job_service(db)
        
        try:
            jobs = await job_service.aggregate_from_sources(
                query=query,
                location=location,
                limit=50
            )
            
            if jobs:
                count = await job_service.bulk_create_jobs(jobs)
                logger.info(f"Scraped and saved {count} jobs for '{query}' in {location}")
                return count
            
            return 0
            
        except Exception as e:
            logger.error(f"Scraping task error: {e}")
            return 0
        finally:
            await job_service.cleanup()
    loop = asyncio.get_event_loop()
    result = loop.run_until_complete(_scrape())
    
    return result


@celery_app.task(name="app.workers.job_scraper.import_weekly_api_jobs")
def import_weekly_api_jobs():
    """Import a randomized weekly number of jobs from every configured API."""

    async def _import():
        db = await get_database()
        job_service = get_job_service(db)
        minimum = max(1, settings.JOB_WEEKLY_MIN_POSTS)
        maximum = max(minimum, settings.JOB_WEEKLY_MAX_POSTS)
        total_inserted = 0

        for connector in job_service.job_connectors:
            requested = random.randint(minimum, maximum)
            try:
                jobs = await connector.search(
                    query="jobs",
                    location="remote",
                    limit=requested,
                )
                inserted = await job_service.bulk_create_jobs(jobs)
                total_inserted += inserted
                logger.info(
                    "Weekly API import: %s returned %s and inserted %s jobs (target %s)",
                    connector.name,
                    len(jobs),
                    inserted,
                    requested,
                )
            except Exception as error:
                logger.error("Weekly API import failed for %s: %s", connector.name, error)

        return total_inserted
    loop = asyncio.get_event_loop()
    return loop.run_until_complete(_import())


@celery_app.task(name="app.workers.job_scraper.expire_old_jobs_task")
def expire_old_jobs_task(days: int = 30):
    """Mark active jobs older than the retention period as expired."""
    
    async def _expire():
        db = await get_database()
        job_service = get_job_service(db)
        
        try:
            count = await job_service.expire_old_jobs(days=days)
            logger.info(f"Expired {count} old jobs")
            return count
        except Exception as e:
            logger.error(f"Expire jobs error: {e}")
            return 0
    
    loop = asyncio.get_event_loop()
    return loop.run_until_complete(_expire())


@celery_app.task(name="app.workers.job_scraper.clean_cache_task")
def clean_cache_task():
    """Clean expired cache entries"""
    
    async def _clean():
        try:
            count = await cache_service.clear_pattern("jobs_search:*")
            logger.info(f"Cleaned {count} cache entries")
            return count
        except Exception as e:
            logger.error(f"Cache cleaning error: {e}")
            return 0
    
    loop = asyncio.get_event_loop()
    return loop.run_until_complete(_clean())