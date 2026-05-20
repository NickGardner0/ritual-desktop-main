"""
Ritual FastAPI Backend
Primary API entrypoint for dashboard, desktop, and mobile clients.
"""

from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import JSONResponse
from typing import Optional, Dict, Any
import os
import asyncio
from datetime import datetime, timezone
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
from api.action_profiles import create_action_profiles_router
from api.approvals import create_approvals_router
from api.artifacts import create_artifacts_router
from api.biometrics import create_biometrics_router
from api.core import create_core_router
from api.conversations import create_conversations_router
from api.facts import create_facts_router
from api.financial import create_financial_router
from api.integrations import create_whoop_router, create_tesla_router
from api.imports import create_imports_router
from api.metric_facts import create_metric_facts_router
from api.reports import create_reports_router
from api.search import create_search_router
from api.screen_time import create_screen_time_router
from api.screenshot import create_screenshot_router
from api.wearables import create_wearables_router
from api.workflows import create_workflows_router
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
ENABLE_INTERNAL_SCHEDULER = os.getenv(
    "ENABLE_INTERNAL_SCHEDULER", "0"
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

# Internal service-to-service auth token (used by SMS orchestrator loop)
_INTERNAL_BACKEND_TOKEN = os.getenv("INTERNAL_BACKEND_TOKEN", "")

# Dependency to get current user from JWT token
async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    """
    Extract user from JWT token — or from internal service auth.

    Internal service auth (SMS orchestrator → Python API): if the Bearer
    token matches INTERNAL_BACKEND_TOKEN *and* x-internal-user-id is set,
    resolve the user by ID directly without Clerk JWT validation.
    """
    token = credentials.credentials

    # ── Internal service auth fast-path ──────────────────────────────
    if (
        _INTERNAL_BACKEND_TOKEN
        and token == _INTERNAL_BACKEND_TOKEN
    ):
        internal_user_id = request.headers.get("x-internal-user-id")
        if not internal_user_id:
            raise HTTPException(
                status_code=401,
                detail="Internal service auth requires x-internal-user-id header",
            )
        logger.info("🔑 Internal service auth for user %s", internal_user_id)
        # Return the same dict shape as Clerk JWT auth
        user_profile = await user_service.get_user_profile(internal_user_id)
        if not user_profile:
            raise HTTPException(status_code=401, detail="User not found")
        return {
            "id": internal_user_id,
            "email": getattr(user_profile, "email", None),
            "phone": getattr(user_profile, "phone_number", None),
            "name": getattr(user_profile, "full_name", None),
            "metadata": {},
        }

    # ── Standard Clerk JWT auth ──────────────────────────────────────
    try:
        user = await auth_service.get_user_from_token(token)
        if not user:
            raise HTTPException(status_code=401, detail="Invalid authentication token")
        return user
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Authentication failed: %s", e)
        raise HTTPException(status_code=401, detail=f"Authentication failed: {e}")


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
    create_reports_router(
        get_current_user=get_current_user,
    )
)
app.include_router(
    create_artifacts_router(
        get_current_user=get_current_user,
    )
)
app.include_router(
    create_workflows_router(
        get_current_user=get_current_user,
    )
)
app.include_router(
    create_action_profiles_router(
        get_current_user=get_current_user,
    )
)
app.include_router(
    create_approvals_router(
        get_current_user=get_current_user,
    )
)
app.include_router(
    create_facts_router(
        get_current_user=get_current_user,
    )
)
app.include_router(
    create_metric_facts_router(
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

from api.watcher import router as watcher_router
app.include_router(watcher_router)

from api.sendblue import router as sendblue_router
app.include_router(sendblue_router)

from api.proactive_sms import router as proactive_sms_router
app.include_router(proactive_sms_router)

from api.sms_preferences import create_sms_preferences_router
app.include_router(create_sms_preferences_router(get_current_user=get_current_user))

from api.ui_preferences import create_ui_preferences_router
app.include_router(create_ui_preferences_router(get_current_user=get_current_user))

from api.sms_copilot import create_sms_copilot_router
app.include_router(create_sms_copilot_router())

from api.vcard import router as vcard_router
app.include_router(vcard_router)


# ---------------------------------------------------------------------------
# Internal hourly scheduler — replaces Trigger.dev for proactive SMS + syncs
# ---------------------------------------------------------------------------

async def _internal_scheduler_loop() -> None:
    """Background loop that fires once per hour to run scheduled tasks.

    Replaces external schedulers (Trigger.dev, Railway cron) by calling
    service methods directly — no HTTP round-trips or extra auth needed.

    Tasks executed each tick:
    1. Proactive SMS sweep (all trigger types — each checks user local time)
    2. Wearable syncs (Whoop, Oura, Garmin, Tesla) for users whose
       configured sync_hour matches the current UTC hour
    3. Financial (Plaid) sync for matching sync_hour
    """
    from datetime import datetime as _dt, timezone as _tz

    # Let other startup work finish first
    await asyncio.sleep(30)
    logger.info("⏰ Internal scheduler loop started (runs every hour)")

    while True:
        current_hour = _dt.now(_tz.utc).hour
        logger.info("⏰ Scheduler tick — UTC hour %d", current_hour)

        # --- 1. Proactive SMS sweep ---
        try:
            from services.proactive_sms_service import run_hourly_proactive_sweep

            results = await run_hourly_proactive_sweep()
            total_sent = sum(r.get("sent", 0) for r in results)
            logger.info(
                "📬 Proactive SMS sweep complete: %d messages sent across %d trigger types",
                total_sent, len(results),
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("⚠️ Proactive SMS sweep failed: %s", exc)

        # --- 2. Whoop sync ---
        try:
            from services.whoop_service import whoop_service as _whoop
            from services.unified_wearables_service import wearable_connection_service as _wc
            from database.connection import get_db_session
            from database.models import WhoopIntegrationDB
            from sqlalchemy import select as _sel
            import json as _json

            async with get_db_session() as session:
                rows = await session.execute(
                    _sel(WhoopIntegrationDB).where(WhoopIntegrationDB.is_active.is_(True))
                )
                integrations = rows.scalars().all()

            synced = 0
            for integration in integrations:
                canonical = await _wc.get_connection(integration.user_id, "whoop")
                settings = {}
                if canonical and canonical.settings_json:
                    try:
                        settings = _json.loads(canonical.settings_json)
                    except Exception:
                        pass
                if not settings.get("auto_sync_enabled", True):
                    continue
                configured_hour = int(
                    settings.get("sync_hour",
                                 settings.get("whoop_sync_hour",
                                              integration.whoop_sync_hour or 9))
                )
                if configured_hour != current_hour:
                    continue
                try:
                    await _whoop.sync_whoop_data(integration.user_id)
                    synced += 1
                except Exception:
                    logger.exception("Whoop sync failed for user %s", integration.user_id)
            if synced:
                logger.info("🏋️ Whoop sync: %d users synced at hour %d", synced, current_hour)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("⚠️ Whoop scheduler sync failed: %s", exc)

        # --- 3. Oura + Garmin sync (via wearable_connections table) ---
        try:
            from services.oura_service import oura_service as _oura
            from services.garmin_service import garmin_service as _garmin
            from database.models import WearableConnectionDB
            from database.connection import get_db_session
            from sqlalchemy import select as _sel
            import json as _json

            for provider, svc in [("oura", _oura), ("garmin", _garmin)]:
                async with get_db_session() as session:
                    rows = await session.execute(
                        _sel(WearableConnectionDB).where(
                            WearableConnectionDB.provider == provider,
                            WearableConnectionDB.status == "active",
                        )
                    )
                    connections = rows.scalars().all()

                synced = 0
                for conn in connections:
                    settings = {}
                    if conn.settings_json:
                        try:
                            settings = _json.loads(conn.settings_json)
                        except Exception:
                            pass
                    if not settings.get("auto_sync_enabled", True):
                        continue
                    configured_hour = int(settings.get("sync_hour", 9))
                    if configured_hour != current_hour:
                        continue
                    try:
                        if provider == "oura":
                            await svc.sync_oura_data(conn.user_id)
                        else:
                            await svc.sync_garmin_account(conn.user_id)
                        synced += 1
                    except Exception:
                        logger.exception("%s sync failed for user %s", provider.title(), conn.user_id)
                if synced:
                    logger.info("⌚ %s sync: %d users synced at hour %d", provider.title(), synced, current_hour)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("⚠️ Oura/Garmin scheduler sync failed: %s", exc)

        # --- 4. Tesla sync ---
        try:
            from database.models import WearableConnectionDB
            from database.connection import get_db_session
            from sqlalchemy import select as _sel

            async with get_db_session() as session:
                rows = await session.execute(
                    _sel(WearableConnectionDB).where(
                        WearableConnectionDB.provider == "tesla",
                        WearableConnectionDB.status == "active",
                    )
                )
                connections = rows.scalars().all()

            synced = 0
            for conn in connections:
                settings = {}
                if conn.settings_json:
                    try:
                        import json as _json
                        settings = _json.loads(conn.settings_json)
                    except Exception:
                        pass
                if not settings.get("auto_sync_enabled", True):
                    continue
                configured_hour = int(settings.get("sync_hour", 9))
                if configured_hour != current_hour:
                    continue
                try:
                    await tesla_service.sync_odometer(conn.user_id)
                    synced += 1
                except Exception:
                    logger.exception("Tesla sync failed for user %s", conn.user_id)
            if synced:
                logger.info("🚗 Tesla sync: %d users synced at hour %d", synced, current_hour)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("⚠️ Tesla scheduler sync failed: %s", exc)

        # --- 5. Financial (Plaid) sync ---
        try:
            from services.financial_sync_service import financial_sync_service as _fin

            result = await _fin.sync_all_active(hour=current_hour)
            synced = result.get("successful_syncs", 0)
            if synced:
                logger.info("💰 Financial sync: %d connections synced at hour %d", synced, current_hour)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("⚠️ Financial scheduler sync failed: %s", exc)

        logger.info("⏰ Scheduler tick complete — sleeping 1 hour")
        await asyncio.sleep(3600)


async def _report_scheduler_loop() -> None:
    """Dispatch and process scheduled habit reports on a shorter cadence."""
    await asyncio.sleep(45)
    logger.info("📨 Report scheduler loop started (runs every 15 minutes)")

    while True:
        try:
            from services.reports_service import reports_service

            result = await reports_service.scheduler_tick()
            queued = int(result.get("queued", 0) or 0)
            processed = int(result.get("processed", 0) or 0)
            failed = int(result.get("failed", 0) or 0)
            if queued or processed or failed:
                logger.info(
                    "📨 Report scheduler tick: queued=%d processed=%d failed=%d",
                    queued,
                    processed,
                    failed,
                )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("⚠️ Report scheduler tick failed: %s", exc)

        await asyncio.sleep(900)


async def _workflow_scheduler_loop() -> None:
    """Dispatch and process scheduled workflow runs on a shorter cadence."""
    await asyncio.sleep(50)
    logger.info("🧭 Workflow scheduler loop started (runs every 5 minutes)")

    while True:
        try:
            from services.workflow_service import workflow_service

            result = await workflow_service.scheduler_tick()
            queued = int(result.get("queued", 0) or 0)
            processed = int(result.get("processed", 0) or 0)
            failed = int(result.get("failed", 0) or 0)
            if queued or processed or failed:
                logger.info(
                    "🧭 Workflow scheduler tick: queued=%d processed=%d failed=%d",
                    queued,
                    processed,
                    failed,
                )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("⚠️ Workflow scheduler tick failed: %s", exc)

        await asyncio.sleep(300)


async def _ambient_scheduler_loop() -> None:
    """Evaluate ambient workflow signals and process resulting runs."""
    await asyncio.sleep(65)
    logger.info("🌤️ Ambient scheduler loop started (runs every 15 minutes)")

    while True:
        try:
            from services.workflow_service import workflow_service

            result = await workflow_service.ambient_tick()
            queued = int(result.get("queued", 0) or 0)
            suppressed = int(result.get("suppressed", 0) or 0)
            processed = int(result.get("processed", 0) or 0)
            failed = int(result.get("failed", 0) or 0)
            if queued or suppressed or processed or failed:
                logger.info(
                    "🌤️ Ambient scheduler tick: queued=%d suppressed=%d processed=%d failed=%d",
                    queued,
                    suppressed,
                    processed,
                    failed,
                )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("⚠️ Ambient scheduler tick failed: %s", exc)

        await asyncio.sleep(900)


async def _sms_copilot_loop() -> None:
    """Run narrow deterministic copilot checks every five minutes."""
    from sqlalchemy import select
    from database.models import UserDB

    await asyncio.sleep(45)
    logger.info("📲 SMS copilot loop started (runs every 5 minutes)")

    while True:
        candidate_count = 0
        sent_count = 0
        try:
            from services.sms_copilot_dispatch_service import sms_copilot_dispatch_service
            from services.sms_copilot_signal_service import sms_copilot_signal_service

            now_utc = datetime.now(timezone.utc)

            async with get_db_session() as session:
                result = await session.execute(
                    select(UserDB.id).where(
                        UserDB.phone_number.isnot(None),
                        UserDB.onboarding_completed.is_(True),
                    )
                )
                user_ids = [row[0] for row in result.all()]

            for user_id in user_ids:
                candidates = await sms_copilot_signal_service.evaluate_user(
                    user_id=user_id,
                    now_utc=now_utc,
                )
                candidate_count += len(candidates)
                for candidate in candidates:
                    event = await sms_copilot_dispatch_service.dispatch_candidate(candidate)
                    if event.status == "sent":
                        sent_count += 1

            if candidate_count or sent_count:
                logger.info(
                    "📲 SMS copilot tick complete: candidates=%d sent=%d users=%d",
                    candidate_count,
                    sent_count,
                    len(user_ids),
                )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("⚠️ SMS copilot loop failed: %s", exc)

        await asyncio.sleep(300)


async def _wearable_ingest_job_loop() -> None:
    """Process queued wearable backfill/replay jobs in-process."""
    await asyncio.sleep(60)
    logger.info("🧵 Wearable ingest job loop started (runs every 15 seconds)")

    while True:
        try:
            from services.wearable_ingest_job_service import wearable_ingest_job_service

            result = await wearable_ingest_job_service.process_next_job()
            if result:
                logger.info(
                    "🧵 Wearable ingest job processed: job_id=%s status=%s",
                    result.get("job_id"),
                    result.get("status"),
                )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("⚠️ Wearable ingest job loop failed: %s", exc)

        await asyncio.sleep(15)


async def _wearable_maintenance_loop() -> None:
    """Compact historical wearable rows and purge expired raw payloads nightly."""
    await asyncio.sleep(90)
    logger.info("🧹 Wearable maintenance loop started (runs every 24 hours)")

    while True:
        try:
            from services.unified_wearables_service import wearable_sync_service
            from services.wearable_maintenance_service import wearable_maintenance_service

            run = await wearable_sync_service.start_sync_run(
                provider="system",
                trigger="maintenance",
                metadata={"task": "wearable_maintenance"},
            )
            result = await wearable_maintenance_service.run_once()
            items_written = sum(
                int(block.get("written", 0))
                for block in result.values()
                if isinstance(block, dict)
            )
            items_deleted = int(result.get("raw_payloads", {}).get("deleted_payloads", 0))
            await wearable_sync_service.finish_sync_run(
                run.id,
                status="success",
                items_written=items_written,
                items_deleted=items_deleted,
            )
            logger.info("🧹 Wearable maintenance complete: %s", result)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("⚠️ Wearable maintenance loop failed: %s", exc)

        await asyncio.sleep(86400)


async def _wearable_event_outbox_loop() -> None:
    """Process queued internal wearable outbox events in-process."""
    await asyncio.sleep(75)
    logger.info("📮 Wearable event outbox loop started (runs every 15 seconds)")

    while True:
        try:
            from services.wearable_event_outbox_service import wearable_event_outbox_service

            result = await wearable_event_outbox_service.process_next_event()
            if result:
                logger.info(
                    "📮 Wearable outbox event processed: event_id=%s status=%s",
                    result.get("event_id"),
                    result.get("status"),
                )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("⚠️ Wearable outbox loop failed: %s", exc)

        await asyncio.sleep(15)


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

    # Start internal hourly scheduler (proactive SMS + wearable syncs)
    if ENABLE_INTERNAL_SCHEDULER:
        app.state.scheduler_task = asyncio.create_task(_internal_scheduler_loop())
        app.state.report_scheduler_task = asyncio.create_task(_report_scheduler_loop())
        app.state.workflow_scheduler_task = asyncio.create_task(_workflow_scheduler_loop())
        app.state.ambient_scheduler_task = asyncio.create_task(_ambient_scheduler_loop())
        app.state.sms_copilot_task = asyncio.create_task(_sms_copilot_loop())
        app.state.wearable_ingest_job_task = asyncio.create_task(_wearable_ingest_job_loop())
        app.state.wearable_maintenance_task = asyncio.create_task(_wearable_maintenance_loop())
        app.state.wearable_event_outbox_task = asyncio.create_task(_wearable_event_outbox_loop())
        logger.info("⏰ Internal hourly scheduler started (proactive SMS + wearable syncs)")
        logger.info("📨 Report scheduler started")
        logger.info("🧭 Workflow scheduler started")
        logger.info("🌤️ Ambient scheduler started")
        logger.info("📲 SMS copilot scheduler started")
        logger.info("🧵 Wearable ingest job worker started")
        logger.info("🧹 Wearable maintenance scheduler started")
        logger.info("📮 Wearable event outbox worker started")
    else:
        logger.info("⏭️ Internal scheduler disabled (set ENABLE_INTERNAL_SCHEDULER=1 to enable)")


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
    logger.info("🖥️ Watcher API ready for computer activity tracking")
    app.state.startup_maintenance_task = None
    app.state.scheduler_task = None
    app.state.report_scheduler_task = None
    app.state.workflow_scheduler_task = None
    app.state.ambient_scheduler_task = None
    app.state.sms_copilot_task = None
    app.state.wearable_ingest_job_task = None
    app.state.wearable_maintenance_task = None
    app.state.wearable_event_outbox_task = None
    if ENABLE_STARTUP_MAINTENANCE_TASK:
        app.state.startup_maintenance_task = asyncio.create_task(
            _delayed_post_startup_initialization()
        )
    else:
        logger.info("⏭️ Deferred startup maintenance disabled for fast platform readiness")

@app.on_event("shutdown") 
async def shutdown_event():
    """Clean up on shutdown"""
    startup_maintenance_task = getattr(app.state, "startup_maintenance_task", None)
    scheduler_task = getattr(app.state, "scheduler_task", None)
    report_scheduler_task = getattr(app.state, "report_scheduler_task", None)
    workflow_scheduler_task = getattr(app.state, "workflow_scheduler_task", None)
    ambient_scheduler_task = getattr(app.state, "ambient_scheduler_task", None)
    sms_copilot_task = getattr(app.state, "sms_copilot_task", None)
    wearable_ingest_job_task = getattr(app.state, "wearable_ingest_job_task", None)
    wearable_maintenance_task = getattr(app.state, "wearable_maintenance_task", None)
    wearable_event_outbox_task = getattr(app.state, "wearable_event_outbox_task", None)
    tasks = [
        t
        for t in [
            startup_maintenance_task,
            scheduler_task,
            report_scheduler_task,
            workflow_scheduler_task,
            ambient_scheduler_task,
            sms_copilot_task,
            wearable_ingest_job_task,
            wearable_maintenance_task,
            wearable_event_outbox_task,
        ]
        if t is not None
    ]
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
