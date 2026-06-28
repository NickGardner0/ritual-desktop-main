"""Durable first-run activation state for Ritual users."""

from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Any, Dict, Optional

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from database.connection import get_db_session
from database.helpers import habit_db_to_pydantic, habit_log_db_to_pydantic
from database.models import (
    HabitDB,
    HabitLogDB,
    UserActivationChecklistItemDB,
    UserActivationStateDB,
    UserDB,
    WearableConnectionDB,
    WhoopIntegrationDB,
)
from models.user_models import (
    ActivationChecklistItem,
    ActivationState,
    BootstrapUser,
    ChecklistUpdateRequest,
    FirstBehaviorRequest,
    IntegrationActivationStatus,
    UserBootstrapResponse,
)


CHECKLIST_KEYS = (
    "mac_activity",
    "apple_health",
    "oura",
    "whoop",
    "garmin",
    "ai_voice",
    "place_tagging",
    "reminders",
)
CHECKLIST_STATUSES = {"not_started", "seen", "skipped", "completed", "needs_attention"}

INTEGRATION_RESPONSE_KEYS = {
    "mac_activity": "macActivity",
    "apple_health": "appleHealth",
    "oura": "oura",
    "whoop": "whoop",
    "garmin": "garmin",
    "ai_voice": "aiVoice",
    "place_tagging": "placeTagging",
    "reminders": "reminders",
}

STARTER_TEMPLATES: Dict[str, Dict[str, Any]] = {
    "sleep": {
        "name": "Sleep Duration",
        "category": "Fitness & Health",
        "icon": "Moon",
        "unit_type": "Hours",
        "is_custom": False,
    },
    "exercise": {
        "name": "Exercise",
        "category": "Fitness & Health",
        "icon": "Dumbbell",
        "unit_type": "Minutes",
        "is_custom": False,
    },
    "focus": {
        "name": "Focus Time",
        "category": "Productivity",
        "icon": "Focus",
        "unit_type": "Hours",
        "is_custom": False,
    },
    "mood": {
        "name": "Mood",
        "category": "Health",
        "icon": "Smile",
        "unit_type": "Score",
        "is_custom": False,
    },
}


def _utcnow() -> datetime:
    return datetime.utcnow()


def _parse_metadata(value: Optional[str]) -> Optional[Dict[str, Any]]:
    if not value:
        return None
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, dict) else None
    except (json.JSONDecodeError, TypeError):
        return None


class ActivationService:
    """Owns first-run activation routing and state transitions."""

    async def get_bootstrap(self, user_id: str) -> UserBootstrapResponse:
        async with get_db_session() as session:
            user = await session.get(UserDB, user_id)
            if not user:
                raise ValueError("User must exist before bootstrap")

            state = await self._ensure_activation_state(session, user)
            checklist_rows = await self._get_checklist_rows(session, user_id)
            connected_providers = await self._get_connected_providers(session, user_id)
            await session.commit()

            return self._build_response(
                user=user,
                state=state,
                checklist_rows=checklist_rows,
                connected_providers=connected_providers,
            )

    async def update_profile(
        self,
        *,
        user_id: str,
        full_name: str,
        timezone: str,
    ) -> UserBootstrapResponse:
        clean_name = full_name.strip()
        clean_timezone = timezone.strip()
        if len(clean_name) < 2:
            raise ValueError("fullName must be at least 2 characters")
        if not clean_timezone:
            raise ValueError("timezone is required")

        async with get_db_session() as session:
            user = await session.get(UserDB, user_id)
            if not user:
                raise ValueError("User must exist before profile update")

            now = _utcnow()
            user.full_name = clean_name
            user.timezone = clean_timezone
            user.updated_at = now

            state = await self._ensure_activation_state(session, user)
            state.profile_completed_at = state.profile_completed_at or now
            state.updated_at = now

            checklist_rows = await self._get_checklist_rows(session, user_id)
            connected_providers = await self._get_connected_providers(session, user_id)
            await session.commit()

            return self._build_response(
                user=user,
                state=state,
                checklist_rows=checklist_rows,
                connected_providers=connected_providers,
            )

    async def create_first_behavior(
        self,
        *,
        user_id: str,
        request: FirstBehaviorRequest,
        habits_service: Any = None,
        _retry_on_integrity: bool = True,
    ) -> Dict[str, Any]:
        template = self._resolve_template(request)

        async with get_db_session() as session:
            user = await session.get(UserDB, user_id)
            if not user:
                raise ValueError("User must exist before first behavior")

            state = await self._ensure_activation_state(session, user)

            duplicate = await self._find_log_by_client_event_id(
                session=session,
                user_id=user_id,
                client_event_id=request.clientEventId,
            )
            now = _utcnow()
            if duplicate:
                habit, log = duplicate
            else:
                habit = await self._get_or_create_habit(session, user_id, template)
                log = HabitLogDB(
                    id=str(uuid.uuid4()),
                    habit_id=habit.id,
                    habit_name=habit.name,
                    duration=request.duration,
                    amount=request.amount,
                    date=request.date,
                    completed_at=request.completedAt,
                    status="completed",
                    notes=request.notes,
                    client_event_id=request.clientEventId,
                    source="first_run",
                )
                session.add(log)
                try:
                    await session.flush()
                except IntegrityError:
                    await session.rollback()
                    if not _retry_on_integrity:
                        raise
                    return await self.create_first_behavior(
                        user_id=user_id,
                        request=request,
                        habits_service=habits_service,
                        _retry_on_integrity=False,
                    )

            state.first_habit_id = state.first_habit_id or habit.id
            state.first_log_id = state.first_log_id or log.id
            state.first_behavior_logged_at = state.first_behavior_logged_at or now
            state.activation_completed_at = state.activation_completed_at or now
            state.updated_at = now
            user.onboarding_completed = True
            user.updated_at = now

            checklist_rows = await self._get_checklist_rows(session, user_id)
            connected_providers = await self._get_connected_providers(session, user_id)
            await session.commit()

            bootstrap = self._build_response(
                user=user,
                state=state,
                checklist_rows=checklist_rows,
                connected_providers=connected_providers,
            )
            habit_model = habit_db_to_pydantic(habit)
            log_model = habit_log_db_to_pydantic(log)

        if habits_service and not duplicate:
            try:
                await habits_service._refresh_metric_facts_for_logs(user_id=user_id, logs=[log])
                habits_service._fire_habit_definition_side_effects(habit_model, user_id)
                habits_service._fire_habit_log_side_effects(log_model, habit_model, user_id)
            except Exception:
                # First-run activation should not fail after the durable write succeeds.
                pass

        return {
            "habit": habit_model,
            "log": log_model,
            "bootstrap": bootstrap,
        }

    async def mark_checklist_completed(
        self,
        *,
        user_id: str,
        key: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        if key not in CHECKLIST_KEYS:
            return

        await self.update_checklist(
            user_id=user_id,
            request=ChecklistUpdateRequest(
                key=key,
                status="completed",
                metadata=metadata,
            ),
        )

    async def update_checklist(
        self,
        *,
        user_id: str,
        request: ChecklistUpdateRequest,
    ) -> UserBootstrapResponse:
        async with get_db_session() as session:
            user = await session.get(UserDB, user_id)
            if not user:
                raise ValueError("User must exist before checklist update")

            state = await self._ensure_activation_state(session, user)
            now = _utcnow()
            row = await self._get_checklist_row(session, user_id, request.key)
            if row is None:
                row = UserActivationChecklistItemDB(
                    id=str(uuid.uuid4()),
                    user_id=user_id,
                    key=request.key,
                )
                session.add(row)

            row.status = request.status
            row.metadata_json = json.dumps(request.metadata) if request.metadata else None
            row.updated_at = now
            if request.status == "seen":
                row.seen_at = row.seen_at or now
            elif request.status == "skipped":
                row.skipped_at = row.skipped_at or now
            elif request.status == "completed":
                row.completed_at = row.completed_at or now
            if request.key in {"mac_activity", "ai_voice"} and request.status in {"seen", "completed", "skipped"}:
                state.permissions_seen_at = state.permissions_seen_at or now
                state.updated_at = now

            await session.flush()
            checklist_rows = await self._get_checklist_rows(session, user_id)
            connected_providers = await self._get_connected_providers(session, user_id)
            await session.commit()

            return self._build_response(
                user=user,
                state=state,
                checklist_rows=checklist_rows,
                connected_providers=connected_providers,
            )

    async def mark_permissions_seen(self, *, user_id: str) -> UserBootstrapResponse:
        async with get_db_session() as session:
            user = await session.get(UserDB, user_id)
            if not user:
                raise ValueError("User must exist before setup completion")

            now = _utcnow()
            state = await self._ensure_activation_state(session, user)
            state.permissions_seen_at = state.permissions_seen_at or now
            state.updated_at = now

            checklist_rows = await self._get_checklist_rows(session, user_id)
            connected_providers = await self._get_connected_providers(session, user_id)
            await session.commit()

            return self._build_response(
                user=user,
                state=state,
                checklist_rows=checklist_rows,
                connected_providers=connected_providers,
            )

    async def _ensure_activation_state(self, session, user: UserDB) -> UserActivationStateDB:
        state = await session.get(UserActivationStateDB, user.id)
        now = _utcnow()
        if state is None:
            state = UserActivationStateDB(
                user_id=user.id,
                created_at=now,
                updated_at=now,
            )
            session.add(state)
            await session.flush()

        if user.full_name and user.timezone and not state.profile_completed_at:
            state.profile_completed_at = now
            state.updated_at = now

        if not state.first_behavior_logged_at:
            first_log = await self._get_first_existing_log(session, user.id)
            if first_log:
                habit, log = first_log
                state.first_habit_id = habit.id
                state.first_log_id = log.id
                state.first_behavior_logged_at = log.completed_at and _utcnow() or now
                state.activation_completed_at = state.activation_completed_at or now
                state.updated_at = now
                user.onboarding_completed = True
                if user.onboarding_completed and not user.timezone:
                    user.timezone = "America/New_York"

        return state

    async def _get_first_existing_log(self, session, user_id: str):
        result = await session.execute(
            select(HabitDB, HabitLogDB)
            .join(HabitLogDB, HabitLogDB.habit_id == HabitDB.id)
            .where(HabitDB.user_id == user_id)
            .order_by(HabitLogDB.date.asc(), HabitLogDB.completed_at.asc())
            .limit(1)
        )
        return result.first()

    async def _find_log_by_client_event_id(self, *, session, user_id: str, client_event_id: str):
        result = await session.execute(
            select(HabitDB, HabitLogDB)
            .join(HabitLogDB, HabitLogDB.habit_id == HabitDB.id)
            .where(HabitDB.user_id == user_id)
            .where(HabitLogDB.client_event_id == client_event_id)
            .limit(1)
        )
        return result.first()

    async def _get_or_create_habit(self, session, user_id: str, template: Dict[str, Any]) -> HabitDB:
        name_key = template["name"].strip().lower()
        result = await session.execute(
            select(HabitDB).where(
                HabitDB.user_id == user_id,
                func.lower(func.trim(HabitDB.name)) == name_key,
            )
        )
        habit = result.scalar_one_or_none()
        if habit:
            return habit

        habit = HabitDB(
            id=str(uuid.uuid4()),
            user_id=user_id,
            name=template["name"],
            category=template["category"],
            icon=template["icon"],
            unit_type=template.get("unit_type"),
            sensor_type="Manual",
            is_custom=bool(template.get("is_custom")),
            created_at=_utcnow(),
            updated_at=_utcnow(),
        )
        session.add(habit)
        await session.flush()
        return habit

    async def _get_checklist_row(self, session, user_id: str, key: str):
        result = await session.execute(
            select(UserActivationChecklistItemDB).where(
                UserActivationChecklistItemDB.user_id == user_id,
                UserActivationChecklistItemDB.key == key,
            )
        )
        return result.scalar_one_or_none()

    async def _get_checklist_rows(self, session, user_id: str):
        result = await session.execute(
            select(UserActivationChecklistItemDB).where(
                UserActivationChecklistItemDB.user_id == user_id,
            )
        )
        return list(result.scalars().all())

    async def _get_connected_providers(self, session, user_id: str) -> set[str]:
        providers: set[str] = set()
        result = await session.execute(
            select(WearableConnectionDB.provider).where(
                WearableConnectionDB.user_id == user_id,
                WearableConnectionDB.status == "active",
            )
        )
        providers.update(str(provider) for provider in result.scalars().all())

        whoop_result = await session.execute(
            select(WhoopIntegrationDB.id).where(
                WhoopIntegrationDB.user_id == user_id,
                WhoopIntegrationDB.is_active.is_(True),
            )
        )
        if whoop_result.scalar_one_or_none():
            providers.add("whoop")
        return providers

    def _resolve_template(self, request: FirstBehaviorRequest) -> Dict[str, Any]:
        if request.templateKey == "custom":
            name = (request.customName or "").strip()
            if len(name) < 2:
                raise ValueError("customName must be at least 2 characters")
            return {
                "name": name,
                "category": "Custom",
                "icon": "Circle",
                "unit_type": None,
                "is_custom": True,
            }
        return STARTER_TEMPLATES[request.templateKey]

    def _build_response(
        self,
        *,
        user: UserDB,
        state: UserActivationStateDB,
        checklist_rows: list[UserActivationChecklistItemDB],
        connected_providers: set[str],
    ) -> UserBootstrapResponse:
        profile_complete = bool(user.full_name and user.timezone)
        first_behavior_logged = bool(state.first_behavior_logged_at)
        checklist_by_key = {row.key: row for row in checklist_rows}

        checklist = []
        integrations = {}
        for key in CHECKLIST_KEYS:
            row = checklist_by_key.get(key)
            status = row.status if row else "not_started"
            if status not in CHECKLIST_STATUSES:
                status = "not_started"
            if key in connected_providers:
                status = "completed"
            checklist.append(
                ActivationChecklistItem(
                    key=key,
                    status=status,
                    metadata=_parse_metadata(row.metadata_json) if row else None,
                )
            )
            integrations[INTEGRATION_RESPONSE_KEYS[key]] = IntegrationActivationStatus(status=status)

        if not profile_complete:
            next_route = "/onboarding?s=signup"
        elif not state.permissions_seen_at:
            next_route = "/onboarding?s=setup"
        else:
            next_route = "/dashboard"

        return UserBootstrapResponse(
            userExists=True,
            profileComplete=profile_complete,
            firstBehaviorLogged=first_behavior_logged,
            permissionsSeen=bool(state.permissions_seen_at),
            user=BootstrapUser(
                id=user.id,
                email=user.email,
                fullName=user.full_name,
                timezone=user.timezone,
            ),
            activation=ActivationState(
                firstHabitId=state.first_habit_id,
                firstLogId=state.first_log_id,
                activationCompleted=bool(state.activation_completed_at),
                checklist=checklist,
            ),
            integrations=integrations,
            nextRoute=next_route,
        )


activation_service = ActivationService()
