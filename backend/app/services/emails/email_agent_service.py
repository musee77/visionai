# backend/app/services/email_agent_service.py
"""
Email Agent Service - AI-Powered Application Submission
Handles form prefilling, email composition, and application tracking via Gmail
"""

import logging
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List
from bson import ObjectId
import re
import httpx

from app.database import get_database
from app.integrations.openai_client import openai_client
from .gmail_service import gmail_service
from .email_response_analyzer import email_response_analyzer
from app.models.user import GmailAuth
from app.core.config import settings

logger = logging.getLogger(__name__)


class EmailAgentService:
    """
    Email Agent for intelligent job application submission
    
    Features:
    - Extract form data from CV
    - Compose professional application emails
    - Send via Gmail API
    - Track applications and responses
    """
    
    @staticmethod
    def profile_facts(user: Dict[str, Any]) -> Dict[str, str]:
        """Facts that should come from the profile, not from an AI rewrite."""
        profile = (user or {}).get("profile") or {}
        personal = profile.get("personal_info") or {}
        location_prefs = profile.get("location_preferences") or {}
        country = personal.get("country") or ""
        pref_country = location_prefs.get("country")
        if not country and isinstance(pref_country, dict):
            country = pref_country.get("name") or ""
        elif not country and isinstance(pref_country, str):
            country = pref_country
        city = (personal.get("city") or location_prefs.get("city") or "").strip()
        state = (personal.get("state") or location_prefs.get("state") or "").strip()
        if not city:
            location_text = (personal.get("location") or "").strip()
            location_parts = [part.strip() for part in location_text.split(",") if part.strip()]
            if location_parts:
                city = location_parts[0]
            if len(location_parts) > 1 and not state:
                state = location_parts[1]
        first_name = (personal.get("first_name") or user.get("first_name") or "").strip()
        last_name = (personal.get("last_name") or user.get("last_name") or "").strip()
        if not first_name and not last_name:
            full_name = (user.get("full_name") or personal.get("name") or "").strip()
            parts = [part for part in full_name.split() if part]
            if parts:
                first_name = parts[0]
                last_name = " ".join(parts[1:])
        linkedin = personal.get("linkedin") or personal.get("linkedin_url") or ""
        github = personal.get("github") or personal.get("github_url") or ""
        portfolio = personal.get("portfolio") or personal.get("portfolio_url") or ""
        location = personal.get("location") or ", ".join(part for part in (city, state, country) if part)
        return {
            "first_name": first_name,
            "last_name": last_name,
            "name": " ".join(part for part in (first_name, last_name) if part),
            "email": user.get("email") or "",
            "phone": personal.get("phone") or user.get("phone") or "",
            "address": personal.get("address") or "",
            "city": city,
            "state": state,
            "country": country if isinstance(country, str) else "",
            "postal_code": personal.get("postal_code") or "",
            "location": location,
            "linkedin": linkedin,
            "linkedin_url": linkedin,
            "github": github,
            "github_url": github,
            "portfolio": portfolio,
            "portfolio_url": portfolio,
        }

    @staticmethod
    async def cover_text_for_job(cv_data: Dict[str, Any], job: Dict[str, Any]) -> str:
        """AI text for a cover letter or other open-ended application answer."""
        try:
            from app.services.documents.cover_letter_service import cover_letter_service
            result = await cover_letter_service.generate_cover_letter(
                cv_data=cv_data or {},
                job_data={
                    "title": job.get("title", ""),
                    "company_name": job.get("company_name") or job.get("company") or "",
                    "description": (job.get("description") or "")[:4000],
                    "requirements": job.get("requirements") or [],
                },
                tone="professional",
            )
            letter = (result or {}).get("cover_letter") or {}
            text = (letter.get("content") or {}).get("full_text") or ""
            if text.strip():
                return text.strip()
        except Exception as error:
            logger.warning(f"Cover letter generation failed: {error}")
        name = ((cv_data or {}).get("personal_info") or {}).get("name") or "Applicant"
        title = job.get("title") or "this role"
        company = job.get("company_name") or job.get("company") or "your team"
        return f"Dear hiring team,\n\nI am applying for the {title} role at {company}.\n\nThank you,\n{name}"

    @staticmethod
    async def answer_open_question(user: Dict[str, Any], job: Dict[str, Any], question: str, cv_data: Optional[Dict] = None) -> str:
        facts = EmailAgentService.profile_facts(user)
        prompt = (
            "Answer this job application question in 2 to 4 sentences. "
            "Use the profile facts as given. Do not invent a different name, phone, email, or location.\n\n"
            f"Name: {facts['name']}\nLocation: {facts['location']}\n"
            f"Role: {job.get('title') or ''}\nCompany: {job.get('company_name') or job.get('company') or ''}\n"
            f"Job description: {(job.get('description') or '')[:1500]}\n"
            f"Question: {question}"
        )
        try:
            answer = await openai_client.chat_completion(
                messages=[
                    {"role": "system", "content": "You write short, specific answers for job application forms."},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.4,
                max_tokens=220,
            )
            if isinstance(answer, str) and answer.strip():
                return answer.strip()
        except Exception as error:
            logger.warning(f"Open question answer failed: {error}")
        return await EmailAgentService.cover_text_for_job(cv_data or {}, job)

    @staticmethod
    async def extract_form_data_from_cv(user_id: str, cv_data: Optional[Dict] = None, db = None) -> Dict[str, Any]:
        """
        Extract form-fillable data from user's CV
        
        Args:
            user_id: User ID
            cv_data: Optional CV data (if not provided, fetches latest)
            db: Optional database connection (dependency injection)
            
        Returns:
            Dict with form fields ready for prefilling
        """
        try:
            if db is None:
                db = await get_database()
            
            # Get user data
            user = await db.users.find_one({"_id": ObjectId(user_id)})
            if not user:
                raise ValueError(f"User {user_id} not found")
            
            logger.info(f"Extracting form data for user {user_id}")
            
            # Get CV data if not provided
            if not cv_data:
                cv_doc = await db.documents.find_one(
                    {
                        "user_id": user_id,  # user_id is already a string, not ObjectId
                        "document_type": "cv",
                        "is_active": True
                    },
                    sort=[("created_at", -1)]
                )
                
                if cv_doc:
                    cv_data = cv_doc.get("cv_data", {})
                    logger.info(f"Found CV document with cv_data keys: {list(cv_data.keys()) if cv_data else 'None'}")
                else:
                    logger.warning(f"No CV document found for user {user_id}")
            
            personal_info = cv_data.get("personal_info", {}) if cv_data else {}
            profile = user.get("profile", {}) or {}
            facts = EmailAgentService.profile_facts(user)
            first_name = facts["first_name"]
            last_name = facts["last_name"]
            if not first_name and not last_name:
                cv_name = (personal_info.get("name") or "").strip()
                name_parts = cv_name.split()
                if len(name_parts) >= 2:
                    first_name = name_parts[0]
                    last_name = " ".join(name_parts[1:])
                elif name_parts:
                    first_name = name_parts[0]
            city = facts["city"]
            state = facts["state"]
            if not city:
                cv_location = personal_info.get("location") or ""
                location_parts = [part.strip() for part in cv_location.split(",") if part.strip()]
                if location_parts:
                    city = location_parts[0]
                if len(location_parts) >= 2 and not state:
                    state = location_parts[1]

            form_data = {
                "first_name": first_name,
                "last_name": last_name,
                "email": facts["email"],
                "phone": facts["phone"] or personal_info.get("phone") or "",
                "address": facts["address"],
                "city": city,
                "state": state,
                "country": facts["country"],
                "postal_code": facts["postal_code"],
                "linkedin_url": facts["linkedin_url"] or personal_info.get("linkedin") or "",
                "portfolio_url": facts["portfolio_url"] or personal_info.get("portfolio") or "",
                "github_url": facts["github_url"] or personal_info.get("github") or "",
            }
            
            # Add experience summary if available
            if cv_data and isinstance(cv_data, dict) and cv_data.get("experience"):
                experiences = cv_data.get("experience", [])
                if experiences and isinstance(experiences, list):
                    # Get years of experience
                    total_years = sum(exp.get("years", 0) for exp in experiences if isinstance(exp, dict))
                    form_data["years_of_experience"] = total_years
                    
                    # Get current/most recent position
                    if experiences:
                        latest_exp = experiences[0]
                        if isinstance(latest_exp, dict):
                            form_data["current_position"] = latest_exp.get("title", "")
                            form_data["current_company"] = latest_exp.get("company", "")
            
            # Add education if available
            if cv_data and isinstance(cv_data, dict) and cv_data.get("education"):
                education = cv_data.get("education", [])
                if education and isinstance(education, list):
                    latest_edu = education[0]
                    if isinstance(latest_edu, dict):
                        form_data["education_level"] = latest_edu.get("degree", "")
                        form_data["university"] = latest_edu.get("institution", "")
            
            # Add skills
            if cv_data and isinstance(cv_data, dict) and cv_data.get("skills"):
                skills = cv_data.get("skills", {})
                if isinstance(skills, dict):
                    form_data["skills"] = skills.get("technical", []) + skills.get("soft", [])
            elif profile and isinstance(profile, dict) and profile.get("skills"):
                form_data["skills"] = profile.get("skills", [])
            
            # Count how many fields have actual values
            populated_fields = sum(1 for v in form_data.values() if v)
            logger.info(f"Extracted form data for user {user_id}: {populated_fields}/{len(form_data)} fields populated")
            
            return form_data
            
        except Exception as e:
            logger.error(f"Error extracting form data: {str(e)}")
            raise
    
    
    @staticmethod
    async def compose_application_email(
        job: Dict[str, Any],
        user: Dict[str, Any],
        form_data: Dict[str, Any],
        cover_letter: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Compose professional application email
        
        Args:
            job: Job posting data
            user: User data
            form_data: Form data from quick apply
            cover_letter: Optional cover letter content
            
        Returns:
            Dict with email subject, body, and metadata
        """
        try:
            # Extract job details
            job_title = job.get("title", "Position")
            company_name = job.get("company_name", "your company")
            
            # Build email subject
            subject = f"Application for {job_title} at {company_name}"
            
            # Use provided cover letter if substantial, otherwise generate with AI
            if cover_letter and len(cover_letter) > 150:
                logger.info(f"Using provided cover letter from CoverLetterService for {job_title}")
                body = cover_letter
            else:
                # Try to compose a mini-cover letter with AI
                logger.info(f"No full cover letter provided. Composing mini-cover letter with AI for {job_title}")
                ai_body = await EmailAgentService._compose_email_with_ai(
                    job=job,
                    user=user,
                    message_context=cover_letter
                )
                
                if ai_body:
                    body = ai_body
                else:
                    # Fallback to professional template if AI fails
                    logger.info(f"AI composition failed. Using template fallback for {job_title}")
                    body = EmailAgentService._compose_email_with_template(
                        job_title=job_title,
                        company_name=company_name,
                        form_data=form_data,
                        cover_letter=cover_letter
                    )
            
            # Metadata and info
            full_name = f"{form_data.get('first_name', '')} {form_data.get('last_name', '')}".strip()
            
            return {
                "subject": subject,
                "body": body,
                "from_name": full_name,
                "from_email": form_data.get("email", "")
            }
            
        except Exception as e:
            logger.error(f"Error composing email: {str(e)}")
            raise

    @staticmethod
    async def _compose_email_with_ai(
        job: Dict[str, Any],
        user: Dict[str, Any],
        message_context: Optional[str] = None
    ) -> Optional[str]:
        """Compose a high-impact 'mini-cover letter' as the email body using AI"""
        try:
            job_title = job.get("title", "Position")
            company = job.get("company_name", "your company")
            description = job.get("description", "")
            
            prompt = f"""
            Write a professional, impactful application email body for:
            Position: {job_title}
            Company: {company}
            Job Description (Excerpt): {description[:600]}
            
            CANDIDATE:
            Name: {user.get('full_name', 'Applicant')}
            {f"ADDITIONAL MESSAGE/CONTEXT: {message_context}" if message_context else ""}
            
            GOAL:
            The email serves as a 'mini-cover letter'. It should be short (2 paragraphs max), enthusiastic, and clearly explain why the candidate's core strengths match this specific role.
            
            INSTRUCTIONS:
            1. Write ONLY the body text.
            2. Do NOT include a subject line, formal contact blocks, or 'Dear Hiring Manager' (those are handled by the sender).
            3. Start directly with the professional opening message.
            4. Focus on 'Show, Don't Tell' with matching highlights.
            5. Ensure the tone is confident and professional.
            """
            
            response = await openai_client.chat_completion(
                messages=[
                    {"role": "system", "content": "You are an expert recruiter writing high-conversion job application emails."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.7,
                max_tokens=500
            )
            
            return response.strip() if response else None
            
        except Exception as e:
            logger.error(f"AI email composition failed: {e}")
            return None

    @staticmethod
    def _compose_email_with_template(
        job_title: str,
        company_name: str,
        form_data: Dict[str, Any],
        cover_letter: Optional[str] = None
    ) -> str:
        """Fallback method for template-based email composition"""
        full_name = f"{form_data.get('first_name', '')} {form_data.get('last_name', '')}".strip()
        body_parts = []
        body_parts.append(f"Dear Hiring Manager,\n")
        body_parts.append(
            f"I am writing to express my strong interest in the {job_title} position at {company_name}. "
            f"I believe my skills and experience make me an excellent candidate for this role.\n"
        )
        
        if cover_letter:
            body_parts.append(f"\n{cover_letter}\n")
        else:
            if form_data.get("years_of_experience"):
                body_parts.append(f"\nWith {form_data.get('years_of_experience')} years of professional experience")
                if form_data.get("current_position"):
                    body_parts.append(f" as a {form_data.get('current_position')}")
                body_parts.append(", I am confident in my ability to contribute to your team.\n")
        
        body_parts.append("\nContact Information:")
        body_parts.append(f"Email: {form_data.get('email', '')}")
        if form_data.get("phone"):
            body_parts.append(f"Phone: {form_data.get('phone')}")
        if form_data.get("linkedin_url"):
            body_parts.append(f"LinkedIn: {form_data.get('linkedin_url')}")
        if form_data.get("portfolio_url"):
            body_parts.append(f"Portfolio: {form_data.get('portfolio_url')}")
        
        body_parts.append(
            f"\n\nI have attached my resume for your review. "
            f"I would welcome the opportunity to discuss how my background and skills "
            f"would be a great fit for {company_name}.\n"
        )
        body_parts.append(f"\nThank you for your consideration.\n")
        body_parts.append(f"\nBest regards,\n{full_name}")
        
        return "\n".join(body_parts)
    
    
    @staticmethod
    async def send_application_via_gmail(
        user_id: str,
        job_id: str,
        application_id: str,
        recipient_email: str,
        form_data: Dict[str, Any],
        cv_document_id: str,
        cover_letter_document_id: Optional[str] = None,
        additional_message: Optional[str] = None,
        db = None
    ) -> Dict[str, Any]:
        """
        Send job application via Gmail API
        
        Args:
            user_id: User ID
            job_id: Job ID
            application_id: Application record ID
            recipient_email: Company/recruiter email
            form_data: Form data
            cv_document_id: CV document ID
            cover_letter_document_id: Optional cover letter document ID
            additional_message: Optional additional message
            db: Optional database connection (dependency injection)
            
        Returns:
            Dict with send result and Gmail message ID
        """
        try:
            if db is None:
                db = await get_database()
            
            # Get user and Gmail auth
            user = await db.users.find_one({"_id": ObjectId(user_id)})
            if not user:
                raise ValueError(f"User {user_id} not found")
            
            gmail_auth_data = user.get("gmail_auth")
            if not gmail_auth_data:
                raise ValueError("Gmail not connected. Please connect your Gmail account first.")
            
            # Convert to GmailAuth model
            gmail_auth = GmailAuth(**gmail_auth_data)
            
            # Get job details
            job = await db.jobs.find_one({"_id": ObjectId(job_id)})
            if not job:
                raise ValueError(f"Job {job_id} not found")
            
            # Get cover letter text if provided
            cl_text = additional_message
            if cover_letter_document_id:
                cl_doc = await db.documents.find_one({"_id": ObjectId(cover_letter_document_id)})
                if not cl_doc:
                    cl_doc = await db.generated_documents.find_one({"_id": ObjectId(cover_letter_document_id)})
                
                if cl_doc:
                    # Prefer full_text or content field
                    cl_text = cl_doc.get("full_text") or cl_doc.get("content") or cl_doc.get("text") or cl_text
            
            # Compose email
            email_data = await EmailAgentService.compose_application_email(
                job=job,
                user=user,
                form_data=form_data,
                cover_letter=cl_text
            )
            
            # Get CV document path (check both uploaded and generated documents)
            attachments = []
            
            # 1. Try uploaded documents
            cv_doc = await db.documents.find_one({"_id": ObjectId(cv_document_id)})
            
            # 2. If not found, try generated documents
            if not cv_doc:
                logger.info(f"CV {cv_document_id} not found in documents, checking generated_documents")
                cv_doc = await db.generated_documents.find_one({"_id": ObjectId(cv_document_id)})
                if cv_doc:
                     logger.info(f"Found generated CV document: {cv_document_id}")
            
            if cv_doc:
                # Debug fields
                logger.info(f"CV Document fields: {list(cv_doc.keys())}")
                file_path = cv_doc.get("file_path") or cv_doc.get("pdf_path") or cv_doc.get("path")
                
                logger.info(f"Resolved file_path: {file_path}")
                
                if file_path:
                    attachments.append(file_path)
                    logger.info(f"Attached CV file: {file_path}")
                else:
                    logger.warning(f"CV document {cv_document_id} found but has no file_path/pdf_path/path")
            else:
                logger.warning(f"CV document {cv_document_id} not found in documents or generated_documents")
            
            # 3. Only attach the CV (user request: only cv should be attached to email)
            # The email body itself now serves as the personalized cover letter message.
            
            # Send email via Gmail
            logger.info(f"Sending application email to {recipient_email}")
            gmail_result = gmail_service.send_email(
                auth=gmail_auth,
                to=recipient_email,
                subject=email_data["subject"],
                body=email_data["body"],
                attachments=attachments
            )
            
            # Update application record
            await db.applications.update_one(
                {"_id": ObjectId(application_id)},
                {
                    "$set": {
                        "status": "applied",
                        "applied_date": datetime.utcnow(),
                        "email_sent_via": "gmail",
                        "gmail_message_id": gmail_result.get("id"),
                        "gmail_thread_id": gmail_result.get("threadId"),
                        "last_email_at": datetime.utcnow(),
                        "recipient_email": recipient_email,
                        "email_subject": email_data["subject"],
                        "updated_at": datetime.utcnow()
                    }
                }
            )
            
            # Track email in email_logs
            await db.email_logs.insert_one({
                "user_id": ObjectId(user_id),
                "application_id": ObjectId(application_id),
                "job_id": ObjectId(job_id),
                "gmail_message_id": gmail_result.get("id"),
                "recipient": recipient_email,
                "subject": email_data["subject"],
                "sent_at": datetime.utcnow(),
                "status": "sent"
            })
            
            logger.info(f"Application sent successfully via Gmail: {gmail_result.get('id')}")
            
            return {
                "success": True,
                "gmail_message_id": gmail_result.get("id"),
                "sent_at": datetime.utcnow().isoformat(),
                "recipient": recipient_email
            }
            
        except Exception as e:
            logger.error(f"Error sending application via Gmail: {str(e)}")
            
            # Update application with error
            try:
                db = await get_database()
                await db.applications.update_one(
                    {"_id": ObjectId(application_id)},
                    {
                        "$set": {
                            "status": "failed",
                            "error_message": str(e),
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
    async def monitor_application_responses(user_id: str, days_back: int = 30, application_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Monitor Gmail for application responses
        
        Args:
            user_id: User ID
            days_back: Number of days to look back
            application_id: Optional specific application ID to check
            
        Returns:
            List of detected responses
        """
        try:
            db = await get_database()
            
            # Get user and Gmail auth
            user = await db.users.find_one({"_id": ObjectId(user_id)})
            if not user or not user.get("gmail_auth"):
                logger.warning(f"User {user_id} not found or Gmail not connected")
                return []
            
            gmail_auth = GmailAuth(**user.get("gmail_auth"))
            
            # Calculate the cutoff date
            cutoff_date = datetime.utcnow() - timedelta(days=days_back)
            
            # Build query
            query = {
                "user_id": user_id,
                "recipient_email": {"$exists": True}
            }
            
            if application_id:
                query["_id"] = ObjectId(application_id)
            else:
                query["$or"] = [
                    {"email_sent_at": {"$exists": True, "$gte": cutoff_date}},
                    {"created_at": {"$gte": cutoff_date}}
                ]
            
            # Get applications
            applications = await db.applications.find(query).to_list(length=100)
            
            logger.info(f"Found {len(applications)} applications to check for responses")
            
            responses = []
            
            # Check for responses to each application
            for app in applications:
                try:
                    recipient_email = app.get("recipient_email")
                    # Fallback to applied_date or created_at if email_sent_at missing
                    email_sent_at = app.get("email_sent_at") or app.get("applied_date") or app.get("created_at")
                    last_email_at = app.get("last_email_at") or app.get("applied_date") or app.get("created_at")
                    # Ensure it's a datetime object (applied_date might be string in some legacy data, but model says datetime)
                    if isinstance(last_email_at, str):
                        try:
                            last_email_at = datetime.fromisoformat(last_email_at.replace('Z', '+00:00'))
                        except:
                            last_email_at = datetime.utcnow() - timedelta(days=7) # Fallback

                    gmail_thread_id = app.get("gmail_thread_id")
                    
                    if not recipient_email or not last_email_at:
                        logger.debug(f"Skipping app {app.get('_id')}: missing recipient or date")
                        continue
                    
                    messages = []
                    
                    # Strategy 1: Search by thread ID (most reliable if available)
                    if gmail_thread_id:
                        try:
                            logger.info(f"Searching thread {gmail_thread_id} for responses")
                            # Get all messages in the thread
                            thread_messages = gmail_service.list_messages(
                                auth=gmail_auth,
                                query=f"rfc822msgid:{gmail_thread_id}",
                                max_results=20
                            )
                            
                            # Filter to only messages received AFTER we sent (exclude our own sent message)
                            if thread_messages:
                                for msg in thread_messages:
                                    # Get message details to check date
                                    msg_details = gmail_service.get_message(gmail_auth, msg.get('id'))
                                    if msg_details:
                                        # Check if this message is newer than our sent email
                                        internal_date = int(msg_details.get('internalDate', 0)) / 1000
                                        msg_date = datetime.fromtimestamp(internal_date)
                                        if msg_date > email_sent_at:
                                            messages.append(msg)
                        except Exception as thread_error:
                            logger.warning(f"Thread search failed: {thread_error}, falling back to sender search")
                    
                    # Strategy 2: Search by sender email/domain and date (fallback or primary if no thread)
                    if not messages:
                        # Extract domain from recipient email
                        domain = recipient_email.split('@')[-1] if '@' in recipient_email else None
                        
                        # Determine date for search
                        # For auto-apply, we want emails after we sent the application
                        # For manual apps, we look back 30 days to catch recent context
                        if app.get("source") == "auto_apply":
                             search_date = email_sent_at
                        else:
                             search_date = datetime.utcnow() - timedelta(days=30)

                        # Format date for Gmail API (YYYY/MM/DD format)
                        after_date = search_date.strftime('%Y/%m/%d')
                        
                        # Build search query
                        # Search for emails from the recipient address or domain, received after we sent
                        if domain:
                            # Search both specific email and domain (catches replies from different addresses at same company)
                            query = f"from:({recipient_email} OR @{domain}) after:{after_date}"
                        else:
                            query = f"from:{recipient_email} after:{after_date}"
                        
                        logger.info(f"Searching for responses with query: {query}")
                        messages = gmail_service.list_messages(
                            auth=gmail_auth,
                            query=query,
                            max_results=10
                        )
                    
                    if messages:
                        logger.info(f"Found {len(messages)} response(s) for application {app.get('_id')}")
                        
                        # Process the latest message for analysis
                        # (Assume messages are returned in some order, but safer to sort or just pick the first found if logic implies recency)
                        # Gmail API list usually returns newest first.
                        latest_msg_summary = messages[0] 
                        
                        try:
                            # Fetch full message details for analysis
                            full_msg = gmail_service.get_message(gmail_auth, latest_msg_summary.get('id'))
                            
                            if full_msg:
                                # Extract subject
                                subject = ""
                                for header in full_msg.get('payload', {}).get('headers', []):
                                    if header.get('name', '').lower() == 'subject':
                                        subject = header.get('value', '')
                                        break

                                # Extract content (Body)
                                body_content = ""
                                if 'parts' in full_msg.get('payload', {}):
                                    for part in full_msg['payload']['parts']:
                                        if part.get('mimeType') == 'text/plain' and 'data' in part.get('body', {}):
                                            import base64
                                            try:
                                                data = part['body']['data']
                                                body_content = base64.urlsafe_b64decode(data).decode('utf-8')
                                                break
                                            except Exception as e:
                                                logger.warning(f"Failed to decode body: {e}")
                                
                                # Fallback to snippet if body extraction failed or no parts
                                if not body_content:
                                    body_content = full_msg.get('snippet', '')
                                
                                snippet = full_msg.get('snippet', '')
                                
                                # Analyze the email
                                logger.info(f"Analyzing email response for application {app.get('_id')}")
                                analysis_result = await email_response_analyzer.analyze_email_response(
                                    email_content=body_content or snippet,
                                    email_subject=subject,
                                    sender_email=recipient_email or "unknown",
                                    application_id=str(app.get('_id')),
                                    use_ai=True
                                )
                                
                                # Update application based on analysis
                                update_result = await email_response_analyzer.update_application_from_analysis(
                                    application_id=str(app.get('_id')),
                                    analysis_result=analysis_result,
                                    user_id=user_id
                                )
                                
                                logger.info(f"Analysis complete: {analysis_result.category} -> {update_result.new_status}")
                        
                        except Exception as analysis_error:
                            logger.error(f"Failed to analyze email content: {analysis_error}")
                            # Ensure body_content is defined even on error to save raw message
                            if 'body_content' not in locals():
                                body_content = latest_msg_summary.get('snippet', '')
                            subject = subject if 'subject' in locals() else "Response Received"
                        
                        # Create communication record
                        new_communication = {
                            "type": "email",
                            "direction": "inbound",
                            "subject": subject,
                            "content": body_content,
                            "contact_email": recipient_email,
                            "timestamp": datetime.utcnow(),
                            "message_id": latest_msg_summary.get('id')
                        }

                        # Fallback/Base Update: Mark as response received even if analysis fails or changes nothing
                        # AND push the communication
                        await db.applications.update_one(
                            {"_id": app["_id"]},
                            {
                                "$set": {
                                    "response_received": True,
                                    "response_count": len(messages),
                                    "last_response_at": datetime.utcnow(),
                                    "updated_at": datetime.utcnow()
                                },
                                "$push": {
                                    "communications": new_communication
                                }
                            }
                        )
                        
                        responses.append({
                            "application_id": str(app["_id"]),
                            "job_id": str(app.get("job_id", "")),
                            "company_name": app.get("company_name"),
                            "job_title": app.get("job_title"),
                            "response_count": len(messages),
                            "detected_at": datetime.utcnow().isoformat(),
                            "analysis": analysis_result.category.value if 'analysis_result' in locals() else "unknown"
                        })
                    else:
                        logger.debug(f"No responses found for application {app.get('_id')}")
                        
                except Exception as app_error:
                    error_str = str(app_error)
                    if "invalid_grant" in error_str or "Token has been expired" in error_str:
                        logger.error(f"Gmail auth expired for user {user_id}: {app_error}")
                        # Invalidate Gmail auth
                        await db.users.update_one(
                            {"_id": ObjectId(user_id)},
                            {"$unset": {"gmail_auth": ""}}
                        )
                        raise ValueError("Gmail authentication expired")
                    
                    logger.error(f"Error checking application {app.get('_id')}: {app_error}")
                    continue
            
            logger.info(f"Monitored {len(applications)} applications, found {len(responses)} with responses")
            return responses
        except Exception as e:
            logger.error(f"Error monitoring responses: {str(e)}")
            return []

    @staticmethod
    async def find_verification_link(user_id: str, domain: str) -> Optional[str]:
        """
        Scan Gmail for verification/activation links from a specific domain
        """
        try:
            db = await get_database()
            user = await db.users.find_one({"_id": ObjectId(user_id)})
            if not user or not user.get("gmail_auth"):
                return None
            
            gmail_auth = GmailAuth(**user.get("gmail_auth"))
            
            # Search query: messages from domain with verification keywords
            # We look for messages in the last 15 minutes to be efficient
            search_query = f"from:{domain} (verify OR activate OR confirm OR registration)"
            messages = gmail_service.list_messages(gmail_auth, query=search_query, max_results=5)
            
            if not messages:
                logger.info(f"No verification emails found for domain {domain}")
                return None
            
            for msg_info in messages:
                msg = gmail_service.get_message(gmail_auth, msg_info['id'])
                
                # Extract body from Gmail message
                body = ""
                snippet = msg.get('snippet', '')
                
                payload = msg.get('payload', {})
                parts = payload.get('parts', [])
                
                if not parts and payload.get('body', {}).get('data'):
                    # Not multipart
                    import base64
                    data = payload['body']['data']
                    body = base64.urlsafe_b64decode(data).decode('utf-8')
                else:
                    # Multipart
                    for part in parts:
                        if part.get('mimeType') == 'text/plain' and part.get('body', {}).get('data'):
                            import base64
                            data = part['body']['data']
                            body = base64.urlsafe_b64decode(data).decode('utf-8')
                            break
                        elif part.get('mimeType') == 'text/html' and part.get('body', {}).get('data'):
                            import base64
                            data = part['body']['data']
                            body = base64.urlsafe_b64decode(data).decode('utf-8')
                
                # Use body or snippet for research
                search_text = body + " " + snippet
                
                # Look for URLs
                # Regex for common verification links
                url_pattern = r'https?://[^\s<>"]+/(?:verify|activate|confirm|auth|registration)[^\s<>"]*'
                links = re.findall(url_pattern, search_text)
                
                if not links:
                    # Fallback: find any link from that domain that isn't a tracking pixel
                    generic_pattern = rf'https?://[^\s<>"]*{re.escape(domain)}[^\s<>"]*'
                    links = [l for l in re.findall(generic_pattern, search_text) if len(l) > 20]
                
                if links:
                    # Return the first matching link (usually the primary button link)
                    logger.info(f"Found potential verification link for {domain}: {links[0]}")
                    return links[0]
            
            return None
        except Exception as e:
            logger.error(f"Error finding verification link for {domain}: {e}")
            return None

    @staticmethod
    async def auto_click_verification_link(url: str) -> bool:
        """
        Headlessly 'clicks' a verification link via GET request
        """
        try:
            logger.info(f"Attempting to headlessly verify link: {url}")
            async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
                response = await client.get(url)
                if response.status_code in [200, 201]:
                    logger.info(f"Verification link clicked successfully (Status: {response.status_code})")
                    return True
                else:
                    logger.warning(f"Verification link returned non-success status: {response.status_code}")
                    return False
        except Exception as e:
            logger.error(f"Error auto-clicking verification link: {e}")
            return False


# Singleton instance
email_agent_service = EmailAgentService()
