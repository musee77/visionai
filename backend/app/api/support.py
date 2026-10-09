from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends
from pydantic import BaseModel, EmailStr, Field
from typing import Optional
from datetime import datetime
import logging
import re

from app.services.emails.email_service import email_service
from app.core.config import settings
from app.database import get_database
from app.api.deps import get_current_active_user
from bson import ObjectId

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
    email = str(request.email).strip().lower()
    db = await get_database()
    now = datetime.utcnow()
    user = await db.users.find_one({"email": {"$regex": f"^{re.escape(email)}$", "$options": "i"}})
    result = await db.support_tickets.insert_one({
        "email": email,
        "user_id": str(user["_id"]) if user else None,
        "message": message,
        "status": "open",
        "messages": [{
            "sender": "user",
            "body": message,
            "created_at": now,
            "read": True,
        }],
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


class InboxReply(BaseModel):
    message: str = Field(..., min_length=1, max_length=5000)


def _message_list(ticket: dict) -> list:
    stored = ticket.get("messages") or []
    if stored:
        return stored
    if ticket.get("message"):
        return [{
            "sender": "user",
            "body": ticket.get("message"),
            "created_at": ticket.get("created_at"),
            "read": True,
        }]
    return []


def _thread_view(ticket: dict) -> dict:
    messages = _message_list(ticket)
    unread = sum(1 for item in messages if item.get("sender") == "admin" and not item.get("read"))
    return {
        "id": str(ticket["_id"]),
        "status": ticket.get("status") or "open",
        "created_at": ticket.get("created_at"),
        "updated_at": ticket.get("updated_at") or ticket.get("created_at"),
        "unread": unread,
        "messages": [
            {
                "sender": item.get("sender") or "user",
                "body": item.get("body") or "",
                "created_at": item.get("created_at"),
                "read": bool(item.get("read", item.get("sender") != "admin")),
            }
            for item in messages
        ],
    }


def _inbox_query(current_user: dict) -> dict:
    email = str(current_user.get("email") or "").strip()
    clauses = [{"user_id": str(current_user["_id"])}]
    if email:
        clauses.append({"email": {"$regex": f"^{re.escape(email)}$", "$options": "i"}})
    return {"$or": clauses}


@router.post("/inbox")
async def start_inbox_chat(
    request: InboxReply,
    current_user: dict = Depends(get_current_active_user),
    db=Depends(get_database),
):
    """Start a chat, or add to the user's open conversation, so admin can reply."""
    body = request.message.strip()
    if len(body) < 1:
        raise HTTPException(status_code=400, detail="Message is required")
    now = datetime.utcnow()
    email = str(current_user.get("email") or "").strip().lower()
    existing_rows = await db.support_tickets.find(
        {**_inbox_query(current_user), "status": "open"}
    ).sort("updated_at", -1).limit(1).to_list(length=1)
    existing = existing_rows[0] if existing_rows else None
    entry = {"sender": "user", "body": body, "created_at": now, "read": True, "seen_by_admin": False}
    if existing:
        messages = _message_list(existing)
        messages.append(entry)
        await db.support_tickets.update_one(
            {"_id": existing["_id"]},
            {"$set": {
                "messages": messages,
                "message": body,
                "user_id": str(current_user["_id"]),
                "email": email or existing.get("email"),
                "updated_at": now,
                "status": "open",
            }},
        )
        existing["messages"] = messages
        existing["status"] = "open"
        existing["updated_at"] = now
        return _thread_view(existing)
    result = await db.support_tickets.insert_one({
        "email": email,
        "user_id": str(current_user["_id"]),
        "message": body,
        "status": "open",
        "messages": [entry],
        "created_at": now,
        "updated_at": now,
    })
    created = await db.support_tickets.find_one({"_id": result.inserted_id})
    return _thread_view(created)


@router.get("/inbox")
async def list_inbox(
    current_user: dict = Depends(get_current_active_user),
    db=Depends(get_database),
):
    """Messages between this user and the admin support team."""
    tickets = await db.support_tickets.find(_inbox_query(current_user)).sort("updated_at", -1).to_list(length=100)
    threads = [_thread_view(ticket) for ticket in tickets]
    return {
        "threads": threads,
        "unread_count": sum(thread["unread"] for thread in threads),
    }


@router.post("/inbox/{ticket_id}/reply")
async def reply_to_admin(
    ticket_id: str,
    request: InboxReply,
    current_user: dict = Depends(get_current_active_user),
    db=Depends(get_database),
):
    if not ObjectId.is_valid(ticket_id):
        raise HTTPException(status_code=404, detail="Message not found")
    ticket = await db.support_tickets.find_one({"_id": ObjectId(ticket_id), **_inbox_query(current_user)})
    if not ticket:
        raise HTTPException(status_code=404, detail="Message not found")
    body = request.message.strip()
    if len(body) < 1:
        raise HTTPException(status_code=400, detail="Message is required")
    now = datetime.utcnow()
    messages = _message_list(ticket)
    messages.append({"sender": "user", "body": body, "created_at": now, "read": True, "seen_by_admin": False})
    await db.support_tickets.update_one(
        {"_id": ticket["_id"]},
        {"$set": {
            "messages": messages,
            "message": body,
            "status": "open",
            "user_id": str(current_user["_id"]),
            "updated_at": now,
        }},
    )
    ticket["messages"] = messages
    ticket["status"] = "open"
    ticket["updated_at"] = now
    return _thread_view(ticket)


@router.post("/inbox/{ticket_id}/read")
async def mark_inbox_read(
    ticket_id: str,
    current_user: dict = Depends(get_current_active_user),
    db=Depends(get_database),
):
    if not ObjectId.is_valid(ticket_id):
        raise HTTPException(status_code=404, detail="Message not found")
    ticket = await db.support_tickets.find_one({"_id": ObjectId(ticket_id), **_inbox_query(current_user)})
    if not ticket:
        raise HTTPException(status_code=404, detail="Message not found")
    messages = _message_list(ticket)
    for item in messages:
        if item.get("sender") == "admin":
            item["read"] = True
    await db.support_tickets.update_one(
        {"_id": ticket["_id"]},
        {"$set": {"messages": messages, "user_id": str(current_user["_id"])}},
    )
    ticket["messages"] = messages
    return _thread_view(ticket)
