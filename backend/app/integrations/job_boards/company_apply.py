"""Company career APIs whose links open the employer's application page."""

import asyncio
import logging
import re
from typing import List, Optional

import httpx

from app.integrations.job_boards.connectors import JobConnector
from app.models.job import EmploymentType, JobCreate, JobSource, WorkArrangement

logger = logging.getLogger(__name__)

# Public board tokens. Each job's apply link is the company or ATS application page.
GREENHOUSE_BOARDS = [
    "stripe",
    "gitlab",
    "discord",
    "figma",
    "airbnb",
    "mongodb",
    "elastic",
    "datadog",
    "duolingo",
    "brex",
    "dropbox",
    "asana",
    "intercom",
]

LEVER_BOARDS = [
    ("palantir", "Palantir"),
    ("spotify", "Spotify"),
]

BROAD_QUERIES = {"", "jobs", "job", "remote"}
GENERIC_LOCATIONS = {"", "remote", "worldwide", "anywhere", "global"}


class CompanyApplyConnector(JobConnector):
    """Greenhouse and Lever boards. No API key."""

    name = "company_apply"

    async def search(self, query: str, location: str, limit: int) -> List[JobCreate]:
        per_board = max(4, min(12, limit))
        headers = {"User-Agent": "Mozilla/5.0", "Accept": "application/json"}
        async with httpx.AsyncClient(timeout=12.0, headers=headers, follow_redirects=True) as client:
            tasks = [
                self._greenhouse(client, board, query, location, per_board)
                for board in GREENHOUSE_BOARDS
            ]
            tasks.extend(
                self._lever(client, board, company, query, location, per_board)
                for board, company in LEVER_BOARDS
            )
            groups = await asyncio.gather(*tasks, return_exceptions=True)

        for group in groups:
            if isinstance(group, Exception):
                logger.warning("Company apply board failed: %s", group)

        mixed: List[JobCreate] = []
        pools = [group for group in groups if isinstance(group, list) and group]
        while len(mixed) < limit and pools:
            next_pools = []
            for pool in pools:
                mixed.append(pool.pop(0))
                if pool and len(mixed) < limit:
                    next_pools.append(pool)
                if len(mixed) >= limit:
                    break
            pools = next_pools
        return mixed

    async def _greenhouse(
        self,
        client: httpx.AsyncClient,
        board: str,
        query: str,
        location: str,
        limit: int,
    ) -> List[JobCreate]:
        response = await client.get(f"https://boards-api.greenhouse.io/v1/boards/{board}/jobs")
        response.raise_for_status()
        raw_jobs = response.json().get("jobs") or []
        jobs: List[JobCreate] = []
        for raw_job in raw_jobs:
            if len(jobs) >= limit:
                break
            if not _matches(raw_job.get("title"), raw_job.get("company_name"), query):
                continue
            place = ((raw_job.get("location") or {}).get("name") or "").strip()
            if not _location_ok(place, location):
                continue
            url = raw_job.get("absolute_url")
            if not url:
                continue
            company = (raw_job.get("company_name") or board).strip() or board
            title = (raw_job.get("title") or "Open role").strip()
            try:
                jobs.append(_build_job(
                    title=title,
                    company=company,
                    location=place or "See company page",
                    description=_description(title, company, place),
                    url=url,
                    external_id=f"greenhouse:{board}:{raw_job.get('id')}",
                ))
            except Exception as exc:
                logger.warning("Skipping Greenhouse job %s: %s", raw_job.get("id"), exc)
        return jobs

    async def _lever(
        self,
        client: httpx.AsyncClient,
        board: str,
        company: str,
        query: str,
        location: str,
        limit: int,
    ) -> List[JobCreate]:
        response = await client.get(f"https://api.lever.co/v0/postings/{board}", params={"mode": "json"})
        response.raise_for_status()
        raw_jobs = response.json()
        if not isinstance(raw_jobs, list):
            return []
        jobs: List[JobCreate] = []
        for raw_job in raw_jobs:
            if len(jobs) >= limit:
                break
            title = (raw_job.get("text") or "").strip()
            if not _matches(title, company, query):
                continue
            categories = raw_job.get("categories") or {}
            place = (categories.get("location") or "").strip()
            if not _location_ok(place, location):
                continue
            url = raw_job.get("applyUrl") or raw_job.get("hostedUrl")
            if not url:
                continue
            description = _plain(raw_job.get("descriptionPlain")) or _description(title, company, place)
            commitment = (categories.get("commitment") or "").lower()
            employment = EmploymentType.FULL_TIME
            if "part" in commitment:
                employment = EmploymentType.PART_TIME
            elif "contract" in commitment or "intern" in commitment:
                employment = EmploymentType.CONTRACT if "contract" in commitment else EmploymentType.INTERNSHIP
            try:
                jobs.append(_build_job(
                    title=title or "Open role",
                    company=company,
                    location=place or "See company page",
                    description=description,
                    url=url,
                    external_id=f"lever:{board}:{raw_job.get('id')}",
                    employment_type=employment,
                ))
            except Exception as exc:
                logger.warning("Skipping Lever job %s: %s", raw_job.get("id"), exc)
        return jobs


def _matches(title: Optional[str], company: Optional[str], query: Optional[str]) -> bool:
    text = (query or "").strip().lower()
    if text in BROAD_QUERIES:
        return True
    haystack = f"{title or ''} {company or ''}".lower()
    return text in haystack


def _location_ok(place: str, location: Optional[str]) -> bool:
    wanted = (location or "").strip().lower()
    if wanted in GENERIC_LOCATIONS:
        return True
    place_text = (place or "").lower()
    return wanted in place_text or "remote" in place_text


def _description(title: str, company: str, place: str) -> str:
    where = place or "the company careers site"
    return f"{title} at {company}. Location: {where}. Apply on the company page."


def _plain(value: Optional[str]) -> str:
    text = re.sub(r"\s+", " ", value or "").strip()
    return text[:5000]


def _arrangement(title: str, location: str) -> WorkArrangement:
    text = f"{title} {location}".lower()
    if "remote" in text:
        return WorkArrangement.REMOTE
    if "hybrid" in text:
        return WorkArrangement.HYBRID
    return WorkArrangement.ON_SITE


def _build_job(
    title: str,
    company: str,
    location: str,
    description: str,
    url: str,
    external_id: str,
    employment_type: EmploymentType = EmploymentType.FULL_TIME,
) -> JobCreate:
    if len(description.strip()) < 10:
        description = _description(title, company, location)
    return JobCreate(
        title=title[:200],
        company_name=company[:100],
        location=location[:200],
        description=description[:5000],
        employment_type=employment_type,
        work_arrangement=_arrangement(title, location),
        application_url=url,
        external_url=url,
        source=JobSource.COMPANY_WEBSITE,
        external_id=str(external_id),
    )
