# backend/app/integrations/job_boards/remoteok_client.py
"""
RemoteOK JSON API Client - Free, no authentication required
API endpoint: https://remoteok.com/api
"""

import httpx
import logging
from typing import List, Dict, Optional
from datetime import datetime
import asyncio

logger = logging.getLogger(__name__)


class RemoteOKClient:
    """Client for RemoteOK JSON API"""
    
    def __init__(self):
        self.base_url = "https://remoteok.com/api"
        self.headers = {
            'User-Agent': 'JobPlatform/1.0 (Contact: your-email@example.com)',
            'Accept': 'application/json'
        }
    
    async def search_jobs(
        self,
        query: Optional[str] = None,
        limit: int = 50
    ) -> List[Dict]:
        """Search jobs via RemoteOK JSON API"""
        
        try:
            logger.info(f"Fetching jobs from RemoteOK API")
            
            async with httpx.AsyncClient(headers=self.headers, timeout=15.0) as client:
                response = await client.get(self.base_url)
                response.raise_for_status()
                
                jobs_data = response.json()
                
                # First item is metadata, skip it
                if jobs_data and isinstance(jobs_data, list):
                    jobs_data = jobs_data[1:]
                
                # Filter by query if provided
                if query:
                    query_lower = query.lower()
                    filtered_jobs = []
                    for job in jobs_data:
                        position = job.get('position', '').lower()
                        company = job.get('company', '').lower()
                        tags = ' '.join(job.get('tags', [])).lower()
                        
                        if (query_lower in position or 
                            query_lower in company or 
                            query_lower in tags):
                            filtered_jobs.append(job)
                    
                    jobs_data = filtered_jobs
                
                logger.info(f"RemoteOK API returned {len(jobs_data)} jobs")
                return jobs_data[:limit]
                
        except httpx.HTTPStatusError as e:
            logger.error(f"RemoteOK API error: {e}")
            return []
        except Exception as e:
            logger.error(f"RemoteOK request failed: {e}")
            return []
    
    def normalize_job(self, job_data: Dict) -> 'JobCreate':
        """Normalize RemoteOK job to JobCreate model"""
        from app.models.job import JobCreate, WorkArrangement, EmploymentType, JobSource
        
        # RemoteOK jobs are always remote
        work_arrangement = WorkArrangement.REMOTE
        
        # Extract location
        location = job_data.get('location', 'Worldwide')
        if not location or location == 'false':
            location = 'Worldwide'
        
        # Extract salary
        salary_range = None
        salary_min = job_data.get('salary_min')
        salary_max = job_data.get('salary_max')
        
        if salary_min or salary_max:
            salary_range = {
                'min_amount': int(salary_min) if salary_min else 0,
                'max_amount': int(salary_max) if salary_max else int(salary_min or 0),
                'currency': 'USD'
            }
        
        # Determine employment type
        employment_type = EmploymentType.FULL_TIME
        position = job_data.get('position', '').lower()
        if 'part time' in position or 'part-time' in position:
            employment_type = EmploymentType.PART_TIME
        elif 'contract' in position:
            employment_type = EmploymentType.CONTRACT
        
        # Get tags as skills
        tags = job_data.get('tags', [])
        skills = [tag for tag in tags if tag and len(tag) < 30][:10]
        
        # Build description
        description = job_data.get('description', '') or ''
        if len(description.strip()) < 10:
            description = f"Remote position at {job_data.get('company', 'Unknown')}."
            if skills:
                description += f" Skills: {', '.join(skills[:5])}"

        url = job_data.get('url') or job_data.get('apply_url') or None
        if isinstance(url, str):
            url = url.strip() or None
        external_id = job_data.get('id', job_data.get('slug', ''))
        
        return JobCreate(
            title=str(job_data.get('position') or 'Unknown Position')[:200],
            company_name=str(job_data.get('company') or 'Unknown Company').strip()[:100],
            location=str(location)[:200],
            description=description[:5000],
            employment_type=employment_type,
            work_arrangement=work_arrangement,
            skills_required=skills,
            salary_range=salary_range,
            application_url=url,
            external_url=url,
            source=JobSource.JOB_BOARD,
            external_id=str(external_id) if external_id else None,
        )
    
    def _parse_epoch(self, epoch: Optional[int]) -> datetime:
        """Parse epoch timestamp"""
        if not epoch:
            return datetime.utcnow()
        
        try:
            return datetime.fromtimestamp(epoch)
        except:
            return datetime.utcnow()