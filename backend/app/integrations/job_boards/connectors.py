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


class RemoteOKConnector(JobConnector):
    """Public RemoteOK JSON API. No key required."""

    name = "remoteok"

    async def search(self, query: str, location: str, limit: int) -> List[JobCreate]:
        from app.integrations.job_boards.remoteok_client import RemoteOKClient

        client = RemoteOKClient()
        broad = not query or query.strip().lower() in {"jobs", "job", "remote"}
        raw_jobs = await client.search_jobs(query=None if broad else query, limit=limit)
        jobs: List[JobCreate] = []
        for raw_job in raw_jobs:
            try:
                jobs.append(client.normalize_job(raw_job))
            except Exception as exc:
                logger.warning("Skipping RemoteOK job: %s", exc)
        return jobs


def build_job_connectors() -> List[JobConnector]:
    """Company career pages first, then RemoteOK and any JOB_API_URLS."""
    from app.core.config import settings
    from app.integrations.job_boards.company_apply import CompanyApplyConnector

    connectors: List[JobConnector] = [CompanyApplyConnector(), RemoteOKConnector()]
    configured_urls = [url.strip() for url in settings.JOB_API_URLS.split(",") if url.strip()]
    connectors.extend(GenericApiConnector(url) for url in configured_urls)
    return connectors
