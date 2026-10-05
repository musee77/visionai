# backend/app/services/cv_customization_service.py
"""
CV Customization Service - Phase 3
Tailors CVs for specific job postings using AI
"""

from typing import Dict, Any, Optional, List
from datetime import datetime
import logging
from bson import ObjectId

from app.integrations.openai_client import openai_client
from app.database import get_database

logger = logging.getLogger(__name__)


class CVCustomizationService:
    """Service for customizing CVs for specific jobs"""
    
    def __init__(self):
        self.db = None
    
    async def _get_db(self):
        """Get database instance"""
        if self.db is None:
            self.db = await get_database()
        return self.db
    
    async def customize_cv_for_job(
        self,
        cv_data: Dict[str, Any],
        job_data: Dict[str, Any],
        user_preferences: Optional[Dict] = None
    ) -> Dict[str, Any]:
        try:
            logger.info(f"Customizing CV for job: {job_data.get('title', 'Unknown')}")
            logger.debug(f"Input cv_data: {cv_data}")
            logger.debug(f"Input job_data: {job_data}")
            logger.debug(f"User preferences: {user_preferences}")
            
            # Build customization prompt
            prompt = self._build_customization_prompt(cv_data, job_data, user_preferences)
            logger.debug(f"Generated prompt: {prompt}")
            
            # Call OpenAI for customization
            logger.debug("Calling OpenAI chat completion")
            customized_content = await openai_client.chat_completion(
                messages=[
                    {
                        "role": "system",
                        "content": "You are an expert CV writer and career consultant specializing in ATS optimization and job matching."
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                temperature=0.7,
                max_tokens=3000
            )
            logger.debug(f"OpenAI response: {customized_content}")
            
            if not customized_content:
                logger.error("Empty response from OpenAI")
                return {
                    "success": False,
                    "error": "Empty response from OpenAI",
                    "customized_cv": cv_data
                }
            
            # Parse and structure the customized CV
            logger.debug("Parsing customized CV")
            customized_cv = await self._parse_customized_cv(
                customized_content,
                cv_data,
                job_data
            )
            
            # Calculate match score
            logger.debug("Calculating match score")
            match_score = await self._calculate_match_score(customized_cv, job_data)
            
            return {
                "success": True,
                "customized_cv": customized_cv,
                "job_match_score": match_score
            }
            
        except Exception as e:
            detail = getattr(e, "detail", None)
            if not isinstance(detail, str) or not detail.strip():
                detail = str(e).strip() or e.__class__.__name__
            status_code = getattr(e, "status_code", None)
            logger.error(f"CV customization failed: {detail}", exc_info=True)
            return {
                "success": False,
                "error": detail,
                "status_code": status_code if isinstance(status_code, int) else 500,
                "customized_cv": cv_data
            }
    
    def _build_customization_prompt(
        self,
        cv_data: Dict[str, Any],
        job_data: Dict[str, Any],
        user_preferences: Optional[Dict] = None
    ) -> str:
        """Build AI prompt for CV customization"""
        
        job_title = job_data.get("title", "")
        company = job_data.get("company_name", "")
        description = job_data.get("description", "")
        requirements = job_data.get("requirements", [])
        
        # Handle requirements which can be list of strings or list of dicts
        req_list = []
        if requirements and isinstance(requirements, list):
            for r in requirements:
                if isinstance(r, dict):
                     req_list.append(r.get("requirement", ""))
                else:
                     req_list.append(str(r))
        
        req_str = ', '.join(req_list[:10]) if req_list else 'Not specified'

        prompt = f"""
Customize this CV for a {job_title} position at {company} to maximize ATS (Applicant Tracking System) compatibility and impact.

JOB CONTEXT:
Title: {job_title}
Company: {company}
Description: {description[:1200]}
Key Requirements: {req_str}

CANDIDATE DATA:
{self._format_cv_for_prompt(cv_data)}

CUSTOMIZATION STRATEGY:
1. **ATS Optimization**: Naturally integrate the identified `ats_keywords` into the professional summary and experience bullet points. Do not keyword-stuff; ensure the flow is professional.
2. **Impact-First Bullet Points**: Rewrite experience highlights using strong action verbs (e.g., "Spearheaded", "Optimized", "Architected", "Engineered"). 
3. **Quantification**: Look for any numbers, percentages, or dollar amounts in the original data and transform them into high-impact accomplishments (e.g., "Increased efficiency by 20%" instead of "Made things faster").
4. **Thematic Tailoring**: Reframe the `professional_summary` to directly address the primary challenges mentioned in the job description.
5. **Conciseness**: Filter out experiences that are completely irrelevant to this role to maintain a high "signal-to-noise" ratio.

Please provide the customized CV in the following JSON structure:
{{
    "professional_summary": "A high-impact, tailored summary (3-4 sentences) connecting candidate strengths to job needs.",
    "experience": [
        {{
            "title": "Job Title",
            "company": "Company Name",
            "duration": "Start - End",
            "highlights": ["Key achievement with metrics", "Specific project outcome using matching skills"],
            "relevance_score": 0-10
        }}
    ],
    "skills": {{
        "technical": ["skill1", "skill2"],
        "soft": ["skill1", "skill2"]
    }},
    "education": [...],
    "certifications": [...],
    "ats_keywords": ["Extracted keywords used in this version"]
}}
"""
        return prompt
    
    def _format_cv_for_prompt(self, cv_data: Dict[str, Any]) -> str:
        """Format CV data for AI prompt"""
        sections = []
        
        if cv_data.get("personal_info"):
            sections.append(f"Name: {cv_data['personal_info'].get('name', 'N/A')}")
        
        if cv_data.get("professional_summary"):
            sections.append(f"Summary: {cv_data['professional_summary']}")
        
        if cv_data.get("experience"):
            exp_text = "Experience:\n"
            for exp in cv_data["experience"][:5]:  # Limit to 5 most recent
                exp_text += f"- {exp.get('title')} at {exp.get('company')} ({exp.get('duration')})\n"
            sections.append(exp_text)
        
        if cv_data.get("skills"):
            skills = cv_data["skills"]
            if isinstance(skills, list):
                sections.append(f"Skills: {', '.join(skills[:20])}")
            else:
                logger.error(f"Invalid skills type: {type(skills)}, value: {skills}")
                sections.append("Skills: Not available")
        
        if cv_data.get("education"):
            edu_text = "Education:\n"
            for edu in cv_data["education"]:
                edu_text += f"- {edu.get('degree')} from {edu.get('institution')}\n"
            sections.append(edu_text)
        
        return "\n\n".join(sections)
    
    async def _parse_customized_cv(
        self,
        ai_response: str,
        original_cv: Dict[str, Any],
        job_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        try:
            import json
            
            logger.debug(f"Raw AI response: {ai_response}")
            
            # Try to extract JSON from response
            start_idx = ai_response.find("{")
            end_idx = ai_response.rfind("}") + 1
            logger.debug(f"JSON start_idx: {start_idx}, end_idx: {end_idx}")
            
            if start_idx < 0 or end_idx <= start_idx:
                logger.warning("No valid JSON found in AI response, using original CV")
                return original_cv
            
            json_str = ai_response[start_idx:end_idx]
            logger.debug(f"Extracted JSON string: {json_str}")
            
            try:
                customized_data = json.loads(json_str)
                logger.debug(f"Parsed customized_data: {customized_data}")
            except json.JSONDecodeError as e:
                logger.error(f"Invalid JSON in AI response: {str(e)}")
                return original_cv
            
            # Validate customized_data is a dict
            if not isinstance(customized_data, dict):
                logger.error(f"Parsed AI response is not a dict: {type(customized_data)}")
                return original_cv
            
            # Sanitize customized_data to prevent slice objects or invalid types
            def sanitize_dict(d):
                if isinstance(d, dict):
                    return {k: sanitize_dict(v) for k, v in d.items()}
                elif isinstance(d, list):
                    return [sanitize_dict(v) for v in d]
                elif isinstance(d, slice):  # Explicitly catch slice objects
                    logger.error(f"Found slice object in AI response: {d}")
                    return str(d)  # Convert to string
                return d
            
            customized_data = sanitize_dict(customized_data)
            logger.debug(f"Sanitized customized_data: {customized_data}")
            
            # Merge with original data, preserving contact info
            result = {
                **original_cv,
                **customized_data,
                "personal_info": original_cv.get("personal_info", {}),
                "customization_metadata": {
                    "job_id": job_data.get("_id"),
                    "job_title": job_data.get("title"),
                    "customized_at": datetime.utcnow()
                }
            }
            logger.debug(f"Final customized CV: {result}")
            return result
                
        except Exception as e:
            logger.error(f"Failed to parse customized CV: {str(e)}", exc_info=True)
            return original_cv
    
    async def _calculate_match_score(
        self,
        cv_data: Dict[str, Any],
        job_data: Dict[str, Any]
    ) -> float:
        """Calculate how well the CV matches the job using AI semantic matching"""
        try:
            # Try AI-powered semantic matching first
            ai_score = await self._calculate_semantic_match_score(cv_data, job_data)
            if ai_score is not None:
                logger.debug(f"AI Semantic Match Score: {ai_score}")
                return ai_score
                
            # Fallback to keyword-based matching
            return await self._calculate_keyword_match_score(cv_data, job_data)
            
        except Exception as e:
            logger.warning(f"Match score calculation failed: {e}. Returning default score.")
            return 0.75  # Default 75% match

    async def _calculate_semantic_match_score(
        self,
        cv_data: Dict[str, Any],
        job_data: Dict[str, Any]
    ) -> Optional[float]:
        """Use AI to semantically compare CV and Job for a match score"""
        try:
            job_title = job_data.get("title", "")
            description = job_data.get("description", "")
            requirements = job_data.get("requirements", [])
            
            prompt = f"""
            Analyze the match between this CV and the Job Posting.
            
            JOB:
            Title: {job_title}
            Description: {description[:1000]}
            Requirements: {str(requirements)[:500]}
            
            CV SUMMARY:
            {self._format_cv_for_prompt(cv_data)}
            
            INSTRUCTIONS:
            1. Evaluate the semantic match between the candidate's experience/skills and the job requirements.
            2. Provide a score from 0.0 to 1.0, where 1.0 is a perfect match and 0.0 is no match.
            3. Consider both technical skills and the level of responsibility.
            4. Respond ONLY with the numerical score as a float.
            
            Score:
            """
            
            response = await openai_client.chat_completion(
                messages=[
                    {"role": "system", "content": "You are an expert technical recruiter providing accurate candidate-job match assessments."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.3,
                max_tokens=10
            )
            
            if response:
                import re
                match = re.search(r"(\d+\.\d+)", response)
                if match:
                    score = float(match.group(1))
                    return max(0.0, min(1.0, score))
            return None
        except Exception as e:
            logger.error(f"Semantic match scoring failed: {e}")
            return None

    async def _calculate_keyword_match_score(
        self,
        cv_data: Dict[str, Any],
        job_data: Dict[str, Any]
    ) -> float:
        """Fallback keyword-based matching logic (Jaccard similarity)"""
        try:
            cv_skills = set()
            if cv_data.get("skills"):
                skills = cv_data["skills"]
                if isinstance(skills, dict):
                    for skill_list in skills.values():
                        if isinstance(skill_list, list):
                            cv_skills.update(s.lower() for s in skill_list)
                elif isinstance(skills, list):
                    cv_skills.update(s.lower() for s in skills)
            
            job_skills = set()
            if job_data.get("skills_required"):
                job_skills = set(s.lower() for s in job_data["skills_required"])
            elif job_data.get("requirements"):
                reqs = job_data["requirements"][:10]
                extracted_reqs = []
                for r in reqs:
                    if isinstance(r, dict):
                         extracted_reqs.append(r.get("requirement", ""))
                    else:
                         extracted_reqs.append(str(r))
                job_skills = set(s.lower() for s in extracted_reqs)
            
            if not job_skills:
                return 0.75
            
            if not cv_skills:
                return 0.5
            
            intersection = len(cv_skills & job_skills)
            union = len(cv_skills | job_skills)
            
            score = intersection / union if union > 0 else 0.5
            if intersection > 0:
                score = min(1.0, score + 0.2)
            
            return round(score, 2)
        except Exception:
            return 0.75
    
    async def generate_multiple_versions(
        self,
        cv_data: Dict[str, Any],
        jobs: List[Dict[str, Any]],
        user_id: str
    ) -> List[Dict[str, Any]]:
        """
        Generate customized CVs for multiple jobs in batch
        
        Args:
            cv_data: Original CV data
            jobs: List of job postings
            user_id: User ID for tracking
            
        Returns:
            List of customized CV results
        """
        results = []
        db = await self._get_db()
        
        for job in jobs:
            try:
                # Customize CV for this job
                result = await self.customize_cv_for_job(cv_data, job)
                
                if result["success"]:
                    # Store generated version
                    doc_id = await self._store_generated_cv(
                        user_id=user_id,
                        job_id=str(job.get("_id")),
                        customized_cv=result["customized_cv"],
                        match_score=result["job_match_score"]
                    )
                    
                    result["document_id"] = doc_id
                
                results.append({
                    "job_id": str(job.get("_id")),
                    "job_title": job.get("title"),
                    **result
                })
                
            except Exception as e:
                logger.error(f"Failed to customize CV for job {job.get('_id')}: {e}")
                results.append({
                    "job_id": str(job.get("_id")),
                    "job_title": job.get("title"),
                    "success": False,
                    "error": str(e)
                })
        
        return results
    
    async def _store_generated_cv(
        self,
        user_id: str,
        job_id: str,
        customized_cv: Dict[str, Any],
        match_score: float
    ) -> str:
        """Store generated CV in database"""
        db = await self._get_db()
        
        doc = {
            "user_id": user_id,
            "job_id": job_id,
            "type": "customized_cv",
            "content": customized_cv,
            "match_score": match_score,
            "generated_at": datetime.utcnow(),
            "status": "generated"
        }
        
        result = await db.generated_documents.insert_one(doc)
        return str(result.inserted_id)
    
    async def get_generated_cv(
        self,
        document_id: str,
        user_id: str
    ) -> Optional[Dict[str, Any]]:
        """Retrieve a generated CV"""
        db = await self._get_db()
        
        doc = await db.generated_documents.find_one({
            "_id": ObjectId(document_id),
            "user_id": user_id,
            "type": "customized_cv"
        })
        
        if doc:
            doc["_id"] = str(doc["_id"])
        
        return doc


# Create singleton instance
cv_customization_service = CVCustomizationService()