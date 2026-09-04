"""Core API router extracted from main.py (user, habits, calendar, batch logging)."""

import asyncio
import logging
import os
import time
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel
from database.connection import force_local_replica_sync
from database.helpers import user_db_to_profile
from models.habit_models import Habit, HabitCreate, HabitLog, HabitLogCreate, HabitLogUpdate, HabitUpdate
from models.user_models import (
    BootstrapProfileUpdate,
    ChecklistUpdateRequest,
    FirstBehaviorRequest,
    OnboardingData,
    UserBootstrapResponse,
    UserProfile,
)
from services.account_context import ensure_current_user_record
from services.activation_service import activation_service
from services.habits_service import (
    ComputedMetricReadOnlyError,
    HabitLogNotFoundError,
    HabitLogRevisionConflictError,
    HabitLogUpdateValidationError,
)
from services.privacy_policy import (
    can_send_to_cloud,
    request_cloud_consents,
    request_privacy_mode,
)
from services.turso_user_service import TursoProvisioningError, turso_user_service
from services.user_service import AccountIdentityConflictError

logger = logging.getLogger(__name__)

_bootstrap_setup_inflight: set[str] = set()


def _env_flag(name: str) -> bool:
    return os.getenv(name, "").lower() in {"1", "true", "yes", "on"}


class BatchLogItem(BaseModel):
    habit_id: str
    date: str  # YYYY-MM-DD
    amount: Optional[float] = None
    duration: Optional[int] = None  # in seconds
    unit: Optional[str] = None
    source: str = "ai_log_v2"
    notes: Optional[str] = None
    completed_at: Optional[str] = None


class BatchLogRequest(BaseModel):
    items: List[BatchLogItem]
    client_event_id: Optional[str] = None  # For idempotency


class TursoSyncConfigResponse(BaseModel):
    sync_url: str
    auth_token: str
    expires_at: str
    database_name: str
    activity_schema_version: int = 2


async def _maybe_force_fresh_read(request: Request):
    if request.headers.get("x-ritual-force-fresh") == "1":
        await force_local_replica_sync()


async def _provision_activity_metadata_deferred(user_id: str) -> None:
    """Provision per-user activity storage after the routing response."""

    try:
        await turso_user_service.ensure_user_activity_metadata(user_id)
    except TursoProvisioningError:
        logger.warning(
            "Failed deferred per-user activity provisioning for user %s",
            user_id,
            exc_info=True,
        )
    except Exception:
        logger.warning(
            "Unexpected deferred per-user activity provisioning error for user %s",
            user_id,
            exc_info=True,
        )


async def _run_deferred_bootstrap_setup(
    user_id: str,
    *,
    user_service: Any,
    current_user: Dict[str, Any],
) -> None:
    """Run non-routing setup after the bootstrap response has been sent."""

    if user_id in _bootstrap_setup_inflight:
        return

    _bootstrap_setup_inflight.add(user_id)
    started_at = time.perf_counter()
    try:
        results = await asyncio.gather(
            _provision_activity_metadata_deferred(user_id),
            user_service.ensure_user_exists(
                user_id=user_id,
                email=current_user.get("email") or "",
                full_name=current_user.get("name"),
                phone_number=current_user.get("phone"),
                send_welcome_sms=True,
            ),
            return_exceptions=True,
        )
        for result in results:
            if isinstance(result, Exception):
                logger.warning(
                    "Deferred bootstrap setup failed for user %s: %s",
                    user_id,
                    result,
                )
    finally:
        _bootstrap_setup_inflight.discard(user_id)
        logger.info(
            "Deferred bootstrap setup finished for user %s duration_ms=%.1f",
            user_id,
            (time.perf_counter() - started_at) * 1000,
        )


def create_core_router(
    *,
    limiter: Any,
    get_current_user: Callable[..., Any],
    user_service: Any,
    habits_service: Any,
    tinybird_service: Any,
    get_auth_user: Optional[Callable[..., Any]] = None,
) -> APIRouter:
    """Build core router with injected app dependencies."""
    router = APIRouter(tags=["core"])
    get_auth_user = get_auth_user or get_current_user

    @router.get("/api/user/profile", response_model=UserProfile)
    async def get_user_profile(current_user=Depends(get_auth_user)):
        try:
            logger.info("Fetching profile for user %s", current_user["id"])
            user = await ensure_current_user_record(user_service, current_user)
            try:
                await turso_user_service.ensure_user_activity_metadata(user.id)
            except TursoProvisioningError:
                if turso_user_service.is_platform_configured():
                    raise
            logger.info("User profile ensured for %s", user.email)
            return user_db_to_profile(user)
        except AccountIdentityConflictError:
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
            )
        except TursoProvisioningError as exc:
            logger.exception("Error provisioning per-user Turso database")
            raise HTTPException(status_code=500, detail=str(exc))
        except Exception:
            logger.exception("Error getting user profile")
            raise HTTPException(status_code=500, detail="Request could not be processed.")

    @router.get("/api/user/bootstrap", response_model=UserBootstrapResponse)
    async def get_user_bootstrap(
        request: Request,
        response: Response,
        background_tasks: BackgroundTasks,
        current_user=Depends(get_auth_user),
    ):
        started_at = time.perf_counter()
        try:
            await _maybe_force_fresh_read(request)
            identity_started_at = time.perf_counter()
            user = await ensure_current_user_record(
                user_service,
                current_user,
                send_welcome_sms=False,
            )
            identity_ms = (time.perf_counter() - identity_started_at) * 1000

            activation_started_at = time.perf_counter()
            if getattr(user, "_ritual_created", False):
                bootstrap = activation_service.build_initial_bootstrap(user)
                mode = "created"
            else:
                bootstrap = await activation_service.get_bootstrap(current_user["id"])
                mode = "existing"
            activation_ms = (time.perf_counter() - activation_started_at) * 1000
            total_ms = (time.perf_counter() - started_at) * 1000

            response.headers["Server-Timing"] = (
                f"identity;dur={identity_ms:.1f}, "
                f"activation;dur={activation_ms:.1f}, "
                f"total;dur={total_ms:.1f}"
            )
            response.headers["X-Ritual-Bootstrap-Mode"] = mode
            response.headers["X-Ritual-Bootstrap-Duration-Ms"] = f"{total_ms:.1f}"
            logger.info(
                "Bootstrap completed for user %s mode=%s total_ms=%.1f "
                "identity_ms=%.1f activation_ms=%.1f",
                current_user["id"],
                mode,
                total_ms,
                identity_ms,
                activation_ms,
            )

            background_tasks.add_task(
                _run_deferred_bootstrap_setup,
                user.id,
                user_service=user_service,
                current_user=dict(current_user),
            )
            return bootstrap
        except AccountIdentityConflictError:
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
            )
        except TursoProvisioningError as exc:
            logger.exception("Error provisioning per-user Turso database during bootstrap")
            raise HTTPException(status_code=500, detail=str(exc))
        except Exception:
            logger.exception("Error getting user bootstrap")
            raise HTTPException(status_code=500, detail="Request could not be processed.")

    @router.patch("/api/user/bootstrap/profile", response_model=UserBootstrapResponse)
    async def update_user_bootstrap_profile(
        profile_data: BootstrapProfileUpdate,
        current_user=Depends(get_current_user),
    ):
        try:
            return await activation_service.update_profile(
                user_id=current_user["id"],
                full_name=profile_data.fullName,
                timezone=profile_data.timezone,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        except Exception:
            logger.exception("Error updating bootstrap profile")
            raise HTTPException(status_code=500, detail="Request could not be processed.")

    @router.post("/api/user/activation/first-behavior")
    @limiter.limit("20/minute")
    async def create_first_behavior(
        activation_data: FirstBehaviorRequest,
        request: Request,
        current_user=Depends(get_current_user),
    ):
        try:
            return await activation_service.create_first_behavior(
                user_id=current_user["id"],
                request=activation_data,
                habits_service=habits_service,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        except Exception:
            logger.exception("Error creating first behavior")
            raise HTTPException(status_code=500, detail="Request could not be processed.")

    @router.patch("/api/user/activation/checklist", response_model=UserBootstrapResponse)
    async def update_activation_checklist(
        checklist_data: ChecklistUpdateRequest,
        current_user=Depends(get_current_user),
    ):
        try:
            return await activation_service.update_checklist(
                user_id=current_user["id"],
                request=checklist_data,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        except Exception:
            logger.exception("Error updating activation checklist")
            raise HTTPException(status_code=500, detail="Request could not be processed.")

    @router.patch("/api/user/activation/permissions-seen", response_model=UserBootstrapResponse)
    async def mark_activation_permissions_seen(current_user=Depends(get_current_user)):
        try:
            # Onboarding is not complete until the account's private activity
            # database exists and its schema is ready. The earlier bootstrap
            # task remains a latency optimization; this is the durable gate.
            if not turso_user_service.is_platform_configured():
                raise TursoProvisioningError("Per-user Turso platform is not configured")
            await turso_user_service.ensure_user_activity_metadata(current_user["id"])
            return await activation_service.mark_permissions_seen(user_id=current_user["id"])
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        except TursoProvisioningError as exc:
            logger.exception("Per-user Turso provisioning failed at onboarding completion")
            raise HTTPException(
                status_code=503,
                detail={
                    "code": "account_storage_unavailable",
                    "message": "Ritual could not finish creating your private account storage. Please try again.",
                    "retryable": True,
                },
            ) from exc
        except Exception:
            logger.exception("Error marking activation setup seen")
            raise HTTPException(status_code=500, detail="Request could not be processed.")

    @router.get("/api/user/turso-sync-config", response_model=TursoSyncConfigResponse)
    async def get_turso_sync_config(
        request: Request,
        current_user=Depends(get_current_user),
    ):
        try:
            decision = can_send_to_cloud(
                data_class="computer_activity",
                destination="turso_cloud",
                purpose="plaintext_sync",
                mode=request_privacy_mode(request.headers),
                consents=request_cloud_consents(request.headers),
            )
            if not decision.allowed:
                raise HTTPException(
                    status_code=403,
                    detail={
                        "error": "Cloud consent required",
                        "privacy_blocked": True,
                        "reason": decision.reason,
                        "required_consent": "plaintext_sync",
                    },
                )
            config = await turso_user_service.get_desktop_sync_config(current_user["id"])
            logger.info("Providing Turso sync config to user %s", current_user["id"])
            return TursoSyncConfigResponse(
                sync_url=config.sync_url,
                auth_token=config.auth_token,
                expires_at=config.expires_at,
                database_name=config.database_name,
                activity_schema_version=config.activity_schema_version,
            )
        except HTTPException:
            raise
        except TursoProvisioningError as exc:
            logger.exception("Error getting per-user Turso sync config")
            status_code = 409 if "migration" in str(exc).lower() else 503
            raise HTTPException(status_code=status_code, detail=str(exc))
        except Exception:
            logger.exception("Error getting Turso sync config")
            raise HTTPException(status_code=500, detail="Request could not be processed.")

    @router.put("/api/user/onboarding", response_model=UserProfile)
    async def update_onboarding(
        onboarding_data: OnboardingData,
        current_user=Depends(get_current_user),
    ):
        try:
            logger.info("Updating onboarding for user %s", current_user["id"])
            user = await user_service.update_onboarding(
                user_id=current_user["id"],
                name=onboarding_data.name,
                age_bracket=onboarding_data.age_bracket,
                gender=onboarding_data.gender,
                country=onboarding_data.country,
                tracking_interests=onboarding_data.tracking_interests,
                wearable_devices=onboarding_data.wearable_devices,
                phone_number=onboarding_data.phone_number,
                client_surface=onboarding_data.client_surface or "web",
            )
            logger.info("Onboarding updated successfully for user %s", current_user["id"])
            return user_db_to_profile(user)
        except Exception:
            logger.exception("Error updating onboarding")
            raise HTTPException(status_code=500, detail="Request could not be processed.")

    @router.post("/api/habits", response_model=Habit)
    @limiter.limit("10/minute")
    async def create_habit(
        habit_data: HabitCreate,
        request: Request,
        current_user=Depends(get_current_user),
    ):
        try:
            habit = await habits_service.create_habit(habit_data, current_user["id"])
            if tinybird_service:
                try:
                    await tinybird_service.ingest_habit_definition(habit)
                except Exception as tb_error:
                    logger.warning("Tinybird habit-definition sync failed (non-fatal): %s", tb_error)
            return habit
        except HTTPException:
            raise
        except Exception:
            logger.exception("create_habit failed for user %s", current_user.get("id"))
            raise HTTPException(status_code=400, detail="Request could not be processed.")

    @router.get("/api/habits", response_model=List[Habit])
    @limiter.limit("30/minute")
    async def get_habits(
        request: Request,
        current_user=Depends(get_current_user),
    ):
        try:
            await _maybe_force_fresh_read(request)
            return await habits_service.get_habits(current_user["id"])
        except Exception:
            raise HTTPException(status_code=400, detail="Request could not be processed.")

    @router.get("/api/dashboard/overview-snapshot")
    async def get_dashboard_overview_snapshot(
        request: Request,
        start_date: Optional[str] = Query(None),
        end_date: Optional[str] = Query(None),
        current_user=Depends(get_current_user),
    ):
        try:
            if start_date:
                datetime.strptime(start_date, "%Y-%m-%d")
            if end_date:
                datetime.strptime(end_date, "%Y-%m-%d")
            await _maybe_force_fresh_read(request)
            if _env_flag("METRIC_FACTS_READS"):
                from services.metric_facts_service import metric_fact_service

                return await metric_fact_service.get_overview_snapshot(
                    user_id=current_user["id"],
                    start_date=start_date,
                    end_date=end_date,
                    days_back=3650,
                )
            snapshot = await habits_service.get_overview_snapshot(
                current_user["id"],
                start_date=start_date,
                end_date=end_date,
            )
            if _env_flag("METRIC_FACTS_SHADOW"):
                try:
                    from services.metric_facts_service import metric_fact_service

                    fact_snapshot = await metric_fact_service.get_overview_snapshot(
                        user_id=current_user["id"],
                        start_date=start_date,
                        end_date=end_date,
                        days_back=3650,
                    )
                    legacy_stats = snapshot.get("overviewStats") or {}
                    fact_stats = fact_snapshot.get("overviewStats") or {}
                    drift_count = 0
                    for habit_id, legacy in legacy_stats.items():
                        fact = fact_stats.get(habit_id) or {}
                        if abs(float((legacy or {}).get("total") or 0) - float(fact.get("total") or 0)) > 0.05:
                            drift_count += 1
                    logger.info(
                        "Metric facts shadow overview computed for user %s; drift_count=%s",
                        current_user["id"],
                        drift_count,
                    )
                except Exception as exc:
                    logger.warning("Metric facts shadow overview failed for user %s: %s", current_user["id"], exc)
            return snapshot
        except ValueError:
            raise HTTPException(status_code=400, detail="start_date/end_date must be YYYY-MM-DD")
        except HTTPException:
            raise
        except Exception:
            logger.exception("dashboard overview snapshot failed for user %s", current_user.get("id"))
            raise HTTPException(status_code=400, detail="Request could not be processed.")

    @router.get("/api/dashboard/metrics-snapshot")
    async def get_dashboard_metrics_snapshot(
        request: Request,
        start_date: Optional[str] = Query(None),
        end_date: Optional[str] = Query(None),
        current_user=Depends(get_current_user),
    ):
        try:
            if start_date:
                datetime.strptime(start_date, "%Y-%m-%d")
            if end_date:
                datetime.strptime(end_date, "%Y-%m-%d")
            await _maybe_force_fresh_read(request)
            from services.metric_facts_service import metric_fact_service

            return await metric_fact_service.get_metrics_snapshot(
                user_id=current_user["id"],
                start_date=start_date,
                end_date=end_date,
                days_back=3650,
            )
        except ValueError:
            raise HTTPException(status_code=400, detail="start_date/end_date must be YYYY-MM-DD")
        except HTTPException:
            raise
        except Exception:
            logger.exception("dashboard metrics snapshot failed for user %s", current_user.get("id"))
            raise HTTPException(status_code=400, detail="Request could not be processed.")

    @router.get("/api/logs/read-model")
    async def get_logs_read_model(
        request: Request,
        start_date: Optional[str] = Query(None),
        end_date: Optional[str] = Query(None),
        limit: int = Query(200, ge=1, le=500),
        offset: int = Query(0, ge=0),
        habit_id: Optional[str] = Query(None),
        q: Optional[str] = Query(None),
        categories: Optional[str] = Query(None),
        habits: Optional[str] = Query(None),
        statuses: Optional[str] = Query(None),
        sources: Optional[str] = Query(None),
        sort: Optional[str] = Query(None),
        order: Optional[str] = Query(None),
        current_user=Depends(get_current_user),
    ):
        try:
            if start_date:
                datetime.strptime(start_date, "%Y-%m-%d")
            if end_date:
                datetime.strptime(end_date, "%Y-%m-%d")
            await _maybe_force_fresh_read(request)
            from services.screen_read_models_service import screen_read_models_service

            return await screen_read_models_service.get_logs_read_model(
                user_id=current_user["id"],
                start_date=start_date,
                end_date=end_date,
                limit=limit,
                offset=offset,
                habit_id=habit_id,
                q=q,
                categories=categories,
                habits=habits,
                statuses=statuses,
                sources=sources,
                sort=sort,
                order=order,
            )
        except ValueError:
            raise HTTPException(status_code=400, detail="start_date/end_date must be YYYY-MM-DD")
        except HTTPException:
            raise
        except Exception:
            logger.exception("logs read model failed for user %s", current_user.get("id"))
            raise HTTPException(status_code=400, detail="Request could not be processed.")

    @router.get("/api/habits/aliases")
    async def get_all_habit_aliases(current_user=Depends(get_current_user)):
        try:
            return await habits_service.get_all_aliases_for_user(current_user["id"])
        except Exception:
            raise HTTPException(status_code=400, detail="Request could not be processed.")

    @router.post("/api/habits/{habit_id}/aliases")
    async def add_habit_alias(
        habit_id: str,
        alias_text: str,
        current_user=Depends(get_current_user),
    ):
        try:
            success = await habits_service.add_habit_alias(habit_id, alias_text, current_user["id"])
            if not success:
                raise HTTPException(status_code=404, detail="Habit not found or alias could not be added")
            return {"success": True, "alias": alias_text.lower().strip()}
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=400, detail="Request could not be processed.")

    @router.post("/api/habits/{habit_id}/generate-aliases")
    async def generate_habit_aliases(
        habit_id: str,
        current_user=Depends(get_current_user),
    ):
        try:
            count = await habits_service.ensure_habit_aliases(habit_id, current_user["id"])
            return {"success": True, "aliases_added": count}
        except Exception:
            raise HTTPException(status_code=400, detail="Request could not be processed.")

    @router.put("/api/habits/{habit_id}", response_model=Habit)
    async def update_habit(
        habit_id: str,
        updates: HabitUpdate,
        current_user=Depends(get_current_user),
    ):
        try:
            habit = await habits_service.update_habit(habit_id, updates, current_user["id"])
            if tinybird_service:
                try:
                    await tinybird_service.update_habit_definition(habit)
                except Exception as tb_error:
                    logger.warning("Tinybird habit-definition update failed (non-fatal): %s", tb_error)
            return habit
        except Exception:
            raise HTTPException(status_code=400, detail="Request could not be processed.")

    @router.delete("/api/habits/{habit_id}")
    async def delete_habit(
        habit_id: str,
        current_user=Depends(get_current_user),
    ):
        try:
            await habits_service.delete_habit(habit_id, current_user["id"])
            return {"message": "Habit deleted successfully"}
        except Exception:
            raise HTTPException(status_code=400, detail="Request could not be processed.")

    @router.post("/api/habits/{habit_id}/logs", response_model=HabitLog)
    @limiter.limit("60/minute")
    async def log_habit(
        habit_id: str,
        log_data: HabitLogCreate,
        request: Request,
        current_user=Depends(get_current_user),
    ):
        try:
            habit = await habits_service.get_habit_by_id(habit_id, current_user["id"])
            if not habit:
                raise HTTPException(status_code=404, detail="Habit not found")
            return await habits_service.log_habit(habit_id, log_data, current_user["id"])
        except HTTPException:
            raise
        except ComputedMetricReadOnlyError as exc:
            raise HTTPException(
                status_code=409,
                detail={"code": "computed_metric_read_only", "message": str(exc)},
            ) from exc
        except Exception:
            raise HTTPException(status_code=400, detail="Request could not be processed.")

    @router.delete("/api/habits/{habit_id}/logs/{log_id}")
    async def delete_habit_log(
        habit_id: str,
        log_id: str,
        current_user=Depends(get_current_user),
    ):
        try:
            await habits_service.delete_habit_log(habit_id, log_id, current_user["id"])
            return {"message": "Habit log deleted successfully"}
        except Exception:
            raise HTTPException(status_code=400, detail="Request could not be processed.")

    @router.patch("/api/habits/{habit_id}/logs/{log_id}", response_model=HabitLog)
    async def update_habit_log(
        habit_id: str,
        log_id: str,
        update_data: HabitLogUpdate,
        current_user=Depends(get_current_user),
    ):
        try:
            return await habits_service.update_habit_log(
                habit_id,
                log_id,
                update_data,
                current_user["id"],
            )
        except HabitLogNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except HabitLogRevisionConflictError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except HabitLogUpdateValidationError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except Exception:
            logger.exception("habit log update failed for user %s", current_user.get("id"))
            raise HTTPException(status_code=400, detail="Request could not be processed.")

    @router.get("/api/habits/{habit_id}/logs", response_model=List[HabitLog])
    async def get_habit_logs(
        habit_id: str,
        request: Request,
        current_user=Depends(get_current_user),
    ):
        try:
            await _maybe_force_fresh_read(request)
            return await habits_service.get_habit_logs(habit_id, current_user["id"])
        except Exception:
            raise HTTPException(status_code=400, detail="Request could not be processed.")

    @router.get("/api/habit-logs", response_model=List[HabitLog])
    async def get_all_habit_logs(
        request: Request,
        start_date: Optional[str] = Query(None),
        end_date: Optional[str] = Query(None),
        limit: Optional[int] = Query(None, ge=1, le=10000),
        offset: int = Query(0, ge=0),
        current_user=Depends(get_current_user),
    ):
        try:
            if start_date:
                datetime.strptime(start_date, "%Y-%m-%d")
            if end_date:
                datetime.strptime(end_date, "%Y-%m-%d")
            await _maybe_force_fresh_read(request)
            return await habits_service.get_habit_logs(
                None,
                current_user["id"],
                start_date=start_date,
                end_date=end_date,
                limit=limit,
                offset=offset,
            )
        except ValueError:
            raise HTTPException(status_code=400, detail="start_date/end_date must be YYYY-MM-DD")
        except Exception:
            raise HTTPException(status_code=400, detail="Request could not be processed.")

    @router.post("/api/logs/batch")
    @limiter.limit("30/minute")
    async def batch_log_habits(
        request: Request,
        batch_request: BatchLogRequest,
        current_user=Depends(get_current_user),
    ):
        try:
            if not batch_request.items:
                raise HTTPException(status_code=400, detail="No items provided")
            if len(batch_request.items) > 10:
                raise HTTPException(status_code=400, detail="Maximum 10 items per batch")

            items = [item.model_dump() for item in batch_request.items]
            result = await habits_service.batch_log_habits(
                items=items,
                user_id=current_user["id"],
                client_event_id=batch_request.client_event_id,
            )

            if not result.get("success"):
                raise HTTPException(
                    status_code=400,
                    detail={
                        "message": result.get("error", "Batch log failed"),
                        "results": result.get("results", []),
                        "logged_count": result.get("logged_count", 0),
                    },
                )
            return result
        except HTTPException:
            raise
        except Exception:
            logger.exception("Batch log error")
            raise HTTPException(status_code=500, detail="Request could not be processed.")

    return router
