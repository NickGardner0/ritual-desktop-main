"""
Ritual FastAPI Backend
Primary API entrypoint for dashboard, desktop, and mobile clients.
"""

from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import JSONResponse
from typing import Optional, Dict, Any
import os
import asyncio
from datetime import datetime
import logging
from dotenv import load_dotenv
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration

# Load environment variables FIRST before importing services
# .env.development overrides .env for local dev (Clerk dev keys, etc.)
load_dotenv(".env.development", override=True)
load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("watchfiles.main").setLevel(logging.WARNING)

SENTRY_DSN = os.getenv("SENTRY_BACKEND_DSN") or os.getenv("SENTRY_DSN")
SENTRY_ENVIRONMENT = (
    os.getenv("SENTRY_ENVIRONMENT")
    or os.getenv("RAILWAY_ENVIRONMENT")
    or ("development" if os.getenv("DEBUG", "false").lower() == "true" else "production")
)
SENTRY_RELEASE = os.getenv("SENTRY_RELEASE") or os.getenv("RAILWAY_GIT_COMMIT_SHA")

if SENTRY_DSN:
    sentry_sdk.init(
        dsn=SENTRY_DSN,
        environment=SENTRY_ENVIRONMENT,
        release=SENTRY_RELEASE,
        traces_sample_rate=float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.1")),
        integrations=[FastApiIntegration(transaction_style="endpoint")],
    )
    logger.info("Sentry backend monitoring enabled")
    if os.getenv("SENTRY_BACKEND_SMOKE_TEST", "0").lower() in {"1", "true", "yes", "on"}:
        sentry_sdk.set_tag("runtime", "backend")
        sentry_sdk.set_tag("surface", "fastapi")
        sentry_sdk.capture_message("Sentry smoke test: backend", level="info")

# Import our services
from services.habits_service import HabitsService
from services.auth_service import AuthService
from services.tinybird_service import TinybirdService
from services.whoop_service import WhoopService
from services.tesla_service import TeslaService
from services.user_service import UserService
from api.analytics import create_analytics_router
from api.biometrics import create_biometrics_router
from api.core import create_core_router
from api.conversations import create_conversations_router
from api.financial import create_financial_router
from api.integrations import create_whoop_router, create_tesla_router
from api.imports import create_imports_router
from api.search import create_search_router
from api.screen_time import create_screen_time_router
from api.screenshot import create_screenshot_router
from api.wearables import create_wearables_router
from database.connection import (
    complete_database_startup_maintenance,
    get_db_session,
    get_database_runtime_health,
)
from sqlalchemy import text

app = FastAPI(title="Ritual Backend API", version="1.0.0")
STARTUP_MAINTENANCE_DELAY_SECONDS = float(
    os.getenv("STARTUP_MAINTENANCE_DELAY_SECONDS", "15")
)
ENABLE_STARTUP_MAINTENANCE_TASK = os.getenv(
    "ENABLE_STARTUP_MAINTENANCE_TASK", "0"
).lower() in {"1", "true", "yes", "on"}

# Rate limiting setup
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS middleware to allow frontend requests
# For development
ALLOWED_ORIGINS = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:3000,https://localhost:3000,tauri://localhost"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

# Security
security = HTTPBearer()

# Initialize services
habits_service = HabitsService()
auth_service = AuthService()
try:
    tinybird_service: Optional[TinybirdService] = TinybirdService()
    logger.info("Tinybird service initialized")
except Exception as e:
    tinybird_service = None
    logger.warning("Tinybird service unavailable; analytics sync disabled: %s", e)
whoop_service = WhoopService()
tesla_service = TeslaService()
user_service = UserService()


def require_tinybird() -> TinybirdService:
    if tinybird_service is None:
        raise HTTPException(
            status_code=503,
            detail="Tinybird analytics is not configured on this backend instance.",
        )
    return tinybird_service

# Dependency to get current user from JWT token
async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Extract user from JWT token - mirrors Supabase auth"""
    try:
        user = await auth_service.get_user_from_token(credentials.credentials)
        if not user:
            raise HTTPException(status_code=401, detail="Invalid authentication token")
        return user
    except Exception as e:
        raise HTTPException(status_code=401, detail="Authentication failed.")


app.include_router(
    create_analytics_router(
        limiter=limiter,
        get_current_user=get_current_user,
        require_tinybird=require_tinybird,
        habits_service=habits_service,
    )
)
app.include_router(
    create_biometrics_router(
        get_current_user=get_current_user,
    )
)
app.include_router(
    create_whoop_router(
        get_current_user=get_current_user,
        whoop_service=whoop_service,
    )
)
app.include_router(
    create_tesla_router(
        get_current_user=get_current_user,
        tesla_service=tesla_service,
    )
)
app.include_router(
    create_core_router(
        limiter=limiter,
        get_current_user=get_current_user,
        user_service=user_service,
        habits_service=habits_service,
        tinybird_service=tinybird_service,
    )
)
app.include_router(
    create_conversations_router(
        get_current_user=get_current_user,
    )
)
app.include_router(
    create_search_router(
        get_current_user=get_current_user,
    )
)
app.include_router(
    create_screenshot_router(
        limiter=limiter,
        get_current_user=get_current_user,
        habits_service=habits_service,
    )
)
app.include_router(
    create_wearables_router(
        limiter=limiter,
        get_current_user=get_current_user,
    )
)
app.include_router(
    create_screen_time_router(
        get_current_user=get_current_user,
    )
)
app.include_router(
    create_imports_router(
        limiter=limiter,
        get_current_user=get_current_user,
        habits_service=habits_service,
        tinybird_service=tinybird_service,
    )
)
app.include_router(
    create_financial_router(
        get_current_user=get_current_user,
    )
)

@app.get("/")
async def root():
    return {"message": "Ritual Backend API", "status": "running"}

@app.get("/ready")
async def ready_check():
    """Lightweight readiness probe for platform health checks."""
    return {"status": "ready"}

@app.get("/health")
async def health_check():
    """
    Health check endpoint with dependency connectivity checks.
    """
    checks: Dict[str, Any] = {}
    status = "healthy"
    status_code = 200

    # Database liveness/readiness probe.
    try:
        async with get_db_session() as session:
            await session.execute(text("SELECT 1"))
        db_runtime = get_database_runtime_health()
        checks["database"] = {
            "status": "ok",
            "runtime": db_runtime,
        }
    except Exception as exc:
        status = "unhealthy"
        status_code = 503
        checks["database"] = {
            "status": "error",
            "error": str(exc),
            "runtime": get_database_runtime_health(),
        }

    # Tinybird connectivity probe when configured.
    if tinybird_service is None:
        if status == "healthy":
            status = "degraded"
        checks["tinybird"] = {
            "status": "unavailable",
            "reason": "Tinybird service is not configured on this backend instance.",
        }
    else:
        tinybird_check = await tinybird_service.check_connectivity()
        checks["tinybird"] = tinybird_check
        if tinybird_check.get("status") != "ok":
            status = "unhealthy"
            status_code = 503

    # Cloud memory provider probe when enabled.
    memory_cloud_enabled = (os.getenv("RITUAL_MEMORY_CLOUD_ENABLED") or "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    if memory_cloud_enabled:
        try:
            from services.memory_embedding_service import get_memory_index_health
            from services.memory_turbopuffer_service import TurbopufferService

            index_health = get_memory_index_health()
            provider_health = await TurbopufferService().health_check()
            memory_status = "ok" if provider_health.get("status") == "ok" else "degraded"

            checks["memory_cloud"] = {
                "status": memory_status,
                "provider": provider_health,
                "index": index_health,
            }
            if memory_status != "ok" and status == "healthy":
                status = "degraded"
        except Exception as exc:
            checks["memory_cloud"] = {
                "status": "error",
                "error": str(exc),
            }
            status = "degraded" if status == "healthy" else status
    else:
        checks["memory_cloud"] = {"status": "disabled"}

    return JSONResponse(
        status_code=status_code,
        content={
            "status": status,
            "timestamp": datetime.utcnow().isoformat(),
            "checks": checks,
        },
    )


# ================================
# REAL-TIME ENDPOINTS - WebSocket for live updates
# ================================

from fastapi import WebSocket, WebSocketDisconnect
from services.realtime import websocket_manager

@app.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: str):
    """
    WebSocket endpoint for real-time updates
    Replaces Supabase real-time subscriptions
    """
    auth_header = websocket.headers.get("authorization")
    token = auth_service.extract_token_from_header(auth_header or "")

    # Fallback for websocket clients that pass token as a query string.
    if not token:
        token = websocket.query_params.get("token")

    if not token:
        await websocket.close(code=1008, reason="Authentication required")
        return

    user = await auth_service.get_user_from_token(token)
    if not user or user.get("id") != user_id:
        await websocket.close(code=1008, reason="Invalid authentication token")
        return

    await websocket_manager.connect(websocket, user_id)
    try:
        while True:
            # Keep connection alive
            data = await websocket.receive_text()
            # Echo back for heartbeat
            await websocket.send_text(f"pong: {data}")
    except WebSocketDisconnect:
        websocket_manager.disconnect(websocket, user_id)

# ================================
# SCREENSHOT ANALYSIS ENDPOINTS - Extracted to api/screenshot.py
# ================================

# ================================
# WEARABLES API - Extracted to api/wearables.py
# ================================

# ================================
# ROBUST IMPORT SYSTEM ENDPOINTS - Extracted to api/imports.py
# ================================

# ================================
# SEARCH API - Typesense Integration

# ================================
# WATCHER API ROUTER - Computer Activity Tracking
# ================================

from api.memory import router as memory_router
app.include_router(memory_router)

from api.watcher import router as watcher_router
app.include_router(watcher_router)

from api.sendblue import router as sendblue_router
app.include_router(sendblue_router)

from api.vcard import router as vcard_router
app.include_router(vcard_router)


def _memory_cloud_enabled() -> bool:
    return (os.getenv("RITUAL_MEMORY_CLOUD_ENABLED") or "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


async def _memory_embedding_worker_loop() -> None:
    from services.memory_embedding_service import get_memory_index_health, process_embedding_jobs_with_guard

    while True:
        pending_jobs = 0
        try:
            health = get_memory_index_health()
            pending_jobs = int(health.get("pending_jobs") or 0)
            if pending_jobs > 2000:
                batch_size = 256
            elif pending_jobs > 500:
                batch_size = 256
            elif pending_jobs > 100:
                batch_size = 128
            else:
                batch_size = 64
            await process_embedding_jobs_with_guard(batch_size=batch_size)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("Memory embedding worker loop error: %s", exc)

        if pending_jobs > 2000:
            sleep_seconds = 0.5
        elif pending_jobs > 500:
            sleep_seconds = 1.0
        elif pending_jobs > 100:
            sleep_seconds = 3.0
        elif pending_jobs > 0:
            sleep_seconds = 6.0
        else:
            sleep_seconds = 15.0
        await asyncio.sleep(sleep_seconds)


async def _memory_retention_loop() -> None:
    from services.memory_retention_service import run_memory_retention_once

    while True:
        try:
            await run_memory_retention_once(limit=2000)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("Memory retention loop error: %s", exc)
        await asyncio.sleep(10 * 60)


async def _semantic_summary_worker_loop() -> None:
    """Background worker that generates semantic summaries for new context_snapshots.

    Runs continuously with adaptive sleep:
    - High backlog (>100 remaining): process every 30s
    - Medium backlog (>0 remaining): process every 2 min
    - Caught up: check every 5 min
    """
    from services.memory_semantic_summary_service import process_pending_summaries
    from services.watcher_service_local_db import get_local_activity_db_path_impl

    # Initial delay to let other services start first
    await asyncio.sleep(10)

    while True:
        remaining = 0
        try:
            db_path = get_local_activity_db_path_impl()
            result = await asyncio.to_thread(process_pending_summaries, db_path, 20)
            remaining = result.get("remaining", 0)
            processed = result.get("processed", 0)
            if processed > 0:
                logger.info(
                    "Semantic summary worker: processed %d, remaining %d",
                    processed, remaining,
                )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("Semantic summary worker loop error: %s", exc)

        if remaining > 100:
            sleep_seconds = 30
        elif remaining > 0:
            sleep_seconds = 120
        else:
            sleep_seconds = 300
        await asyncio.sleep(sleep_seconds)


async def _post_startup_initialization() -> None:
    """Run nonessential startup work after readiness is available."""
    logger = logging.getLogger("uvicorn")

    try:
        migration_summary = await complete_database_startup_maintenance()
        logger.info(
            "🗃️ Deferred database startup maintenance complete (status=%s, warnings=%s)",
            migration_summary.get("status"),
            migration_summary.get("warning_count"),
        )
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        logger.warning("⚠️ Deferred database startup maintenance failed: %s", exc)
        return

    try:
        from services.search_service import search_service

        await search_service.ensure_collections()
        logger.info("🔎 Typesense search collections are ready")
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        logger.warning("⚠️ Typesense search initialization skipped: %s", exc)

    if _memory_cloud_enabled():
        try:
            from services.memory_cloud_store import get_memory_db, memory_cloud_db_path

            with get_memory_db() as conn:
                conn.execute("SELECT COUNT(*) FROM memory_chunks").fetchone()
            logger.info("🧠 Cloud memory metadata DB ready: %s", memory_cloud_db_path())

            app.state.memory_worker_task = asyncio.create_task(_memory_embedding_worker_loop())
            app.state.memory_retention_task = asyncio.create_task(_memory_retention_loop())
            logger.info("🧠 Cloud memory worker loops started (embedding + retention)")
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("⚠️ Cloud memory worker loops not started (schema preflight failed): %s", exc)


async def _delayed_post_startup_initialization() -> None:
    """Wait briefly so platform readiness checks can succeed before heavy startup work."""
    if STARTUP_MAINTENANCE_DELAY_SECONDS > 0:
        await asyncio.sleep(STARTUP_MAINTENANCE_DELAY_SECONDS)
    await _post_startup_initialization()


# Startup and shutdown events
@app.on_event("startup")
async def startup_event():
    """Initialize database and services on startup"""
    import logging
    logger = logging.getLogger("uvicorn")
    
    from database.connection import init_database
    await init_database(fast_startup=True)
    logger.info("🚀 Ritual Backend API started successfully!")
    logger.info("📅 Automated Whoop sync is handled by Trigger.dev (runs daily at 9 AM)")
    logger.info("🖥️ Watcher API ready for computer activity tracking")
    app.state.memory_worker_task = None
    app.state.memory_retention_task = None
    app.state.semantic_summary_task = None
    app.state.startup_maintenance_task = None
    if ENABLE_STARTUP_MAINTENANCE_TASK:
        app.state.startup_maintenance_task = asyncio.create_task(
            _delayed_post_startup_initialization()
        )
    else:
        logger.info("⏭️ Deferred startup maintenance disabled for fast platform readiness")

    # Semantic summaries are now JIT-only: generated when the user requests
    # screen evidence (calendar day click or chat query). This avoids burning
    # LLM tokens on captures the user never looks at.
    # The background worker is disabled — JIT trigger is in get_screen_evidence.
    # To re-enable continuous background processing, uncomment below:
    # try:
    #     app.state.semantic_summary_task = asyncio.create_task(_semantic_summary_worker_loop())
    #     logger.info("🧠 Semantic summary worker started")
    # except Exception as exc:
    #     logger.warning("⚠️ Semantic summary worker not started: %s", exc)

@app.on_event("shutdown") 
async def shutdown_event():
    """Clean up on shutdown"""
    worker_task = getattr(app.state, "memory_worker_task", None)
    retention_task = getattr(app.state, "memory_retention_task", None)
    semantic_task = getattr(app.state, "semantic_summary_task", None)
    startup_maintenance_task = getattr(app.state, "startup_maintenance_task", None)
    tasks = [t for t in [worker_task, retention_task, semantic_task, startup_maintenance_task] if t is not None]
    for task in tasks:
        task.cancel()
    if tasks:
        try:
            await asyncio.wait_for(
                asyncio.gather(*tasks, return_exceptions=True),
                timeout=5.0
            )
        except asyncio.TimeoutError:
            logger.warning("Timed out waiting for background tasks to cancel")

    from database.connection import close_database
    await close_database()
    logger.info("👋 Ritual Backend API shutdown complete!")

if __name__ == "__main__":
    import uvicorn
    import os
    from dotenv import load_dotenv
    
    load_dotenv()
    
    host = os.getenv("API_HOST", "0.0.0.0")
    port = int(os.getenv("API_PORT", 8000))
    debug = os.getenv("DEBUG", "true").lower() == "true"
    
    uvicorn.run(app, host=host, port=port, reload=debug)
