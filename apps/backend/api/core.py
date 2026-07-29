"""Core API router extracted from main.py (user, habits, calendar, batch logging)."""

import asyncio
import logging
import os
import uuid
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import and_, delete, select

from database.connection import force_local_replica_sync, get_db_session
from database.models import ScheduledBlockDB
from database.helpers import user_db_to_profile
from models.habit_models import Habit, HabitCreate, HabitLog, HabitLogCreate, HabitUpdate
from models.user_models import (
    BootstrapProfileUpdate,
    ChecklistUpdateRequest,
    FirstBehaviorRequest,
    OnboardingData,
    UserBootstrapResponse,
    UserProfile,
)
from services.account_deletion_service import (
    clerk_identity_exists,
    process_account_deletion,
)
from services.activation_service import activation_service
from services.privacy_policy import (
    can_send_to_cloud,
    request_cloud_consents,
    request_privacy_mode,
)
from services.turso_user_service import TursoProvisioningError, turso_user_service
from services.user_service import AccountIdentityConflictError

logger = logging.getLogger(__name__)

BOOTSTRAP_ACTIVITY_METADATA_TIMEOUT_SECONDS = 2.5


async def ensure_current_user_record(user_service: Any, current_user: Dict[str, Any]):
    try:
        return await user_service.ensure_user_exists(
            user_id=current_user["id"],
            email=current_user.get("email") or "",
            full_name=current_user.get("name"),
            phone_number=current_user.get("phone"),
        )
    except AccountIdentityConflictError as conflict:
        if await clerk_identity_exists(conflict.existing_user_id):
            raise

        logger.warning(
            "Recovering stale Ritual account row %s after Clerk confirmed deletion",
            conflict.existing_user_id,
        )
        await process_account_deletion(
            conflict.existing_user_id,
            source="identity_conflict_recovery",
            event_id=(
                f"identity-conflict:{conflict.existing_user_id}:"
                f"{conflict.requested_user_id}"
            ),
        )
        return await user_service.ensure_user_exists(
            user_id=current_user["id"],
            email=current_user.get("email") or "",
            full_name=current_user.get("name"),
            phone_number=current_user.get("phone"),
        )


def _env_flag(name: str) -> bool:
    return os.getenv(name, "").lower() in {"1", "true", "yes", "on"}


class ScheduledBlockBase(BaseModel):
    title: str
    notes: Optional[str] = None
    day: str  # YYYY-MM-DD
    start_minutes: int  # 0..1439
    end_minutes: int  # 1..1440


class ScheduledBlockCreate(ScheduledBlockBase):
    pass


class ScheduledBlockUpdate(BaseModel):
    title: Optional[str] = None
    notes: Optional[str] = None
    day: Optional[str] = None
    start_minutes: Optional[int] = None
    end_minutes: Optional[int] = None


class ScheduledBlock(ScheduledBlockBase):
    id: str
    user_id: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


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


def _validate_scheduled_block_values(day: str, start_minutes: int, end_minutes: int):
    try:
        datetime.strptime(day, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="day must be YYYY-MM-DD")

    if start_minutes < 0 or start_minutes > 1439:
        raise HTTPException(status_code=400, detail="start_minutes must be between 0 and 1439")

    if end_minutes < 1 or end_minutes > 1440:
        raise HTTPException(status_code=400, detail="end_minutes must be between 1 and 1440")

    if end_minutes <= start_minutes:
        raise HTTPException(status_code=400, detail="end_minutes must be greater than start_minutes")


async def _maybe_force_fresh_read(request: Request):
    if request.headers.get("x-ritual-force-fresh") == "1":
        await force_local_replica_sync()


async def _ensure_activity_metadata_for_bootstrap(user_id: str) -> None:
    """Best-effort provisioning guard for login/bootstrap.

    Per-user activity databases are useful for local watcher sync, but a slow
    Turso platform call should never trap an authenticated user on the desktop
    setup spinner.
    """
    try:
        await asyncio.wait_for(
            turso_user_service.ensure_user_activity_metadata(user_id),
            timeout=BOOTSTRAP_ACTIVITY_METADATA_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        logger.warning(
            "Timed out provisioning per-user activity metadata during bootstrap for user %s after %.1fs",
            user_id,
            BOOTSTRAP_ACTIVITY_METADATA_TIMEOUT_SECONDS,
        )
    except TursoProvisioningError:
        logger.warning(
            "Failed provisioning per-user activity metadata during bootstrap for user %s",
            user_id,
            exc_info=True,
        )
    except Exception:
        logger.warning(
            "Unexpected error provisioning per-user activity metadata during bootstrap for user %s",
            user_id,
            exc_info=True,
        )


def create_core_router(
    *,
    limiter: Any,
    get_current_user: Callable[..., Any],
    user_service: Any,
    habits_service: Any,
    tinybird_service: Any,
) -> APIRouter:
    """Build core router with injected app dependencies."""
    router = APIRouter(tags=["core"])

    @router.get("/api/user/profile", response_model=UserProfile)
    async def get_user_profile(current_user=Depends(get_current_user)):
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
        current_user=Depends(get_current_user),
    ):
        try:
            await _maybe_force_fresh_read(request)
            user = await ensure_current_user_record(user_service, current_user)
            await _ensure_activity_metadata_for_bootstrap(user.id)
            return await activation_service.get_bootstrap(current_user["id"])
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
            await user_service.ensure_user_exists(
                user_id=current_user["id"],
                email=current_user.get("email") or "",
                full_name=current_user.get("name"),
                phone_number=current_user.get("phone"),
            )
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
            await user_service.ensure_user_exists(
                user_id=current_user["id"],
                email=current_user.get("email") or "",
                full_name=current_user.get("name"),
                phone_number=current_user.get("phone"),
            )
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
            await user_service.ensure_user_exists(
                user_id=current_user["id"],
                email=current_user.get("email") or "",
                full_name=current_user.get("name"),
                phone_number=current_user.get("phone"),
            )
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
            await user_service.ensure_user_exists(
                user_id=current_user["id"],
                email=current_user.get("email") or "",
                full_name=current_user.get("name"),
                phone_number=current_user.get("phone"),
            )
            return await activation_service.mark_permissions_seen(user_id=current_user["id"])
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
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
            await user_service.ensure_user_exists(
                user_id=current_user["id"],
                email=current_user.get("email") or "",
                full_name=current_user.get("name"),
                phone_number=current_user.get("phone"),
            )
            config = await turso_user_service.get_desktop_sync_config(current_user["id"])
            logger.info("Providing Turso sync config to user %s", current_user["id"])
            return TursoSyncConfigResponse(
                sync_url=config.sync_url,
                auth_token=config.auth_token,
                expires_at=config.expires_at,
                database_name=config.database_name,
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
            await user_service.ensure_user_exists(
                user_id=current_user["id"],
                email=current_user["email"],
                full_name=current_user.get("name"),
            )
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
            # Habits reference users.id — Clerk JWT alone does not insert the row; without this,
            # first habit create fails FK and surfaces as opaque 400s in dev.
            await user_service.ensure_user_exists(
                user_id=current_user["id"],
                email=current_user.get("email") or "",
                full_name=current_user.get("name"),
                phone_number=current_user.get("phone"),
            )
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

    @router.get("/api/calendar/read-model")
    async def get_calendar_read_model(
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
            from services.screen_read_models_service import screen_read_models_service

            return await screen_read_models_service.get_calendar_read_model(
                user_id=current_user["id"],
                start_date=start_date,
                end_date=end_date,
            )
        except ValueError:
            raise HTTPException(status_code=400, detail="start_date/end_date must be YYYY-MM-DD")
        except HTTPException:
            raise
        except Exception:
            logger.exception("calendar read model failed for user %s", current_user.get("id"))
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
        except Exception:
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

    @router.get("/api/calendar/scheduled-blocks", response_model=List[ScheduledBlock])
    async def get_scheduled_blocks(
        start_date: Optional[str] = Query(None),
        end_date: Optional[str] = Query(None),
        current_user=Depends(get_current_user),
    ):
        try:
            if start_date:
                datetime.strptime(start_date, "%Y-%m-%d")
            if end_date:
                datetime.strptime(end_date, "%Y-%m-%d")

            async with get_db_session() as session:
                query = select(ScheduledBlockDB).where(ScheduledBlockDB.user_id == current_user["id"])
                if start_date:
                    query = query.where(ScheduledBlockDB.day >= start_date)
                if end_date:
                    query = query.where(ScheduledBlockDB.day <= end_date)
                query = query.order_by(ScheduledBlockDB.day.asc(), ScheduledBlockDB.start_minutes.asc())
                result = await session.execute(query)
                return result.scalars().all()
        except ValueError:
            raise HTTPException(status_code=400, detail="start_date/end_date must be YYYY-MM-DD")
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=400, detail="Request could not be processed.")

    @router.post("/api/calendar/scheduled-blocks", response_model=ScheduledBlock)
    async def create_scheduled_block(
        block_data: ScheduledBlockCreate,
        current_user=Depends(get_current_user),
    ):
        try:
            title = block_data.title.strip()
            if not title:
                raise HTTPException(status_code=400, detail="title is required")

            _validate_scheduled_block_values(
                day=block_data.day,
                start_minutes=block_data.start_minutes,
                end_minutes=block_data.end_minutes,
            )

            now = datetime.utcnow()
            block = ScheduledBlockDB(
                id=str(uuid.uuid4()),
                user_id=current_user["id"],
                title=title,
                notes=block_data.notes.strip() if block_data.notes else None,
                day=block_data.day,
                start_minutes=block_data.start_minutes,
                end_minutes=block_data.end_minutes,
                created_at=now,
                updated_at=now,
            )

            async with get_db_session() as session:
                session.add(block)
                await session.commit()
                await session.refresh(block)
                return block
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=400, detail="Request could not be processed.")

    @router.put("/api/calendar/scheduled-blocks/{block_id}", response_model=ScheduledBlock)
    async def update_scheduled_block(
        block_id: str,
        block_data: ScheduledBlockUpdate,
        current_user=Depends(get_current_user),
    ):
        try:
            async with get_db_session() as session:
                result = await session.execute(
                    select(ScheduledBlockDB).where(
                        and_(
                            ScheduledBlockDB.id == block_id,
                            ScheduledBlockDB.user_id == current_user["id"],
                        )
                    )
                )
                block = result.scalar_one_or_none()
                if not block:
                    raise HTTPException(status_code=404, detail="Scheduled block not found")

                next_day = block_data.day if block_data.day is not None else block.day
                next_start = block_data.start_minutes if block_data.start_minutes is not None else block.start_minutes
                next_end = block_data.end_minutes if block_data.end_minutes is not None else block.end_minutes

                _validate_scheduled_block_values(day=next_day, start_minutes=next_start, end_minutes=next_end)

                if block_data.title is not None:
                    title = block_data.title.strip()
                    if not title:
                        raise HTTPException(status_code=400, detail="title cannot be empty")
                    block.title = title

                if block_data.notes is not None:
                    block.notes = block_data.notes.strip() or None

                block.day = next_day
                block.start_minutes = next_start
                block.end_minutes = next_end
                block.updated_at = datetime.utcnow()

                await session.commit()
                await session.refresh(block)
                return block
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=400, detail="Request could not be processed.")

    @router.delete("/api/calendar/scheduled-blocks/{block_id}")
    async def delete_scheduled_block(
        block_id: str,
        current_user=Depends(get_current_user),
    ):
        try:
            async with get_db_session() as session:
                result = await session.execute(
                    select(ScheduledBlockDB).where(
                        and_(
                            ScheduledBlockDB.id == block_id,
                            ScheduledBlockDB.user_id == current_user["id"],
                        )
                    )
                )
                block = result.scalar_one_or_none()
                if not block:
                    raise HTTPException(status_code=404, detail="Scheduled block not found")
                await session.delete(block)
                await session.commit()
                return {"deleted": True, "id": block_id}
        except HTTPException:
            raise
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
