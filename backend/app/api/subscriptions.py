# backend/app/api/subscriptions.py

from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.responses import StreamingResponse
from typing import List, Optional, Dict, Any
from datetime import datetime
import logging
import io
import csv
import secrets
from bson import ObjectId

from app.database import get_database
from app.api.deps import get_current_user, get_current_active_user
from app.services.core.subscription_service import SubscriptionService
from app.services.core.referral_service import ReferralService
from app.models.subscription import (
    Subscription, SubscriptionCreate, SubscriptionUpdate,
    SubscriptionResponse, SubscriptionPlan, Referral
)
from pydantic import BaseModel, EmailStr

router = APIRouter()
logger = logging.getLogger(__name__)

# Request Models
class CreateSubscriptionRequest(BaseModel):
    plan_id: str
    reference: Optional[str] = None # Paystack transaction reference
    referral_code: Optional[str] = None

class UpgradeSubscriptionRequest(BaseModel):
    new_plan_id: str
    reference: Optional[str] = None # Paystack transaction reference

class CancelSubscriptionRequest(BaseModel):
    cancel_immediately: bool = False
    reason: Optional[str] = None

class CreateReferralRequest(BaseModel):
    referee_email: EmailStr

class CompleteReferralRequest(BaseModel):
    referral_code: str

# Helper function
def get_user_id(current_user: dict) -> str:
    """Extract user_id from current_user dict"""
    return current_user.get("id") or current_user.get("_id") or current_user.get("sub")

@router.get("/config")
async def get_payment_config():
    """Get public configuration for all payment gateways"""
    from app.core.config import settings
    
    return {
        "paystack": {
            "public_key": getattr(settings, 'PAYSTACK_PUBLIC_KEY', '')
        },
        "stripe": {
            "public_key": getattr(settings, 'STRIPE_PUBLIC_KEY', '')
        },
        "paypal": {
            "client_id": getattr(settings, 'PAYPAL_CLIENT_ID', ''),
            "mode": getattr(settings, 'PAYPAL_MODE', 'sandbox')
        },
        "intasend": {
            "public_key": getattr(settings, 'INTASEND_PUBLIC_KEY', ''),
            "live": getattr(settings, 'INTASEND_IS_LIVE', False)
        },
        "user_email": None # Frontend will fill this from user profile
    }

@router.get("/config/paystack")
async def get_paystack_config():
    """Get public Paystack configuration - no authentication required"""
    from app.core.config import settings
    
    return {
        "public_key": getattr(settings, 'PAYSTACK_PUBLIC_KEY', 'pk_test_placeholder'),
        "user_email": None
    }

@router.get("/config/stripe")
async def get_stripe_config_deprecated():
    """Deprecated: Get public Paystack configuration for backward compatibility"""
    return await get_paystack_config()

# ==================== SUBSCRIPTION PLANS ====================

@router.get("/plans", response_model=List[SubscriptionPlan])
async def get_subscription_plans(currency: Optional[str] = None, db = Depends(get_database)):
    """Get all available subscription plans, optionally filtered by currency"""
    service = SubscriptionService(db)
    plans = await service.list_plans(currency=currency)
    return plans

@router.get("/plans/{plan_id}", response_model=SubscriptionPlan)
async def get_subscription_plan(plan_id: str, db = Depends(get_database)):
    """Get specific subscription plan"""
    service = SubscriptionService(db)
    plan = await service.get_plan(plan_id)
    
    if not plan:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan not found")
    
    return plan

# ==================== USER SUBSCRIPTION MANAGEMENT ====================

@router.post("/", response_model=Subscription)
async def create_subscription(
    request: CreateSubscriptionRequest,
    current_user: dict = Depends(get_current_active_user),
    db = Depends(get_database)
):
    """Create a new subscription (verify Paystack payment)"""
    user_id = get_user_id(current_user)
    service = SubscriptionService(db)
    
    referral_service = ReferralService(db)
    if request.referral_code:
        is_valid = await referral_service.validate_referral_code(request.referral_code)
        own_code = (current_user.get("referral_code") or "").upper()
        if not is_valid or request.referral_code.strip().upper() == own_code:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid referral code")
    
    try:
        subscription = await service.create_subscription(
            user_id=user_id,
            plan_id=request.plan_id,
            reference=request.reference
        )

        plan = await service.get_plan(request.plan_id)
        if plan and str(getattr(plan.tier, "value", plan.tier)) in ("basic", "premium"):
            try:
                if request.referral_code:
                    await referral_service.record_signup(
                        referee_user_id=str(user_id),
                        referee_email=current_user.get("email") or "",
                        code=request.referral_code
                    )
                await referral_service.reward_for_paid_plan(str(user_id))
            except Exception as referral_error:
                logger.warning(f"Referral reward was not applied for {user_id}: {referral_error}")
        
        return subscription
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

@router.get("/me", response_model=Subscription)
async def get_my_subscription(
    current_user: dict = Depends(get_current_active_user),
    db = Depends(get_database)
):
    """Get current user's subscription"""
    try:
        user_id = get_user_id(current_user)
        service = SubscriptionService(db)
        subscription = await service.get_user_subscription(user_id)
        
        if not subscription:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No subscription found")
        
        return subscription
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in get_my_subscription: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Internal server error: {str(e)}"
        )

@router.put("/upgrade", response_model=Subscription)
async def upgrade_subscription(
    request: UpgradeSubscriptionRequest,
    current_user: dict = Depends(get_current_active_user),
    db = Depends(get_database)
):
    """Upgrade subscription"""
    user_id = get_user_id(current_user)
    service = SubscriptionService(db)
    
    try:
        subscription = await service.upgrade_subscription(
            user_id=user_id,
            new_plan_id=request.new_plan_id,
            reference=request.reference
        )
        return subscription
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

@router.post("/cancel", response_model=Subscription)
async def cancel_subscription(
    request: CancelSubscriptionRequest,
    current_user: dict = Depends(get_current_active_user),
    db = Depends(get_database)
):
    """Cancel subscription"""
    user_id = get_user_id(current_user)
    service = SubscriptionService(db)
    
    try:
        subscription = await service.cancel_subscription(
            user_id=user_id,
            cancel_immediately=request.cancel_immediately,
            reason=request.reason
        )
        return subscription
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

@router.get("/usage")
async def get_usage_stats(
    current_user: dict = Depends(get_current_active_user),
    db = Depends(get_database)
):
    """Get usage statistics"""
    try:
        user_id = get_user_id(current_user)
        service = SubscriptionService(db)
        subscription = await service.get_user_subscription(user_id)
        
        if not subscription:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No subscription found")
        
        plan = await service.get_plan(subscription.plan_id)
        limits = {}
        price_cents = 0
        currency = "USD"
        billing_interval = subscription.billing_interval
        if plan:
            billing_interval = plan.billing_interval or billing_interval
            if plan.price:
                price_cents = int(plan.price.amount or 0)
                currency = getattr(plan.price.currency, "value", plan.price.currency) or "USD"
            if plan.limits:
                manual = plan.limits.monthly_manual_applications
                auto = plan.limits.monthly_auto_applications
                account = await service._find_account(user_id)
                auto_bonus = int((account or {}).get("referral_bonus_auto_applications") or 0)
                limits = {
                    "manual_applications": manual.max_value if manual else 0,
                    "auto_applications": auto.max_value if auto else 0,
                    "referral_bonus_auto_applications": auto_bonus,
                }

        return {
            "subscription_id": subscription.id,
            "plan": plan.name if plan else subscription.plan_id,
            "plan_id": subscription.plan_id,
            "tier": subscription.plan_id,
            "status": subscription.status,
            "billing_interval": billing_interval,
            "price_cents": price_cents,
            "currency": currency,
            "limits": limits,
            "current_usage": subscription.current_usage,
            "usage_reset_date": subscription.usage_reset_date,
            "current_period_end": subscription.current_period_end
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching usage stats: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to load usage stats: {str(e)}"
        )

# ==================== REFERRAL ENDPOINTS ====================

@router.get("/referral/code")
async def get_referral_code(
    current_user: dict = Depends(get_current_active_user),
    db = Depends(get_database)
):
    """Get user's referral code"""
    user_id = get_user_id(current_user)
    user_oid = user_id if isinstance(user_id, ObjectId) else ObjectId(str(user_id))
    user = await db.users.find_one({"_id": user_oid})
    
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    
    referral_code = user.get("referral_code")
    
    if not referral_code:
        referral_code = f"{str(user_oid)[:4].upper()}{secrets.token_urlsafe(6).upper().replace('-', '').replace('_', '')[:6]}"
        await db.users.update_one({"_id": user_oid}, {"$set": {"referral_code": referral_code}})
    
    return {"code": referral_code}

@router.get("/referral/stats")
async def get_referral_stats_detailed(
    current_user: dict = Depends(get_current_active_user),
    db = Depends(get_database)
):
    """Get detailed referral statistics"""
    user_id = str(get_user_id(current_user))
    service = ReferralService(db)
    await service.sync_paid_referrals(user_id)
    
    stats = await service.get_referral_stats(user_id)
    
    active_referrals = await db.referrals.count_documents({
        "referrer_user_id": user_id,
        "status": "completed"
    })
    
    pending_referrals = await db.referrals.count_documents({
        "referrer_user_id": user_id,
        "status": "pending"
    })
    
    user = await service._find_user(user_id) or {}
    
    return {
        **stats,
        "active_referrals": active_referrals,
        "pending_referrals": pending_referrals,
        "total_rewards_earned": int(user.get("referral_auto_earned") or 0),
        "pending_rewards": stats.get("next_reward_in", 5)
    }

@router.get("/referral/list")
async def get_referral_list(
    page: int = 1,
    page_size: int = 10,
    status: Optional[str] = None,
    current_user: dict = Depends(get_current_active_user),
    db = Depends(get_database)
):
    """Get paginated referral list"""
    user_id = str(get_user_id(current_user))
    await ReferralService(db).sync_paid_referrals(user_id)
    
    query = {"referrer_user_id": user_id}
    if status and status != "all":
        query["status"] = status
    
    total = await db.referrals.count_documents(query)
    skip = (page - 1) * page_size
    total_pages = (total + page_size - 1) // page_size
    
    referrals_cursor = db.referrals.find(query).sort("referred_at", -1).skip(skip).limit(page_size)
    referrals = await referrals_cursor.to_list(length=page_size)
    
    for ref in referrals:
        ref["_id"] = str(ref.get("_id"))
        if ref.get("referee_user_id"):
            referee_id = ref["referee_user_id"]
            referee_query = {"_id": ObjectId(referee_id)} if ObjectId.is_valid(str(referee_id)) else {"_id": referee_id}
            referee = await db.users.find_one(referee_query)
            ref["referee_user_id"] = str(referee_id)
            if referee:
                ref["subscription_tier"] = referee.get("subscription_tier", "free")
        referred_at = ref.get("referred_at")
        if hasattr(referred_at, "isoformat"):
            ref["referred_at"] = referred_at.isoformat()
        completed_at = ref.get("completed_at")
        if hasattr(completed_at, "isoformat"):
            ref["completed_at"] = completed_at.isoformat()
        ref.pop("referrer_reward_amount", None)
        ref.pop("referee_reward_amount", None)
        
        ref["created_at"] = ref.get("referred_at")
        ref["reward_granted"] = bool(ref.get("referrer_reward_paid"))
        ref["reward_amount"] = 0
    
    return {
        "referrals": referrals,
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": total_pages
    }

@router.get("/referral/activity")
async def get_referral_activity(
    limit: int = 10,
    current_user: dict = Depends(get_current_active_user),
    db = Depends(get_database)
):
    """Get recent referral activity"""
    user_id = str(get_user_id(current_user))
    await ReferralService(db).sync_paid_referrals(user_id)
    
    referrals_cursor = db.referrals.find({
        "referrer_user_id": user_id
    }).sort("referred_at", -1).limit(limit)
    
    referrals = await referrals_cursor.to_list(length=limit)
    
    activities = []
    for ref in referrals:
        activity_type = "signup"
        email = ref.get("referee_email") or "A friend"
        description = f"New referral: {email}"
        
        if ref.get("status") == "completed":
            activity_type = "subscription"
            description = f"{email} subscribed"
        
        if ref.get("referrer_reward_paid"):
            activity_type = "reward"
            description = f"Reward earned from {email}"
        
        activities.append({
            "type": activity_type,
            "description": description,
            "created_at": ref.get("referred_at") or ref.get("completed_at")
        })
    
    return activities

@router.get("/referral/export")
async def export_referrals(
    current_user: dict = Depends(get_current_active_user),
    db = Depends(get_database)
):
    """Export referrals to CSV"""
    user_id = str(get_user_id(current_user))
    
    referrals_cursor = db.referrals.find({
        "referrer_user_id": user_id
    }).sort("referred_at", -1)
    
    referrals = await referrals_cursor.to_list(length=None)
    
    output = io.StringIO()
    writer = csv.writer(output)
    
    writer.writerow(["Email", "Referral Code", "Status", "Referred Date", "Completed Date", "Reward Granted"])
    
    for ref in referrals:
        writer.writerow([
            ref.get("referee_email", ""),
            ref.get("referral_code", ""),
            ref.get("status", ""),
            ref.get("referred_at", ""),
            ref.get("completed_at", ""),
            "Yes" if ref.get("referrer_reward_paid") else "No"
        ])
    
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=referrals_{datetime.utcnow().strftime('%Y%m%d')}.csv"}
    )

@router.post("/referrals", response_model=Referral)
async def create_referral(
    request: CreateReferralRequest,
    current_user: dict = Depends(get_current_active_user),
    db = Depends(get_database)
):
    """Create a referral"""
    user_id = get_user_id(current_user)
    service = ReferralService(db)
    
    try:
        referral = await service.create_referral(
            referrer_user_id=user_id,
            referee_email=request.referee_email
        )
        return referral
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

@router.get("/referrals")
async def get_my_referrals(
    status: Optional[str] = None,
    current_user: dict = Depends(get_current_active_user),
    db = Depends(get_database)
):
    """Get user's referrals"""
    user_id = get_user_id(current_user)
    service = ReferralService(db)
    referrals = await service.get_user_referrals(user_id=user_id, status=status)
    return {"referrals": referrals}

@router.get("/referrals/stats")
async def get_referral_stats(
    current_user: dict = Depends(get_current_active_user),
    db = Depends(get_database)
):
    """Get referral statistics"""
    user_id = get_user_id(current_user)
    service = ReferralService(db)
    stats = await service.get_referral_stats(user_id)
    return stats

@router.post("/referrals/complete")
async def complete_referral(
    request: CompleteReferralRequest,
    current_user: dict = Depends(get_current_active_user),
    db = Depends(get_database)
):
    """Attach this account to a referrer. Paid plans grant the referrer automated applications."""
    user_id = str(get_user_id(current_user))
    service = ReferralService(db)
    own_code = (current_user.get("referral_code") or "").upper()
    if request.referral_code and request.referral_code.strip().upper() == own_code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid referral code")

    recorded = None
    if request.referral_code:
        recorded = await service.record_signup(
            referee_user_id=user_id,
            referee_email=current_user.get("email") or "",
            code=request.referral_code
        )
        if not recorded:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid referral code")

    if current_user.get("subscription_tier") in ("basic", "premium"):
        await service.reward_for_paid_plan(user_id)

    return {"message": "Referral recorded", "referral_id": (recorded or {}).get("_id")}

# ==================== PAYSTACK WEBHOOKS ====================

@router.post("/webhooks/paystack")
async def paystack_webhook(request: Request, db = Depends(get_database)):
    """Handle Paystack webhook events"""
    from app.integrations.paystack_client import PaystackClient
    from app.core.config import settings
    
    payload = await request.body()
    sig_header = request.headers.get("x-paystack-signature")
    
    if not sig_header:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing signature header")
    
    paystack_client = PaystackClient()
    
    try:
        if not paystack_client.verify_webhook_signature(
            payload=payload,
            signature=sig_header,
            webhook_secret=getattr(settings, 'PAYSTACK_WEBHOOK_SECRET', settings.PAYSTACK_SECRET_KEY)
        ):
             raise ValueError("Invalid signature")
    except Exception as e:
        logger.error(f"Webhook signature verification failed: {e}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid signature")
    
    try:
        event = await request.json()
    except:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid JSON")
        
    event_type = event.get("event")
    event_data = event.get("data", {})
    logger.info(f"Received Paystack webhook: {event_type}")
    
    try:
        if event_type == "charge.success":
            # Successful payment
            reference = event_data.get("reference")
            logger.info(f"Payment success for reference: {reference}")
            # Can be used to activate subscription if not already active
            
        elif event_type == "subscription.create":
            # Subscription created
            logger.info(f"Subscription created: {event_data.get('subscription_code')}")
            
        elif event_type == "subscription.disable":
            # Subscription cancelled or expired
            logger.info(f"Subscription disabled: {event_data.get('subscription_code')}")
            # Find and update local subscription status if needed
            
        elif event_type == "invoice.payment_failed":
            # Payment failed
            logger.info(f"Invoice payment failed")
        
        return {"status": "success"}
        
    except Exception as e:
        logger.error(f"Webhook processing error: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Webhook processing failed")