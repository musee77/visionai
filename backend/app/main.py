"""
CVision - AI Job Application Platform
Main FastAPI Application
"""

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path
from app.services.core.cache_service import init_cache, close_cache
from app.core.config import settings


# Configure logging
logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


# Update the lifespan function
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events"""
    # Startup
    logger.info("Starting Synovae - AI Job Application Platform...")
    
    Path(settings.UPLOAD_DIR).mkdir(exist_ok=True)
    Path("logs").mkdir(exist_ok=True)
    
    # Initialize database connection
    try:
        from app.database import init_database, get_database
        await init_database()
        logger.info("Database connection established")
        
        # Initialize indexes for services
        try:
            from app.services.core.blog_service import BlogService
            db = await get_database()
            blog_service = BlogService(db)
            await blog_service.ensure_indexes()
            logger.info("Blog indexes ensured")
        except Exception as e:
            logger.warning(f"Failed to ensure blog indexes: {e}")
            
    except Exception as e:
        logger.error(f"Database connection failed: {e}")
    
    try:
        await init_cache()
        logger.info("Redis cache initialized")
    except Exception as e:
        logger.warning(f"Redis cache initialization failed: {e}")
    
    yield
    
    # Shutdown
    logger.info("Shutting down CVision...")
    
    try:
        await close_cache()
        logger.info("Cache connection closed")
    except Exception as e:
        logger.error(f"Error closing cache: {e}")
    
    try:
        from app.database import close_database_connection
        await close_database_connection()
        logger.info("Database connection closed")
    except Exception as e:
        logger.error(f"Error closing database: {e}")
    logger.info("CVision stopped")


# Create FastAPI application
app = FastAPI(
    title=settings.PROJECT_NAME,
    description="AI-Powered Job Application Platform - Automate your job search with intelligent CV customization and application tracking",
    version=settings.PROJECT_VERSION,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc"
)

_maintenance_cache = {"checked": 0.0, "on": False}


@app.middleware("http")
async def maintenance_gate(request: Request, call_next):
    """Block the API while an admin has maintenance mode on."""
    path = request.url.path
    if path.startswith("/api/v1/admin") or path.startswith("/docs") or path.startswith("/redoc") or path == "/health":
        return await call_next(request)
    now = time.time()
    if now - _maintenance_cache["checked"] > 15:
        try:
            from app.database import get_database
            db = await get_database()
            document = await db.app_settings.find_one({"_id": "system"})
            _maintenance_cache["on"] = bool((document or {}).get("maintenance_mode"))
        except Exception:
            _maintenance_cache["on"] = False
        _maintenance_cache["checked"] = now
    if _maintenance_cache["on"] and path.startswith("/api/"):
        return JSONResponse(status_code=423, content={"detail": "Synovae is down for maintenance."})
    return await call_next(request)


# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# Mount static files
frontend_assets_path = Path("/app/frontend/assets")
if not frontend_assets_path.exists():
    # Fallback to local path for development
    frontend_assets_path = Path("frontend/assets")

if frontend_assets_path.exists():
    app.mount("/assets", StaticFiles(directory=str(frontend_assets_path)), name="assets")
    logger.info(f"Mounted frontend assets directory from: {frontend_assets_path}")
else:
    logger.warning(f"Frontend assets directory not found at {frontend_assets_path}, skipping mount")

# Mount uploads directory
uploads_path = Path(settings.UPLOAD_DIR)
try:
    uploads_path.mkdir(parents=True, exist_ok=True)
    app.mount("/uploads", StaticFiles(directory=str(uploads_path)), name="uploads")
    logger.info(f"Mounted uploads directory: {uploads_path}")
except Exception as e:
    logger.error(f"Failed to mount uploads directory: {e}")

# Exception handlers
@app.exception_handler(ValueError)
async def value_error_handler(request: Request, exc: ValueError):
    logger.error(f"ValueError: {str(exc)}")
    return JSONResponse(
        status_code=400,
        content={"message": "Invalid input", "details": str(exc)}
    )

@app.exception_handler(500)
async def internal_server_error_handler(request: Request, exc: Exception):
    logger.error(f"Internal server error: {str(exc)}")
    return JSONResponse(
        status_code=500,
        content={
            "message": "Internal server error",
            "details": str(exc) if settings.DEBUG else "Something went wrong"
        }
    )

# Health check
@app.get("/health")
async def health_check():
    """CVision health check endpoint"""
    return {
        "status": "healthy",
        "platform": settings.PROJECT_NAME,
        "timestamp": int(time.time()),
        "version": settings.PROJECT_VERSION,
        "description": "AI Job Application Platform"
    }

@app.get("/")
async def root():
    """CVision root endpoint"""
    return {
        "platform": settings.PROJECT_NAME,
        "tagline": "AI-Powered Job Application Platform",
        "description": "Automate your job search with intelligent CV customization, job matching, and application tracking",
        "features": [
            "AI-Powered CV Parsing & Customization",
            "Smart Job Matching & Recommendations", 
            "Automated Cover Letter Generation",
            "Application Tracking & Analytics",
            "One-Click Apply with Auto-Fill",
            "Subscription Tiers (Free, Basic, Premium)"
        ],
        "subscription_tiers": {
            "free": f"{settings.FREE_TIER_MONTHLY_ATTEMPTS} search, {settings.FREE_TIER_JOBS_PER_ATTEMPT} jobs per search",
            "basic": f"${settings.BASIC_TIER_PRICE}/month - {settings.BASIC_TIER_MONTHLY_ATTEMPTS} searches, advanced features",
            "premium": f"${settings.PREMIUM_TIER_PRICE}/month - {settings.PREMIUM_TIER_MONTHLY_ATTEMPTS} searches, full automation"
        },
        "docs": "/docs",
        "health": "/health",
        "api_version": settings.API_V1_STR
    }

# Include API routes
try:
    from app.api.auth import router as auth_router
    app.include_router(auth_router, prefix=f"{settings.API_V1_STR}/auth", tags=["Authentication"])
    logger.info("Auth router loaded")
except ImportError as e:
    logger.warning(f"Auth router not available: {e}")

try:
    from app.api.users import router as users_router
    app.include_router(
        users_router,
        prefix=f"{settings.API_V1_STR}/users",
        tags=["Users"]
    )
    logger.info("User router loaded")
except ImportError as e:
    logger.warning(f"User router not available: {e}")

try:
    from app.api.admin import router as admin_router
    app.include_router(admin_router, prefix=f"{settings.API_V1_STR}/admin", tags=["Admin"])
    logger.info("Admin router loaded")
except ImportError as e:
    logger.warning(f"Admin router not available: {e}")

try:
    from app.api.documents import router as docs_router
    app.include_router(docs_router, prefix=f"{settings.API_V1_STR}/documents", tags=["Documents"])
    logger.info("Documents router loaded")
except ImportError as e:
    logger.warning(f"Documents router not available: {e}")

try:
    from app.api.jobs import router as jobs_router
    app.include_router(jobs_router, prefix=f"{settings.API_V1_STR}/jobs", tags=["Jobs"])
    logger.info("Jobs router loaded (Phase 2)")
except ImportError as e:
    logger.warning(f"Jobs router not available: {e}")

try:
    from app.api.generation import router as generation_router
    app.include_router(
        generation_router, 
        prefix=f"{settings.API_V1_STR}/generation", 
        tags=["Content Generation"]
    )
    logger.info("Generation router loaded (Phase 3)")
except ImportError as e:
    logger.warning(f"Generation router not available: {e}")

try:
    from app.api.subscriptions import router as subscriptions_router
    app.include_router(
        subscriptions_router,
        prefix=f"{settings.API_V1_STR}/subscriptions",
        tags=["Subscriptions & Billing"]
    )
    logger.info("Subscriptions router loaded (Phase 4)")
except ImportError as e:
    logger.warning(f"Subscriptions router not available: {e}")

try:
    from app.api.legacy import router as legacy_router
    app.include_router(
        legacy_router,
        prefix=f"{settings.API_V1_STR}/account",
        tags=["Legacy Endpoints"]
    )
    logger.info("Legacy endpoints router loaded")
except ImportError as e:
    logger.warning(f"Legacy router not available: {e}")

# For the admin endpoint
try:
    from app.api.legacy import router as legacy_admin_router
    app.include_router(
        legacy_admin_router, 
        prefix="/system/admin",
        tags=["Legacy Admin Endpoints"]
    )
    logger.info("Legacy admin endpoints router loaded")
except ImportError as e:
    logger.warning(f"Legacy admin router not available: {e}")

try:
    from app.api.notifications import router as notifications_router
    app.include_router(
        notifications_router,
        prefix=f"{settings.API_V1_STR}/notifications",
        tags=["Notifications"]
    )
    logger.info("Notifications router loaded")
except ImportError as e:
    logger.warning(f"Notifications router not available: {e}")

try:
    from app.api.applications import router as applications_router
    app.include_router(
        applications_router,
        prefix=f"{settings.API_V1_STR}/applications",
        tags=["Applications"]
    )
    logger.info("Applications router loaded")
except ImportError as e:
    logger.warning(f"Applications router not available: {e}")


try:
    from app.api import browser_automation
    app.include_router(
        browser_automation.router,
        prefix=f"{settings.API_V1_STR}/browser-automation",
        tags=["Browser Automation"]
    )
    logger.info("Browser automation router loaded")
except ImportError as e:
    logger.warning(f"Browser automation router not available: {e}")

try:
    from app.api import email_applications
    app.include_router(
        email_applications.router,
        prefix=f"{settings.API_V1_STR}/email-applications",
        tags=["Email Applications"]
    )
    logger.info("Email applications router loaded")
except ImportError as e:
    logger.warning(f"Email applications router not available: {e}")

try:
    from app.api.auto_apply import router as auto_apply_router
    app.include_router(
        auto_apply_router,
        prefix=f"{settings.API_V1_STR}/auto-apply",
        tags=["Auto Apply"]
    )
    logger.info("Auto-apply router loaded")
except ImportError as e:
    logger.warning(f"Auto-apply router not available: {e}")

try:
    from app.api.blog import router as blog_router
    app.include_router(
        blog_router,
        prefix=f"{settings.API_V1_STR}/blog",
        tags=["Blog"]
    )
    logger.info("Blog router loaded")
except ImportError as e:
    logger.warning(f"Blog router not available: {e}")

try:
    from app.api.email_analysis import router as email_analysis_router
    app.include_router(
        email_analysis_router,
        prefix=f"{settings.API_V1_STR}/email-analysis",
        tags=["Email Analysis"]
    )
    logger.info("Email analysis router loaded")
except ImportError as e:
    logger.warning(f"Email analysis router not available: {e}")

try:
    from app.api.migration import router as migration_router
    app.include_router(
        migration_router,
        prefix=f"{settings.API_V1_STR}",
        tags=["Migration"]
    )
    logger.info("Migration router loaded")
except ImportError as e:
    logger.warning(f"Migration router not available: {e}")

try:
    from app.api.support import router as support_router
    app.include_router(
        support_router,
        prefix=f"{settings.API_V1_STR}/support",
        tags=["Support"]
    )
    logger.info("Support router loaded")
except ImportError as e:
    logger.warning(f"Support router not available: {e}")





# Catch-all for missing routes during development
@app.get("/api/v1/{path:path}")
async def api_fallback(path: str):
    """Fallback for missing API routes during development"""
    return JSONResponse(
        status_code=404,
        content={
            "message": f"API endpoint /{path} not implemented yet",
            "available_endpoints": [
                "/health",
                "/docs",
                "/api/v1/auth/*",
                "/api/v1/documents/*"
            ]
        }
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",  # Fixed module path
        host=settings.HOST,
        port=settings.PORT,
        reload=True if settings.DEBUG else False,
        log_level=settings.LOG_LEVEL.lower()
    )