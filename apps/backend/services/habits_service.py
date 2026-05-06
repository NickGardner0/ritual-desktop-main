"""
Habits Service - Handles all habit-related database operations
Used by the FastAPI routers for habits and habit logs.
"""

import uuid
import logging
import json
import asyncio
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import case, or_, select, update, delete, func
from sqlalchemy.exc import SQLAlchemyError

from models.habit_models import Habit, HabitCreate, HabitUpdate, HabitLog, HabitLogCreate
from database.connection import get_db_session
from database.models import HabitDB, HabitLogDB, UserDB, HabitAliasDB
from database.helpers import habit_db_to_pydantic, habit_log_db_to_pydantic
from services.realtime import websocket_manager
from services.tinybird_service import TinybirdService

logger = logging.getLogger(__name__)


# Phase 5A: Built-in synonym map for common habit types
HABIT_SYNONYMS = {
    "walk": ["walking", "walked", "stroll", "strolled", "hike", "hiked"],
    "run": ["running", "ran", "jog", "jogging", "jogged"],
    "workout": ["work out", "worked out", "exercise", "exercised", "gym", "training", "trained"],
    "meditation": ["meditate", "meditated", "mindfulness", "mindful"],
    "sleep": ["slept", "sleeping", "rest", "rested"],
    "read": ["reading", "book", "books"],
    "code": ["coding", "coded", "programming", "programmed", "develop", "developed"],
    "write": ["writing", "wrote", "written"],
    "study": ["studying", "studied", "learn", "learning", "learned"],
    "stretch": ["stretching", "stretched", "yoga"],
    "swim": ["swimming", "swam"],
    "bike": ["biking", "biked", "cycling", "cycled", "bicycle"],
    "water": ["hydrate", "hydrated", "hydration", "drink", "drank"],
    "caffeine": ["coffee", "espresso", "tea"],
    "screen": ["screentime", "screen time", "phone", "device"],
}

class HabitsService:
    """Service class for habit operations"""
    
    def __init__(self):
        """Initialize with Tinybird service"""
        try:
            self.tinybird = TinybirdService()
            self.tinybird_enabled = True
            logger.info("✅ Tinybird service initialized - automatic sync enabled")
        except Exception as e:
            logger.warning(f"⚠️  Tinybird service not available: {e}")
            self.tinybird = None
            self.tinybird_enabled = False

    def _is_whoop_heart_rate_habit(self, habit: Habit) -> bool:
        metric_type = (habit.metric_type or "").strip().lower()
        integration_source = (habit.integration_source or "").strip().lower()
        habit_name = (habit.name or "").strip().lower()
        return (
            integration_source == "whoop"
            and (metric_type in {"heart_rate", "hr"} or habit_name == "heart rate")
        )

    def _is_sleep_like_habit_db(self, habit: HabitDB) -> bool:
        metric_type = (habit.metric_type or "").strip().lower()
        habit_name = (habit.name or "").strip().lower()
        category = (habit.category or "").strip().lower()
        integration_source = (habit.integration_source or "").strip().lower()

        if metric_type in {"sleep", "sleep_session", "sleep_duration", "sleep_total", "in_bed"}:
            return True
        if "sleep" in habit_name:
            return True
        return "sleep" in category and integration_source in {
            "whoop",
            "oura",
            "apple_health",
            "fitbit",
            "garmin",
        }

    def _overview_daily_value_from_row(
        self,
        habit: HabitDB,
        row: Any,
    ) -> float:
        unit = (habit.unit_type or "sessions").lower()
        use_max_per_day = self._is_sleep_like_habit_db(habit)

        duration_value = float(row.max_duration or 0) if use_max_per_day else float(row.duration_sum or 0)
        amount_count = int(row.amount_count or 0)
        amount_value = float(row.max_amount or 0) if use_max_per_day else float(row.amount_sum or 0)

        if "hour" in unit:
            if duration_value > 0:
                return duration_value / 3600
            if amount_count > 0:
                return amount_value
            return float(row.entry_count or 0)

        if "minute" in unit:
            if duration_value > 0:
                return duration_value / 60
            if amount_count > 0:
                return amount_value
            return float(row.entry_count or 0)

        if amount_count > 0:
            return amount_value
        if duration_value > 0:
            return duration_value / 3600
        return float(row.entry_count or 0)

    def _build_overview_stat(
        self,
        habit: HabitDB,
        daily_values: List[float],
        total_entries: int,
    ) -> Dict[str, Any]:
        unit = habit.unit_type or "sessions"
        finite_values = [value for value in daily_values if value == value]
        days_with_data = len([value for value in finite_values if value > 0])

        if not finite_values:
            return {
                "id": habit.id,
                "name": habit.name,
                "category": habit.category,
                "unit": unit,
                "total": 0,
                "average": 0,
                "min": 0,
                "max": 0,
                "variance": 0,
                "std_dev": 0,
                "days_with_data": 0,
                "total_entries": 0,
                "summary": f"{habit.name}: no recent data",
            }

        total = sum(finite_values)
        average = total / len(finite_values)
        min_value = min(finite_values)
        max_value = max(finite_values)
        variance = sum((value - average) ** 2 for value in finite_values) / len(finite_values)

        return {
            "id": habit.id,
            "name": habit.name,
            "category": habit.category,
            "unit": unit,
            "total": total,
            "average": average,
            "min": min_value,
            "max": max_value,
            "variance": variance,
            "std_dev": variance ** 0.5,
            "days_with_data": days_with_data,
            "total_entries": total_entries,
            "summary": f"{habit.name}: {total:.2f} total across {len(finite_values)} days",
        }

    async def get_overview_snapshot(
        self,
        user_id: str,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Return a compact dashboard Overview snapshot.

        This intentionally aggregates in SQL by habit/day so desktop startup does
        not need to download and parse every historical habit log before it can
        show the metric column.
        """
        async with get_db_session() as session:
            habits_result = await session.execute(
                select(HabitDB)
                .where(HabitDB.user_id == user_id)
                .order_by(HabitDB.created_at.asc())
            )
            habits = list(habits_result.scalars().all())
            habit_ids = [habit.id for habit in habits if habit.id]

            overview_stats: Dict[str, Any] = {
                habit.id: self._build_overview_stat(habit, [], 0)
                for habit in habits
                if habit.id
            }

            if habit_ids:
                duration_sum = func.coalesce(
                    func.sum(
                        case(
                            (HabitLogDB.duration > 0, HabitLogDB.duration),
                            else_=0,
                        )
                    ),
                    0,
                ).label("duration_sum")
                max_duration = func.coalesce(func.max(func.coalesce(HabitLogDB.duration, 0)), 0).label("max_duration")
                amount_sum = func.coalesce(func.sum(func.coalesce(HabitLogDB.amount, 0)), 0).label("amount_sum")
                max_amount = func.coalesce(func.max(func.coalesce(HabitLogDB.amount, 0)), 0).label("max_amount")
                amount_count = func.count(HabitLogDB.amount).label("amount_count")
                entry_count = func.count(HabitLogDB.id).label("entry_count")

                logs_query = (
                    select(
                        HabitLogDB.habit_id.label("habit_id"),
                        HabitLogDB.date.label("date"),
                        duration_sum,
                        max_duration,
                        amount_sum,
                        max_amount,
                        amount_count,
                        entry_count,
                    )
                    .where(
                        HabitLogDB.habit_id.in_(habit_ids),
                        or_(
                            HabitLogDB.status.is_(None),
                            HabitLogDB.status == "",
                            HabitLogDB.status == "completed",
                            HabitLogDB.status == "success",
                        ),
                    )
                    .group_by(HabitLogDB.habit_id, HabitLogDB.date)
                    .order_by(HabitLogDB.habit_id.asc(), HabitLogDB.date.asc())
                )
                if start_date:
                    logs_query = logs_query.where(HabitLogDB.date >= start_date)
                if end_date:
                    logs_query = logs_query.where(HabitLogDB.date <= end_date)

                rows = list((await session.execute(logs_query)).all())
                habits_by_id = {habit.id: habit for habit in habits}
                values_by_habit: Dict[str, List[float]] = {}
                entries_by_habit: Dict[str, int] = {}

                for row in rows:
                    habit = habits_by_id.get(row.habit_id)
                    if not habit:
                        continue
                    values_by_habit.setdefault(row.habit_id, []).append(
                        self._overview_daily_value_from_row(habit, row)
                    )
                    entries_by_habit[row.habit_id] = entries_by_habit.get(row.habit_id, 0) + int(row.entry_count or 0)

                overview_stats = {
                    habit.id: self._build_overview_stat(
                        habit,
                        values_by_habit.get(habit.id, []),
                        entries_by_habit.get(habit.id, 0),
                    )
                    for habit in habits
                    if habit.id
                }

            return {
                "habits": [
                    habit_db_to_pydantic(habit).model_dump(mode="json")
                    for habit in habits
                ],
                "overviewStats": overview_stats,
                "meta": {
                    "userId": user_id,
                    "generatedAt": int(datetime.now(timezone.utc).timestamp() * 1000),
                    "startDate": start_date,
                    "endDate": end_date,
                },
            }

    async def _safe_background_task(self, coro, task_name: str):
        """Wrapper for fire-and-forget background tasks with error logging."""
        try:
            await coro
        except Exception as e:
            logger.error("Background task '%s' failed: %s", task_name, e)

    def _fire_habit_log_side_effects(
        self, habit_log: HabitLog, habit: Habit, user_id: str
    ):
        """Fire-and-forget Tinybird sync, Typesense indexing, and WebSocket notification for a habit log."""
        if self.tinybird_enabled:
            asyncio.create_task(
                self._safe_background_task(
                    self._sync_habit_log_to_tinybird(habit_log, habit, user_id),
                    f"tinybird_sync_log:{habit_log.id}",
                )
            )

        async def _index_log():
            from services.search_service import search_service
            await search_service.index_habit_log(
                habit_log.model_dump(),
                user_id,
                habit_name=habit.name,
                category=habit.category,
            )

        asyncio.create_task(
            self._safe_background_task(_index_log(), f"typesense_index_log:{habit_log.id}")
        )

        asyncio.create_task(
            self._safe_background_task(
                websocket_manager.notify_habit_logged(
                    {
                        "id": habit_log.id,
                        "habit_id": habit_log.habit_id,
                        "habit_name": habit_log.habit_name,
                        "date": habit_log.date,
                        "completed_at": habit_log.completed_at,
                        "amount": habit_log.amount,
                        "duration": habit_log.duration,
                        "status": habit_log.status,
                    },
                    user_id,
                ),
                f"websocket_notify_log:{habit_log.id}",
            )
        )

    def _fire_habit_definition_side_effects(self, habit: Habit, user_id: str):
        """Fire-and-forget Tinybird sync and Typesense indexing for a habit definition."""
        if self.tinybird_enabled:
            asyncio.create_task(
                self._safe_background_task(
                    self._sync_habit_to_tinybird(habit),
                    f"tinybird_sync_habit:{habit.id}",
                )
            )

        async def _index_habit():
            from services.search_service import search_service
            await search_service.index_habit(habit.model_dump(), user_id)

        asyncio.create_task(
            self._safe_background_task(_index_habit(), f"typesense_index_habit:{habit.id}")
        )

    async def create_habit(self, habit_data: HabitCreate, user_id: str) -> Habit:
        """
        Create a new habit - mirrors habitsService.createHabit()
        """
        async with get_db_session() as session:
            try:
                name_key = (habit_data.name or "").strip().lower()
                if name_key:
                    dup = await session.execute(
                        select(HabitDB).where(
                            HabitDB.user_id == user_id,
                            func.lower(func.trim(HabitDB.name)) == name_key,
                        )
                    )
                    existing_row = dup.scalar_one_or_none()
                    if existing_row:
                        logger.info(
                            "Habit '%s' already exists for user %s; returning existing",
                            habit_data.name,
                            user_id,
                        )
                        return habit_db_to_pydantic(existing_row)

                # Create habit record
                habit_db = HabitDB(
                    id=str(uuid.uuid4()),
                    user_id=user_id,
                    name=habit_data.name,
                    category=habit_data.category,
                    icon=habit_data.icon,
                    is_custom=habit_data.is_custom or False,
                    integration_source=habit_data.integration_source,
                    unit_type=habit_data.unit_type,
                    sensor_type=habit_data.sensor_type,
                    metric_type=habit_data.metric_type,
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow()
                )
                
                session.add(habit_db)
                await session.commit()
                await session.refresh(habit_db)
                
                # Convert to Pydantic model
                habit = habit_db_to_pydantic(habit_db)

                # Fire-and-forget: Tinybird sync + Typesense indexing (background)
                self._fire_habit_definition_side_effects(habit, user_id)

                if self._is_whoop_heart_rate_habit(habit):
                    try:
                        from services.biometrics_service import biometrics_service

                        projected_count = await biometrics_service.sync_projected_heart_rate_habits(
                            user_id,
                            habit.id,
                        )
                        logger.info(
                            "🫀 Backfilled %s projected heart-rate logs for WHOOP habit '%s'",
                            projected_count,
                            habit.name,
                        )
                    except Exception as e:
                        logger.warning(
                            f"⚠️  Heart-rate rollup projection failed for habit '{habit.name}': {e}"
                        )
                
                return habit
                
            except SQLAlchemyError as e:
                await session.rollback()
                raise Exception(f"Failed to create habit: {str(e)}")
    
    async def get_habits(self, user_id: str) -> List[Habit]:
        """
        Get all habits for a user - mirrors habitsService.getHabits()
        """
        async with get_db_session() as session:
            try:
                result = await session.execute(
                    select(HabitDB)
                    .where(HabitDB.user_id == user_id)
                    .order_by(HabitDB.created_at.desc())
                    .limit(500)
                )
                habits_db = result.scalars().all()
                return [habit_db_to_pydantic(habit) for habit in habits_db]
                
            except SQLAlchemyError as e:
                raise Exception(f"Failed to fetch habits: {str(e)}")
    
    async def get_habit_by_id(self, habit_id: str, user_id: str) -> Optional[Habit]:
        """
        Get a specific habit by ID
        """
        async with get_db_session() as session:
            try:
                result = await session.execute(
                    select(HabitDB)
                    .where(HabitDB.id == habit_id)
                    .where(HabitDB.user_id == user_id)
                )
                habit_db = result.scalar_one_or_none()
                return habit_db_to_pydantic(habit_db) if habit_db else None
                
            except SQLAlchemyError as e:
                raise Exception(f"Failed to fetch habit: {str(e)}")
    
    async def update_habit(self, habit_id: str, updates: HabitUpdate, user_id: str) -> Habit:
        """
        Update a habit - mirrors habitsService.updateHabit()
        """
        async with get_db_session() as session:
            try:
                # Build update dict with only provided fields
                update_data = {}
                if updates.name is not None:
                    update_data['name'] = updates.name
                if updates.category is not None:
                    update_data['category'] = updates.category
                if updates.icon is not None:
                    update_data['icon'] = updates.icon
                if updates.is_custom is not None:
                    update_data['is_custom'] = updates.is_custom
                if updates.integration_source is not None:
                    update_data['integration_source'] = updates.integration_source
                if updates.unit_type is not None:
                    update_data['unit_type'] = updates.unit_type
                if updates.sensor_type is not None:
                    update_data['sensor_type'] = updates.sensor_type
                if updates.metric_type is not None:
                    update_data['metric_type'] = updates.metric_type
                
                update_data['updated_at'] = datetime.utcnow()
                
                # Update the habit
                await session.execute(
                    update(HabitDB)
                    .where(HabitDB.id == habit_id)
                    .where(HabitDB.user_id == user_id)
                    .values(**update_data)
                )
                
                await session.commit()
                
                # Fetch and return updated habit
                updated_habit = await self.get_habit_by_id(habit_id, user_id)
                if not updated_habit:
                    raise Exception("Habit not found or not authorized")

                # Sync updated name/unit/category/icon to analytics + search
                self._fire_habit_definition_side_effects(updated_habit, user_id)

                return updated_habit
                
            except SQLAlchemyError as e:
                await session.rollback()
                raise Exception(f"Failed to update habit: {str(e)}")
    
    async def delete_habit(self, habit_id: str, user_id: str) -> None:
        """
        Delete a habit - mirrors habitsService.deleteHabit()
        """
        async with get_db_session() as session:
            try:
                # First check if the habit exists
                check_result = await session.execute(
                    select(HabitDB)
                    .where(HabitDB.id == habit_id)
                )
                habit = check_result.scalar_one_or_none()
                
                if not habit:
                    logger.error(f"❌ Habit not found: {habit_id}")
                    raise Exception(f"Habit not found with ID: {habit_id}")
                
                if habit.user_id != user_id:
                    logger.error(f"❌ Unauthorized: habit user_id={habit.user_id}, requested user_id={user_id}")
                    raise Exception(f"Not authorized to delete this habit")
                
                # Delete habit logs first (cascade)
                logs_result = await session.execute(
                    delete(HabitLogDB)
                    .where(HabitLogDB.habit_id == habit_id)
                )
                logger.info(f"🗑️ Deleted {logs_result.rowcount} habit logs for habit {habit_id}")
                
                # Delete the habit
                result = await session.execute(
                    delete(HabitDB)
                    .where(HabitDB.id == habit_id)
                    .where(HabitDB.user_id == user_id)
                )
                
                if result.rowcount == 0:
                    raise Exception("Habit not found or not authorized")
                
                await session.commit()
                logger.info(f"✅ Successfully deleted habit: {habit.name} ({habit_id})")
                
            except SQLAlchemyError as e:
                await session.rollback()
                logger.error(f"❌ Database error deleting habit: {str(e)}")
                raise Exception(f"Failed to delete habit: {str(e)}")
    
    async def log_habit(self, habit_id: str, log_data: HabitLogCreate, user_id: str) -> HabitLog:
        """
        Log a habit completion - mirrors habitsService.logHabit()
        """
        async with get_db_session() as session:
            try:
                # Verify habit exists and belongs to user
                habit = await self.get_habit_by_id(habit_id, user_id)
                if not habit:
                    raise Exception("Habit not found or not authorized")
                
                # Create habit log (include habit_name for denormalization)
                log_db = HabitLogDB(
                    id=str(uuid.uuid4()),
                    habit_id=habit_id,
                    habit_name=habit.name,  # Denormalized for performance and historical accuracy
                    duration=log_data.duration,
                    amount=log_data.amount,
                    date=log_data.date,
                    completed_at=log_data.completed_at,
                    status=log_data.status,
                    notes=log_data.notes
                )
                
                session.add(log_db)
                await session.commit()
                await session.refresh(log_db)
                
                habit_log = habit_log_db_to_pydantic(log_db)

                # Fire-and-forget: Tinybird + Typesense + WebSocket (background)
                self._fire_habit_log_side_effects(habit_log, habit, user_id)

                return habit_log
                
            except SQLAlchemyError as e:
                await session.rollback()
                raise Exception(f"Failed to log habit: {str(e)}")

    async def upsert_habit_log_rollup(
        self,
        *,
        habit_id: str,
        user_id: str,
        date: str,
        amount: Optional[float],
        completed_at: Optional[str],
        status: str,
        source: str,
        origin_record_kind: str,
        origin_record_id: str,
        notes: Optional[str] = None,
        log_metadata: Optional[Dict[str, Any]] = None,
    ) -> HabitLog:
        """
        Upsert a rollup-oriented habit log keyed by origin_record_kind/origin_record_id.
        Used for provider-backed daily aggregates such as Plaid spending.
        """
        async with get_db_session() as session:
            try:
                habit = await self.get_habit_by_id(habit_id, user_id)
                if not habit:
                    raise Exception("Habit not found or not authorized")

                result = await session.execute(
                    select(HabitLogDB).where(
                        HabitLogDB.habit_id == habit_id,
                        HabitLogDB.origin_record_kind == origin_record_kind,
                        HabitLogDB.origin_record_id == origin_record_id,
                    )
                )
                log_db = result.scalar_one_or_none()
                if log_db is None:
                    log_db = HabitLogDB(
                        id=str(uuid.uuid4()),
                        habit_id=habit_id,
                        habit_name=habit.name,
                        origin_record_kind=origin_record_kind,
                        origin_record_id=origin_record_id,
                    )
                    session.add(log_db)

                log_db.habit_name = habit.name
                log_db.duration = None
                log_db.amount = amount
                log_db.date = date
                log_db.completed_at = completed_at
                log_db.status = status
                log_db.notes = notes
                log_db.source = source
                log_db.log_metadata = (
                    json.dumps(log_metadata) if isinstance(log_metadata, dict) else log_metadata
                )

                await session.commit()
                await session.refresh(log_db)

                habit_log = habit_log_db_to_pydantic(log_db)

                # Fire-and-forget: Tinybird + Typesense + WebSocket (background)
                self._fire_habit_log_side_effects(habit_log, habit, user_id)

                return habit_log
            except SQLAlchemyError as e:
                await session.rollback()
                raise Exception(f"Failed to upsert rollup habit log: {str(e)}")

    async def batch_log_habits(
        self, 
        items: List[Dict], 
        user_id: str, 
        client_event_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Phase 5A: Batch log multiple habits at once.
        Returns per-item results with success/error status.
        """
        results: List[Dict[str, Any]] = []
        
        async with get_db_session() as session:
            try:
                # Check for idempotency if client_event_id provided
                if client_event_id:
                    existing = await session.execute(
                        select(HabitLogDB).where(HabitLogDB.client_event_id == client_event_id)
                    )
                    existing_logs = existing.scalars().all()
                    if existing_logs:
                        logger.warning(f"⚠️ Duplicate client_event_id detected: {client_event_id}")
                        return {
                            "success": True,
                            "duplicate": True,
                            "results": [
                                {"index": i, "success": True, "log_id": log.id, "duplicate": True}
                                for i, log in enumerate(existing_logs)
                            ]
                        }
                
                # Pre-fetch all user habits for validation in this transaction.
                habit_rows = await session.execute(
                    select(HabitDB).where(HabitDB.user_id == user_id)
                )
                habits_by_id = {habit.id: habit for habit in habit_rows.scalars().all()}

                validation_errors: List[Dict[str, Any]] = []
                prepared_logs: List[tuple[int, HabitLogDB, HabitDB]] = []

                for index, item in enumerate(items):
                    habit_id = item.get("habit_id")
                    habit = habits_by_id.get(habit_id)
                    if habit is None:
                        validation_errors.append({
                            "index": index,
                            "success": False,
                            "error": f"Habit not found or not authorized: {habit_id}"
                        })
                        continue

                    # date is required for time-series analytics consistency.
                    if not item.get("date"):
                        validation_errors.append({
                            "index": index,
                            "success": False,
                            "error": "Missing required field: date"
                        })
                        continue

                    log_db = HabitLogDB(
                        id=str(uuid.uuid4()),
                        habit_id=habit_id,
                        habit_name=habit.name,
                        duration=item.get("duration"),
                        amount=item.get("amount"),
                        date=item.get("date"),
                        completed_at=item.get("completed_at") or datetime.now(timezone.utc).isoformat(),
                        status="completed",
                        notes=item.get("notes"),
                        client_event_id=client_event_id,
                        source=item.get("source", "ai_log_v2")
                    )
                    prepared_logs.append((index, log_db, habit))

                # All-or-nothing: if any item fails validation, do not write anything.
                if validation_errors:
                    return {
                        "success": False,
                        "error": "Batch validation failed. No logs were created.",
                        "results": validation_errors,
                        "logged_count": 0
                    }

                for _, log_db, _ in prepared_logs:
                    session.add(log_db)

                # Commit all logs as a single atomic transaction.
                await session.commit()

                for index, log_db, habit in prepared_logs:
                    results.append({
                        "index": index,
                        "success": True,
                        "log_id": log_db.id,
                        "habit_id": log_db.habit_id,
                        "habit_name": habit.name
                    })

                # Fire-and-forget background side effects for each log.
                # Tinybird gets a single batch call; Typesense indexes per-log.
                # WebSocket is intentionally skipped for batch — callers
                # (AI log, bulk import) don't need real-time UI push.
                if self.tinybird_enabled and prepared_logs:
                    batch_payload = [
                        {
                            'id': log_db.id,
                            'habit_id': log_db.habit_id,
                            'habit_name': log_db.habit_name or habit.name,
                            'user_id': user_id,
                            'date': log_db.date,
                            'duration': log_db.duration,
                            'amount': log_db.amount,
                            'unit': habit.unit_type,
                            'status': log_db.status,
                            'notes': log_db.notes,
                            'source': log_db.source or 'manual',
                            'completed_at': log_db.completed_at or log_db.date,
                            'metadata': log_db.log_metadata,
                            'integration_source': habit.integration_source,
                            'metric_type': habit.metric_type,
                        }
                        for _, log_db, habit in prepared_logs
                    ]
                    asyncio.create_task(
                        self._safe_background_task(
                            self.tinybird.ingest_habit_logs_batch(batch_payload),
                            "tinybird_batch_sync",
                        )
                    )

                # Typesense search indexing for each log
                for _, log_db, habit in prepared_logs:
                    async def _index_batch_log(log_row=log_db, h=habit):
                        from services.search_service import search_service
                        log = habit_log_db_to_pydantic(log_row)
                        await search_service.index_habit_log(
                            log.model_dump(), user_id,
                            habit_name=h.name, category=h.category,
                        )
                    asyncio.create_task(
                        self._safe_background_task(
                            _index_batch_log(),
                            f"typesense_index_batch_log:{log_db.id}",
                        )
                    )

                return {
                    "success": True,
                    "results": results,
                    "logged_count": sum(1 for r in results if r.get("success"))
                }
                
            except SQLAlchemyError as e:
                await session.rollback()
                return {
                    "success": False,
                    "error": f"Database error: {str(e)}",
                    "results": results,
                    "logged_count": 0
                }
    
    async def get_habit_logs(
        self,
        habit_id: Optional[str],
        user_id: str,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        limit: Optional[int] = None,
        offset: int = 0,
    ) -> List[HabitLog]:
        """
        Get habit logs - mirrors habitsService.getHabitLogs()
        """
        async with get_db_session() as session:
            try:
                query = (
                    select(HabitLogDB, HabitDB.name)
                    .join(HabitDB)
                    .where(HabitDB.user_id == user_id)
                )
                
                if habit_id:
                    query = query.where(HabitLogDB.habit_id == habit_id)
                if start_date:
                    query = query.where(HabitLogDB.date >= start_date)
                if end_date:
                    query = query.where(HabitLogDB.date <= end_date)
                
                query = query.order_by(HabitLogDB.date.desc())
                if limit is not None:
                    query = query.limit(max(1, min(int(limit), 10000))).offset(max(0, int(offset or 0)))
                
                result = await session.execute(query)
                rows = result.all()

                logs: List[HabitLog] = []
                for log_db, habit_name in rows:
                    log = habit_log_db_to_pydantic(log_db)
                    normalized_habit_name = (log.habit_name or "").strip() or (habit_name or "").strip()
                    if normalized_habit_name:
                        log.habit_name = normalized_habit_name
                    logs.append(log)

                return logs
                
            except SQLAlchemyError as e:
                raise Exception(f"Failed to fetch habit logs: {str(e)}")
    
    async def _sync_habit_to_tinybird(self, habit: Habit) -> None:
        """
        Sync habit definition to Tinybird for analytics enrichment
        """
        if not self.tinybird_enabled:
            return
            
        habit_data = {
            'id': habit.id,
            'user_id': habit.user_id,
            'name': habit.name,
            'category': habit.category,
            'icon': habit.icon,
            'is_custom': habit.is_custom,
            'integration_source': habit.integration_source,
            'unit_type': habit.unit_type,
            'created_at': habit.created_at.isoformat() if habit.created_at else None,
            'updated_at': habit.updated_at.isoformat() if habit.updated_at else None
        }
        
        await self.tinybird.ingest_habit_definition(habit_data)
    
    async def _sync_habit_log_to_tinybird(self, habit_log: HabitLog, habit: Habit, user_id: str) -> Dict[str, Any]:
        """
        Sync habit log to Tinybird for analytics.
        Maps all Turso fields to their Tinybird equivalents.
        """
        if not self.tinybird_enabled:
            return {'success': False, 'error': 'Tinybird not enabled'}
            
        log_data = {
            'id': habit_log.id,
            'habit_id': habit_log.habit_id,
            'habit_name': habit_log.habit_name or habit.name,
            'user_id': user_id,
            'date': habit_log.date,
            'duration': habit_log.duration,
            'amount': habit_log.amount,
            'unit': habit.unit_type,
            'status': habit_log.status,
            'notes': habit_log.notes,
            'source': habit_log.source or 'manual',
            'completed_at': habit_log.completed_at or habit_log.date,
            'metadata': habit_log.log_metadata,
            'integration_source': habit.integration_source,
            'metric_type': habit.metric_type,
        }
        
        result = await self.tinybird.ingest_habit_log(log_data)
        return result
    
    async def get_category_breakdown(self, user_id: str, start_date: str, end_date: str) -> List[Dict[str, Any]]:
        """
        Get habit completion breakdown by category for analytics
        Returns count of completed habits grouped by category
        """
        async with get_db_session() as session:
            try:
                from sqlalchemy import func, and_
                
                # Query to get habit logs count by category
                query = (
                    select(
                        HabitDB.category,
                        func.count(HabitLogDB.id).label('count'),
                        func.sum(HabitLogDB.duration).label('total_duration'),
                        func.sum(HabitLogDB.amount).label('total_amount')
                    )
                    .join(HabitLogDB, HabitDB.id == HabitLogDB.habit_id)
                    .where(
                        and_(
                            HabitDB.user_id == user_id,
                            HabitLogDB.date >= start_date,
                            HabitLogDB.date <= end_date,
                            HabitLogDB.status == 'completed'
                        )
                    )
                    .group_by(HabitDB.category)
                )
                
                result = await session.execute(query)
                rows = result.all()
                
                breakdown = []
                for row in rows:
                    breakdown.append({
                        'category': row.category,
                        'count': row.count,
                        'total_duration': row.total_duration or 0,
                        'total_amount': row.total_amount or 0
                    })
                
                return breakdown
                
            except SQLAlchemyError as e:
                logger.error(f"❌ Error fetching category breakdown: {e}")
                raise
    
    # ================================
    # Phase 5A: Alias Management
    # ================================
    
    async def get_habit_aliases(self, habit_id: str, user_id: str) -> List[str]:
        """
        Get all aliases for a habit.
        """
        async with get_db_session() as session:
            try:
                # Verify habit belongs to user
                habit = await self.get_habit_by_id(habit_id, user_id)
                if not habit:
                    return []
                
                result = await session.execute(
                    select(HabitAliasDB.alias_text)
                    .where(HabitAliasDB.habit_id == habit_id)
                )
                return [row[0] for row in result.all()]
                
            except SQLAlchemyError as e:
                logger.error(f"❌ Error fetching habit aliases: {e}")
                return []
    
    async def add_habit_alias(self, habit_id: str, alias_text: str, user_id: str) -> bool:
        """
        Add an alias to a habit.
        """
        async with get_db_session() as session:
            try:
                # Verify habit belongs to user
                habit = await self.get_habit_by_id(habit_id, user_id)
                if not habit:
                    return False
                
                normalized_alias = alias_text.lower().strip()
                
                # Check if alias already exists
                existing = await session.execute(
                    select(HabitAliasDB)
                    .where(HabitAliasDB.habit_id == habit_id)
                    .where(HabitAliasDB.alias_text == normalized_alias)
                )
                if existing.scalar_one_or_none():
                    return True  # Already exists
                
                alias_db = HabitAliasDB(
                    id=str(uuid.uuid4()),
                    habit_id=habit_id,
                    alias_text=normalized_alias,
                    created_at=datetime.utcnow()
                )
                session.add(alias_db)
                await session.commit()
                return True
                
            except SQLAlchemyError as e:
                await session.rollback()
                logger.error(f"❌ Error adding habit alias: {e}")
                return False
    
    async def auto_generate_aliases(self, habit: Habit) -> List[str]:
        """
        Auto-generate aliases from habit name and built-in synonyms.
        Returns list of generated aliases.
        """
        aliases = []
        habit_name_lower = habit.name.lower()
        
        # Extract tokens from habit name
        tokens = habit_name_lower.replace("-", " ").replace("_", " ").split()
        
        # Add each token as potential alias
        for token in tokens:
            if len(token) >= 3:  # Skip very short tokens
                aliases.append(token)
                
                # Add synonyms from the built-in map
                for base_word, synonyms in HABIT_SYNONYMS.items():
                    if base_word == token or token in synonyms:
                        aliases.append(base_word)
                        aliases.extend(synonyms)
        
        # Remove duplicates
        return list(set(aliases))
    
    async def ensure_habit_aliases(self, habit_id: str, user_id: str) -> int:
        """
        Ensure a habit has auto-generated aliases.
        Returns number of aliases added.
        """
        habit = await self.get_habit_by_id(habit_id, user_id)
        if not habit:
            return 0
        
        existing_aliases = await self.get_habit_aliases(habit_id, user_id)
        generated_aliases = await self.auto_generate_aliases(habit)
        
        added = 0
        for alias in generated_aliases:
            if alias not in existing_aliases:
                if await self.add_habit_alias(habit_id, alias, user_id):
                    added += 1
        
        return added
    
    async def get_all_aliases_for_user(self, user_id: str) -> Dict[str, List[str]]:
        """
        Get all aliases for all habits owned by a user.
        Returns dict mapping habit_id -> [aliases]
        """
        async with get_db_session() as session:
            try:
                # Get all user habits
                habits = await self.get_habits(user_id)
                habit_ids = [h.id for h in habits]
                
                if not habit_ids:
                    return {}
                
                result = await session.execute(
                    select(HabitAliasDB.habit_id, HabitAliasDB.alias_text)
                    .where(HabitAliasDB.habit_id.in_(habit_ids))
                )
                
                aliases_map: Dict[str, List[str]] = {hid: [] for hid in habit_ids}
                for row in result.all():
                    aliases_map[row[0]].append(row[1])
                
                return aliases_map
                
            except SQLAlchemyError as e:
                logger.error(f"❌ Error fetching user aliases: {e}")
                return {}
