"""Internal durable outbox for wearable-driven app events."""

from __future__ import annotations

import hashlib
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import select

from database.connection import get_db_session
from database.models import WearableOutboxEventDB

logger = logging.getLogger(__name__)


def _json_dumps(value: Optional[Dict[str, Any]]) -> Optional[str]:
    if value is None:
        return None
    return json.dumps(value, sort_keys=True, default=str)


def _json_loads(value: Optional[str]) -> Optional[Dict[str, Any]]:
    if not value:
        return None
    try:
        parsed = json.loads(value)
    except Exception:
        return {"raw": value}
    return parsed if isinstance(parsed, dict) else {"value": parsed}


class WearableEventOutboxService:
    _SUPPORTED_EVENT_TYPES = {
        "sleep_session_ingested",
        "recovery_metric_changed",
        "steps_bucket_closed",
        "wearable_backfill_completed",
    }

    def _dedupe_key(
        self,
        *,
        user_id: str,
        provider: str,
        event_type: str,
        related_record_kind: str,
        related_record_id: str,
    ) -> str:
        canonical = json.dumps(
            {
                "user_id": user_id,
                "provider": provider,
                "event_type": event_type,
                "related_record_kind": related_record_kind,
                "related_record_id": related_record_id,
            },
            sort_keys=True,
        )
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    async def _find_existing(self, dedupe_key: str) -> Optional[WearableOutboxEventDB]:
        async with get_db_session() as session:
            result = await session.execute(
                select(WearableOutboxEventDB).where(WearableOutboxEventDB.dedupe_key == dedupe_key)
            )
            return result.scalar_one_or_none()

    async def enqueue_event(
        self,
        *,
        user_id: str,
        provider: str,
        event_type: str,
        related_record_kind: str,
        related_record_id: str,
        connection_id: Optional[str] = None,
        source_id: Optional[str] = None,
        payload: Optional[Dict[str, Any]] = None,
        delivery_target: str = "internal",
        available_at: Optional[datetime] = None,
        max_attempts: int = 5,
    ) -> WearableOutboxEventDB:
        if event_type not in self._SUPPORTED_EVENT_TYPES:
            raise ValueError(f"Unsupported wearable outbox event_type: {event_type}")

        dedupe_key = self._dedupe_key(
            user_id=user_id,
            provider=provider,
            event_type=event_type,
            related_record_kind=related_record_kind,
            related_record_id=related_record_id,
        )
        existing = await self._find_existing(dedupe_key)
        if existing:
            return existing

        now = datetime.now(timezone.utc)
        async with get_db_session() as session:
            event = WearableOutboxEventDB(
                id=str(uuid.uuid4()),
                user_id=user_id,
                connection_id=connection_id,
                source_id=source_id,
                provider=provider,
                event_type=event_type,
                delivery_target=delivery_target,
                related_record_kind=related_record_kind,
                related_record_id=related_record_id,
                status="queued",
                payload_json=_json_dumps(payload),
                dedupe_key=dedupe_key,
                max_attempts=max_attempts,
                available_at=available_at or now,
                created_at=now,
                updated_at=now,
            )
            session.add(event)
            await session.commit()
            await session.refresh(event)
            return event

    async def list_events(
        self,
        *,
        user_id: Optional[str] = None,
        provider: Optional[str] = None,
        status: Optional[str] = None,
        event_type: Optional[str] = None,
        limit: int = 100,
    ) -> List[WearableOutboxEventDB]:
        async with get_db_session() as session:
            query = select(WearableOutboxEventDB)
            if user_id:
                query = query.where(WearableOutboxEventDB.user_id == user_id)
            if provider:
                query = query.where(WearableOutboxEventDB.provider == provider)
            if status:
                query = query.where(WearableOutboxEventDB.status == status)
            if event_type:
                query = query.where(WearableOutboxEventDB.event_type == event_type)
            query = query.order_by(WearableOutboxEventDB.created_at.desc()).limit(limit)
            result = await session.execute(query)
            return list(result.scalars().all())

    async def get_event(self, event_id: str) -> Optional[WearableOutboxEventDB]:
        async with get_db_session() as session:
            return await session.get(WearableOutboxEventDB, event_id)

    async def claim_next_event(self) -> Optional[WearableOutboxEventDB]:
        now = datetime.now(timezone.utc)
        async with get_db_session() as session:
            result = await session.execute(
                select(WearableOutboxEventDB)
                .where(
                    WearableOutboxEventDB.status == "queued",
                    WearableOutboxEventDB.available_at <= now,
                )
                .order_by(WearableOutboxEventDB.created_at.asc())
                .limit(1)
            )
            event = result.scalar_one_or_none()
            if event is None:
                return None
            event.status = "running"
            event.started_at = now
            event.updated_at = now
            event.attempts = int(event.attempts or 0) + 1
            await session.commit()
            await session.refresh(event)
            return event

    async def _finish_event(
        self,
        event_id: str,
        *,
        status: str,
        result: Optional[Dict[str, Any]] = None,
        error: Optional[Dict[str, Any]] = None,
    ) -> Optional[WearableOutboxEventDB]:
        async with get_db_session() as session:
            event = await session.get(WearableOutboxEventDB, event_id)
            if event is None:
                return None
            event.status = status
            event.result_json = _json_dumps(result)
            event.error_json = _json_dumps(error)
            event.completed_at = datetime.now(timezone.utc)
            event.updated_at = datetime.now(timezone.utc)
            await session.commit()
            await session.refresh(event)
            return event

    async def _requeue_event(self, event_id: str, *, error: Dict[str, Any]) -> Optional[WearableOutboxEventDB]:
        async with get_db_session() as session:
            event = await session.get(WearableOutboxEventDB, event_id)
            if event is None:
                return None
            event.status = "queued" if int(event.attempts or 0) < int(event.max_attempts or 5) else "failed"
            event.error_json = _json_dumps(error)
            event.updated_at = datetime.now(timezone.utc)
            if event.status == "failed":
                event.completed_at = datetime.now(timezone.utc)
            await session.commit()
            await session.refresh(event)
            return event

    async def _handle_sleep_session_ingested(
        self,
        event: WearableOutboxEventDB,
        payload: Dict[str, Any],
    ) -> Dict[str, Any]:
        logger.info(
            "🛌 Internal wearable event: sleep_session_ingested user=%s provider=%s record=%s duration_minutes=%s",
            event.user_id,
            event.provider,
            event.related_record_id,
            payload.get("duration_minutes"),
        )
        return {"internal_consumer": "wearable_signal_logger", "disposition": "recorded"}

    async def _handle_recovery_metric_changed(
        self,
        event: WearableOutboxEventDB,
        payload: Dict[str, Any],
    ) -> Dict[str, Any]:
        logger.info(
            "💓 Internal wearable event: recovery_metric_changed user=%s provider=%s metric=%s value=%s",
            event.user_id,
            event.provider,
            payload.get("metric_type"),
            payload.get("value"),
        )
        return {"internal_consumer": "wearable_signal_logger", "disposition": "recorded"}

    async def _handle_steps_bucket_closed(
        self,
        event: WearableOutboxEventDB,
        payload: Dict[str, Any],
    ) -> Dict[str, Any]:
        logger.info(
            "👟 Internal wearable event: steps_bucket_closed user=%s provider=%s value=%s start=%s end=%s",
            event.user_id,
            event.provider,
            payload.get("value"),
            payload.get("start_time"),
            payload.get("end_time"),
        )
        return {"internal_consumer": "wearable_signal_logger", "disposition": "recorded"}

    async def _handle_wearable_backfill_completed(
        self,
        event: WearableOutboxEventDB,
        payload: Dict[str, Any],
    ) -> Dict[str, Any]:
        logger.info(
            "📦 Internal wearable event: wearable_backfill_completed user=%s provider=%s job=%s",
            event.user_id,
            event.provider,
            payload.get("job_id"),
        )
        return {"internal_consumer": "wearable_signal_logger", "disposition": "recorded"}

    async def _dispatch_event(self, event: WearableOutboxEventDB) -> Dict[str, Any]:
        payload = _json_loads(event.payload_json) or {}
        if event.event_type == "sleep_session_ingested":
            return await self._handle_sleep_session_ingested(event, payload)
        if event.event_type == "recovery_metric_changed":
            return await self._handle_recovery_metric_changed(event, payload)
        if event.event_type == "steps_bucket_closed":
            return await self._handle_steps_bucket_closed(event, payload)
        if event.event_type == "wearable_backfill_completed":
            return await self._handle_wearable_backfill_completed(event, payload)
        logger.info("Unhandled wearable outbox event_type=%s id=%s", event.event_type, event.id)
        return {"internal_consumer": "wearable_signal_logger", "disposition": "ignored"}

    async def process_next_event(self) -> Optional[Dict[str, Any]]:
        event = await self.claim_next_event()
        if event is None:
            return None
        try:
            result = await self._dispatch_event(event)
            await self._finish_event(event.id, status="succeeded", result=result)
            return {"event_id": event.id, "status": "succeeded", "result": result}
        except Exception as exc:
            logger.exception("Wearable outbox event %s failed", event.id)
            requeued = await self._requeue_event(event.id, error={"message": str(exc)})
            if requeued and requeued.status == "failed":
                await self._finish_event(event.id, status="failed", error={"message": str(exc)})
            return {"event_id": event.id, "status": "failed", "error": str(exc)}


wearable_event_outbox_service = WearableEventOutboxService()
