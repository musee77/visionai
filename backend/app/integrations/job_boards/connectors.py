"""Unified job-source connectors for external APIs."""

from abc import ABC, abstractmethod
from typing import Any, Dict, List
import logging
from urllib.parse import urlparse

import httpx

from app.models.job import JobCreate

logger = logging.getLogger(__name__)


class JobConnector(ABC):
    """Common interface for external job APIs."""

    name: str

    @abstractmethod
    async def search(self, query: str, location: str, limit: int) -> List[JobCreate]:
        raise NotImplementedError


class GenericApiConnector(JobConnector):
    """Connector for JSON APIs configured through JOB_API_URLS."""

    def __init__(self, url: str) -> None:
        self.url = url
        hostname = urlparse(url).hostname or "api"
        self.name = hostname.replace("www.", "").split(".")[0]

    async def search(self, query: str, location: str, limit: int) -> List[JobCreate]:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.get(
                self.url,
                params={"query": query, "location": location, "limit": limit},
                headers={"Accept": "application/json"},
            )
            response.raise_for_status()
            payload = response.json()

        raw_jobs = payload.get("jobs", []) if isinstance(payload, dict) else payload
        if not isinstance(raw_jobs, list):
            raise ValueError(f"{self.name} API response must be a list or contain a jobs list")

        return [self._normalize(job) for job in raw_jobs[:limit] if isinstance(job, dict)]

    def _normalize(self, raw_job: Dict[str, Any]) -> JobCreate:
        title = raw_job.get("title") or raw_job.get("jobtitle") or raw_job.get("position") or "Untitled job"
        company = raw_job.get("company_name") or raw_job.get("company") or "Unknown company"
        description = raw_job.get("description") or raw_job.get("snippet") or title
        location = raw_job.get("location") or raw_job.get("formattedLocation") or "Remote"
        url = raw_job.get("application_url") or raw_job.get("url") or raw_job.get("external_url")

        return JobCreate(
            title=str(title),
            company_name=str(company),
            location=str(location),
            description=str(description),
            application_url=url,
            external_url=raw_job.get("external_url") or url,
            external_id=str(raw_job.get("id") or raw_job.get("external_id") or url or title),
            source="api",
            skills_required=raw_job.get("skills_required") or raw_job.get("skills") or [],
        )


def build_job_connectors() -> List[JobConnector]:
    """Build enabled connectors from the current application configuration."""
    from app.core.config import settings

    configured_urls = [url.strip() for url in settings.JOB_API_URLS.split(",") if url.strip()]
    if not configured_urls:
        logger.warning("No job APIs configured: set JOB_API_URLS in .env")
    return [GenericApiConnector(url) for url in configured_urls]
