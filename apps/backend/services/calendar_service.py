"""Calendar V2 domain service."""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Iterable, Optional
from uuid import NAMESPACE_URL, uuid4, uuid5
from zoneinfo import ZoneInfo

from dateutil.rrule import rrulestr
from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.orm import aliased

from database.connection import get_db_session
from database.models import (
    ApprovalRequestDB,
    CalendarAccountDB,
    CalendarEventDB,
    CalendarOccurrenceDB,
    CalendarSourceDB,
    HabitDB,
    HabitLogDB,
    TaskDB,
    WorkflowDefinitionDB,
    WorkflowRunDB,
)
from database.models.base import _utcnow_naive
from schemas.calendar import CalendarEventCreate, CalendarEventUpdate
from services.realtime import websocket_manager


class CalendarNotFoundError(ValueError):
    pass


class CalendarConflictError(ValueError):
    pass


class CalendarValidationError(ValueError):
    pass


def _json_load(raw: Optional[str], fallback: Any) -> Any:
    if not raw:
        return fallback
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return fallback


def _json_dump(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"), default=str)


def _naive_utc(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def _aware_utc(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _date_value(value: Optional[str]) -> Optional[date]:
    return date.fromisoformat(value) if value else None


def _occurrence_id(event_id: str, key: str) -> str:
    return str(uuid5(NAMESPACE_URL, f"ritual:calendar:{event_id}:{key}"))


class CalendarService:
    async def ensure_ritual_source(self, session, user_id: str) -> CalendarSourceDB:
        source_id = str(uuid5(NAMESPACE_URL, f"ritual:calendar-source:{user_id}"))
        source = await session.get(CalendarSourceDB, source_id)
        if source:
            return source
        source = CalendarSourceDB(
            id=source_id,
            user_id=user_id,
            name="Ritual",
            color="#9f7a4f",
            timezone="UTC",
            access_role="owner",
            is_visible=True,
            is_primary=True,
            is_default_write=True,
        )
        session.add(source)
        await session.flush()
        return source

    async def _owned_source(self, session, user_id: str, source_id: Optional[str]) -> CalendarSourceDB:
        if not source_id:
            return await self.ensure_ritual_source(session, user_id)
        source = await session.get(CalendarSourceDB, source_id)
        if not source or source.user_id != user_id:
            raise CalendarValidationError("Calendar source is not available")
        if source.access_role not in {"owner", "writer"}:
            raise CalendarValidationError("Calendar source is read-only")
        return source

    @staticmethod
    def _source_payload(source: CalendarSourceDB, account: Optional[CalendarAccountDB] = None) -> dict:
        return {
            "id": source.id,
            "account_id": source.account_id,
            "provider": account.provider if account else None,
            "provider_calendar_id": source.provider_calendar_id,
            "name": source.name,
            "color": source.color,
            "timezone": source.timezone,
            "access_role": source.access_role,
            "is_visible": bool(source.is_visible),
            "is_primary": bool(source.is_primary),
            "is_default_write": bool(source.is_default_write),
            "writable": source.access_role in {"owner", "writer"},
            "last_sync_at": _aware_utc(source.last_sync_at),
            "last_error": source.last_error,
        }

    def _event_payload(
        self,
        event: CalendarEventDB,
        source: Optional[CalendarSourceDB] = None,
    ) -> dict:
        return {
            "id": event.id,
            "user_id": event.user_id,
            "source_id": event.source_id,
            "source_name": source.name if source else None,
            "source_color": source.color if source else None,
            "kind": event.kind,
            "origin": event.origin,
            "title": event.title,
            "description": event.description,
            "start_at": _aware_utc(event.start_at),
            "end_at": _aware_utc(event.end_at),
            "start_date": _date_value(event.start_date),
            "end_date": _date_value(event.end_date),
            "timezone": event.timezone,
            "all_day": bool(event.all_day),
            "status": event.status,
            "availability": event.availability,
            "visibility": event.visibility,
            "location": _json_load(event.location_json, {}),
            "conference": _json_load(event.conference_json, {}),
            "organizer": _json_load(event.organizer_json, {}),
            "attendees": _json_load(event.attendees_json, []),
            "reminders": _json_load(event.reminders_json, {}),
            "recurrence": _json_load(event.recurrence_json, []),
            "recurring_event_id": event.recurring_event_id,
            "task_id": event.task_id,
            "routine_run_id": event.routine_run_id,
            "provider_event_id": event.provider_event_id,
            "provider_event_type": event.provider_event_type,
            "provider_etag": event.provider_etag,
            "sync_state": event.sync_state,
            "revision": event.revision,
            "created_at": _aware_utc(event.created_at),
            "updated_at": _aware_utc(event.updated_at),
        }

    @staticmethod
    def _validate_event_window(event: CalendarEventDB) -> None:
        try:
            ZoneInfo(event.timezone or "UTC")
        except Exception as exc:
            raise CalendarValidationError("Event time zone must be a valid IANA time zone") from exc
        if event.all_day:
            if not event.start_date or not event.end_date:
                raise CalendarValidationError("All-day events require start and exclusive end dates")
            if date.fromisoformat(event.end_date) <= date.fromisoformat(event.start_date):
                raise CalendarValidationError("Event end must be after its start")
            return
        if not event.start_at or not event.end_at or event.end_at <= event.start_at:
            raise CalendarValidationError("Event end must be after its start")

    @staticmethod
    def _apply_update_fields(event: CalendarEventDB, payload: CalendarEventUpdate, fields: set[str]) -> None:
        scalar_fields = {
            "title": "title",
            "description": "description",
            "timezone": "timezone",
            "all_day": "all_day",
            "status": "status",
            "availability": "availability",
            "visibility": "visibility",
        }
        for request_name, model_name in scalar_fields.items():
            if request_name in fields:
                setattr(event, model_name, getattr(payload, request_name))
        if "start_at" in fields:
            event.start_at = _naive_utc(payload.start_at)
        if "end_at" in fields:
            event.end_at = _naive_utc(payload.end_at)
        if "start_date" in fields:
            event.start_date = payload.start_date.isoformat() if payload.start_date else None
        if "end_date" in fields:
            event.end_date = payload.end_date.isoformat() if payload.end_date else None
        json_fields = {
            "location": "location_json",
            "conference": "conference_json",
            "attendees": "attendees_json",
            "reminders": "reminders_json",
            "recurrence": "recurrence_json",
        }
        for request_name, model_name in json_fields.items():
            if request_name in fields:
                setattr(event, model_name, _json_dump(getattr(payload, request_name)))

    @staticmethod
    def _new_occurrence_override(master: CalendarEventDB, occurrence: CalendarOccurrenceDB) -> CalendarEventDB:
        now = _utcnow_naive()
        return CalendarEventDB(
            id=str(uuid4()),
            user_id=master.user_id,
            source_id=master.source_id,
            kind=master.kind,
            origin=master.origin,
            title=master.title,
            description=master.description,
            start_at=occurrence.start_at,
            end_at=occurrence.end_at,
            start_date=occurrence.start_date,
            end_date=occurrence.end_date,
            timezone=occurrence.timezone,
            all_day=occurrence.all_day,
            status=occurrence.status,
            availability=master.availability,
            visibility=master.visibility,
            location_json=master.location_json,
            conference_json=master.conference_json,
            organizer_json=master.organizer_json,
            attendees_json=master.attendees_json,
            reminders_json=master.reminders_json,
            recurrence_json="[]",
            recurring_event_id=master.id,
            original_start_at=occurrence.original_start_at,
            original_start_date=occurrence.original_start_date,
            task_id=master.task_id,
            routine_run_id=master.routine_run_id,
            provider_event_type=master.provider_event_type,
            sync_state="pending" if master.provider_event_id else "local",
            created_at=now,
            updated_at=now,
        )

    async def list_sources(self, user_id: str) -> list[dict]:
        async with get_db_session() as session:
            await self.ensure_ritual_source(session, user_id)
            await session.commit()
            rows = (
                await session.execute(
                    select(CalendarSourceDB, CalendarAccountDB)
                    .outerjoin(CalendarAccountDB, CalendarAccountDB.id == CalendarSourceDB.account_id)
                    .where(CalendarSourceDB.user_id == user_id)
                    .order_by(CalendarSourceDB.is_primary.desc(), CalendarSourceDB.name.asc())
                )
            ).all()
            return [self._source_payload(source, account) for source, account in rows]

    async def update_source(self, user_id: str, source_id: str, fields: dict[str, Any]) -> dict:
        async with get_db_session() as session:
            source = await session.get(CalendarSourceDB, source_id)
            if not source or source.user_id != user_id:
                raise CalendarNotFoundError("Calendar source not found")
            if fields.get("is_default_write") is True:
                current = (
                    await session.execute(
                        select(CalendarSourceDB).where(CalendarSourceDB.user_id == user_id)
                    )
                ).scalars().all()
                for item in current:
                    item.is_default_write = item.id == source.id
            if "is_visible" in fields and fields["is_visible"] is not None:
                source.is_visible = bool(fields["is_visible"])
            if "color" in fields and fields["color"] is not None:
                color = str(fields["color"]).strip()
                if not color.startswith("#") or len(color) not in {4, 7}:
                    raise CalendarValidationError("color must be a hex color")
                source.color = color
            source.updated_at = _utcnow_naive()
            await session.commit()
            account = await session.get(CalendarAccountDB, source.account_id) if source.account_id else None
            return self._source_payload(source, account)

    async def get_event(self, user_id: str, event_id: str) -> dict:
        async with get_db_session() as session:
            row = (
                await session.execute(
                    select(CalendarEventDB, CalendarSourceDB)
                    .outerjoin(CalendarSourceDB, CalendarSourceDB.id == CalendarEventDB.source_id)
                    .where(
                        CalendarEventDB.id == event_id,
                        CalendarEventDB.user_id == user_id,
                        CalendarEventDB.deleted_at.is_(None),
                    )
                )
            ).first()
            if not row:
                raise CalendarNotFoundError("Calendar event not found")
            return self._event_payload(row[0], row[1])

    async def _materialize_event(self, session, event: CalendarEventDB) -> None:
        override_ids = list(
            (
                await session.execute(
                    select(CalendarOccurrenceDB.override_event_id).where(
                        CalendarOccurrenceDB.event_id == event.id,
                        CalendarOccurrenceDB.override_event_id.is_not(None),
                    )
                )
            ).scalars().all()
        )
        await session.execute(delete(CalendarOccurrenceDB).where(CalendarOccurrenceDB.event_id == event.id))
        if override_ids:
            await session.execute(
                delete(CalendarEventDB).where(
                    CalendarEventDB.id.in_(override_ids),
                    CalendarEventDB.recurring_event_id == event.id,
                )
            )
        recurrence = _json_load(event.recurrence_json, [])
        starts: list[datetime]
        if recurrence and not event.all_day:
            rule_text = next((str(item) for item in recurrence if str(item).upper().startswith("RRULE:")), "")
            if rule_text and event.start_at:
                try:
                    rule = rrulestr(rule_text.removeprefix("RRULE:"), dtstart=event.start_at)
                    window_start = min(event.start_at, _utcnow_naive() - timedelta(days=366))
                    window_end = max(event.start_at + timedelta(days=730), _utcnow_naive() + timedelta(days=730))
                    starts = list(rule.between(window_start, window_end, inc=True))[:1000]
                except (TypeError, ValueError) as exc:
                    raise CalendarValidationError(f"Invalid recurrence rule: {exc}") from exc
            else:
                starts = [event.start_at] if event.start_at else []
        elif recurrence and event.all_day and event.start_date:
            rule_text = next((str(item) for item in recurrence if str(item).upper().startswith("RRULE:")), "")
            seed = datetime.combine(date.fromisoformat(event.start_date), time.min)
            try:
                rule = rrulestr(rule_text.removeprefix("RRULE:"), dtstart=seed)
                starts = list(rule.between(seed - timedelta(days=366), seed + timedelta(days=730), inc=True))[:1000]
            except (TypeError, ValueError) as exc:
                raise CalendarValidationError(f"Invalid recurrence rule: {exc}") from exc
        else:
            starts = [event.start_at] if not event.all_day and event.start_at else []

        if event.all_day:
            start_day = date.fromisoformat(event.start_date or "")
            end_day = date.fromisoformat(event.end_date or "")
            span = end_day - start_day
            day_starts = [item.date() for item in starts] if recurrence else [start_day]
            for occurrence_day in day_starts:
                key = occurrence_day.isoformat()
                session.add(
                    CalendarOccurrenceDB(
                        id=_occurrence_id(event.id, key),
                        event_id=event.id,
                        user_id=event.user_id,
                        source_id=event.source_id,
                        original_start_date=key,
                        start_date=key,
                        end_date=(occurrence_day + span).isoformat(),
                        timezone=event.timezone,
                        all_day=True,
                        status=event.status,
                        revision=event.revision,
                    )
                )
            return

        if not event.start_at or not event.end_at:
            return
        duration = event.end_at - event.start_at
        for occurrence_start in starts:
            occurrence_start = _naive_utc(occurrence_start) or occurrence_start
            key = occurrence_start.isoformat()
            session.add(
                CalendarOccurrenceDB(
                    id=_occurrence_id(event.id, key),
                    event_id=event.id,
                    user_id=event.user_id,
                    source_id=event.source_id,
                    original_start_at=occurrence_start,
                    start_at=occurrence_start,
                    end_at=occurrence_start + duration,
                    timezone=event.timezone,
                    all_day=False,
                    status=event.status,
                    revision=event.revision,
                )
            )

    async def create_event(self, user_id: str, payload: CalendarEventCreate) -> dict:
        async with get_db_session() as session:
            if payload.client_event_id:
                existing = (
                    await session.execute(
                        select(CalendarEventDB).where(
                            CalendarEventDB.user_id == user_id,
                            CalendarEventDB.client_event_id == payload.client_event_id,
                        )
                    )
                ).scalar_one_or_none()
                if existing:
                    source = await session.get(CalendarSourceDB, existing.source_id) if existing.source_id else None
                    return self._event_payload(existing, source)

            source = await self._owned_source(session, user_id, payload.source_id)
            if payload.task_id:
                task = await session.get(TaskDB, payload.task_id)
                if not task or task.user_id != user_id:
                    raise CalendarValidationError("Task is not available")
            now = _utcnow_naive()
            event = CalendarEventDB(
                id=str(uuid4()),
                user_id=user_id,
                source_id=source.id,
                kind=payload.kind,
                origin=payload.origin,
                title=payload.title.strip(),
                description=payload.description,
                start_at=_naive_utc(payload.start_at),
                end_at=_naive_utc(payload.end_at),
                start_date=payload.start_date.isoformat() if payload.start_date else None,
                end_date=payload.end_date.isoformat() if payload.end_date else None,
                timezone=payload.timezone,
                all_day=payload.all_day,
                status=payload.status,
                availability=payload.availability,
                visibility=payload.visibility,
                location_json=_json_dump(payload.location),
                conference_json=_json_dump(payload.conference),
                organizer_json=_json_dump(payload.organizer),
                attendees_json=_json_dump(payload.attendees),
                reminders_json=_json_dump(payload.reminders),
                recurrence_json=_json_dump(payload.recurrence),
                task_id=payload.task_id,
                routine_run_id=payload.routine_run_id,
                sync_state="pending" if source.account_id else "local",
                client_event_id=payload.client_event_id,
                created_at=now,
                updated_at=now,
            )
            session.add(event)
            self._validate_event_window(event)
            await session.flush()

            if source.account_id:
                from services.google_calendar_service import google_calendar_service

                await google_calendar_service.create_provider_event(session, event, source)
            await self._materialize_event(session, event)
            await session.commit()
            result = self._event_payload(event, source)
        await self._notify(user_id, event)
        return result

    async def update_event(self, user_id: str, event_id: str, payload: CalendarEventUpdate) -> dict:
        async with get_db_session() as session:
            event = await session.get(CalendarEventDB, event_id)
            if not event or event.user_id != user_id or event.deleted_at is not None:
                raise CalendarNotFoundError("Calendar event not found")
            if payload.expected_revision is not None and payload.expected_revision != event.revision:
                raise CalendarConflictError("Calendar event changed since it was opened")
            fields = set(payload.model_fields_set)
            scope = payload.recurrence_scope
            if scope == "series" and event.recurring_event_id:
                master = await session.get(CalendarEventDB, event.recurring_event_id)
                if master and master.user_id == user_id and master.deleted_at is None:
                    event = master
            if scope in {"occurrence", "following"} and payload.occurrence_id:
                occurrence = await session.get(CalendarOccurrenceDB, payload.occurrence_id)
                master = await session.get(CalendarEventDB, occurrence.event_id) if occurrence else None
                if not occurrence or not master or master.user_id != user_id or (
                    event.id not in {occurrence.event_id, occurrence.override_event_id}
                ):
                    raise CalendarNotFoundError("Calendar occurrence not found")
                if "source_id" in fields or "recurrence" in fields:
                    raise CalendarValidationError("Calendar and recurrence changes must apply to the entire series")
                affected = [occurrence]
                if scope == "following":
                    order_at = occurrence.original_start_at or occurrence.start_at
                    order_date = occurrence.original_start_date or occurrence.start_date
                    if order_at:
                        affected = list(
                            (
                                await session.execute(
                                    select(CalendarOccurrenceDB).where(
                                        CalendarOccurrenceDB.event_id == master.id,
                                        CalendarOccurrenceDB.original_start_at >= order_at,
                                    )
                                )
                            ).scalars().all()
                        )
                    elif order_date:
                        affected = list(
                            (
                                await session.execute(
                                    select(CalendarOccurrenceDB).where(
                                        CalendarOccurrenceDB.event_id == master.id,
                                        CalendarOccurrenceDB.original_start_date >= order_date,
                                    )
                                )
                            ).scalars().all()
                        )
                reference_start = occurrence.start_at
                reference_end = occurrence.end_at
                desired_start = _naive_utc(payload.start_at) if payload.start_at else None
                desired_end = _naive_utc(payload.end_at) if payload.end_at else None
                time_delta = desired_start - reference_start if desired_start and reference_start else timedelta(0)
                desired_duration = desired_end - desired_start if desired_end and desired_start else None
                reference_start_date = _date_value(occurrence.start_date)
                desired_start_date = payload.start_date
                date_delta = desired_start_date - reference_start_date if desired_start_date and reference_start_date else timedelta(0)
                desired_date_span = payload.end_date - payload.start_date if payload.end_date and payload.start_date else None
                result_event = event
                for item in affected:
                    override = await session.get(CalendarEventDB, item.override_event_id) if item.override_event_id else None
                    if not override:
                        override = self._new_occurrence_override(master, item)
                        session.add(override)
                        await session.flush()
                        item.override_event_id = override.id
                    detail_fields = fields - {"start_at", "end_at", "start_date", "end_date", "all_day"}
                    self._apply_update_fields(override, payload, detail_fields)
                    if not item.all_day:
                        if item.start_at and ("start_at" in fields):
                            override.start_at = item.start_at + time_delta
                        if desired_duration is not None and override.start_at:
                            override.end_at = override.start_at + desired_duration
                        elif item.end_at and "end_at" in fields and reference_end:
                            override.end_at = item.end_at + (desired_end - reference_end)
                        item.start_at = override.start_at
                        item.end_at = override.end_at
                    else:
                        item_start_date = _date_value(item.start_date)
                        if item_start_date and "start_date" in fields:
                            override.start_date = (item_start_date + date_delta).isoformat()
                        if desired_date_span is not None and override.start_date:
                            override.end_date = (date.fromisoformat(override.start_date) + desired_date_span).isoformat()
                        item.start_date = override.start_date
                        item.end_date = override.end_date
                    override.revision += 1
                    override.updated_at = _utcnow_naive()
                    self._validate_event_window(override)
                    item.status = override.status
                    item.is_exception = True
                    item.revision += 1
                    item.updated_at = _utcnow_naive()
                    result_event = override
                    source = await session.get(CalendarSourceDB, master.source_id) if master.source_id else None
                    if source and source.account_id:
                        from services.google_calendar_service import google_calendar_service

                        await google_calendar_service.update_provider_occurrence(
                            session, master, override, item, source
                        )
                event = result_event
            else:
                old_source = await session.get(CalendarSourceDB, event.source_id) if event.source_id else None
                self._apply_update_fields(event, payload, fields)
                if "source_id" in fields and payload.source_id:
                    source = await self._owned_source(session, user_id, payload.source_id)
                    event.source_id = source.id
                else:
                    source = await session.get(CalendarSourceDB, event.source_id) if event.source_id else None
                event.revision += 1
                event.updated_at = _utcnow_naive()
                self._validate_event_window(event)
                if source and source.account_id:
                    from services.google_calendar_service import google_calendar_service

                    if event.provider_event_id and old_source and old_source.id != source.id:
                        await google_calendar_service.move_provider_event(session, event, old_source, source)
                    else:
                        await google_calendar_service.update_provider_event(session, event, source)
                elif old_source and old_source.account_id and event.provider_event_id:
                    raise CalendarValidationError("Move Google events to another writable Google calendar")
                rematerialize_fields = {"start_at", "end_at", "start_date", "end_date", "timezone", "all_day", "recurrence"}
                if fields & rematerialize_fields:
                    await self._materialize_event(session, event)
                elif "status" in fields:
                    await session.execute(
                        CalendarOccurrenceDB.__table__.update()
                        .where(CalendarOccurrenceDB.event_id == event.id)
                        .values(status=event.status, revision=CalendarOccurrenceDB.revision + 1)
                    )

            await session.commit()
            source = await session.get(CalendarSourceDB, event.source_id) if event.source_id else None
            result = self._event_payload(event, source)
        await self._notify(user_id, event)
        return result

    async def delete_event(
        self,
        user_id: str,
        event_id: str,
        *,
        scope: str = "series",
        occurrence_id: Optional[str] = None,
    ) -> None:
        async with get_db_session() as session:
            event = await session.get(CalendarEventDB, event_id)
            if not event or event.user_id != user_id or event.deleted_at is not None:
                raise CalendarNotFoundError("Calendar event not found")
            if scope in {"occurrence", "following"} and occurrence_id:
                occurrence = await session.get(CalendarOccurrenceDB, occurrence_id)
                master = await session.get(CalendarEventDB, occurrence.event_id) if occurrence else None
                if not occurrence or not master or master.user_id != user_id or event.id not in {
                    occurrence.event_id,
                    occurrence.override_event_id,
                }:
                    raise CalendarNotFoundError("Calendar occurrence not found")
                query = select(CalendarOccurrenceDB).where(CalendarOccurrenceDB.id == occurrence.id)
                if scope == "following" and occurrence.original_start_at:
                    query = select(CalendarOccurrenceDB).where(
                        CalendarOccurrenceDB.event_id == master.id,
                        CalendarOccurrenceDB.original_start_at >= occurrence.original_start_at,
                    )
                elif scope == "following" and occurrence.original_start_date:
                    query = select(CalendarOccurrenceDB).where(
                        CalendarOccurrenceDB.event_id == master.id,
                        CalendarOccurrenceDB.original_start_date >= occurrence.original_start_date,
                    )
                affected = list((await session.execute(query)).scalars().all())
                source = await session.get(CalendarSourceDB, master.source_id) if master.source_id else None
                if source and source.account_id:
                    from services.google_calendar_service import google_calendar_service

                    for item in affected:
                        await google_calendar_service.delete_provider_occurrence(session, master, item, source)
                for item in affected:
                    item.status = "canceled"
                    item.is_exception = True
                    item.revision += 1
                    if item.override_event_id:
                        override = await session.get(CalendarEventDB, item.override_event_id)
                        if override:
                            override.status = "canceled"
                            override.deleted_at = _utcnow_naive()
                            override.revision += 1
                event = master
            else:
                if event.recurring_event_id:
                    master = await session.get(CalendarEventDB, event.recurring_event_id)
                    if master and master.user_id == user_id:
                        event = master
                source = await session.get(CalendarSourceDB, event.source_id) if event.source_id else None
                if source and source.account_id:
                    from services.google_calendar_service import google_calendar_service

                    await google_calendar_service.delete_provider_event(session, event, source, scope="series")
                event.status = "canceled"
                event.deleted_at = _utcnow_naive()
                event.revision += 1
                await session.execute(
                    delete(CalendarOccurrenceDB).where(CalendarOccurrenceDB.event_id == event.id)
                )
            await session.commit()
        await self._notify(user_id, event)

    async def publish_event(self, user_id: str, event_id: str, source_id: str) -> dict:
        async with get_db_session() as session:
            event = await session.get(CalendarEventDB, event_id)
            if not event or event.user_id != user_id or event.deleted_at is not None:
                raise CalendarNotFoundError("Calendar event not found")
            if event.provider_event_id:
                raise CalendarValidationError("Event is already published")
            source = await self._owned_source(session, user_id, source_id)
            if not source.account_id:
                raise CalendarValidationError("Choose a connected Google calendar")
            from services.google_calendar_service import google_calendar_service

            event.source_id = source.id
            event.sync_state = "pending"
            await google_calendar_service.create_provider_event(session, event, source)
            await session.execute(
                CalendarOccurrenceDB.__table__.update()
                .where(CalendarOccurrenceDB.event_id == event.id)
                .values(source_id=source.id)
            )
            await session.commit()
            result = self._event_payload(event, source)
        await self._notify(user_id, event)
        return result

    async def rsvp(self, user_id: str, event_id: str, response: str) -> dict:
        async with get_db_session() as session:
            event = await session.get(CalendarEventDB, event_id)
            if not event or event.user_id != user_id or event.deleted_at is not None:
                raise CalendarNotFoundError("Calendar event not found")
            source = await session.get(CalendarSourceDB, event.source_id) if event.source_id else None
            attendees = _json_load(event.attendees_json, [])
            changed = False
            for attendee in attendees:
                if attendee.get("self"):
                    attendee["responseStatus"] = response
                    changed = True
            if not changed:
                raise CalendarValidationError("The connected account is not an attendee")
            event.attendees_json = _json_dump(attendees)
            event.revision += 1
            if source and source.account_id:
                from services.google_calendar_service import google_calendar_service

                await google_calendar_service.update_provider_event(session, event, source)
            await session.commit()
            result = self._event_payload(event, source)
        await self._notify(user_id, event)
        return result

    async def list_range(
        self,
        user_id: str,
        *,
        start: datetime,
        end: datetime,
        timezone_name: str,
        mode: str,
        source_ids: Optional[list[str]] = None,
    ) -> dict:
        start_utc = _naive_utc(start)
        end_utc = _naive_utc(end)
        if not start_utc or not end_utc or end_utc <= start_utc:
            raise CalendarValidationError("Invalid calendar range")
        start_day = start.astimezone(ZoneInfo(timezone_name)).date() if start.tzinfo else start.date()
        end_day = end.astimezone(ZoneInfo(timezone_name)).date() if end.tzinfo else end.date()
        async with get_db_session() as session:
            await self.ensure_ritual_source(session, user_id)
            await session.commit()
            OverrideEventDB = aliased(CalendarEventDB)
            query = (
                select(CalendarOccurrenceDB, CalendarEventDB, CalendarSourceDB, OverrideEventDB)
                .join(CalendarEventDB, CalendarEventDB.id == CalendarOccurrenceDB.event_id)
                .outerjoin(CalendarSourceDB, CalendarSourceDB.id == CalendarOccurrenceDB.source_id)
                .outerjoin(OverrideEventDB, OverrideEventDB.id == CalendarOccurrenceDB.override_event_id)
                .where(
                    CalendarOccurrenceDB.user_id == user_id,
                    CalendarEventDB.deleted_at.is_(None),
                    or_(
                        and_(
                            CalendarOccurrenceDB.all_day.is_(False),
                            CalendarOccurrenceDB.start_at < end_utc,
                            CalendarOccurrenceDB.end_at > start_utc,
                        ),
                        and_(
                            CalendarOccurrenceDB.all_day.is_(True),
                            CalendarOccurrenceDB.start_date < end_day.isoformat(),
                            CalendarOccurrenceDB.end_date > start_day.isoformat(),
                        ),
                    ),
                )
                .order_by(CalendarOccurrenceDB.start_at.asc(), CalendarOccurrenceDB.start_date.asc())
            )
            if source_ids:
                query = query.where(CalendarOccurrenceDB.source_id.in_(source_ids))
            rows = (await session.execute(query)).all()
            occurrences: list[dict] = []
            for occurrence, series_event, source, override_event in rows:
                event = override_event or series_event
                if mode == "plan" and occurrence.status == "canceled":
                    continue
                occurrences.append(
                    {
                        "id": occurrence.id,
                        "event_id": event.id,
                        "source_id": event.source_id,
                        "title": event.title,
                        "description": event.description,
                        "kind": event.kind,
                        "origin": event.origin,
                        "task_id": event.task_id,
                        "start_at": _aware_utc(occurrence.start_at),
                        "end_at": _aware_utc(occurrence.end_at),
                        "start_date": _date_value(occurrence.start_date),
                        "end_date": _date_value(occurrence.end_date),
                        "timezone": occurrence.timezone,
                        "all_day": bool(occurrence.all_day),
                        "status": occurrence.status,
                        "availability": event.availability,
                        "visibility": event.visibility,
                        "source_name": source.name if source else None,
                        "source_color": source.color if source else None,
                        "provider_event_type": event.provider_event_type,
                        "sync_state": event.sync_state,
                        "revision": occurrence.revision,
                        "is_exception": bool(occurrence.is_exception),
                        "conflict": False,
                    }
                )
            self._mark_conflicts(occurrences)
            tasks = await self._task_inbox(session, user_id)
            workflows = await self._workflow_timeline(session, user_id, start_utc, end_utc)
            source_rows = (
                await session.execute(
                    select(CalendarSourceDB, CalendarAccountDB)
                    .outerjoin(CalendarAccountDB, CalendarAccountDB.id == CalendarSourceDB.account_id)
                    .where(CalendarSourceDB.user_id == user_id)
                    .order_by(CalendarSourceDB.is_primary.desc(), CalendarSourceDB.name.asc())
                )
            ).all()
            sources = [self._source_payload(source, account) for source, account in source_rows]
            sync = [
                {
                    "source_id": source.id,
                    "status": "error" if source.last_error else ("synced" if source.account_id else "local"),
                    "last_sync_at": _aware_utc(source.last_sync_at),
                    "error_code": source.last_error,
                }
                for source, _account in source_rows
            ]
            review_end_day = max(start_day, end_day - timedelta(days=1))
            review = await self._review_data(session, user_id, start_day, review_end_day, occurrences) if mode == "review" else None
            proposal_rows = list(
                (
                    await session.execute(
                        select(ApprovalRequestDB).where(
                            ApprovalRequestDB.user_id == user_id,
                            ApprovalRequestDB.capability == "calendar_events",
                            ApprovalRequestDB.status == "pending",
                            or_(ApprovalRequestDB.expires_at.is_(None), ApprovalRequestDB.expires_at > _utcnow_naive()),
                        ).order_by(ApprovalRequestDB.created_at.asc()).limit(100)
                    )
                ).scalars().all()
            )
            proposals = []
            for proposal in proposal_rows:
                action = _json_load(proposal.proposed_action_json, {})
                proposals.append(
                    {
                        "id": proposal.id,
                        "action": action.get("action") or proposal.action_kind,
                        "event_id": action.get("event_id"),
                        "occurrence_id": action.get("occurrence_id"),
                        "before": action.get("before"),
                        "after": action.get("after") or {},
                        "conflicts": action.get("conflicts") or [],
                        "expires_at": proposal.expires_at or (_utcnow_naive() + timedelta(minutes=30)),
                    }
                )
            return {
                "start": _aware_utc(start_utc),
                "end": _aware_utc(end_utc),
                "timezone": timezone_name,
                "mode": mode,
                "occurrences": occurrences,
                "tasks": tasks,
                "workflows": workflows,
                "sources": sources,
                "sync": sync,
                "review": review,
                "proposals": proposals,
            }

    @staticmethod
    def _mark_conflicts(items: list[dict]) -> None:
        timed = [
            item for item in items
            if not item["all_day"] and item["availability"] == "busy" and item["status"] == "confirmed"
        ]
        for index, left in enumerate(timed):
            for right in timed[index + 1 :]:
                if left["start_at"] < right["end_at"] and right["start_at"] < left["end_at"]:
                    left["conflict"] = True
                    right["conflict"] = True

    async def _task_inbox(self, session, user_id: str) -> list[dict]:
        allocation_counts = (
            select(CalendarEventDB.task_id, func.count(CalendarEventDB.id).label("allocation_count"))
            .where(
                CalendarEventDB.user_id == user_id,
                CalendarEventDB.kind == "task_allocation",
                CalendarEventDB.deleted_at.is_(None),
                CalendarEventDB.status != "canceled",
            )
            .group_by(CalendarEventDB.task_id)
            .subquery()
        )
        rows = (
            await session.execute(
                select(TaskDB, allocation_counts.c.allocation_count)
                .outerjoin(allocation_counts, allocation_counts.c.task_id == TaskDB.id)
                .where(TaskDB.user_id == user_id, TaskDB.status.in_(["open", "in_progress", "in_review"]))
                .order_by(TaskDB.due_at.asc().nullslast(), TaskDB.priority.desc(), TaskDB.created_at.desc())
                .limit(300)
            )
        ).all()
        return [
            {
                "id": task.id,
                "title": task.title,
                "notes": task.notes,
                "status": task.status,
                "priority": task.priority,
                "due_at": _aware_utc(task.due_at),
                "project": task.project,
                "category": task.category,
                "allocation_count": int(count or 0),
            }
            for task, count in rows
        ]

    async def _workflow_timeline(
        self, session, user_id: str, start: datetime, end: datetime
    ) -> list[dict]:
        definitions = list(
            (
                await session.execute(
                    select(WorkflowDefinitionDB).where(
                        WorkflowDefinitionDB.user_id == user_id,
                        WorkflowDefinitionDB.status == "scheduled",
                    )
                )
            ).scalars().all()
        )
        items: list[dict] = []
        for definition in definitions:
            cursor = definition.next_run_at
            if not cursor:
                continue
            duration = max(5, int(definition.expected_duration_minutes or 30))
            cadence = timedelta(days=7 if definition.cadence == "weekly" else 1)
            while cursor < start:
                cursor += cadence
            while cursor < end:
                items.append(
                    {
                        "id": f"planned:{definition.id}:{cursor.isoformat()}",
                        "definition_id": definition.id,
                        "name": definition.name,
                        "kind": definition.kind,
                        "item_type": "planned",
                        "status": "scheduled",
                        "start_at": _aware_utc(cursor),
                        "end_at": _aware_utc(cursor + timedelta(minutes=duration)),
                        "expected_duration_minutes": duration,
                    }
                )
                cursor += cadence

        runs = list(
            (
                await session.execute(
                    select(WorkflowRunDB, WorkflowDefinitionDB)
                    .join(WorkflowDefinitionDB, WorkflowDefinitionDB.id == WorkflowRunDB.workflow_definition_id)
                    .where(
                        WorkflowRunDB.user_id == user_id,
                        or_(
                            and_(WorkflowRunDB.started_at < end, WorkflowRunDB.finished_at > start),
                            and_(WorkflowRunDB.created_at >= start, WorkflowRunDB.created_at < end),
                            and_(WorkflowRunDB.window_start < end, WorkflowRunDB.window_end > start),
                        ),
                    )
                )
            ).all()
        )
        run_ids = [run.id for run, _definition in runs]
        approvals = {}
        if run_ids:
            pending = list(
                (
                    await session.execute(
                        select(ApprovalRequestDB).where(
                            ApprovalRequestDB.workflow_run_id.in_(run_ids),
                            ApprovalRequestDB.status == "pending",
                        )
                    )
                ).scalars().all()
            )
            approvals = {item.workflow_run_id: item.id for item in pending}
        now = _utcnow_naive()
        for run, definition in runs:
            duration = max(5, int(definition.expected_duration_minutes or 30))
            actual_start = run.started_at or run.window_start or run.created_at
            actual_end = run.finished_at or (now if run.status == "processing" else None)
            actual_end = actual_end or run.window_end or (actual_start + timedelta(minutes=duration))
            status = "approval_blocked" if run.id in approvals else run.status
            items.append(
                {
                    "id": f"run:{run.id}",
                    "definition_id": definition.id,
                    "name": definition.name,
                    "kind": definition.kind,
                    "item_type": "actual",
                    "status": status,
                    "start_at": _aware_utc(actual_start),
                    "end_at": _aware_utc(actual_end),
                    "expected_duration_minutes": duration,
                    "approval_request_id": approvals.get(run.id),
                    "run_id": run.id,
                }
            )
        return sorted(items, key=lambda item: item["start_at"])

    async def _review_data(
        self,
        session,
        user_id: str,
        start_day: date,
        end_day: date,
        occurrences: list[dict],
    ) -> dict:
        habit_rows = list(
            (
                await session.execute(
                    select(HabitLogDB, HabitDB).join(HabitDB, HabitDB.id == HabitLogDB.habit_id).where(
                        HabitDB.user_id == user_id,
                        HabitLogDB.date >= start_day.isoformat(),
                        HabitLogDB.date <= end_day.isoformat(),
                    )
                )
            ).all()
        )
        completed_tasks = int(
            (
                await session.execute(
                    select(func.count(TaskDB.id)).where(
                        TaskDB.user_id == user_id,
                        TaskDB.completed_at >= datetime.combine(start_day, time.min),
                        TaskDB.completed_at < datetime.combine(end_day + timedelta(days=1), time.min),
                    )
                )
            ).scalar_one()
        )
        planned_minutes = sum(
            int((item["end_at"] - item["start_at"]).total_seconds() // 60)
            for item in occurrences
            if item["kind"] == "task_allocation" and item["start_at"] and item["end_at"]
        )
        try:
            from services.project_time_service import get_project_time_sessions

            session_result = await get_project_time_sessions(
                user_id,
                start_date=start_day.isoformat(),
                end_date=end_day.isoformat(),
                limit=500,
            )
            raw_activity_sessions = list(session_result.get("data") or [])
        except Exception:
            raw_activity_sessions = []

        activity_sessions: list[dict[str, Any]] = []
        actual_by_task: defaultdict[str, int] = defaultdict(int)
        for row in raw_activity_sessions:
            try:
                start_at = datetime.fromtimestamp(int(row.get("start_ts")) / 1000, tz=timezone.utc)
                end_at = datetime.fromtimestamp(int(row.get("end_ts")) / 1000, tz=timezone.utc)
            except (TypeError, ValueError, OSError):
                continue
            if end_at <= start_at:
                continue
            task_key = str(row.get("task_key") or "") or None
            active_minutes = max(0, int(row.get("active_ms") or 0) // 60_000)
            if task_key:
                actual_by_task[task_key] += active_minutes
            activity_sessions.append(
                {
                    "id": str(row.get("session_uid") or f"activity:{int(start_at.timestamp())}"),
                    "start_at": start_at,
                    "end_at": end_at,
                    "project_id": row.get("project_key"),
                    "project": row.get("project_name") or "Computer activity",
                    "task_id": task_key,
                    "task": row.get("task_name"),
                    "active_minutes": active_minutes,
                    "confidence": row.get("confidence"),
                    "evidence": row.get("artifacts") or [],
                }
            )

        planned_by_task: defaultdict[str, int] = defaultdict(int)
        for item in occurrences:
            if item["kind"] != "task_allocation" or not item.get("task_id"):
                continue
            if item.get("start_at") and item.get("end_at"):
                planned_by_task[str(item["task_id"])] += int(
                    (item["end_at"] - item["start_at"]).total_seconds() // 60
                )
        linked_task_comparisons = [
            {
                "task_id": task_id,
                "planned_minutes": planned_by_task.get(task_id, 0),
                "actual_minutes": actual_by_task.get(task_id, 0),
            }
            for task_id in sorted(set(planned_by_task) | set(actual_by_task))
            if task_id in planned_by_task and task_id in actual_by_task
        ]
        return {
            "habit_markers": [
                {
                    "id": row.id,
                    "habit_id": row.habit_id,
                    "habit_name": habit.name,
                    "date": row.date,
                    "status": row.status,
                    "duration": row.duration,
                    "amount": row.amount,
                }
                for row, habit in habit_rows
            ],
            "activity_sessions": activity_sessions,
            "health_summaries": [
                {
                    "id": row.id,
                    "habit_id": habit.id,
                    "habit_name": habit.name,
                    "date": row.date,
                    "status": row.status,
                    "duration": row.duration,
                    "amount": row.amount,
                    "unit": getattr(habit, "unit_label", None),
                }
                for row, habit in habit_rows
                if str(habit.category or "").strip().lower() in {"health", "fitness", "sleep", "recovery"}
            ],
            "planned_minutes": planned_minutes,
            "attributable_actual_minutes": sum(actual_by_task.values()),
            "linked_task_comparisons": linked_task_comparisons,
            "completed_task_count": completed_tasks,
        }

    async def search(self, user_id: str, query_text: str, limit: int = 30) -> dict:
        term = f"%{query_text.strip()}%"
        async with get_db_session() as session:
            event_rows = (
                await session.execute(
                    select(CalendarEventDB, CalendarSourceDB)
                    .outerjoin(CalendarSourceDB, CalendarSourceDB.id == CalendarEventDB.source_id)
                    .where(
                        CalendarEventDB.user_id == user_id,
                        CalendarEventDB.deleted_at.is_(None),
                        or_(
                            CalendarEventDB.title.ilike(term),
                            CalendarEventDB.description.ilike(term),
                            CalendarEventDB.attendees_json.ilike(term),
                            CalendarSourceDB.name.ilike(term),
                        ),
                    )
                    .order_by(CalendarEventDB.updated_at.desc())
                    .limit(limit)
                )
            ).all()
            task_rows = list(
                (
                    await session.execute(
                        select(TaskDB)
                        .where(
                            TaskDB.user_id == user_id,
                            or_(TaskDB.title.ilike(term), TaskDB.notes.ilike(term), TaskDB.project.ilike(term)),
                        )
                        .order_by(TaskDB.updated_at.desc())
                        .limit(limit)
                    )
                ).scalars().all()
            )
            return {
                "events": [self._event_payload(event, source) for event, source in event_rows],
                "tasks": [
                    {
                        "id": task.id,
                        "title": task.title,
                        "notes": task.notes,
                        "status": task.status,
                        "priority": task.priority,
                        "due_at": _aware_utc(task.due_at),
                        "project": task.project,
                        "category": task.category,
                        "allocation_count": 0,
                    }
                    for task in task_rows
                ],
                "workflows": [],
            }

    async def availability(
        self,
        user_id: str,
        *,
        start: datetime,
        end: datetime,
        timezone_name: str,
        workday_start_minutes: int,
        workday_end_minutes: int,
        minimum_minutes: int,
        source_ids: Optional[list[str]] = None,
    ) -> dict:
        model = await self.list_range(
            user_id,
            start=start,
            end=end,
            timezone_name=timezone_name,
            mode="plan",
            source_ids=source_ids,
        )
        tz = ZoneInfo(timezone_name)
        busy = sorted(
            [
                (item["start_at"].astimezone(tz), item["end_at"].astimezone(tz))
                for item in model["occurrences"]
                if not item["all_day"] and item["availability"] == "busy" and item["status"] == "confirmed"
            ],
            key=lambda pair: pair[0],
        )
        windows: list[dict] = []
        current_day = start.astimezone(tz).date()
        final_day = end.astimezone(tz).date()
        while current_day <= final_day:
            day_start = datetime.combine(current_day, time.min, tz) + timedelta(minutes=workday_start_minutes)
            day_end = datetime.combine(current_day, time.min, tz) + timedelta(minutes=workday_end_minutes)
            cursor = max(day_start, start.astimezone(tz))
            boundary = min(day_end, end.astimezone(tz))
            for busy_start, busy_end in busy:
                if busy_end <= cursor or busy_start >= boundary:
                    continue
                if busy_start > cursor and busy_start - cursor >= timedelta(minutes=minimum_minutes):
                    windows.append({"start_at": cursor, "end_at": min(busy_start, boundary)})
                cursor = max(cursor, busy_end)
                if cursor >= boundary:
                    break
            if boundary - cursor >= timedelta(minutes=minimum_minutes):
                windows.append({"start_at": cursor, "end_at": boundary})
            current_day += timedelta(days=1)
        formatted = "\n".join(
            f"{item['start_at'].strftime('%a %b %-d, %-I:%M %p')}–{item['end_at'].strftime('%-I:%M %p %Z')}"
            for item in windows
        ) or "No matching availability"
        return {"timezone": timezone_name, "windows": windows, "formatted_text": formatted}

    async def cancel_future_task_allocations(self, session, user_id: str, task_id: str) -> None:
        now = _utcnow_naive()
        events = list(
            (
                await session.execute(
                    select(CalendarEventDB).where(
                        CalendarEventDB.user_id == user_id,
                        CalendarEventDB.task_id == task_id,
                        CalendarEventDB.kind == "task_allocation",
                        CalendarEventDB.provider_event_id.is_(None),
                        CalendarEventDB.deleted_at.is_(None),
                    )
                )
            ).scalars().all()
        )
        for event in events:
            future_count = int(
                (
                    await session.execute(
                        select(func.count(CalendarOccurrenceDB.id)).where(
                            CalendarOccurrenceDB.event_id == event.id,
                            CalendarOccurrenceDB.start_at > now,
                        )
                    )
                ).scalar_one()
            )
            if future_count:
                event.status = "canceled"
                event.revision += 1
                await session.execute(
                    CalendarOccurrenceDB.__table__.update()
                    .where(
                        CalendarOccurrenceDB.event_id == event.id,
                        CalendarOccurrenceDB.start_at > now,
                    )
                    .values(status="canceled", revision=CalendarOccurrenceDB.revision + 1)
                )

    async def _notify(self, user_id: str, event: CalendarEventDB) -> None:
        await websocket_manager.broadcast_to_user(
            {
                "type": "calendar.changed",
                "data": {
                    "source_id": event.source_id,
                    "revision": event.revision,
                },
            },
            user_id,
        )


calendar_service = CalendarService()
