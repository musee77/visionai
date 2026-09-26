# backend/app/workers/celery_app.py
"""
Celery configuration for background tasks
"""

from celery import Celery
from celery.schedules import crontab
from app.core.config import settings

celery_app = Celery(
    "job_platform",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
    include=[
        'app.workers.job_scraper',
        'app.workers.email_sender',
        'app.workers.email_monitor',
        'app.workers.notification_scheduler',
        'app.workers.email_campaigns',
        'app.workers.auto_apply'
    ]
)

celery_app.conf.update(
    task_serializer='json',
    accept_content=['json'],
    result_serializer='json',
    timezone='UTC',
    enable_utc=True,
    task_track_started=True,
    task_time_limit=30 * 60,
    task_soft_time_limit=25 * 60,
    worker_prefetch_multiplier=1,
    worker_max_tasks_per_child=1000,
)

celery_app.conf.beat_schedule = {
    # Email monitoring tasks
    'scan-all-inboxes': {
        'task': 'app.workers.email_monitor.scan_all_inboxes',
        'schedule': crontab(minute='*/30'),  # Every 30 minutes
        'args': ()
    },
    'scan-recent-applications': {
        'task': 'app.workers.email_monitor.scan_recent_applications',
        'schedule': crontab(minute='*/15'),  # Every 15 minutes
        'args': ()
    },
    'retry-failed-emails': {
        'task': 'app.workers.email_sender.retry_failed_emails',
        'schedule': crontab(hour=3, minute=30),  # Daily at 3:30 AM
        'args': ()
    },
    # Email campaign tasks (Customer Journey Automation)
    'send-daily-job-digest': {
        'task': 'app.workers.email_campaigns.send_daily_job_digest',
        'schedule': crontab(hour=9, minute=0),  # Daily at 9 AM
        'args': ()
    },
    'send-weekly-summary': {
        'task': 'app.workers.email_campaigns.send_weekly_summary',
        'schedule': crontab(day_of_week=1, hour=10, minute=0),  # Monday 10 AM
        'args': ()
    },
    # Full automation - Auto-apply to matching jobs
    'auto-apply-to-jobs': {
        'task': 'app.workers.auto_apply.auto_apply_to_matching_jobs',
        'schedule': crontab(hour='*/6'),  # Every 6 hours
        'args': ()
    },
    # Hybrid Monitoring - Check status of non-email applications
    'monitor-portal-applications': {
        'task': 'app.workers.auto_apply.monitor_portal_applications',
        'schedule': crontab(hour='*/6'),  # Every 6 hours
        'args': ()
    },
    'weekly-api-job-import': {
        'task': 'app.workers.job_scraper.import_weekly_api_jobs',
        'schedule': crontab(day_of_week=1, hour=2, minute=0),  # Monday at 2 AM UTC
        'args': ()
    },
    'expire-month-old-jobs': {
        'task': 'app.workers.job_scraper.expire_old_jobs_task',
        'schedule': crontab(hour=3, minute=0),  # Daily at 3 AM UTC
        'args': (30,)
    },
}