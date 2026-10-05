# backend/app/services/referral_service.py

from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
import logging
import uuid
import secrets
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.subscription import Referral, ReferralProgram, Money
from app.models.user import SubscriptionTier
from app.models.common import Currency

logger = logging.getLogger(__name__)

class ReferralService:
    def __init__(self, db: AsyncIOMotorDatabase):
        self.db = db
        
        # 5 automated applications for every 5 friends who subscribe to Basic or Premium
        self.REFERRAL_REWARDS = {
            "auto_applications_per_milestone": 5,
            "milestone_referrals": 5,
            "paid_tiers": [SubscriptionTier.BASIC.value, SubscriptionTier.PREMIUM.value]
        }

    async def _find_user(self, user_id):
        if not user_id:
            return None
        if isinstance(user_id, ObjectId):
            return await self.db.users.find_one({"_id": user_id})
        if ObjectId.is_valid(str(user_id)):
            return await self.db.users.find_one({"_id": ObjectId(str(user_id))})
        return await self.db.users.find_one({"_id": user_id})

    async def record_signup(self, referee_user_id: str, referee_email: str, code: str) -> Optional[Dict[str, Any]]:
        """Attach a new account to the referrer who owns this code."""
        normalized = (code or "").strip().upper()
        if not normalized:
            return None

        referrer = await self.db.users.find_one({"referral_code": normalized})
        invite = None
        if not referrer:
            invite = await self.db.referrals.find_one({
                "referral_code": normalized,
                "status": "pending"
            })
            if invite:
                referrer = await self._find_user(invite.get("referrer_user_id"))
        if not referrer:
            return None

        referrer_id = str(referrer["_id"])
        referee_id = str(referee_user_id)
        if referrer_id == referee_id:
            return None

        referee_oid = ObjectId(referee_id) if ObjectId.is_valid(referee_id) else referee_id
        await self.db.users.update_one(
            {
                "_id": referee_oid,
                "$or": [
                    {"referred_by": None},
                    {"referred_by": {"$exists": False}}
                ]
            },
            {"$set": {"referred_by": referrer_id, "updated_at": datetime.utcnow()}}
        )

        existing = await self.db.referrals.find_one({
            "referrer_user_id": referrer_id,
            "referee_user_id": referee_id
        })
        if not existing and referee_email:
            existing = await self.db.referrals.find_one({
                "referrer_user_id": referrer_id,
                "referee_email": referee_email,
                "status": "pending"
            })
        if not existing and invite:
            invite_referee = str(invite.get("referee_user_id") or "")
            invite_email = (invite.get("referee_email") or "").lower()
            same_person = invite_referee in ("", referee_id) or invite_email == (referee_email or "").lower()
            if same_person:
                existing = invite
        if existing:
            await self.db.referrals.update_one(
                {"_id": existing["_id"]},
                {"$set": {
                    "referee_user_id": referee_id,
                    "referee_email": referee_email or existing.get("referee_email"),
                    "referrer_user_id": referrer_id
                }}
            )
            existing["referee_user_id"] = referee_id
            return existing

        referral_data = {
            "_id": f"ref_{uuid.uuid4().hex[:8]}",
            "program_id": "default",
            "referrer_user_id": referrer_id,
            "referee_email": referee_email,
            "referee_user_id": referee_id,
            "referrer_code": normalized,
            "referral_code": f"signup_{uuid.uuid4().hex}",
            "status": "pending",
            "referred_at": datetime.utcnow(),
            "referrer_reward_paid": False,
            "referee_reward_paid": False,
            "metadata": {"source": "signup"}
        }
        await self.db.referrals.insert_one(referral_data)
        logger.info(f"Recorded signup referral {referral_data['_id']} for {referrer_id}")
        return referral_data

    async def reward_for_paid_plan(self, referee_user_id: str) -> None:
        """Complete the referee's referral once they subscribe to Basic or Premium."""
        referee_id = str(referee_user_id)
        referral = await self.db.referrals.find_one({
            "referee_user_id": referee_id,
            "status": "pending"
        })
        if not referral:
            referee = await self._find_user(referee_id)
            referrer_id = (referee or {}).get("referred_by")
            if not referrer_id:
                return
            referral = await self.db.referrals.find_one({
                "referrer_user_id": str(referrer_id),
                "referee_user_id": referee_id
            })
        if not referral or referral.get("status") == "completed":
            return

        await self.db.referrals.update_one(
            {"_id": referral["_id"]},
            {"$set": {"status": "completed", "completed_at": datetime.utcnow()}}
        )
        await self._grant_auto_bonus(referral["referrer_user_id"])

    async def sync_paid_referrals(self, referrer_user_id: str) -> None:
        """Create any missing signup rows, then complete friends already on Basic or Premium."""
        referrer_id = str(referrer_user_id)
        referred_query = [{"referred_by": referrer_id}]
        if ObjectId.is_valid(referrer_id):
            referred_query.append({"referred_by": ObjectId(referrer_id)})
        friends = await self.db.users.find({"$or": referred_query}).to_list(length=200)
        for friend in friends:
            friend_id = str(friend["_id"])
            if friend_id == referrer_id:
                continue
            existing = await self.db.referrals.find_one({
                "referrer_user_id": referrer_id,
                "referee_user_id": friend_id
            })
            if existing:
                continue
            await self.db.referrals.insert_one({
                "_id": f"ref_{uuid.uuid4().hex[:8]}",
                "program_id": "default",
                "referrer_user_id": referrer_id,
                "referee_email": friend.get("email") or "",
                "referee_user_id": friend_id,
                "referrer_code": (friend.get("referred_with_code") or ""),
                "referral_code": f"signup_{uuid.uuid4().hex}",
                "status": "pending",
                "referred_at": friend.get("created_at") or datetime.utcnow(),
                "referrer_reward_paid": False,
                "referee_reward_paid": False,
                "metadata": {"source": "signup"}
            })

        pending = await self.db.referrals.find({
            "referrer_user_id": str(referrer_user_id),
            "status": "pending",
            "referee_user_id": {"$exists": True}
        }).to_list(length=100)
        for referral in pending:
            referee = await self._find_user(referral.get("referee_user_id"))
            tier = (referee or {}).get("subscription_tier")
            if tier in self.REFERRAL_REWARDS["paid_tiers"]:
                await self.reward_for_paid_plan(str(referee["_id"]))
    
    def generate_referral_code(self, user_id: str) -> str:
        """Generate unique referral code"""
        # Create a user-friendly referral code
        random_part = secrets.token_urlsafe(6).upper().replace('-', '').replace('_', '')
        return f"{user_id[:4].upper()}{random_part[:6]}"
    
    async def create_referral_program(
        self,
        name: str,
        description: str,
        referrer_reward_amount: int,
        referee_reward_amount: int,
        valid_until: Optional[datetime] = None
    ) -> ReferralProgram:
        """Create a referral program"""
        
        program_data = {
            "_id": f"prog_{uuid.uuid4().hex[:8]}",
            "name": name,
            "description": description,
            "is_active": True,
            "referrer_reward_type": "credit",
            "referrer_reward_amount": Money(amount=referrer_reward_amount, currency=Currency.USD),
            "referee_reward_type": "discount",
            "referee_reward_amount": Money(amount=referee_reward_amount, currency=Currency.USD),
            "minimum_subscription_duration": 30,
            "maximum_rewards_per_user": None,
            "valid_from": datetime.utcnow(),
            "valid_until": valid_until,
            "total_referrals": 0,
            "successful_referrals": 0,
            "total_rewards_paid": Money(amount=0, currency=Currency.USD)
        }
        
        await self.db.referral_programs.insert_one(program_data)
        return ReferralProgram(**program_data)
    
    async def create_referral(
        self,
        referrer_user_id: str,
        referee_email: str,
        program_id: Optional[str] = None
    ) -> Referral:
        """Create a referral"""
        
        # Get or create default program
        if not program_id:
            program = await self.db.referral_programs.find_one({"is_active": True})
            if not program:
                # Create default program
                default_program = await self.create_referral_program(
                    name="Default Referral Program",
                    description="Refer friends and earn rewards",
                    referrer_reward_amount=1000,  # $10 credit
                    referee_reward_amount=500  # $5 discount
                )
                program_id = default_program.id
            else:
                program_id = program["_id"]
        
        referrer = await self._find_user(referrer_user_id)
        referrer_user_id = str(referrer["_id"]) if referrer else str(referrer_user_id)
        referral_code = (referrer or {}).get("referral_code") or self.generate_referral_code(referrer_user_id)
        
        # Check if referral already exists
        existing = await self.db.referrals.find_one({
            "referrer_user_id": referrer_user_id,
            "referee_email": referee_email
        })
        
        if existing:
            return Referral(**existing)
        
        referral_data = {
            "_id": f"ref_{uuid.uuid4().hex[:8]}",
            "program_id": program_id,
            "referrer_user_id": referrer_user_id,
            "referee_email": referee_email,
            "referral_code": referral_code,
            "status": "pending",
            "referred_at": datetime.utcnow(),
            "referrer_reward_paid": False,
            "referee_reward_paid": False,
            "metadata": {}
        }
        
        await self.db.referrals.insert_one(referral_data)
        
        # Update program stats
        await self.db.referral_programs.update_one(
            {"_id": program_id},
            {"$inc": {"total_referrals": 1}}
        )
        
        logger.info(f"Created referral {referral_data['_id']} for user {referrer_user_id}")
        return Referral(**referral_data)
    
    async def complete_referral(
        self,
        referral_code: str,
        referee_user_id: str
    ) -> Referral:
        """Complete a referral when referee signs up"""
        
        referral = await self.db.referrals.find_one({"referral_code": referral_code})
        if not referral:
            raise ValueError("Invalid referral code")
        
        if referral["status"] != "pending":
            raise ValueError("Referral already completed or expired")
        
        # Update referral
        update_data = {
            "referee_user_id": referee_user_id,
            "status": "completed",
            "completed_at": datetime.utcnow()
        }
        
        await self.db.referrals.update_one(
            {"_id": referral["_id"]},
            {"$set": update_data}
        )
        
        await self.db.referral_programs.update_one(
            {"_id": referral["program_id"]},
            {"$inc": {"successful_referrals": 1}}
        )
        await self._grant_auto_bonus(referral["referrer_user_id"])

        logger.info(f"Completed referral {referral['_id']}")
        return Referral(**{**referral, **update_data})
    
    async def _paid_referral_count(self, referrer_user_id: str) -> int:
        completed = await self.db.referrals.find({
            "referrer_user_id": str(referrer_user_id),
            "status": "completed",
            "referee_user_id": {"$exists": True}
        }).to_list(length=None)

        paid = 0
        for referral in completed:
            referee = await self._find_user(referral.get("referee_user_id"))
            if referee and referee.get("subscription_tier") in self.REFERRAL_REWARDS["paid_tiers"]:
                paid += 1
        return paid

    async def _grant_auto_bonus(self, referrer_user_id: str) -> None:
        """Add 5 automated applications for each new group of 5 paid referrals."""
        paid = await self._paid_referral_count(referrer_user_id)
        milestone = self.REFERRAL_REWARDS["milestone_referrals"]
        earned = (paid // milestone) * self.REFERRAL_REWARDS["auto_applications_per_milestone"]
        referrer = await self._find_user(referrer_user_id)
        if not referrer:
            return

        already = int(referrer.get("referral_auto_earned") or 0)
        if earned <= already:
            return

        delta = earned - already
        await self.db.users.update_one(
            {"_id": referrer["_id"]},
            {
                "$inc": {"referral_bonus_auto_applications": delta},
                "$set": {"referral_auto_earned": earned}
            }
        )
        logger.info(f"Granted {delta} automated applications to {referrer_user_id} ({paid} paid referrals)")

    async def grant_referrer_reward(
        self,
        referrer_user_id: str,
        referral_id: str
    ):
        """Grant the automated-application bonus for a completed paid referral."""
        await self._grant_auto_bonus(referrer_user_id)
        await self.db.referrals.update_one(
            {"_id": referral_id},
            {"$set": {"referrer_reward_paid": True}}
        )
    
    async def grant_referee_reward(
        self,
        referee_user_id: str,
        program: Dict[str, Any]
    ):
        """Grant reward to referee (discount or credit)"""
        
        reward_amount = program["referee_reward_amount"]["amount"]
        
        # Create account credit
        credit_data = {
            "_id": f"credit_{uuid.uuid4().hex[:8]}",
            "user_id": referee_user_id,
            "credit_type": "referral",
            "amount": Money(amount=reward_amount, currency=Currency.USD),
            "description": f"Referral reward - {program['name']}",
            "expires_at": datetime.utcnow() + timedelta(days=90),
            "is_used": False,
            "source": "referral",
            "source_id": program["_id"],
            "created_at": datetime.utcnow()
        }
        
        await self.db.account_credits.insert_one(credit_data)
        logger.info(f"Granted referee reward to user {referee_user_id}")
    
    async def get_user_referrals(
        self,
        user_id: str,
        status: Optional[str] = None
    ) -> List[Referral]:
        """Get user's referrals"""
        
        query = {"referrer_user_id": str(user_id)}
        if status:
            query["status"] = status
        
        referrals = await self.db.referrals.find(query).to_list(length=100)
        return [Referral(**ref) for ref in referrals]
    
    async def get_referral_stats(self, user_id: str) -> Dict[str, Any]:
        """Get user's referral statistics"""
        user_id = str(user_id)

        total_referrals = await self.db.referrals.count_documents({
            "referrer_user_id": user_id
        })
        
        successful_referrals = await self.db.referrals.count_documents({
            "referrer_user_id": user_id,
            "status": "completed"
        })
        
        pending_referrals = await self.db.referrals.count_documents({
            "referrer_user_id": user_id,
            "status": "pending"
        })
        
        paid_referrals_count = await self._paid_referral_count(user_id)
        user = await self._find_user(user_id) or {}
        bonus_auto_apps = int(user.get("referral_bonus_auto_applications") or 0)

        milestone_referrals = self.REFERRAL_REWARDS["milestone_referrals"]
        remainder = paid_referrals_count % milestone_referrals
        next_reward_in = milestone_referrals - remainder if remainder else milestone_referrals

        return {
            "total_referrals": total_referrals,
            "successful_referrals": successful_referrals,
            "pending_referrals": pending_referrals,
            "paid_referrals": paid_referrals_count,
            "bonus_manual_applications": 0,
            "bonus_auto_applications": bonus_auto_apps,
            "referral_auto_earned": int(user.get("referral_auto_earned") or 0),
            "bonus_searches_earned": bonus_auto_apps,
            "referral_code": user.get("referral_code"),
            "next_reward_in": next_reward_in
        }
    
    async def validate_referral_code(self, referral_code: str) -> bool:
        """A code is valid when it belongs to an account or a pending invite."""
        normalized = (referral_code or "").strip().upper()
        if not normalized:
            return False
        owner = await self.db.users.find_one({"referral_code": normalized})
        if owner:
            return True
        referral = await self.db.referrals.find_one({
            "referral_code": normalized,
            "status": "pending"
        })
        return referral is not None
    
    async def check_referee_eligibility(
        self,
        referee_user_id: str,
        minimum_days: int = 30
    ) -> bool:
        """Check if referee has been subscribed for minimum period"""
        
        subscription = await self.db.subscriptions.find_one({"user_id": referee_user_id})
        if not subscription:
            return False
        
        created_at = subscription.get("created_at")
        if not created_at:
            return False
        
        days_subscribed = (datetime.utcnow() - created_at).days
        return days_subscribed >= minimum_days