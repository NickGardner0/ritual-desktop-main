"""Core API router extracted from main.py (user, habits, calendar, batch logging)."""

import logging
import uuid
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import and_, delete, select

from database.connection import get_db_session
from database.models import ScheduledBlockDB
from database.helpers import user_db_to_profile
from models.habit_models import Habit, HabitCreate, HabitLog, HabitLogCreate, HabitUpdate
from models.user_models import OnboardingData, UserProfile
from services.turso_user_service import TursoProvisioningError, turso_user_service

logger = logging.getLogger(__name__)


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
            user = await user_service.ensure_user_exists(
                user_id=current_user["id"],
                email=current_user["email"],
                full_name=current_user.get("name"),
                phone_number=current_user.get("phone"),
            )
            try:
                provisioned = await turso_user_service.ensure_user_activity_database(user.id)
                if provisioned is not None:
                    user = provisioned
            except TursoProvisioningError:
                if turso_user_service.is_platform_configured():
                    raise
            logger.info("User profile ensured for %s", user.email)
            return user_db_to_profile(user)
        except TursoProvisioningError as exc:
            logger.exception("Error provisioning per-user Turso database")
            raise HTTPException(status_code=500, detail=str(exc))
        except Exception:
            logger.exception("Error getting user profile")
            raise HTTPException(status_code=500, detail="Request could not be processed.")

    @router.get("/api/user/turso-sync-config", response_model=TursoSyncConfigResponse)
    async def get_turso_sync_config(current_user=Depends(get_current_user)):
        try:
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
            return await habits_service.get_habits(current_user["id"])
        except Exception:
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
    async def get_habit_logs(habit_id: str, current_user=Depends(get_current_user)):
        try:
            return await habits_service.get_habit_logs(habit_id, current_user["id"])
        except Exception:
            raise HTTPException(status_code=400, detail="Request could not be processed.")

    @router.get("/api/habit-logs", response_model=List[HabitLog])
    async def get_all_habit_logs(current_user=Depends(get_current_user)):
        try:
            return await habits_service.get_habit_logs(None, current_user["id"])
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
