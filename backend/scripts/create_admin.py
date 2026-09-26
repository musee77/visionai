import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
import sys
from datetime import datetime
import os
import secrets

# Add parent directory to path to import app modules
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app.core.config import settings
from app.core.security import hash_password

# Use settings from environment
MONGODB_URL = settings.MONGODB_URL
DB_NAME = settings.DATABASE_NAME

async def create_admin():
    print(f"Connecting to {DB_NAME}...")
    try:
        client = AsyncIOMotorClient(MONGODB_URL)
        db = client[DB_NAME]
        users_collection = db.users
        
        email = "admin@synovae.com"
        password = "password123"  # Plain text password for display
        
        hashed_password = hash_password(password)
        
        # Check if user exists
        existing = await users_collection.find_one({"email": email})
        if existing:
            print(f"\n⚠️  User {email} already exists!")
            print("Deleting existing user and creating fresh...")
            await users_collection.delete_one({"email": email})
            print("✅ Existing user deleted.")

        referral_code = "ADMIN123"
        while await users_collection.find_one({"referral_code": referral_code}, {"_id": 1}):
            referral_code = f"ADMIN{secrets.token_hex(4).upper()}"

        # Create new user
        print(f"\n🔨 Creating new admin user: {email}")
        
        new_user = {
            "email": email,
            "password": hashed_password,
            "first_name": "Admin",
            "last_name": "User",
            "role": "admin",
            "is_active": True,
            "is_superuser": True,
            "is_verified": True,
            "subscription_tier": "premium",
            "subscription_status": "active",
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
            "usage_stats": {},
            "preferences": {},
            "profile": {},
            "referral_code": referral_code
        }
        
        await users_collection.insert_one(new_user)
        
        print("\n" + "=" * 60)
        print("✅ Admin user created successfully!")
        print("=" * 60)
        print(f"📧 Email: {email}")
        print(f"🔑 Password: {password}")
        print("=" * 60)
        print("\n⚠️  IMPORTANT: Change this password after first login!")

    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        client.close()

if __name__ == "__main__":
    if sys.platform == 'win32':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(create_admin())