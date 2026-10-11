"""Monthly allowance for tailored CVs and cover letters.

One job uses one allowance the first time a CV or cover letter succeeds.
Two further successful generations of that same job are included.
A failed generation is not recorded. Selecting an uploaded letter does not
come through this quota.
"""

import hashlib
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

from bson import ObjectId
from fastapi import HTTPException


BASIC_MONTHLY_JOBS = 15
PREMIUM_MONTHLY_JOBS = 100
PREMIUM_DAILY_NEW_JOBS = 10
INCLUDED_REGENERATIONS = 2
MAX_RUNS = 1 + INCLUDED_REGENERATIONS


@dataclass
class QuotaDecision:
    allowed: bool
    message: str = ""
    used: int = 0
    limit: int = 0
    remaining: int = 0
    regeneration: bool = False


def monthly_job_limit(tier: str) -> int:
    tier = (tier or "free").lower()
    if tier == "premium":
        return PREMIUM_MONTHLY_JOBS
    if tier == "basic":
        return BASIC_MONTHLY_JOBS
    return 0


def job_key(
    job_id: Optional[str] = None,
    company_name: Optional[str] = None,
    job_title: Optional[str] = None,
    job_description: Optional[str] = None,
) -> str:
    if job_id:
        return f"job:{job_id}"
    company = " ".join((company_name or "").lower().split())
    title = " ".join((job_title or "").lower().split())
    if company or title:
        return f"paste:{company}|{title}"
    digest = hashlib.sha256((job_description or "").strip().lower().encode()).hexdigest()[:16]
    return f"paste:{digest}"


def _run_field(kind: str) -> str:
    if kind == "cv":
        return "cv_runs"
    if kind == "letter":
        return "letter_runs"
    raise ValueError(f"Unknown customization kind: {kind}")


class CustomizationQuota:
    async def period_start(self, db, user_id: str) -> datetime:
        clauses = [{"user_id": user_id}]
        if ObjectId.is_valid(user_id):
            clauses.append({"user_id": ObjectId(user_id)})
        subscription = await db.subscriptions.find_one({"$or": clauses})
        start = (subscription or {}).get("current_period_start")
        if isinstance(start, datetime):
            return start
        now = datetime.utcnow()
        return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    async def summary(self, db, user_id: str, tier: str) -> dict:
        tier = (tier or "free").lower()
        limit = monthly_job_limit(tier)
        start = await self.period_start(db, user_id)
        used = await db.customization_jobs.count_documents({
            "user_id": user_id,
            "period_start": start,
        })
        daily_limit = PREMIUM_DAILY_NEW_JOBS if tier == "premium" else 0
        daily_new = 0
        if daily_limit:
            day_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
            daily_new = await db.customization_jobs.count_documents({
                "user_id": user_id,
                "period_start": start,
                "created_at": {"$gte": day_start},
            })
        return {
            "used": used,
            "limit": limit,
            "remaining": max(0, limit - used),
            "daily_new": daily_new,
            "daily_limit": daily_limit,
        }

    async def check(self, db, user_id: str, tier: str, key: str, kinds: list) -> QuotaDecision:
        tier = (tier or "free").lower()
        limit = monthly_job_limit(tier)
        start = await self.period_start(db, user_id)
        used = await db.customization_jobs.count_documents({
            "user_id": user_id,
            "period_start": start,
        })
        remaining = max(0, limit - used)
        existing = await db.customization_jobs.find_one({
            "user_id": user_id,
            "job_key": key,
            "period_start": start,
        })

        if limit <= 0:
            return QuotaDecision(
                allowed=False,
                message="Customizing a CV and a cover letter are included on Basic and Premium.",
                used=used,
                limit=limit,
                remaining=0,
            )

        if existing:
            for kind in kinds:
                runs = int(existing.get(_run_field(kind)) or 0)
                if runs >= MAX_RUNS:
                    label = "CV" if kind == "cv" else "cover letter"
                    return QuotaDecision(
                        allowed=False,
                        message=(
                            f"This job already includes {INCLUDED_REGENERATIONS} {label} regenerations. "
                            "You can tailor it again when your plan renews."
                        ),
                        used=used,
                        limit=limit,
                        remaining=remaining,
                        regeneration=True,
                    )
            return QuotaDecision(
                allowed=True,
                used=used,
                limit=limit,
                remaining=remaining,
                regeneration=True,
            )

        if used >= limit:
            if tier == "basic":
                message = (
                    f"You've used {BASIC_MONTHLY_JOBS} tailored jobs on Basic. "
                    f"Upgrade to Premium for {PREMIUM_MONTHLY_JOBS} a month."
                )
            else:
                message = (
                    f"You've used {PREMIUM_MONTHLY_JOBS} tailored jobs this billing period. "
                    "The allowance renews with your plan."
                )
            return QuotaDecision(False, message, used, limit, 0)

        if tier == "premium":
            day_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
            daily_new = await db.customization_jobs.count_documents({
                "user_id": user_id,
                "period_start": start,
                "created_at": {"$gte": day_start},
            })
            if daily_new >= PREMIUM_DAILY_NEW_JOBS:
                return QuotaDecision(
                    allowed=False,
                    message=(
                        f"Premium includes {PREMIUM_DAILY_NEW_JOBS} new tailored jobs a day. "
                        "You can tailor more tomorrow."
                    ),
                    used=used,
                    limit=limit,
                    remaining=remaining,
                )

        return QuotaDecision(True, "", used, limit, remaining)

    async def require(self, db, user_id: str, tier: str, key: str, kinds: list) -> QuotaDecision:
        decision = await self.check(db, user_id, tier, key, kinds)
        if not decision.allowed:
            raise HTTPException(status_code=403, detail=decision.message)
        return decision

    async def record(self, db, user_id: str, key: str, kind: str) -> None:
        field = _run_field(kind)
        other = "letter_runs" if field == "cv_runs" else "cv_runs"
        start = await self.period_start(db, user_id)
        now = datetime.utcnow()
        await db.customization_jobs.update_one(
            {"user_id": user_id, "job_key": key, "period_start": start},
            {
                "$setOnInsert": {
                    "created_at": now,
                    other: 0,
                },
                "$inc": {field: 1},
                "$set": {"updated_at": now},
            },
            upsert=True,
        )


customization_quota = CustomizationQuota()
