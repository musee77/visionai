# backend/app/services/cover_letter_service.py
"""
Cover Letter Generation Service - Phase 3
Generates personalized cover letters for job applications
"""

from typing import Dict, Any, Optional
from datetime import datetime
import logging
from bson import ObjectId

from app.integrations.openai_client import openai_client
from app.database import get_database

logger = logging.getLogger(__name__)


class CoverLetterService:
    """Service for generating personalized cover letters"""
    
    TONE_TEMPLATES = {
        "professional": "formal, professional, and business-oriented",
        "enthusiastic": "energetic, passionate, and eager",
        "conversational": "friendly, approachable, yet professional",
        "formal": "traditional, reserved, and highly professional"
    }
    
    def __init__(self):
        self.db = None
    
    async def _get_db(self):
        """Get database instance"""
        if self.db is None:
            self.db = await get_database()
        return self.db
    
    async def generate_cover_letter(
        self,
        cv_data: Dict[str, Any],
        job_data: Dict[str, Any],
        tone: str = "professional",
        user_context: Optional[Dict] = None
    ) -> Dict[str, Any]:
        """
        Generate personalized cover letter for a job application
        
        Args:
            cv_data: Parsed CV data
            job_data: Job posting details
            tone: Writing tone (professional, enthusiastic, conversational, formal)
            user_context: Additional user context (why interested, relocation info, etc.)
            
        Returns:
            Generated cover letter content and metadata
        """
        try:
            logger.info(f"Generating cover letter for: {job_data.get('title', 'Unknown')}")
            
            # Build prompt
            prompt = self._build_cover_letter_prompt(cv_data, job_data, tone, user_context)
            
            # Call OpenAI
            result = await openai_client.chat_completion(
                messages=[
                    {
                        "role": "system",
                        "content": "You are an expert career advisor and professional writer specializing in compelling cover letters that get results."
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                temperature=0.8,  # Slightly higher for creativity
                max_tokens=1500
            )
            
            letter_content = result
            
            # Parse and structure
            structured_letter = self._structure_cover_letter(
                letter_content,
                cv_data,
                job_data
            )
            
            return {
                "success": True,
                "cover_letter": structured_letter,
                "metadata": {
                    "tone": tone,
                    "word_count": len(letter_content.split()),
                    "generated_at": datetime.utcnow().isoformat()
                }
            }
            
        except Exception as e:
            detail = getattr(e, "detail", None)
            if not isinstance(detail, str) or not detail.strip():
                detail = str(e).strip() or e.__class__.__name__
            status_code = getattr(e, "status_code", None)
            logger.error(f"Cover letter generation failed: {detail}")
            return {
                "success": False,
                "error": detail,
                "status_code": status_code if isinstance(status_code, int) else 500,
                "cover_letter": None
            }
    
    def _build_cover_letter_prompt(
        self,
        cv_data: Dict[str, Any],
        job_data: Dict[str, Any],
        tone: str,
        user_context: Optional[Dict] = None
    ) -> str:
        """Build AI prompt for cover letter generation"""
        
        tone_description = self.TONE_TEMPLATES.get(tone, self.TONE_TEMPLATES["professional"])
        
        # Extract key info
        name = cv_data.get("personal_info", {}).get("name", "Applicant")
        job_title = job_data.get("title", "")
        company = job_data.get("company_name", "")
        description = job_data.get("description", "")
        
        # Get relevant experience
        relevant_exp = self._extract_relevant_experience(cv_data, job_data)
        key_skills = self._extract_key_skills(cv_data, job_data)
        
        prompt = f"""
Write a highly personalized, compelling cover letter for {name} applying for the {job_title} position at {company}. 

JOB CONTEXT:
Company: {company}
Position: {job_title}
Description: {description[:1200]}

CANDIDATE STORY:
{self._format_candidate_summary(cv_data)}

RELEVANT ACHIEVEMENTS:
{relevant_exp}

MATCHING STRENGTHS:
{key_skills}

COMPOSITION GUIDELINES:
1. **Thematic Hook**: Start with a personalized opening that connects the candidate's passion or background to {company}'s specific mission or recent challenges mentioned in the description. Avoid "I am writing to apply..."
2. **Narrative Flow**: Instead of listing skills, weave the candidate's achievements into a narrative that demonstrates *how* they solve the problems {company} is facing. Use a "Show, Don't Tell" approach.
3. **Problem-Solver Persona**: Position {name} as a strategic partner who can hit the ground running and add immediate value.
4. **Tone**: {tone_description}. Make it sound authentic and human, not like an AI template.
5. **Length**: 250-350 words. Focus on quality of connection over quantity of text.
6. **Closing**: A confident call to action that focuses on how the candidate can help the company achieve its goals.

{f"USER FEEDBACK/CONTEXT: {user_context}" if user_context else ""}

Write a cover letter that doesn't just list qualifications, but tells a story of why this candidate is the undeniable best fit for {company}.
"""
        return prompt
    
    def _format_candidate_summary(self, cv_data: Dict[str, Any]) -> str:
        """Create brief candidate summary"""
        summary_parts = []
        
        if cv_data.get("professional_summary"):
            summary_parts.append(cv_data["professional_summary"][:200])
        
        # Years of experience
        experience = cv_data.get("experience", [])
        if experience:
            total_years = self._calculate_years_experience(experience)
            summary_parts.append(f"{total_years}+ years of professional experience")
        
        # Education
        education = cv_data.get("education", [])
        if education and isinstance(education[0], dict):
            highest_ed = education[0]
            summary_parts.append(
                f"{highest_ed.get('degree', 'Degree')} from {highest_ed.get('institution', 'University')}"
            )
        
        return " | ".join(summary_parts)
    
    def _extract_relevant_experience(
        self,
        cv_data: Dict[str, Any],
        job_data: Dict[str, Any]
    ) -> str:
        """Extract most relevant work experience"""
        experience = cv_data.get("experience", [])[:3]
        
        exp_text = []
        for exp in experience:
            if not isinstance(exp, dict):
                continue
            highlights = exp.get("highlights") or exp.get("achievements") or exp.get("responsibilities") or []
            if isinstance(highlights, str):
                highlight_text = highlights
            elif isinstance(highlights, list):
                highlight_text = ", ".join(str(item) for item in highlights[:2] if item)
            else:
                highlight_text = ""
            exp_text.append(
                f"- {exp.get('title')} at {exp.get('company')}: {highlight_text}"
            )
        
        return "\n".join(exp_text) if exp_text else "General professional experience"
    
    def _extract_key_skills(
        self,
        cv_data: Dict[str, Any],
        job_data: Dict[str, Any]
    ) -> str:
        """Extract key matching skills"""
        names = []
        skills = cv_data.get("skills") or []
        if isinstance(skills, dict):
            for value in skills.values():
                if isinstance(value, list):
                    names.extend(str(item) for item in value if item)
                elif value:
                    names.append(str(value))
        elif isinstance(skills, list):
            names.extend(str(item) for item in skills if item)
        job_skills = {str(item).lower() for item in (job_data.get("skills_required") or []) if item}
        matching = [name for name in names if name.lower() in job_skills]
        chosen = matching or names
        return ", ".join(chosen[:8]) if chosen else "Not specified"
    
    def _calculate_years_experience(self, experience: list) -> int:
        """Calculate total years of experience"""
        # Simplified calculation - count unique year ranges
        years = set()
        for exp in experience:
            if not isinstance(exp, dict):
                continue
            duration = exp.get("duration", "")
            # Extract years (simplified)
            import re
            year_matches = re.findall(r'\d{4}', duration)
            years.update(year_matches)
        
        return len(years) if years else 0
    
    def _structure_cover_letter(
        self,
        letter_content: str,
        cv_data: Dict[str, Any],
        job_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Structure the cover letter with metadata"""
        
        personal_info = cv_data.get("personal_info", {})
        
        # Split into paragraphs
        paragraphs = [p.strip() for p in letter_content.split("\n\n") if p.strip()]
        
        return {
            "header": {
                "applicant_name": personal_info.get("name", ""),
                "applicant_email": personal_info.get("email", ""),
                "applicant_phone": personal_info.get("phone", ""),
                "date": datetime.utcnow().strftime("%B %d, %Y"),
                "recipient": {
                    "company": job_data.get("company_name", ""),
                    "position": job_data.get("title", "")
                }
            },
            "content": {
                "full_text": letter_content,
                "paragraphs": paragraphs,
                "opening": paragraphs[0] if paragraphs else "",
                "body": paragraphs[1:-1] if len(paragraphs) > 2 else [],
                "closing": paragraphs[-1] if paragraphs else ""
            },
            "metadata": {
                "word_count": len(letter_content.split()),
                "paragraph_count": len(paragraphs),
                "job_id": str(job_data.get("_id", "")),
                "job_title": job_data.get("title", "")
            }
        }
    
    async def store_generated_letter(
        self,
        user_id: str,
        job_id: str,
        letter_data: Dict[str, Any],
        tone: str
    ) -> str:
        """Store generated cover letter in database"""
        db = await self._get_db()
        
        doc = {
            "user_id": user_id,
            "job_id": job_id,
            "type": "cover_letter",
            "content": letter_data,
            "tone": tone,
            "generated_at": datetime.utcnow(),
            "status": "generated"
        }
        
        result = await db.generated_documents.insert_one(doc)
        return str(result.inserted_id)
    
    async def get_generated_letter(
        self,
        document_id: str,
        user_id: str
    ) -> Optional[Dict[str, Any]]:
        """Retrieve a generated cover letter"""
        db = await self._get_db()
        
        doc = await db.generated_documents.find_one({
            "_id": ObjectId(document_id),
            "user_id": user_id,
            "type": "cover_letter"
        })
        
        if doc:
            doc["_id"] = str(doc["_id"])
        
        return doc
    
    async def regenerate_with_feedback(
        self,
        document_id: str,
        user_id: str,
        feedback: str
    ) -> Dict[str, Any]:
        """Regenerate cover letter with user feedback"""
        
        # Get original letter
        original = await self.get_generated_letter(document_id, user_id)
        
        if not original:
            return {"success": False, "error": "Original letter not found"}
        
        # Get original CV and job data from database
        db = await self._get_db()
        
        job = await db.jobs.find_one({"_id": ObjectId(original["job_id"])})
        cv = await db.documents.find_one({
            "user_id": user_id,
            "document_type": "cv"
        })
        
        if not job or not cv:
            return {"success": False, "error": "Required data not found"}
        
        # Build refinement prompt
        refinement_prompt = f"""
Original cover letter:
{original['content']['content']['full_text']}

User feedback: {feedback}

Please revise the cover letter incorporating this feedback while maintaining professionalism and effectiveness.
"""
        
        result = await openai_client.chat_completion(
            messages=[
                {
                    "role": "system",
                    "content": "You are revising a cover letter based on user feedback."
                },
                {
                    "role": "user",
                    "content": refinement_prompt
                }
            ],
            temperature=0.7,
            max_tokens=1500
        )
        
        revised_content = result.get("content", "")
        
        # Structure and store
        structured = self._structure_cover_letter(
            revised_content,
            cv.get("cv_data", {}),
            job
        )
        
        new_id = await self.store_generated_letter(
            user_id=user_id,
            job_id=original["job_id"],
            letter_data=structured,
            tone=original.get("tone", "professional")
        )
        
        return {
            "success": True,
            "document_id": new_id,
            "cover_letter": structured
        }


# Create singleton instance
cover_letter_service = CoverLetterService()