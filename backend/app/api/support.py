from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime
import logging

from app.services.emails.email_service import email_service
from app.core.config import settings
from app.database import get_database

logger = logging.getLogger(__name__)

router = APIRouter()

class ContactRequest(BaseModel):
    name: str
    email: EmailStr
    subject: str
    category: Optional[str] = "General"
    message: str

@router.post("/contact")
async def contact_form_submission(
    request: ContactRequest,
    background_tasks: BackgroundTasks
):
    """
    Handle contact form submissions by sending an email to support
    """
    try:
        # Prepare email template context
        template_body = {
            "name": request.name,
            "email": request.email,
            "category": request.category,
            "subject": request.subject,
            "message": request.message
        }

        # Send email in background to avoid blocking the response
        background_tasks.add_task(
            email_service.send_email,
            subject=f"Contact Form: {request.subject}",
            recipients=[settings.SUPPORT_EMAIL],
            body="",  # Use template
            subtype="html",
            template_name="contact_form.html",
            template_body=template_body,
            reply_to=request.email
        )

        return {"success": True, "message": "Thank you for your message! Our support team will get back to you within 24 hours."}

    except Exception as e:
        logger.error(f"Error processing contact form: {e}")
        raise HTTPException(
            status_code=500,
            detail="There was an error processing your request. Please try again later."
        )


class TicketRequest(BaseModel):
    email: EmailStr
    message: str


@router.post("/tickets")
async def create_support_ticket(request: TicketRequest, background_tasks: BackgroundTasks):
    """Save a support ticket from the help chat."""
    message = (request.message or "").strip()
    if len(message) < 2:
        raise HTTPException(status_code=400, detail="Message is required")
    db = await get_database()
    now = datetime.utcnow()
    result = await db.support_tickets.insert_one({
        "email": request.email,
        "message": message,
        "status": "open",
        "created_at": now,
        "updated_at": now,
    })
    email_sent = False
    try:
        background_tasks.add_task(
            email_service.send_email,
            subject=f"Support ticket from {request.email}",
            recipients=[settings.SUPPORT_EMAIL],
            body=message,
            subtype="plain",
            reply_to=request.email
        )
        email_sent = True
    except Exception as error:
        logger.warning(f"Support ticket email was not queued: {error}")
    return {
        "success": True,
        "id": str(result.inserted_id),
        "email_sent": email_sent,
    }
