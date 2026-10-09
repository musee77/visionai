# backend/app/services/pdf_service.py
"""
PDF Generation Service - Phase 3
Creates professional PDFs from customized CVs and cover letters
"""

from typing import Dict, Any, Optional
from io import BytesIO
from datetime import datetime
import logging
from pathlib import Path

from reportlab.lib.pagesizes import letter, A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor, black, grey
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, KeepTogether, Frame, PageTemplate
)
from reportlab.pdfgen import canvas

from app.core.config import settings
from app.database import get_database

logger = logging.getLogger(__name__)


class PDFService:
    """Service for generating professional PDF documents"""
    
    # Template color schemes
    TEMPLATES = {
        "professional": {
            "primary": HexColor("#2C3E50"),
            "secondary": HexColor("#34495E"),
            "accent": HexColor("#3498DB"),
            "text": black
        },
        "modern": {
            "primary": HexColor("#1A1A2E"),
            "secondary": HexColor("#16213E"),
            "accent": HexColor("#0F3460"),
            "text": black
        },
        "minimal": {
            "primary": HexColor("#000000"),
            "secondary": HexColor("#333333"),
            "accent": HexColor("#666666"),
            "text": black
        },
        "creative": {
            "primary": HexColor("#6C5CE7"),
            "secondary": HexColor("#A29BFE"),
            "accent": HexColor("#FD79A8"),
            "text": black
        }
    }
    
    def __init__(self):
        self.db = None
        self.upload_dir = Path(settings.UPLOAD_DIR)
        self.upload_dir.mkdir(exist_ok=True)
    
    async def _get_db(self):
        """Get database instance"""
        if self.db is None:
            self.db = await get_database()
        return self.db
    
    async def generate_cv_pdf(
        self,
        cv_content: Dict[str, Any],
        template: str = "professional",
        watermark: bool = False,
        user_id: Optional[str] = None
    ) -> BytesIO:
        """
        Generate professional CV PDF
        
        Args:
            cv_content: Structured CV data
            template: Visual template (professional, modern, minimal, creative)
            watermark: Add watermark for free tier
            user_id: User ID for storage
            
        Returns:
            BytesIO object containing PDF
        """
        try:
            logger.info(f"Generating CV PDF with template: {template}")
            
            buffer = BytesIO()
            colors = self.TEMPLATES.get(template, self.TEMPLATES["professional"])
            
            # Create PDF document
            doc = SimpleDocTemplate(
                buffer,
                pagesize=letter,
                rightMargin=0.75*inch,
                leftMargin=0.75*inch,
                topMargin=0.75*inch,
                bottomMargin=0.75*inch
            )
            
            # Build content
            story = []
            styles = self._get_styles(colors)
            
            # Header with name and contact
            story.extend(self._build_cv_header(cv_content, styles, colors))
            
            # Professional Summary
            if cv_content.get("professional_summary"):
                story.append(Spacer(1, 0.2*inch))
                story.extend(self._build_section(
                    "PROFESSIONAL SUMMARY",
                    cv_content["professional_summary"],
                    styles,
                    colors
                ))
            
            # Experience
            if cv_content.get("experience"):
                story.append(Spacer(1, 0.3*inch))
                story.extend(self._build_experience_section(
                    cv_content["experience"],
                    styles,
                    colors
                ))
            
            # Skills
            if cv_content.get("skills"):
                story.append(Spacer(1, 0.3*inch))
                story.extend(self._build_skills_section(
                    cv_content["skills"],
                    styles,
                    colors
                ))
            
            # Education
            if cv_content.get("education"):
                story.append(Spacer(1, 0.3*inch))
                story.extend(self._build_education_section(
                    cv_content["education"],
                    styles,
                    colors
                ))
            
            # Certifications
            if cv_content.get("certifications"):
                story.append(Spacer(1, 0.3*inch))
                story.extend(self._build_certifications_section(
                    cv_content["certifications"],
                    styles,
                    colors
                ))
            
            # Build PDF
            if watermark:
                doc.build(story, onFirstPage=self._add_watermark, onLaterPages=self._add_watermark)
            else:
                doc.build(story)
            
            buffer.seek(0)
            return buffer
            
        except Exception as e:
            logger.error(f"CV PDF generation failed: {e}")
            raise
    
    async def generate_cover_letter_pdf(
        self,
        letter_content: Dict[str, Any],
        template: str = "professional",
        watermark: bool = False
    ) -> BytesIO:
        """
        Generate professional cover letter PDF
        
        Args:
            letter_content: Structured cover letter data
            template: Visual template
            watermark: Add watermark for free tier
            
        Returns:
            BytesIO object containing PDF
        """
        try:
            logger.info(f"Generating cover letter PDF with template: {template}")
            
            buffer = BytesIO()
            colors = self.TEMPLATES.get(template, self.TEMPLATES["professional"])
            
            doc = SimpleDocTemplate(
                buffer,
                pagesize=letter,
                rightMargin=1*inch,
                leftMargin=1*inch,
                topMargin=1*inch,
                bottomMargin=1*inch
            )
            
            story = []
            styles = self._get_styles(colors)
            
            # Header with contact info
            header_data = letter_content.get("header", {})
            story.extend(self._build_letter_header(header_data, styles, colors))
            
            story.append(Spacer(1, 0.3*inch))
            
            # Date
            date_para = Paragraph(header_data.get("date", ""), styles["Normal"])
            story.append(date_para)
            story.append(Spacer(1, 0.2*inch))
            
            # Recipient
            recipient = header_data.get("recipient", {})
            if recipient:
                story.append(Paragraph(f"Hiring Manager", styles["Normal"]))
                story.append(Paragraph(recipient.get("company", ""), styles["Normal"]))
                story.append(Paragraph(f"Re: {recipient.get('position', '')}", styles["Normal"]))
                story.append(Spacer(1, 0.2*inch))
            
            # Letter body
            content = letter_content.get("content", {})
            paragraphs = content.get("paragraphs", [])
            
            for para_text in paragraphs:
                para = Paragraph(para_text, styles["BodyText"])
                story.append(para)
                story.append(Spacer(1, 0.15*inch))
            
            # Signature
            story.append(Spacer(1, 0.2*inch))
            story.append(Paragraph("Sincerely,", styles["Normal"]))
            story.append(Spacer(1, 0.3*inch))
            story.append(Paragraph(header_data.get("applicant_name", ""), styles["Normal"]))
            
            # Build PDF
            if watermark:
                doc.build(story, onFirstPage=self._add_watermark, onLaterPages=self._add_watermark)
            else:
                doc.build(story)
            
            buffer.seek(0)
            return buffer
            
        except Exception as e:
            logger.error(f"Cover letter PDF generation failed: {e}")
            raise
    
    def _get_styles(self, colors: Dict) -> Dict:
        """Create custom styles for PDF"""
        from reportlab.lib.styles import StyleSheet1
        
        # Create a fresh stylesheet to avoid conflicts
        styles = StyleSheet1()
        
        # Add base Normal style
        styles.add(ParagraphStyle(
            name='Normal',
            fontName='Helvetica',
            fontSize=10,
            leading=12
        ))
        
        # Custom Heading style
        styles.add(ParagraphStyle(
            name='CustomHeading',
            parent=styles['Normal'],
            fontSize=14,
            textColor=colors["primary"],
            spaceAfter=6,
            spaceBefore=12,
            fontName='Helvetica-Bold'
        ))
        
        # Subheading style
        styles.add(ParagraphStyle(
            name='CustomSubHeading',
            parent=styles['Normal'],
            fontSize=11,
            textColor=colors["secondary"],
            spaceAfter=3,
            spaceBefore=6,
            fontName='Helvetica-Bold'
        ))
        
        # Name/Title style
        styles.add(ParagraphStyle(
            name='NameStyle',
            parent=styles['Normal'],
            fontSize=24,
            textColor=colors["primary"],
            alignment=TA_CENTER,
            spaceAfter=6,
            fontName='Helvetica-Bold'
        ))
        
        # Contact style
        styles.add(ParagraphStyle(
            name='ContactStyle',
            parent=styles['Normal'],
            fontSize=10,
            textColor=colors["secondary"],
            alignment=TA_CENTER,
            spaceAfter=3
        ))
        
        # Body text style
        styles.add(ParagraphStyle(
            name='BodyText',
            parent=styles['Normal'],
            fontSize=10,
            leading=14,
            alignment=TA_JUSTIFY,
            spaceAfter=6
        ))
        
        return styles
    
    def _build_cv_header(
        self,
        cv_content: Dict[str, Any],
        styles: Dict,
        colors: Dict
    ) -> list:
        """Build CV header section"""
        header_elements = []
        personal_info = cv_content.get("personal_info", {})
        
        # Ensure personal_info is a dict
        if not isinstance(personal_info, dict):
            # If it's a string, just print it
            if isinstance(personal_info, str):
                header_elements.append(Paragraph(personal_info, styles["NameStyle"]))
            return header_elements
        
        # Name
        name = personal_info.get("name", "")
        if name:
            header_elements.append(Paragraph(name, styles["NameStyle"]))
        
        # Contact info
        contact_parts = []
        if personal_info.get("email"):
            contact_parts.append(personal_info["email"])
        if personal_info.get("phone"):
            contact_parts.append(personal_info["phone"])
        if personal_info.get("location"):
            contact_parts.append(personal_info["location"])
        
        if contact_parts:
            contact_text = " | ".join(contact_parts)
            header_elements.append(Paragraph(contact_text, styles["ContactStyle"]))
        
        # LinkedIn/Portfolio
        links = []
        if personal_info.get("linkedin"):
            links.append(f"LinkedIn: {personal_info['linkedin']}")
        if personal_info.get("portfolio"):
            links.append(f"Portfolio: {personal_info['portfolio']}")
        
        if links:
            links_text = " | ".join(links)
            header_elements.append(Paragraph(links_text, styles["ContactStyle"]))
        
        return header_elements
    
    def _build_letter_header(
        self,
        header_data: Dict[str, Any],
        styles: Dict,
        colors: Dict
    ) -> list:
        """Build cover letter header"""
        header_elements = []
        
        name = header_data.get("applicant_name", "")
        if name:
            header_elements.append(Paragraph(name, styles["NameStyle"]))
        
        contact_parts = []
        if header_data.get("applicant_email"):
            contact_parts.append(header_data["applicant_email"])
        if header_data.get("applicant_phone"):
            contact_parts.append(header_data["applicant_phone"])
        
        if contact_parts:
            contact_text = " | ".join(contact_parts)
            header_elements.append(Paragraph(contact_text, styles["ContactStyle"]))
        
        return header_elements
    
    def _build_section(
        self,
        title: str,
        content: str,
        styles: Dict,
        colors: Dict
    ) -> list:
        """Build a generic section"""
        elements = []
        elements.append(Paragraph(title, styles["CustomHeading"]))
        elements.append(Paragraph(content, styles["BodyText"]))
        return elements
    
    def _build_experience_section(
        self,
        experience: list,
        styles: Dict,
        colors: Dict
    ) -> list:
        """Build experience section"""
        elements = []
        elements.append(Paragraph("PROFESSIONAL EXPERIENCE", styles["CustomHeading"]))
        
        for exp in experience:
            # Handle if exp is a string/non-dict
            if not isinstance(exp, dict):
                elements.append(Paragraph(f"• {str(exp)}", styles["BodyText"]))
                elements.append(Spacer(1, 0.1*inch))
                continue
                
            # Job title and company
            title_text = f"<b>{exp.get('title', '')}</b> | {exp.get('company', '')}"
            elements.append(Paragraph(title_text, styles["CustomSubHeading"]))
            
            # Duration
            duration = exp.get('duration', '')
            if duration:
                elements.append(Paragraph(f"<i>{duration}</i>", styles["Normal"]))
            
            # Responsibilities/Highlights
            highlights = exp.get('highlights', exp.get('responsibilities', []))
            if highlights:
                # Handle if highlights is a string
                if isinstance(highlights, str):
                    elements.append(Paragraph(highlights, styles["BodyText"]))
                elif isinstance(highlights, list):
                    for highlight in highlights[:5]:  # Limit to 5
                        bullet = f"• {highlight}"
                        elements.append(Paragraph(bullet, styles["BodyText"]))
            
            elements.append(Spacer(1, 0.15*inch))
        
        return elements
    
    def _build_skills_section(
        self,
        skills: Any,
        styles: Dict,
        colors: Dict
    ) -> list:
        """Build skills section"""
        elements = []
        elements.append(Paragraph("SKILLS", styles["CustomHeading"]))
        
        if isinstance(skills, dict):
            # Categorized skills
            for category, skill_list in skills.items():
                if skill_list:
                    category_title = category.replace("_", " ").title()
                    # Handle if skill_list is not a list
                    if isinstance(skill_list, list):
                        skills_text = ", ".join(skill_list[:15])  # Limit skills
                    else:
                        skills_text = str(skill_list)
                    
                    text = f"<b>{category_title}:</b> {skills_text}"
                    elements.append(Paragraph(text, styles["BodyText"]))
        elif isinstance(skills, list):
            # Flat skill list
            skills_text = ", ".join([str(s) for s in skills[:20]])
            elements.append(Paragraph(skills_text, styles["BodyText"]))
        
        return elements
    
    def _build_education_section(
        self,
        education: list,
        styles: Dict,
        colors: Dict
    ) -> list:
        """Build education section"""
        elements = []
        elements.append(Paragraph("EDUCATION", styles["CustomHeading"]))
        
        for edu in education:
            # Handle if edu is a string/non-dict
            if not isinstance(edu, dict):
                elements.append(Paragraph(f"• {str(edu)}", styles["BodyText"]))
                elements.append(Spacer(1, 0.1*inch))
                continue
                
            # Degree and institution
            degree_text = f"<b>{edu.get('degree', '')}</b> | {edu.get('institution', '')}"
            elements.append(Paragraph(degree_text, styles["CustomSubHeading"]))
            
            # Graduation date
            grad_date = edu.get('graduation_date', edu.get('year', ''))
            if grad_date:
                elements.append(Paragraph(f"<i>{grad_date}</i>", styles["Normal"]))
            
            # GPA or honors
            if edu.get('gpa'):
                elements.append(Paragraph(f"GPA: {edu['gpa']}", styles["Normal"]))
            if edu.get('honors'):
                elements.append(Paragraph(f"Honors: {edu['honors']}", styles["Normal"]))
            
            elements.append(Spacer(1, 0.1*inch))
        
        return elements
    
    def _build_certifications_section(
        self,
        certifications: list,
        styles: Dict,
        colors: Dict
    ) -> list:
        """Build certifications section"""
        elements = []
        elements.append(Paragraph("CERTIFICATIONS", styles["CustomHeading"]))
        
        for cert in certifications:
            if isinstance(cert, dict):
                cert_text = f"• <b>{cert.get('name', '')}</b>"
                if cert.get('issuer'):
                    cert_text += f" - {cert['issuer']}"
                if cert.get('date'):
                    cert_text += f" ({cert['date']})"
            else:
                cert_text = f"• {cert}"
            
            elements.append(Paragraph(cert_text, styles["BodyText"]))
        
        return elements
    
    def _add_watermark(self, canvas_obj, doc):
        """Add watermark to PDF pages for free tier"""
        canvas_obj.saveState()
        canvas_obj.setFont('Helvetica', 60)
        canvas_obj.setFillColorRGB(0.9, 0.9, 0.9, alpha=0.3)
        canvas_obj.translate(4*inch, 5*inch)
        canvas_obj.rotate(45)
        canvas_obj.drawCentredString(0, 0, "JobsApply")
        canvas_obj.restoreState()
    
    async def save_pdf(
        self,
        pdf_buffer: BytesIO,
        user_id: str,
        job_id: str,
        doc_type: str
    ) -> str:
        """Save PDF to storage and return file path"""
        # Create structured directory: uploads/jobs/{job_id}
        job_dir = self.upload_dir / "jobs" / job_id
        job_dir.mkdir(parents=True, exist_ok=True)
        
        # Save as clean filename: {doc_type}.pdf (e.g. cv.pdf or cover_letter.pdf)
        # We append timestamp ONLY if we want history, but user asked for specific path structure
        # Let's keep it simple as requested: "job id, then docs"
        filename = f"{doc_type}.pdf"
        filepath = job_dir / filename
        
        with open(filepath, 'wb') as f:
            f.write(pdf_buffer.getvalue())
        
        logger.info(f"PDF saved: {filepath}")
        return str(filepath)
    
    async def get_pdf_url(self, filepath: str) -> str:
        """Get public URL for PDF"""
        # Convert absolute path to relative URL
        # Path structure: .../uploads/jobs/{job_id}/{filename} -> /uploads/jobs/{job_id}/{filename}
        try:
            rel_path = Path(filepath).relative_to(self.upload_dir)
            return f"/uploads/{rel_path}".replace("\\", "/")
        except ValueError:
            # Fallback for old files or unexpected paths
            return f"/uploads/{Path(filepath).name}"
    
    async def save_pdf(
        self,
        pdf_buffer: BytesIO,
        user_id: str,
        job_id: str,
        doc_type: str  # "cv" or "cover_letter"
    ) -> str:
        """
        Save PDF buffer to file system
        
        Args:
            pdf_buffer: BytesIO containing PDF data
            user_id: User ID
            job_id: Job ID
            doc_type: Type of document ("cv" or "cover_letter")
            
        Returns:
            File path where PDF was saved
        """
        from datetime import datetime
        import glob
        import os
        
        # Create directory structure: uploads/users/{user_id}/jobs/{job_id}/
        job_dir = self.upload_dir / "users" / user_id / "jobs" / job_id
        job_dir.mkdir(parents=True, exist_ok=True)
        
        # Delete old files of the same type for this job (PDF, HTML, HTM)
        for ext in ['*.pdf', '*.html', '*.htm']:
            old_files = glob.glob(str(job_dir / f"{doc_type}_{ext}"))
            for old_file in old_files:
                try:
                    os.remove(old_file)
                    logger.info(f"Deleted old {doc_type} file: {old_file}")
                except Exception as e:
                    logger.warning(f"Failed to delete old file {old_file}: {e}")
        
        # Generate filename with timestamp
        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        filename = f"{doc_type}_{timestamp}.pdf"
        filepath = job_dir / filename
        
        # Write PDF to file
        with open(filepath, "wb") as f:
            f.write(pdf_buffer.getvalue())
        
        logger.info(f"Saved {doc_type} PDF to: {filepath}")
        return str(filepath)
    
    async def get_pdf_url(self, filepath: str) -> str:
        """
        Convert file path to accessible URL
        
        Args:
            filepath: Absolute file path
            
        Returns:
            Relative URL path
        """
        try:
            # Convert to Path object
            path = Path(filepath)
            
            # Get relative path from upload_dir
            rel_path = path.relative_to(self.upload_dir)
            
            # Return as URL with forward slashes
            url = f"/uploads/{rel_path}".replace("\\", "/")
            logger.info(f"Generated PDF URL: {url}")
            return url
        except ValueError as e:
            logger.error(f"Failed to generate PDF URL for {filepath}: {e}")
            # Fallback to filename only
            return f"/uploads/{path.name}"


# Create singleton instance
pdf_service = PDFService()