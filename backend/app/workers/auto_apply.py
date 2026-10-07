# backend/app/workers/auto_apply.py
"""
Automatic Job Application Worker
Fully automated job application without user intervention
"""

from app.workers.celery_app import celery_app
from motor.motor_asyncio import AsyncIOMotorClient
from app.core.config import settings
from app.services.documents.cv_customization_service import cv_customization_service
from app.services.emails.email_agent_service import email_agent_service
from app.services.documents.pdf_service import pdf_service
import asyncio
import logging
from datetime import datetime, timedelta
from bson import ObjectId
from typing import List, Dict, Any

logger = logging.getLogger(__name__)


async def get_database():
    """Get database connection"""
    client = AsyncIOMotorClient(settings.MONGODB_URL)
    return client[settings.DATABASE_NAME]


def run_async(coro):
    """Helper to run async functions in Celery tasks"""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


async def calculate_match_score(user_cv, job):
    """
    Calculate match score between user CV and job using AI
    Returns score from 0.0 to 1.0
    """
    try:
        from app.integrations.openai_client import openai_client
        
        # Extract key info from CV
        cv_skills = user_cv.get("skills", [])
        if isinstance(cv_skills, list):
            cv_skills_str = ", ".join(str(x) for x in cv_skills[:20]) # Take top 20
        else:
             cv_skills_str = str(cv_skills)[:500]

        cv_experience = user_cv.get("experience", [])
        
        # Extract job requirements
        job_title = job.get("title", "")
        job_description = job.get("description", "")
        
        raw_requirements = job.get("requirements", "")
        if isinstance(raw_requirements, list):
            # If list of dicts, simplify
            if raw_requirements and isinstance(raw_requirements[0], dict):
                 job_requirements = ", ".join([r.get('requirement', '') for r in raw_requirements])
            else:
                 job_requirements = ", ".join(str(x) for x in raw_requirements)
        else:
            job_requirements = str(raw_requirements)

        # Use OpenAI to calculate match
        prompt = f"""
        Analyze the match between this candidate and job. Return ONLY a number between 0.0 and 1.0.
        
        Candidate Skills: {cv_skills_str}
        Candidate Experience: {str(cv_experience)[:500]}
        
        Job Title: {job_title}
        Job Requirements: {job_requirements[:1000]}
        
        Match Score (0.0-1.0):
        """
        
        # Messages for chat completion
        messages = [{"role": "user", "content": prompt}]
        
        # Use shared async client
        response_content = await openai_client.chat_completion(
            messages=messages,
            max_tokens=10,
            temperature=0.3
        )
        
        score_text = response_content.strip()
        
        # Extract number from response (handle cases like "Score: 0.8")
        import re
        match = re.search(r"0\.\d+|1\.0|0|1", score_text)
        if match:
             score = float(match.group())
        else:
             score = 0.5 # Default fallback
             
        return min(max(score, 0.0), 1.0)  # Clamp between 0 and 1
        
    except Exception as e:
        logger.error(f"Error calculating match score: {e}")
        return 0.0


async def generate_custom_cv(user_cv: Dict, job: Dict) -> str:
    """
    Generate customized CV for specific job using CVCustomizationService
    Returns document ID of generated CV
    """
    try:
        from app.services.documents.cv_customization_service import cv_customization_service
        
        # Prepare job data in expected format
        job_data = {
            "_id": str(job["_id"]),
            "title": job.get("title", ""),
            "company_name": job.get("company_name") or job.get("company") or "",
            "description": job.get("description", ""),
            "requirements": job.get("requirements", []),
            "skills_required": job.get("skills_required", [])
        }
        
        # Generate customized CV
        result = await cv_customization_service.customize_cv_for_job(
            cv_data=user_cv,
            job_data=job_data
        )
        
        if not result.get("success"):
            logger.error(f"Failed to generate custom CV: {result.get('error')}")
            return None
            
        customized_cv = result.get("customized_cv")
        match_score = result.get("job_match_score", 0.0)
        
        # Save customized CV to database using the service's storage method
        # Note: The service has a private _store_generated_cv, but we can replicate the storage logic here
        # or expose a public store method. For now, we'll store it directly to ensure compatibility
        
        # Generate PDF for the customized CV
        try:
            pdf_buffer = await pdf_service.generate_cv_pdf(
                cv_content=customized_cv,
                template="professional",
                user_id=user_cv.get("user_id")
            )
            
            # Save PDF to disk
            file_path = await pdf_service.save_pdf(
                pdf_buffer=pdf_buffer,
                user_id=user_cv.get("user_id"),
                job_id=str(job.get("_id")),
                doc_type="cv"
            )
            logger.info(f"Generated and saved CV PDF at: {file_path}")
        except Exception as pdf_error:
            logger.error(f"Failed to generate CV PDF: {pdf_error}")
            file_path = None

        db = await get_database()
        cv_doc = {
            "user_id": user_cv.get("user_id"),
            "job_id": str(job.get("_id")),
            "type": "customized_cv",
            "content": customized_cv,
            "original_cv_id": user_cv.get("_id"),
            "match_score": match_score,
            "file_path": file_path,  # Critical for email attachment
            "created_at": datetime.utcnow()
        }
        
        insert_result = await db.documents.insert_one(cv_doc)
        return str(insert_result.inserted_id)
        
    except Exception as e:
        logger.error(f"Error generating custom CV: {e}")
        return None


async def generate_cover_letter(user_cv: Dict, job: Dict) -> str:
    """
    Generate customized cover letter for specific job using CoverLetterService
    Returns document ID of generated cover letter
    """
    try:
        from app.services.documents.cover_letter_service import cover_letter_service
        
        # Prepare job data
        job_data = {
            "_id": str(job["_id"]),
            "title": job.get("title", ""),
            "company_name": job.get("company_name") or job.get("company") or "",
            "description": job.get("description", ""),
            "requirements": job.get("requirements", []),
            "skills_required": job.get("skills_required", [])
        }
        
        # Generate cover letter
        result = await cover_letter_service.generate_cover_letter(
            cv_data=user_cv,
            job_data=job_data,
            tone="professional" # Default tone for auto-apply
        )
        
        if not result.get("success"):
            logger.error(f"Failed to generate cover letter: {result.get('error')}")
            return None
            
        cover_letter_data = result.get("cover_letter")
        
        # Extract the full text content nicely
        content_text = cover_letter_data.get("content", {}).get("full_text", "")
        
        # Generate PDF for cover letter
        try:
            pdf_buffer = await pdf_service.generate_cover_letter_pdf(
                letter_content=cover_letter_data,
                template="professional"
            )
            
            # Save PDF to disk
            file_path = await pdf_service.save_pdf(
                pdf_buffer=pdf_buffer,
                user_id=user_cv.get("user_id"),
                job_id=str(job.get("_id")),
                doc_type="cover_letter"
            )
            logger.info(f"Generated and saved Cover Letter PDF at: {file_path}")
        except Exception as pdf_error:
            logger.error(f"Failed to generate Cover Letter PDF: {pdf_error}")
            file_path = None

        # Save cover letter to database
        db = await get_database()
        cover_doc = {
            "user_id": user_cv.get("user_id"),
            "job_id": str(job.get("_id")),
            "type": "cover_letter",
            "content": content_text, # Store text for email sending compatibility
            "structured_content": cover_letter_data, # Store structured for future use
            "file_path": file_path, # Critical for email attachment
            "created_at": datetime.utcnow()
        }
        
        insert_result = await db.documents.insert_one(cover_doc)
        return str(insert_result.inserted_id)
        
    except Exception as e:
        logger.error(f"Error generating cover letter: {e}")
        return None


def _job_apply_url(job: Dict) -> str:
    return job.get("external_url") or job.get("apply_url") or job.get("application_url") or ""


def _blocked_apply_url(url: str) -> bool:
    lowered = (url or "").lower()
    return any(host in lowered for host in ("remoteok.com", "remoteok.io", "linkedin.com", "indeed.com"))


async def _uploaded_cv_id(db, user_id: str):
    ids = [user_id]
    if ObjectId.is_valid(user_id):
        ids.append(ObjectId(user_id))
    document = await db.documents.find_one(
        {"user_id": {"$in": ids}, "document_type": "cv"},
        sort=[("created_at", -1)]
    )
    return str(document["_id"]) if document else None


async def _basic_cover_letter(user_cv: Dict, job: Dict) -> str:
    name = user_cv.get("full_name") or "Applicant"
    title = job.get("title") or "the role"
    company = job.get("company_name") or job.get("company") or "your team"
    text = (
        f"Dear hiring team,\n\n"
        f"I am applying for the {title} role at {company}. "
        f"My CV is attached.\n\n"
        f"Thank you,\n{name}\n"
    )
    db = await get_database()
    result = await db.documents.insert_one({
        "user_id": user_cv.get("user_id"),
        "job_id": str(job.get("_id")),
        "type": "cover_letter",
        "content": text,
        "created_at": datetime.utcnow()
    })
    return str(result.inserted_id)


async def process_auto_apply_for_user(user: Dict, db, task_instance=None) -> Dict:
    """Core logic to process auto-apply for a single user"""
    stats = {
        "jobs_found": 0,
        "jobs_analyzed": 0,
        "matches_found": 0,
        "applications_sent": 0,
        "daily_limit": 0,
        "limit_reached": False,
        "reason": ""
    }
    
    try:
        if task_instance:
            task_instance.update_state(state='PROGRESS', meta={'current': 5, 'total': 100, 'status': 'Initializing user data...'})

        user_id = str(user["_id"])
        tier = str(user.get("subscription_tier") or "free").lower()
        bonus_left = int(user.get("referral_bonus_auto_applications") or 0)
        if tier != "premium" and bonus_left <= 0:
            stats["reason"] = "Auto-apply is included on Premium."
            return {"success": True, "applications_sent": 0, "message": stats["reason"], "stats": stats}
        
        # DEBUG: Inspect user object structure
        logger.info(f"DEBUG: Processing user {user_id}")
        logger.info(f"DEBUG: User keys available: {list(user.keys())}")

        # Get user's CV data (Strategy: 1. User Profile, 2. Latest Document)
        user_cv = user.get("cv_data")
        
        if not user_cv:
            logger.info(f"DEBUG: cv_data not in User profile, checking Documents collection for user {user_id}...")
            # Fallback: Fetch latest CV document
            latest_cv_doc = await db.documents.find_one(
                {"user_id": user_id, "document_type": "cv"},
                sort=[("created_at", -1)]
            )
            
            if latest_cv_doc:
                user_cv = latest_cv_doc.get("cv_data")
                logger.info(f"DEBUG: Found CV data in document {latest_cv_doc.get('_id')}")
        
        if not user_cv:
            logger.error(f"DEBUG: No CV data found in Profile OR Documents for user {user_id}")
            return {"success": False, "error": "No CV data found", "stats": stats}

        user_cv["user_id"] = user_id
        user_cv["full_name"] = user.get("full_name")
        
        # Get user preferences
        preferences = user.get("preferences", {})
        max_daily_applications = preferences.get("max_daily_applications", 5)
        min_match_score = preferences.get("min_match_score", 0.7)
        
        stats["daily_limit"] = max_daily_applications
        
        # Check how many applications sent today
        today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        applications_today = await db.applications.count_documents({
            "user_id": user_id,
            "created_at": {"$gte": today_start},
            "auto_applied": True,
            "status": {"$nin": ["failed", "withdrawn", "awaiting_review"]}
        })
        
        if applications_today >= max_daily_applications:
            logger.info(f"User {user_id} reached daily limit ({max_daily_applications})")
            stats["limit_reached"] = True
            stats["reason"] = f"Daily limit reached ({applications_today}/{max_daily_applications})"
            return {"success": True, "applications_sent": 0, "message": stats["reason"], "stats": stats}
        
        remaining_applications = max_daily_applications - applications_today
        
        if task_instance:
            task_instance.update_state(state='PROGRESS', meta={'current': 10, 'total': 100, 'status': 'Analyzing Profile...'})
        
        logger.info(">>> STARTED: Profile Analysis")
        await asyncio.sleep(1.5) # UX Delay
        logger.info(">>> COMPLETED: Profile Analysis")

        # Find new jobs (not already applied to)
        applied_job_ids = await db.applications.distinct("job_id", {"user_id": user_id})
        
        # Get jobs from last 7 days
        seven_days_ago = datetime.utcnow() - timedelta(days=7)
        exclude_ids = []
        for jid in applied_job_ids:
            try:
                exclude_ids.append(jid if isinstance(jid, ObjectId) else ObjectId(jid))
            except Exception:
                continue
        
        # Get recommended roles using Matching Service (Dynamic)
        from app.services.intelligence.matching_service import matching_service
        suggested_roles_data = await matching_service.get_suggested_roles(user_cv, limit=5)
        recommended_roles = [r["title"] for r in suggested_roles_data]
        
        if task_instance:
             task_instance.update_state(state='PROGRESS', meta={'current': 20, 'total': 100, 'status': f'Identified {len(recommended_roles)} target roles...'})
        
        logger.info(f">>> STARTED: Fetching Target Roles")
        await asyncio.sleep(1.0) # UX Delay
        logger.info(f">>> COMPLETED: Fetching Target Roles (Found: {recommended_roles})")
        logger.info(f"Auto-Apply: Calculated suggested roles for user {user_id}: {recommended_roles}")
            
        new_jobs = []
        
        if recommended_roles:
            if task_instance:
                task_instance.update_state(state='PROGRESS', meta={'current': 30, 'total': 100, 'status': 'Scanning job database...'})
            
            logger.info(">>> STARTED: Job Database Search")
            await asyncio.sleep(1.0) # UX Delay
            
            logger.info(f"Searching email-based jobs for user {user_id} using roles: {recommended_roles}")
            
            # Construct OR query for all roles
            role_conditions = []
            for role in recommended_roles:
                role_conditions.append({"title": {"$regex": role, "$options": "i"}})
                # Optional: also search description if you want broader matches, but title is safer for auto-apply
                # role_conditions.append({"description": {"$regex": role, "$options": "i"}})
            
            # Search the DB
            # Must have SOME email to support email-based application
            email_exists = {
                "$or": [
                    {"application_email": {"$exists": True, "$ne": None}},
                    {"contact_email": {"$exists": True, "$ne": None}},
                    {"email": {"$exists": True, "$ne": None}}, # Legacy
                    {"company_info.contact.email": {"$exists": True, "$ne": None}},
                    {"external_url": {"$exists": True, "$ne": None}},
                    {"apply_url": {"$exists": True, "$ne": None}}
                ]
            }
            
            query = {
                "_id": {"$nin": exclude_ids},
                "status": "active",
                "created_at": {"$gte": seven_days_ago},
                **email_exists
            }
            
            if role_conditions:
                query["$and"] = [{"$or": role_conditions}]

            new_jobs = await db.jobs.find(query).limit(remaining_applications * 10).to_list(length=remaining_applications * 10)
            new_jobs = [job for job in new_jobs if not _blocked_apply_url(_job_apply_url(job)) or job.get("application_email") or job.get("contact_email") or job.get("email")]
            
        else:
            # Fallback to generic recent jobs
            logger.info(f"No specific roles found for user {user_id}, using generic search")
            
            email_exists = {
                "$or": [
                    {"application_email": {"$exists": True, "$ne": None}},
                    {"contact_email": {"$exists": True, "$ne": None}},
                    {"email": {"$exists": True, "$ne": None}},
                    {"company_info.contact.email": {"$exists": True, "$ne": None}},
                    {"external_url": {"$exists": True, "$ne": None}},
                    {"apply_url": {"$exists": True, "$ne": None}}
                ]
            }
            
            new_jobs = await db.jobs.find({
                "_id": {"$nin": exclude_ids},
                "status": "active",
                "created_at": {"$gte": seven_days_ago},
                **email_exists
            }).limit(remaining_applications * 5).to_list(length=remaining_applications * 5)
            new_jobs = [job for job in new_jobs if not _blocked_apply_url(_job_apply_url(job)) or job.get("application_email") or job.get("contact_email") or job.get("email")]
        
        stats["jobs_found"] = len(new_jobs)
        logger.info(f">>> COMPLETED: Job Database Search (Found {len(new_jobs)} jobs)")
        
        if not new_jobs:
            if task_instance:
                task_instance.update_state(state='PROGRESS', meta={'current': 100, 'total': 100, 'status': 'Search complete. No matches.'})
            
            msg = f"No matched jobs found for roles: {', '.join(recommended_roles)}"
            logger.info(msg)
            stats["reason"] = msg
            return {"success": True, "applications_sent": 0, "message": msg, "stats": stats}
        
        if task_instance:
            task_instance.update_state(state='PROGRESS', meta={'current': 40, 'total': 100, 'status': f'Found {len(new_jobs)} potential matches. Analyzing...'})
        
        await asyncio.sleep(1.5) # UX Delay

        # Calculate match scores for all jobs
        job_scores = []
        for job in new_jobs:
            score = await calculate_match_score(user_cv, job)
            stats["jobs_analyzed"] += 1
            if score >= min_match_score:
                job_scores.append((job, score))
        
        stats["matches_found"] = len(job_scores)
        
        # Sort by score and take top matches
        job_scores.sort(key=lambda x: x[1], reverse=True)
        top_matches = job_scores[:remaining_applications]
        
        if not top_matches:
             stats["reason"] = f"Analyzed {len(new_jobs)} jobs, but none passed your {int(min_match_score*100)}% match threshold."
             return {"success": True, "applications_sent": 0, "message": stats["reason"], "stats": stats}

        applications_sent = 0
        total_matches = len(top_matches)
        
        # Apply to each matching job
        for idx, (job, match_score) in enumerate(top_matches):
            application_record_id = None
            try:
                from app.services.core.subscription_service import SubscriptionService
                allowed, _, _ = await SubscriptionService(db).check_usage_limit(str(user_id), "auto_application")
                if not allowed:
                    logger.info(f"User {user_id} has no automated applications left")
                    break

                job_id = str(job["_id"])
                
                company_name = job.get("company_name") or job.get("company") or ""
                recipient_email = (
                    job.get("application_email") or
                    job.get("contact_email") or
                    job.get("email") or
                    (job.get("company_info") or {}).get("contact", {}).get("email")
                )
                apply_url = _job_apply_url(job)
                has_gmail = bool(user.get("gmail_auth"))
                can_email = bool(recipient_email and has_gmail)
                can_browser = bool(apply_url) and not _blocked_apply_url(apply_url)

                if not can_email and not can_browser:
                    logger.warning(
                        f"Skipping job {job_id}: no Gmail path and no apply link."
                    )
                    continue
                
                # Calculate progress
                base_progress = 50
                progress_step = 50 / total_matches
                current_base = base_progress + (idx * progress_step)
                
                if task_instance:
                    task_instance.update_state(state='PROGRESS', meta={
                        'current': int(current_base), 
                        'total': 100, 
                        'status': f'Applying to {job.get("title")}...'
                    })
                
                await asyncio.sleep(1.0) # UX Delay

                logger.info(f"Auto-applying to {job.get('title')} at {company_name} (score: {match_score})")
                
                # Generate custom CV
                if task_instance:
                     task_instance.update_state(state='PROGRESS', meta={
                        'current': int(current_base), 
                        'total': 100, 
                        'status': f'Generating Smart CV for {company_name}...'
                    })
                
                logger.info(f">>> STARTED: Generating Smart CV for {job_id}")
                custom_cv_id = await generate_custom_cv(user_cv, job)
                if not custom_cv_id:
                    custom_cv_id = await _uploaded_cv_id(db, user_id)
                    logger.info(f"Custom CV unavailable, using uploaded CV {custom_cv_id}")
                if not custom_cv_id and not can_browser:
                    logger.error(f"Failed to generate CV for job {job_id}")
                    continue
                logger.info(f">>> COMPLETED: Smart CV Generation (ID: {custom_cv_id})")
                
                await asyncio.sleep(1.0) # UX delay
                
                if task_instance:
                    task_instance.update_state(state='PROGRESS', meta={
                        'current': int(current_base + (progress_step * 0.5)), 
                        'total': 100, 
                        'status': f'Writing personalized cover letter...'
                    })

                # Generate cover letter
                logger.info(f">>> STARTED: Writing Cover Letter for {job_id}")
                cover_letter_id = await generate_cover_letter(user_cv, job)
                if not cover_letter_id:
                    cover_letter_id = await _basic_cover_letter(user_cv, job)
                    logger.info(f"Generated cover letter unavailable, stored a plain letter {cover_letter_id}")
                logger.info(f">>> COMPLETED: Cover Letter Generation (ID: {cover_letter_id})")
                
                await asyncio.sleep(1.0) # UX delay for reading
                
                # Create application record
                channel = "email" if can_email else "browser"
                submission_message = (
                    f"Please find attached my CV and cover letter for the {job.get('title')} position."
                    if channel == "email"
                    else "Your name, email, and phone will be filled on the application form, then the form will be submitted."
                )
                application = {
                    "user_id": user_id,
                    "job_id": job_id,
                    "job_title": job.get("title"),
                    "company_name": company_name,
                    "location": job.get("location"),
                    "status": "awaiting_review",
                    "source": "auto_apply",
                    "auto_applied": True,
                    "email_monitoring_enabled": False,
                    "priority": "medium",
                    "match_score": match_score,
                    "cv_document_id": custom_cv_id,
                    "cover_letter_document_id": cover_letter_id,
                    "review": {
                        "channel": channel,
                        "recipient_email": recipient_email,
                        "apply_url": apply_url,
                        "message": submission_message,
                    },
                    "created_at": datetime.utcnow(),
                    "updated_at": datetime.utcnow(),
                    "deleted_at": None,
                    "timeline": [{
                        "status": "awaiting_review",
                        "timestamp": datetime.utcnow(),
                        "note": f"Ready for review before submission (match score: {match_score:.2f})"
                    }],
                    "documents": [],
                    "communications": [],
                    "interviews": [],
                    "tasks": []
                }
                
                result = await db.applications.insert_one(application)
                application_record_id = result.inserted_id
                await SubscriptionService(db).track_usage(str(user_id), "auto_application")
                await db.applications.update_one(
                    {"_id": application_record_id},
                    {"$set": {"usage_reserved": True}}
                )
                
                if task_instance:
                    task_instance.update_state(state='PROGRESS', meta={
                        'current': int(current_base + (progress_step * 0.9)), 
                        'total': 100, 
                        'status': f'Ready for review: {job.get("title")} at {company_name}'
                    })

                stats["prepared_for_review"] = stats.get("prepared_for_review", 0) + 1
                logger.info(f"Prepared {job_id} for review via {channel}")
                
            except Exception as e:
                logger.error(f"Error auto-applying to job {job.get('_id')}: {e}")
                if application_record_id is not None:
                    await db.applications.update_one(
                        {"_id": application_record_id},
                        {"$set": {
                            "status": "failed",
                            "email_status": "failed",
                            "email_error": str(e),
                            "updated_at": datetime.utcnow()
                        }}
                    )
                continue
        
        if task_instance:
            task_instance.update_state(state='PROGRESS', meta={'current': 100, 'total': 100, 'status': 'Test run complete!'})

        prepared = stats.get("prepared_for_review", 0)
        msg = f"{prepared} applications are ready for review." if prepared else "No applications ready for review."
        if applications_sent:
            msg = f"Sent {applications_sent} applications."
        elif not prepared and stats.get("reason"):
            msg = stats["reason"]

        return {"success": True, "applications_sent": applications_sent, "message": msg, "stats": stats}

    except Exception as e:
        logger.error(f"Error processing user {user.get('_id')}: {e}")
        return {"success": False, "error": str(e), "stats": stats}


@celery_app.task(name="app.workers.auto_apply.auto_apply_to_matching_jobs")
def auto_apply_to_matching_jobs():
    """
    FULL AUTOMATION: Find matching jobs and automatically apply
    Runs every 6 hours
    """
    async def _auto_apply():
        try:
            db = await get_database()
            
            # Get users with auto-apply enabled
            auto_apply_users = await db.users.find({
                "preferences.auto_apply_enabled": True,
                "$or": [
                    {"subscription_tier": "premium"},
                    {"referral_bonus_auto_applications": {"$gt": 0}}
                ]
            }).to_list(length=None)
            
            if not auto_apply_users:
                logger.info("No users with auto-apply enabled")
                return {"success": True, "applications": 0}
            
            total_applications = 0
            
            for user in auto_apply_users:
                # No task instance passed for batch job (or we could bind it too if needed later)
                result = await process_auto_apply_for_user(user, db)
                if result.get("success"):
                    total_applications += result.get("applications_sent", 0)
            
            logger.info(f"Auto-applied to {total_applications} jobs")
            return {"success": True, "applications": total_applications}
            
        except Exception as e:
            logger.error(f"Error in auto_apply_to_matching_jobs: {e}")
            return {"success": False, "error": str(e)}
    
    return run_async(_auto_apply())


@celery_app.task(bind=True, name="app.workers.auto_apply.trigger_single_user_test")
def trigger_single_user_test(self, user_id: str):
    """
    Trigger a single test run for a specific user.
    Calculates matches and applies to jobs immediately.
    """
    async def _run_test():
        try:
            db = await get_database()
            user = await db.users.find_one({"_id": ObjectId(user_id)})
            if not user:
                return {"success": False, "error": "User not found"}
            
            return await process_auto_apply_for_user(user, db, task_instance=self)
            
        except Exception as e:
            logger.error(f"Error in single user test: {e}")
            return {"success": False, "error": str(e)}

    return run_async(_run_test())


@celery_app.task(name="app.workers.auto_apply.enable_auto_apply_for_user")
def enable_auto_apply_for_user(user_id: str, max_daily_applications: int = 5, min_match_score: float = 0.7):
    """
    Enable auto-apply for a specific user
    Can be called from API when user opts in
    """
    async def _enable():
        try:
            db = await get_database()
            
            await db.users.update_one(
                {"_id": ObjectId(user_id)},
                {"$set": {
                    "preferences.auto_apply_enabled": True,
                    "preferences.auto_monitor_enabled": True,  # Coupled with Auto-Apply
                    "preferences.max_daily_applications": max_daily_applications,
                    "preferences.min_match_score": min_match_score,
                    "preferences.auto_apply_enabled_at": datetime.utcnow()
                }}
            )
            
            logger.info(f"Auto-apply enabled for user {user_id}")
            return {"success": True, "user_id": user_id}
            
        except Exception as e:
            logger.error(f"Error enabling auto-apply: {e}")
            return {"success": False, "error": str(e)}
    
    return run_async(_enable())

@celery_app.task(name="app.workers.auto_apply.monitor_browser_application")
def monitor_browser_application(application_id: str):
    """
    Check status of a specific browser-applied job.
    Used for immediate tracking after application.
    """
    async def _monitor():
        try:
            db = await get_database()
            from app.services.automation.automation_service import AutomationService
            
            app = await db.applications.find_one({"_id": ObjectId(application_id)})
            if not app:
                logger.error(f"Application {application_id} not found for monitoring")
                return {"success": False, "error": "Application not found"}
            
            # Resolve URL
            job = await db.jobs.find_one({"_id": app.get("job_id")})
            if not job:
                logger.error(f"Job {app.get('job_id')} not found for monitoring")
                return {"success": False, "error": "Job not found"}
                
            url = job.get("external_url") or job.get("apply_url")
            if not url:
                return {"success": False, "error": "No application URL found"}
                
            logger.info(f"Targeted Monitoring: Checking app {application_id} at {url}")
            
            return await AutomationService.check_application_status(
                application_id=str(application_id),
                user_id=str(app["user_id"]),
                job_url=url
            )
        except Exception as e:
            logger.error(f"Error in monitor_browser_application: {e}")
            return {"success": False, "error": str(e)}

    return run_async(_monitor())

@celery_app.task(name="app.workers.auto_apply.monitor_portal_applications")
def monitor_portal_applications():
    """
    Periodically check status of browser-applied jobs.
    Runs every 6 hours (distinct from email monitoring).
    """
    async def _monitor():
        try:
            db = await get_database()
            from app.services.automation.automation_service import AutomationService
            
            # Find applications that were auto-applied via browser but haven't been checked recently
            check_date = datetime.utcnow() - timedelta(hours=24)
            
            apps_to_check = await db.applications.find({
                "source": "browser_automation", # Updated to match source
                "email_sent_via": {"$exists": False},
                "status": {"$in": ["applied", "submitted", "processing"]},
                "$or": [
                    {"last_response_check": {"$exists": False}},
                    {"last_response_check": {"$lt": check_date}}
                ]
            }).limit(10).to_list(length=10)
            
            results = []
            for app in apps_to_check:
                job = await db.jobs.find_one({"_id": app.get("job_id")})
                if not job: continue
                    
                url = job.get("external_url") or job.get("apply_url")
                if not url: continue
                    
                status_result = await AutomationService.check_application_status(
                    application_id=str(app["_id"]),
                    user_id=str(app["user_id"]),
                    job_url=url
                )
                results.append(status_result)
                
            return {"success": True, "checked": len(results)}
        except Exception as e:
            logger.error(f"Error in monitor_portal_applications: {e}")
            return {"success": False, "error": str(e)}

    return run_async(_monitor())

@celery_app.task(name="app.workers.auto_apply.check_pending_verifications")
def check_pending_verifications():
    """
    Scan all 'pending_verification' applications and attempt to verify them.
    Runs every 5 minutes (configured in celery beat).
    """
    async def _check():
        try:
            db = await get_database()
            # Find apps waiting for verification
            pending_apps = await db.applications.find({
                "status": "pending_verification",
                "verification_portal_domain": {"$exists": True}
            }).to_list(length=20)
            
            results = []
            for app in pending_apps:
                # Trigger the verification task for each
                verify_and_resume_application.delay(str(app["_id"]))
                results.append(str(app["_id"]))
                
            return {"success": True, "triggered_ids": results}
        except Exception as e:
            logger.error(f"Error checking pending verifications: {e}")
            return {"success": False, "error": str(e)}

    return run_async(_check())


@celery_app.task(name="app.workers.auto_apply.verify_and_resume_application")
def verify_and_resume_application(application_id: str):
    """
    Vision AI Extreme Mode: Find link, click it, and resume job application.
    """
    async def _verify():
        try:
            db = await get_database()
            app = await db.applications.find_one({"_id": ObjectId(application_id)})
            if not app or app.get("status") != "pending_verification":
                return {"success": False, "error": "Not in pending_verification"}
            
            user_id = str(app["user_id"])
            domain = app.get("verification_portal_domain")
            
            if not domain:
                logger.warning(f"No domain found for pending verification app {application_id}")
                return {"success": False, "error": "No domain metadata"}
            
            # 1. Look for the link
            link = await email_agent_service.find_verification_link(user_id, domain)
            if not link:
                logger.info(f"Verification link not yet found for {domain} (app: {application_id})")
                return {"success": False, "status": "still_pending"}
            
            # 2. Click the link
            success = await email_agent_service.auto_click_verification_link(link)
            if not success:
                 # It might be a complex link, but we'll try to resume anyway as some GETs fail
                 # but actually verify. Or we can mark it as 'manual_action_required'
                 logger.warning(f"Verification link 'click' returned False for {application_id}")
            
            # 3. Update status and resume
            await db.applications.update_one(
                {"_id": ObjectId(application_id)},
                {
                    "$set": {
                        "status": "pending", # Set back to pending so auto_apply_to_job can take it
                        "automation_status": "in_progress",
                        "verification_link_clicked_at": datetime.utcnow(),
                        "updated_at": datetime.utcnow()
                    },
                    "$push": {
                         "timeline": {
                             "status": "automatically_verified",
                             "timestamp": datetime.utcnow(),
                             "note": "Vision AI Extreme Mode: Automatically extracted and verified email link."
                         }
                    }
                }
            )
            
            # 4. Re-trigger Browser Automation
            from app.services.automation.browser_automation_service import BrowserAutomationService
            
            # Re-trigger the application flow. 
            # BrowserAutomationService.auto_apply_to_job will now find the credentials 
            # (if they were stored during the first attempt) or attempt login.
            await BrowserAutomationService.auto_apply_to_job(
                user_id=user_id,
                job_id=str(app["job_id"]),
                application_id=application_id
            )
            
            logger.info(f"Vision AI Extreme Mode: Successfully verified and resumed application {application_id}")
            return {"success": True, "application_id": application_id}
            
        except Exception as e:
            logger.error(f"Error in verify_and_resume_application for {application_id}: {e}")
            return {"success": False, "error": str(e)}

    return run_async(_verify())
