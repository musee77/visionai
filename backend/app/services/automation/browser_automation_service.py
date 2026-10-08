# backend/app/services/automation/browser_automation_service.py
"""
Browser Automation Service - Integration with Node.js Playwright Microservice
Handles automated browser-based form filling and job application submission
"""

import asyncio
import base64
import hashlib
import logging
import httpx
from pathlib import Path
from typing import Dict, Any, Optional
from datetime import datetime
from bson import ObjectId
from cryptography.fernet import Fernet

from app.database import get_database
from app.core.config import settings
from app.services.core.subscription_service import SubscriptionService

logger = logging.getLogger(__name__)

# Browser automation service URL (from docker-compose or config)
BROWSER_AUTOMATION_URL = getattr(settings, 'BROWSER_AUTOMATION_URL')


def _secret_box() -> Fernet:
    digest = hashlib.sha256(settings.JWT_SECRET_KEY.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def _encrypt_secret(value: str) -> str:
    return _secret_box().encrypt(value.encode()).decode()


def _decrypt_secret(value: str) -> str:
    if not value:
        return ""
    try:
        return _secret_box().decrypt(value.encode()).decode()
    except Exception:
        return value


def _upload_path(file_path: str) -> str:
    if not file_path:
        return ""
    path = Path(file_path)
    if path.is_absolute():
        return str(path)
    return str(Path(settings.UPLOAD_DIR) / path)


class BrowserAutomationService:
    """
    Service for automating job applications using Node.js browser automation microservice
    
    Architecture:
    - Python backend orchestrates the workflow
    - Node.js service handles actual Playwright browser automation
    - Communication via HTTP REST API
    """
    
    @staticmethod
    async def auto_apply_to_job(
        user_id: str,
        application_id: str,
        job_id: str,
        cv_id: Optional[str] = None,
        usage_type: str = "auto_application"
    ) -> Dict[str, Any]:
        """
        Automate job application submission via Node.js browser automation service
        
        Workflow:
        1. Loads user CV and profile data from database
        2. Gets job application URL
        3. Calls Node.js automation service with prepared data
        4. Node.js service opens browser, fills forms, submits
        5. Updates application status based on result
        
        Args:
            user_id: User ID performing the application
            application_id: Application record ID
            job_id: Job ID to apply for
            cv_id: Optional specific CV ID to use
            
        Returns:
            Dict with automation result and status
        """
        try:
            logger.info(f"Starting browser auto-apply for user {user_id}, job {job_id}")
            
            db = await get_database()
            
            # Step 1: Get job details
            job = await db.jobs.find_one({"_id": ObjectId(job_id)})
            if not job:
                raise ValueError(f"Job {job_id} not found")
            
            application_url = job.get("application_url") or job.get("external_url") or job.get("apply_url")
            if not application_url:
                raise ValueError("Job has no application URL")
            
            # Step 2: Get user's CV and profile data
            user = await db.users.find_one({"_id": ObjectId(user_id)})
            if not user:
                raise ValueError(f"User {user_id} not found")
            
            # Get user's latest CV or specific CV
            logger.info(f"Looking up CV data for user {user_id}, specific cv_id: {cv_id}")
            cv_data = await BrowserAutomationService._get_user_cv_data(user_id, cv_id)
            if not cv_data:
                logger.error(f"Failed to find CV data for user {user_id} (cv_id: {cv_id})")
                raise ValueError("User has no CV uploaded or CV is not yet analyzed")

            existing_application = await db.applications.find_one({"_id": ObjectId(application_id)})
            previous_status = (existing_application or {}).get("status")
            cover_letter = ""
            if (existing_application or {}).get("auto_applied"):
                cover_letter = await BrowserAutomationService._document_text(
                    db, (existing_application or {}).get("cover_letter_document_id")
                )
            resume_file_path = cv_data.get("resume_file_path") or await BrowserAutomationService._resume_file_path(
                db, (existing_application or {}).get("cv_document_id"), user_id
            )
            
            # Step 3: Update application status to "processing"
            await db.applications.update_one(
                {"_id": ObjectId(application_id)},
                {
                    "$set": {
                        "status": "processing",
                        "automation_status": "in_progress",
                        "automation_started_at": datetime.utcnow(),
                        "updated_at": datetime.utcnow()
                    }
                }
            )
            
            # Step 3.5: Check for existing portal credentials
            credentials = None
            try:
                from urllib.parse import urlparse
                domain = urlparse(application_url).netloc
                if domain.startswith("www."):
                    domain = domain[4:]
                
                credentials = await BrowserAutomationService._get_user_portal_credentials(user_id, domain)
                if credentials:
                    logger.info(f"Found existing credentials for {domain}")
                    stored_password = credentials.get("password") or credentials.get("password_encrypted") or ""
                    credentials = {
                        "email": credentials.get("username") or credentials.get("email"),
                        "username": credentials.get("username") or credentials.get("email"),
                        "password": _decrypt_secret(stored_password),
                    }
            except Exception as e:
                logger.warning(f"Failed to lookup credentials: {e}")

            gmail = user.get("gmail_auth") or {}
            connected_email = gmail.get("email_address") or ""
            is_premium = str(user.get("subscription_tier") or "").lower() == "premium"
            personal_info = BrowserAutomationService._personal_info(cv_data, user)
            if connected_email:
                personal_info["email"] = connected_email

            # Step 4: Call Node.js browser automation service
            automation_result = await BrowserAutomationService._call_browser_automation_service(
                application_url=application_url,
                user_data={
                    "personal_info": personal_info,
                    "experience": cv_data.get("experience", []),
                    "education": cv_data.get("education", []),
                    "skills": cv_data.get("skills", {}),
                    "connected_email": connected_email,
                    "cover_letter": cover_letter or "",
                    "resume_file_path": resume_file_path or "",
                    "user_id": user_id,
                    "job_id": job_id,
                },
                job_data={
                    "title": job.get("title"),
                    "company": job.get("company_name"),
                    "location": job.get("location")
                },
                application_id=application_id,
                credentials=credentials,
                auto_create_account=bool(is_premium and connected_email)
            )
            
            # Step 6: Update application with result
            status_update = {}
            if automation_result.get("success"):
                result_status = automation_result.get("status")
                
                # Check for newly created credentials (auto-account creation)
                new_credentials = automation_result.get("new_credentials")
                if new_credentials:
                    logger.info(f"Received new portal credentials for domain {new_credentials.get('domain')}")
                    await BrowserAutomationService._store_portal_credentials(
                        user_id=user_id,
                        portal_name=new_credentials.get("portal_name"),
                        domain=new_credentials.get("domain"),
                        username=new_credentials.get("username"),
                        password=new_credentials.get("password")
                    )

                if result_status == "needs_authentication" or result_status == "login_required" or result_status == "manual_action_required":
                    platform = BrowserAutomationService.detect_application_platform(application_url)
                    
                    if platform == "remoteok":
                        logger.warning(f"RemoteOK login wall detected for job {job_id}. Deleting application and job records.")
                        
                        # Delete application
                        await db.applications.delete_one({"_id": ObjectId(application_id)})
                        
                        # Delete job
                        await db.jobs.delete_one({"_id": ObjectId(job_id)})
                        
                        return {
                            "success": False,
                            "status": "deleted",
                            "message": "RemoteOK job requires login. Record deleted from database.",
                            "timestamp": datetime.utcnow().isoformat()
                        }
                    
                    # For other platforms, standard blocked status update
                    if result_status == "needs_authentication" or result_status == "login_required":
                        status_update = {
                            "status": "needs_authentication",
                            "automation_status": "blocked",
                            "automation_error": "Login required for this portal"
                        }
                    else: # manual_action_required
                        status_update = {
                            "status": "manual_action_required",
                            "automation_status": "blocked",
                            "automation_error": "Captcha or manual login required"
                        }
                elif result_status == "pending_verification":
                    status_update = {
                        "status": "pending_verification",
                        "automation_status": "blocked",
                        "automation_error": "Waiting for email verification link",
                        "verification_portal_domain": automation_result.get("verification_domain")
                    }
                elif result_status == "started":
                    status_update = {
                        "status": "processing",
                        "automation_status": "started",
                        "automation_details": automation_result,
                        "usage_type": usage_type # Store for later tracking on completion
                    }
                    logger.info(f"Browser auto-apply session {application_id} started successfully in background.")
                else:
                    # Extract domain for email monitoring
                    from urllib.parse import urlparse
                    app_domain = urlparse(application_url).netloc
                    if app_domain.startswith("www."):
                        app_domain = app_domain[4:]
                    
                    # Check if user qualifies for email monitoring:
                    # 1. Has Gmail connected, OR
                    # 2. Has active paid subscription
                    enable_email_monitoring = False
                    try:
                        # Check Gmail connection
                        gmail_connected = user.get("gmail_connected", False) or user.get("gmail_credentials") is not None
                        
                        # Check subscription status
                        subscription_tier = user.get("subscription_tier", "free")
                        has_paid_subscription = subscription_tier in ["basic", "premium", "enterprise"]
                        
                        enable_email_monitoring = gmail_connected or has_paid_subscription
                        logger.info(f"Email monitoring eligibility - Gmail: {gmail_connected}, Paid: {has_paid_subscription}, Enabled: {enable_email_monitoring}")
                    except Exception as e:
                        logger.warning(f"Failed to check email monitoring eligibility: {e}")
                    
                    status_update = {
                        "status": "applied",
                        "automation_status": "completed",
                        "automation_completed_at": datetime.utcnow(),
                        "applied_date": datetime.utcnow(),
                        "automation_details": automation_result,
                        "application_url": application_url,
                        "application_domain": app_domain,  # For email monitoring
                        "email_monitoring_enabled": enable_email_monitoring,
                    }
                    logger.info(f"Browser auto-apply successful for application {application_id}, domain: {app_domain}, email_monitoring: {enable_email_monitoring}")
                    
                    
                    # Immediately trigger monitoring to verify status and catch automation effects
                    from app.workers.auto_apply import monitor_browser_application
                    monitor_browser_application.delay(application_id)

                    if not (existing_application or {}).get("usage_reserved"):
                        subscription_service = SubscriptionService(db)
                        await subscription_service.track_usage(user_id, usage_type)
                        logger.info(f"Usage tracked for user {user_id} ({usage_type}) after IMMEDIATE successful application.")
            else:
                status_update = {
                    "status": "pending",
                    "automation_status": "failed",
                    "automation_error": automation_result.get("error"),
                }
                logger.error(f"Browser auto-apply failed for application {application_id}: {automation_result.get('error')}")
            
            sent = bool(
                automation_result.get("success")
                and automation_result.get("status") == "completed"
            )
            if previous_status == "awaiting_review" and not sent:
                status_update["status"] = "awaiting_review"
                status_update["automation_status"] = "failed"
                status_update["automation_error"] = automation_result.get("error") or "The application was not submitted"

            status_update["updated_at"] = datetime.utcnow()
            await db.applications.update_one(
                {"_id": ObjectId(application_id)},
                {"$set": status_update}
            )
            
            return automation_result
            
        except Exception as e:
            logger.error(f"Error in browser auto_apply_to_job: {str(e)}")
            
            # Update application with error
            try:
                db = await get_database()
                await db.applications.update_one(
                    {"_id": ObjectId(application_id)},
                    {
                        "$set": {
                            "status": "pending",
                            "automation_status": "failed",
                            "automation_error": str(e),
                            "updated_at": datetime.utcnow()
                        }
                    }
                )
            except Exception as db_error:
                logger.error(f"Failed to update application after error: {db_error}")
            
            return {
                "success": False,
                "error": str(e),
                "timestamp": datetime.utcnow().isoformat()
            }
    
    
    @staticmethod
    def _cv_payload(document: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        if not document:
            return None
        data = document.get("cv_data") if isinstance(document.get("cv_data"), dict) else None
        if not data and isinstance(document.get("content"), dict):
            data = document.get("content")
        if not isinstance(data, dict) or not data:
            return None
        payload = dict(data)
        if document.get("file_path"):
            payload["resume_file_path"] = _upload_path(document.get("file_path"))
        return payload

    @staticmethod
    async def _document_text(db, document_id: Optional[str]) -> str:
        if not document_id or not ObjectId.is_valid(str(document_id)):
            return ""
        document = await db.documents.find_one({"_id": ObjectId(str(document_id))})
        if not document:
            document = await db.generated_documents.find_one({"_id": ObjectId(str(document_id))})
        if not document:
            return ""
        content = document.get("content")
        if isinstance(content, str):
            return content
        if isinstance(content, dict):
            nested = content.get("content")
            if isinstance(nested, dict):
                nested_text = nested.get("full_text") or nested.get("text") or ""
                if str(nested_text).strip():
                    return str(nested_text)
            return content.get("full_text") or content.get("text") or content.get("summary") or ""
        return document.get("text_content") or ""

    @staticmethod
    async def _resume_file_path(db, document_id: Optional[str], user_id: str) -> str:
        document = None
        if document_id and ObjectId.is_valid(str(document_id)):
            document = await db.documents.find_one({"_id": ObjectId(str(document_id))})
            if not document:
                document = await db.generated_documents.find_one({"_id": ObjectId(str(document_id))})
        if document and document.get("file_path"):
            return _upload_path(document.get("file_path"))
        latest = await db.documents.find_one(
            {"user_id": {"$in": [user_id, ObjectId(user_id)] if ObjectId.is_valid(user_id) else [user_id]}, "document_type": "cv"},
            sort=[("created_at", -1)]
        )
        if latest and latest.get("file_path"):
            return _upload_path(latest.get("file_path"))
        return ""

    @staticmethod
    async def _get_user_cv_data(user_id: str, cv_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """
        Get user's CV data (optionally by specific ID)
        
        Args:
            user_id: User ID
            cv_id: Optional specific CV document ID
            
        Returns:
            Dict with CV data or None
        """
        try:
            db = await get_database()
            
            # Handle both string and ObjectId for user_id to be robust
            user_id_obj = None
            try:
                user_id_obj = ObjectId(user_id)
            except:
                pass
                
            user_ids = [user_id]
            if user_id_obj:
                user_ids.append(user_id_obj)

            if cv_id and ObjectId.is_valid(cv_id):
                chosen = await db.documents.find_one({"_id": ObjectId(cv_id)})
                if not chosen:
                    chosen = await db.generated_documents.find_one({"_id": ObjectId(cv_id)})
                parsed = BrowserAutomationService._cv_payload(chosen)
                if parsed:
                    return parsed

            query = {
                "user_id": {"$in": user_ids},
                "document_type": "cv",
                "cv_data": {"$exists": True, "$ne": None}
            }
            
            logger.info(f"CV Query: {query}")
                
            # Find document
            cv_doc = await db.documents.find_one(
                query,
                sort=[("upload_date", -1), ("created_at", -1)]
            )
            
            if not cv_doc:
                logger.warning(f"No CV found with complete parsed data")
                if cv_id:
                    exists = await db.documents.find_one({"_id": ObjectId(cv_id)})
                    if exists:
                        logger.warning(f"Document {cv_id} exists but missing/null cv_data or wrong user/type")
                    else:
                        logger.error(f"Document {cv_id} NOT FOUND in database")
                return None
            
            logger.info(f"Successfully found CV data for document {cv_doc.get('_id')}")
            return BrowserAutomationService._cv_payload(cv_doc) or cv_doc.get("cv_data")
            
        except Exception as e:
            logger.error(f"Error getting CV data: {str(e)}")
            return None

    @staticmethod
    def _personal_info(cv_data: Dict[str, Any], user: Dict[str, Any]) -> Dict[str, Any]:
        from app.services.emails.email_agent_service import EmailAgentService
        facts = EmailAgentService.profile_facts(user)
        cv_data = cv_data or {}
        cv_personal = cv_data.get("personal_info") or {}
        if not facts["name"]:
            cv_name = (cv_personal.get("name") or cv_data.get("full_name") or "").strip()
            parts = cv_name.split()
            facts["name"] = cv_name
            if parts and not facts["first_name"]:
                facts["first_name"] = parts[0]
                facts["last_name"] = " ".join(parts[1:])
        if not facts["phone"]:
            facts["phone"] = cv_personal.get("phone") or ""
        if not facts["location"]:
            facts["location"] = cv_personal.get("location") or ""
        if not facts["linkedin"]:
            facts["linkedin"] = cv_personal.get("linkedin") or ""
            facts["linkedin_url"] = facts["linkedin"]
        if not facts["github"]:
            facts["github"] = cv_personal.get("github") or ""
            facts["github_url"] = facts["github"]
        if not facts["portfolio"]:
            facts["portfolio"] = cv_personal.get("portfolio") or ""
            facts["portfolio_url"] = facts["portfolio"]
        return facts

    @staticmethod
    async def _cover_text(cv_data: Dict[str, Any], job: Dict[str, Any]) -> str:
        from app.services.emails.email_agent_service import EmailAgentService
        return await EmailAgentService.cover_text_for_job(cv_data or {}, job or {})

    @staticmethod
    async def _wait_for_browser_result(session_id: str) -> Dict[str, Any]:
        """Wait until the browser session finishes instead of treating a start as a sent application."""
        deadline = asyncio.get_running_loop().time() + 90
        last_status = "started"
        while asyncio.get_running_loop().time() < deadline:
            await asyncio.sleep(3)
            payload = await BrowserAutomationService.get_node_automation_status(session_id)
            last_status = payload.get("status") or last_status
            if last_status in ("completed", "error", "manual_action_required", "pending_verification"):
                errors = payload.get("errors") or []
                message = ""
                if errors and isinstance(errors[-1], dict):
                    message = errors[-1].get("message") or ""
                if last_status == "completed" and payload.get("submitted"):
                    return {
                        "success": True,
                        "status": "completed",
                        "session_id": session_id,
                        "new_credentials": payload.get("new_credentials"),
                    }
                if last_status == "completed":
                    return {
                        "success": False,
                        "status": "error",
                        "error": "The form was filled but not submitted",
                        "session_id": session_id,
                    }
                if last_status == "error":
                    return {
                        "success": False,
                        "status": "error",
                        "error": message or "Browser apply failed",
                        "session_id": session_id
                    }
                return {
                    "success": True,
                    "status": "login_required" if last_status == "manual_action_required" and "login" in message.lower() else last_status,
                    "error": message,
                    "session_id": session_id,
                    "new_credentials": payload.get("new_credentials"),
                }
        return {"success": True, "status": "started", "session_id": session_id}

    @staticmethod
    async def _get_user_portal_credentials(user_id: str, domain: str) -> Optional[Dict[str, Any]]:
        """
        Retrieve existing portal credentials for a given user and domain.
        """
        try:
            db = await get_database()
            user = await db.users.find_one(
                {"_id": ObjectId(user_id), "portal_credentials.domain": domain},
                {"portal_credentials.$": 1} # Project only the matching credential
            )
            if user and user.get("portal_credentials"):
                return user["portal_credentials"][0]
            return None
        except Exception as e:
            logger.error(f"Error lookup credentials: {e}")
            return None

    @staticmethod
    async def _store_portal_credentials(
        user_id: str, 
        portal_name: str, 
        domain: str, 
        username: str, 
        password: str
    ) -> bool:
        """
        Store newly created portal credentials to user profile
        """
        try:
            db = await get_database()
            
            new_cred = {
                "_id": ObjectId(),
                "portal_name": portal_name,
                "domain": domain,
                "username": username,
                "password_encrypted": _encrypt_secret(password),
                "created_at": datetime.utcnow(),
                "updated_at": datetime.utcnow()
            }
            
            await db.users.update_one(
                {"_id": ObjectId(user_id)},
                {"$push": {"portal_credentials": new_cred}}
            )
            
            logger.info(f"Successfully stored new credentials for {domain} to user {user_id}")
            return True
        except Exception as e:
            logger.error(f"Error storing credentials: {e}")
            return False
            
    @staticmethod
    async def get_node_automation_status(session_id: str) -> Dict[str, Any]:
        """
        Poll the Node.js automation service for the actual status of a session
        """
        try:
            # Use authentication token from settings
            headers = {
                "Authorization": f"Bearer {settings.BROWSER_AUTOMATION_TOKEN}"
            }
            
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    f"{BROWSER_AUTOMATION_URL}/api/automation/status/{session_id}",
                    headers=headers
                )
                
                if response.status_code == 200:
                    return response.json()
                else:
                    return {"error": f"Node service error: {response.status_code}"}
        except Exception as e:
            logger.error(f"Error polling Node service status: {e}")
            return {"error": str(e)}
    
    
    @staticmethod
    async def _call_browser_automation_service(
        application_url: str,
        user_data: Dict[str, Any],
        job_data: Dict[str, Any],
        application_id: str,
        credentials: Optional[Dict[str, Any]] = None,
        auto_create_account: bool = False
    ) -> Dict[str, Any]:
        """
        Call Node.js browser automation service
        
        Args:
            application_url: URL of job application page
            user_data: User profile and CV information
            job_data: Job posting details
            application_id: Application ID for tracking
            credentials: Optional existing portal credentials for login
            auto_create_account: Flag to instruct the service to create an account if needed
            
        Returns:
            Dict with automation result from Node.js service
        """
        try:
            logger.info(f"Calling browser automation service for URL: {application_url}")
            
            # Prepare request payload for Node.js service
            payload = {
                "session_id": application_id,
                "url": application_url,
                "autofill_data": {
                    "personal_info": user_data.get("personal_info", {}),
                    "experience": user_data.get("experience", []),
                    "education": user_data.get("education", []),
                    "skills": user_data.get("skills", {}),
                    "connected_email": user_data.get("connected_email") or "",
                    "cover_letter": user_data.get("cover_letter") or "",
                    "resume_file_path": user_data.get("resume_file_path") or "",
                    "user_id": user_data.get("user_id") or "",
                    "job_id": user_data.get("job_id") or "",
                    "auto_create_account": auto_create_account,
                    "portal_credentials": credentials,
                },
                "job_source": BrowserAutomationService.detect_application_platform(application_url),
                "credentials": credentials,
                "auto_create_account": auto_create_account
            }
            
            # Use authentication token from settings
            headers = {
                "Authorization": f"Bearer {settings.BROWSER_AUTOMATION_TOKEN}"
            }
            
            # Call Node.js automation service
            async with httpx.AsyncClient(timeout=120.0) as client:
                response = await client.post(
                    f"{BROWSER_AUTOMATION_URL}/api/automation/start",
                    json=payload,
                    headers=headers
                )
                
                if response.status_code == 200:
                    result = response.json()
                    session_id = result.get("browser_session_id") or application_id
                    logger.info(f"Browser automation started: {result.get('status')}")
                    return await BrowserAutomationService._wait_for_browser_result(session_id)
                else:
                    error_msg = f"Browser automation service error: {response.status_code}"
                    logger.error(error_msg)
                    return {
                        "success": False,
                        "error": error_msg,
                        "status_code": response.status_code,
                        "timestamp": datetime.utcnow().isoformat()
                    }
            
        except httpx.ConnectError as e:
            error_msg = f"Cannot connect to browser automation service at {BROWSER_AUTOMATION_URL}"
            logger.error(f"{error_msg}: {str(e)}")
            return {
                "success": False,
                "error": error_msg,
                "note": "Ensure browser-automation service is running",
                "timestamp": datetime.utcnow().isoformat()
            }
        except httpx.TimeoutException:
            error_msg = "Browser automation timed out"
            logger.error(error_msg)
            return {
                "success": False,
                "error": error_msg,
                "timestamp": datetime.utcnow().isoformat()
            }
        except Exception as e:
            logger.error(f"Browser automation error: {str(e)}")
            return {
                "success": False,
                "error": str(e),
                "timestamp": datetime.utcnow().isoformat()
            }
    
    
    @staticmethod
    async def check_application_status(
        application_id: str,
        user_id: str, 
        job_url: str
    ) -> Dict[str, Any]:
        """
        Hyper-Monitoring: Check application status via Browser + Email Domain Scan
        """
        try:
            db = await get_database()
            result_summary = {
                "portal_status": "unknown",
                "email_status": "unknown",
                "final_status": "unknown",
                "signals": []
            }

            # 1. BROWSER CHECK
            if job_url:
                try:
                    payload = {"url": job_url}
                    headers = {"Authorization": f"Bearer {settings.BROWSER_AUTOMATION_TOKEN}"}
                    
                    async with httpx.AsyncClient(timeout=60.0) as client:
                        response = await client.post(
                            f"{BROWSER_AUTOMATION_URL}/api/automation/check-status",
                            json=payload,
                            headers=headers
                        )
                        
                        if response.status_code == 200:
                            browser_data = response.json()
                            if browser_data.get("success"):
                                result_summary["portal_status"] = browser_data.get("status", "unknown")
                                result_summary["signals"].append({
                                    "source": "browser", 
                                    "status": result_summary["portal_status"],
                                    "detail": browser_data.get("matched_keyword"),
                                    "screenshot": browser_data.get("screenshot_base64")
                                })
                except Exception as browser_error:
                    logger.warning(f"Browser check failed: {browser_error}")

            # 2. EMAIL DOMAIN CHECK
            domain = ""
            try:
                from urllib.parse import urlparse
                domain = urlparse(job_url).netloc
                if domain.startswith("www."):
                    domain = domain[4:]
            except:
                pass

            if domain:
                try:
                    from app.services.emails.email_intelligence import EmailIntelligenceService
                    email_service = EmailIntelligenceService(db)
                    
                    email_updates = await email_service.scan_for_application_domain(
                        user_id=user_id,
                        domain=domain,
                        application_id=application_id
                    )
                    
                    if email_updates:
                        latest_update = email_updates[0]
                        result_summary["email_status"] = latest_update["analysis"].category.value
                        result_summary["signals"].append({
                            "source": "email_domain",
                            "status": result_summary["email_status"],
                            "detail": latest_update["subject"],
                            "timestamp": latest_update["timestamp"].isoformat()
                        })
                except Exception as email_error:
                    logger.warning(f"Email domain check failed: {email_error}")

            # 3. SYNTHESIS
            statuses = [s["status"] for s in result_summary["signals"]]
            
            if "rejected" in statuses:
                result_summary["final_status"] = "rejected"
            elif "offer" in statuses:
                result_summary["final_status"] = "offer"
            elif "interview" in statuses:
                result_summary["final_status"] = "interview"
            elif "in_review" in statuses:
                result_summary["final_status"] = "in_review"
            elif "applied" in statuses:
                result_summary["final_status"] = "applied"
            
            # Update Application if new info found
            if result_summary["final_status"] != "unknown":
                update_fields = {
                    "last_response_check": datetime.utcnow(),
                    "response_check_result": result_summary["final_status"]
                }
                
                status_mapping = {
                    "rejected": "rejected",
                    "offer": "offer_received", 
                    "interview": "interview_scheduled",
                    "in_review": "under_review",
                    "applied": "applied"
                }
                
                db_status = status_mapping.get(result_summary["final_status"])
                if db_status:
                    update_fields["status"] = db_status

                await db.applications.update_one(
                    {"_id": ObjectId(application_id)},
                    {"$set": update_fields}
                )

            return result_summary

        except Exception as e:
            logger.error(f"Error in hybrid status check: {e}")
            return {"error": str(e)}

    
    @staticmethod
    async def get_automation_status(application_id: str) -> Dict[str, Any]:
        """
        Get current automation status for an application
        
        Args:
            application_id: Application ID
            
        Returns:
            Dict with automation status details
        """
        try:
            db = await get_database()
            
            application = await db.applications.find_one(
                {"_id": ObjectId(application_id)},
                {
                    "automation_status": 1,
                    "automation_started_at": 1,
                    "automation_completed_at": 1,
                    "automation_error": 1,
                    "automation_details": 1
                }
            )
            
            if not application:
                return {
                    "found": False,
                    "error": "Application not found"
                }
            
            return {
                "found": True,
                "status": application.get("automation_status", "not_started"),
                "started_at": application.get("automation_started_at"),
                "completed_at": application.get("automation_completed_at"),
                "error": application.get("automation_error"),
                "details": application.get("automation_details")
            }
            
        except Exception as e:
            logger.error(f"Error getting automation status: {str(e)}")
            return {
                "found": False,
                "error": str(e)
            }
    
    
    @staticmethod
    async def cancel_automation(application_id: str) -> bool:
        """
        Cancel ongoing automation for an application
        
        Args:
            application_id: Application ID
            
        Returns:
            True if cancelled successfully
        """
        try:
            db = await get_database()
            
            # Update application status
            result = await db.applications.update_one(
                {
                    "_id": ObjectId(application_id),
                    "automation_status": "in_progress"
                },
                {
                    "$set": {
                        "automation_status": "cancelled",
                        "status": "pending",
                        "updated_at": datetime.utcnow()
                    }
                }
            )
            
            if result.modified_count > 0:
                # Try to notify Node.js service to cancel
                try:
                    async with httpx.AsyncClient(timeout=5.0) as client:
                        await client.post(
                            f"{BROWSER_AUTOMATION_URL}/api/cancel",
                            json={"application_id": application_id}
                        )
                except Exception as e:
                    logger.warning(f"Failed to notify browser service of cancellation: {e}")
                
                logger.info(f"Automation cancelled for application {application_id}")
                return True
            
            return False
            
        except Exception as e:
            logger.error(f"Error cancelling automation: {str(e)}")
            return False
    
    
    @staticmethod
    def detect_application_platform(url: str) -> str:
        """
        Detect the job application platform from URL
        
        Args:
            url: Application URL
            
        Returns:
            Platform name (linkedin, indeed, greenhouse, lever, custom)
        """
        url_lower = url.lower()
        
        if "linkedin.com" in url_lower:
            return "linkedin"
        elif "indeed.com" in url_lower:
            return "indeed"
        elif "greenhouse.io" in url_lower:
            return "greenhouse"
        elif "lever.co" in url_lower:
            return "lever"
        elif "workday.com" in url_lower or "myworkdayjobs.com" in url_lower:
            return "workday"
        elif "icims.com" in url_lower:
            return "icims"
        elif "remoteok.com" in url_lower or "remoteok.io" in url_lower:
            return "remoteok"
        else:
            return "custom"
    
    
    @staticmethod
    async def check_automation_service_health() -> Dict[str, Any]:
        """
        Check if browser automation service is running
        
        Returns:
            Dict with health status
        """
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{BROWSER_AUTOMATION_URL}/health")
                
                if response.status_code == 200:
                    return {
                        "healthy": True,
                        "service": "browser-automation",
                        "url": BROWSER_AUTOMATION_URL,
                        "response": response.json()
                    }
                else:
                    return {
                        "healthy": False,
                        "service": "browser-automation",
                        "url": BROWSER_AUTOMATION_URL,
                        "status_code": response.status_code
                    }
        except Exception as e:
            return {
                "healthy": False,
                "service": "browser-automation",
                "url": BROWSER_AUTOMATION_URL,
                "error": str(e)
            }


# Configuration helper
def get_browser_automation_config() -> Dict[str, Any]:
    """
    Get browser automation service configuration
    
    Returns:
        Dict with configuration settings
    """
    return {
        "service_url": BROWSER_AUTOMATION_URL,
        "timeout": 120,
        "supported_platforms": [
            "linkedin",
            "indeed", 
            "greenhouse",
            "lever",
            "workday",
            "generic"
        ],
        "features": {
            "form_detection": True,
            "auto_fill": True,
            "document_upload": True,
            "screenshot": True,
            "multi_page": True
        }
    }
