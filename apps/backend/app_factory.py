"""FastAPI application factory for the Ritual backend."""

from __future__ import annotations

import logging
import os
from datetime import datetime
from typing import Any, Dict, Optional

from fastapi import Depends, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from sqlalchemy import text

from api.action_profiles import create_action_profiles_router
from api.action_receipts import create_action_receipts_router
from api.account_deletion import create_account_deletion_router
from api.analytics import create_analytics_router
from api.approvals import create_approvals_router
from api.artifacts import create_artifacts_router
from api.biometrics import create_biometrics_router
from api.conversations import create_conversations_router
from api.experiments import create_experiments_router
from api.core import create_core_router
from api.facts import create_facts_router
from api.financial import create_financial_router
from api.imports import create_imports_router
from api.integrations import create_tesla_router, create_whoop_router
from api.location import create_location_router
from api.metric_facts import create_metric_facts_router
from api.observability import create_observability_router
from api.privacy import create_privacy_router
from api.proactive_sms import router as proactive_sms_router
from api.reports import create_reports_router
from api.screen_time import create_screen_time_router
from api.screenshot import create_screenshot_router
from api.search import create_search_router
from api.sendblue import router as sendblue_router
from api.sms_copilot import create_sms_copilot_router
from api.sms_preferences import create_sms_preferences_router
from api.tasks import create_tasks_router
from api.ui_preferences import create_ui_preferences_router
from api.vcard import router as vcard_router
from api.watcher import include_watcher_router
from api.wearables import create_wearables_router
from api.workflows import create_workflows_router
from database.connection import get_database_runtime_health, get_db_session
from lifespan import register_lifecycle
from services.auth_service import AuthService
from services.account_context import build_persisted_account_context
from services.habits_service import HabitsService
from services.realtime import websocket_manager
from services.sentry_observability import set_domain_tags, set_request_context, set_user_context
from services.tesla_service import TeslaService
from services.tinybird_service import TinybirdService
from services.user_service import UserService
from services.whoop_service import WhoopService

logger = logging.getLogger(__name__)

ALLOWED_ORIGINS = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:3000,https://localhost:3000,tauri://localhost",
).split(",")
_INTERNAL_BACKEND_TOKEN = os.getenv("INTERNAL_BACKEND_TOKEN", "")

security = HTTPBearer()
limiter = Limiter(key_func=get_remote_address)

habits_service = HabitsService()
auth_service = AuthService()
try:
    tinybird_service: Optional[TinybirdService] = TinybirdService()
    logger.info("Tinybird service initialized")
except Exception as exc:
    tinybird_service = None
    logger.warning("Tinybird service unavailable; analytics sync disabled: %s", exc)
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


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    """Extract user from JWT token — or from internal service auth."""
    token = credentials.credentials

    if _INTERNAL_BACKEND_TOKEN and token == _INTERNAL_BACKEND_TOKEN:
        internal_user_id = request.headers.get("x-internal-user-id")
        if not internal_user_id:
            raise HTTPException(
                status_code=401,
                detail="Internal service auth requires x-internal-user-id header",
            )
        logger.info("🔑 Internal service auth for user %s", internal_user_id)
        user_profile = await user_service.get_user_profile(internal_user_id)
        if not user_profile:
            raise HTTPException(status_code=401, detail="User not found")
        user = {
            "id": internal_user_id,
            "email": getattr(user_profile, "email", None),
            "phone": getattr(user_profile, "phone_number", None),
            "name": getattr(user_profile, "full_name", None),
            "metadata": {},
        }
        set_user_context(user, auth_surface="internal-service")
        return user

    try:
        user = await auth_service.get_user_from_token(token)
        if not user:
            raise HTTPException(status_code=401, detail="Invalid authentication token")
        set_user_context(user, auth_surface="clerk")
        return user
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Authentication failed: %s", exc)
        raise HTTPException(status_code=401, detail=f"Authentication failed: {exc}")


async def get_persisted_account(
    current_user=Depends(get_current_user),
):
    """Authenticate and guarantee the user row required by product data routes."""
    try:
        return await build_persisted_account_context(user_service, current_user)
    except Exception as exc:
        from services.user_service import AccountIdentityConflictError

        if isinstance(exc, AccountIdentityConflictError):
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "account_identity_conflict",
                    "message": (
                        "This email is still attached to a previous Ritual account. "
                        "Account cleanup is still required before setup can finish."
                    ),
                    "retryable": True,
                },
            ) from exc
        raise


def create_app() -> FastAPI:
    app = FastAPI(title="Ritual Backend API", version="1.0.0")

    @app.middleware("http")
    async def sentry_request_context_middleware(request: Request, call_next):
        route_name = None
        try:
            route = request.scope.get("route")
            route_name = getattr(route, "path", None)
        except Exception:
            route_name = None
        set_request_context(
            path=request.url.path,
            method=request.method,
            route_name=route_name,
            query=dict(request.query_params),
        )
        return await call_next(request)

    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=[
            "Authorization",
            "Content-Type",
            "X-Ritual-Force-Fresh",
            "X-Ritual-Privacy-Mode",
            "X-Ritual-Cloud-Consents",
        ],
    )

    app.include_router(
        create_analytics_router(
            limiter=limiter,
            get_current_user=get_persisted_account,
            require_tinybird=require_tinybird,
            habits_service=habits_service,
        )
    )
    app.include_router(
        create_account_deletion_router(get_current_user=get_persisted_account)
    )
    app.include_router(create_biometrics_router(get_current_user=get_persisted_account))
    app.include_router(
        create_whoop_router(
            get_current_user=get_persisted_account,
            whoop_service=whoop_service,
        )
    )
    app.include_router(
        create_tesla_router(
            get_current_user=get_persisted_account,
            tesla_service=tesla_service,
        )
    )
    app.include_router(
        create_core_router(
            limiter=limiter,
            get_current_user=get_persisted_account,
            get_auth_user=get_current_user,
            user_service=user_service,
            habits_service=habits_service,
            tinybird_service=tinybird_service,
        )
    )
    app.include_router(create_conversations_router(get_current_user=get_persisted_account))
    app.include_router(create_experiments_router(get_current_user=get_persisted_account))
    app.include_router(create_search_router(get_current_user=get_persisted_account))
    app.include_router(create_reports_router(get_current_user=get_persisted_account))
    app.include_router(create_artifacts_router(get_current_user=get_persisted_account))
    app.include_router(create_tasks_router(get_current_user=get_persisted_account))
    app.include_router(create_workflows_router(get_current_user=get_persisted_account))
    app.include_router(create_action_profiles_router(get_current_user=get_persisted_account))
    app.include_router(create_action_receipts_router(get_current_user=get_persisted_account))
    app.include_router(create_approvals_router(get_current_user=get_persisted_account))
    app.include_router(create_facts_router(get_current_user=get_persisted_account))
    app.include_router(create_metric_facts_router(get_current_user=get_persisted_account))
    app.include_router(create_observability_router(get_current_user=get_current_user))
    app.include_router(create_privacy_router(get_current_user=get_persisted_account))
    app.include_router(
        create_screenshot_router(
            limiter=limiter,
            get_current_user=get_persisted_account,
            habits_service=habits_service,
        )
    )
    app.include_router(
        create_wearables_router(
            limiter=limiter,
            get_current_user=get_persisted_account,
        )
    )
    app.include_router(create_screen_time_router(get_current_user=get_persisted_account))
    app.include_router(
        create_imports_router(
            limiter=limiter,
            get_current_user=get_persisted_account,
            habits_service=habits_service,
            tinybird_service=tinybird_service,
        )
    )
    app.include_router(create_financial_router(get_current_user=get_persisted_account))
    app.include_router(create_location_router(get_current_user=get_persisted_account))
    include_watcher_router(app, get_current_user=get_current_user)
    app.include_router(sendblue_router)
    app.include_router(proactive_sms_router)
    app.include_router(create_sms_preferences_router(get_current_user=get_persisted_account))
    app.include_router(create_ui_preferences_router(get_current_user=get_persisted_account))
    app.include_router(create_sms_copilot_router())
    app.include_router(vcard_router)

    @app.get("/")
    async def root():
        return {"message": "Ritual Backend API", "status": "running"}

    @app.get("/ready")
    async def ready_check():
        return {"status": "ready"}

    @app.get("/health")
    async def health_check():
        checks: Dict[str, Any] = {}
        status = "healthy"
        status_code = 200

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
            if tinybird_check.get("privacy_blocked"):
                if status == "healthy":
                    status = "degraded"
            elif tinybird_check.get("status") != "ok":
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

    @app.websocket("/ws/{user_id}")
    async def websocket_endpoint(websocket: WebSocket, user_id: str):
        auth_header = websocket.headers.get("authorization")
        token = auth_service.extract_token_from_header(auth_header or "")

        if not token:
            token = websocket.query_params.get("token")

        if not token:
            await websocket.close(code=1008, reason="Authentication required")
            return

        user = await auth_service.get_user_from_token(token)
        if not user or user.get("id") != user_id:
            await websocket.close(code=1008, reason="Invalid authentication token")
            return
        set_user_context(user, auth_surface="clerk-websocket")
        set_domain_tags(
            runtime="backend",
            surface="fastapi-websocket",
            route="/ws/{user_id}",
            user_id=user_id,
        )

        await websocket_manager.connect(websocket, user_id)
        try:
            while True:
                data = await websocket.receive_text()
                await websocket.send_text(f"pong: {data}")
        except WebSocketDisconnect:
            websocket_manager.disconnect(websocket, user_id)

    register_lifecycle(app, tesla_service)
    return app
