"""Shared wearable persistence, parsing, projection, and outbox helpers."""

from .common import *
from .capabilities import RAW_PAYLOAD_TTL_DAYS, _default_source_priority_rank
from .outbox import build_wearable_outbox_event_for_event, build_wearable_outbox_event_for_sample

class WearableSyncPersistenceMixin:
    def _duration_to_minutes(value: Any) -> Optional[float]:
        if value in (None, ""):
            return None
        try:
            numeric = float(value)
        except Exception:
            return None
        if numeric > 100000:
            return numeric / 60000.0
        if numeric > 1000:
            return numeric / 60.0
        return numeric

    @staticmethod
    def _parse_dt(value: Any) -> datetime:
        if isinstance(value, datetime):
            return value
        text = str(value)
        if text.endswith("Z"):
            text = text.replace("Z", "+00:00")
        return datetime.fromisoformat(text)

    @staticmethod
    def _extract_collection(payload: Dict[str, Any], *keys: str) -> List[Dict[str, Any]]:
        for key in keys:
            value = payload.get(key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)]
            if isinstance(value, dict) and isinstance(value.get("records"), list):
                return [item for item in value["records"] if isinstance(item, dict)]
        return []

    @staticmethod
    def _extract_date_value(record: Dict[str, Any]) -> Optional[str]:
        for key in ("calendarDate", "day", "summary_date", "date"):
            value = record.get(key)
            if value:
                return str(value)[:10]
        for key in ("wellnessStartTimeGmt", "timestamp", "startTimeGMT"):
            value = record.get(key)
            if value:
                return str(value)[:10]
        return None

    @staticmethod
    def _get_first(record: Dict[str, Any], *keys: str, default: Any = None) -> Any:
        for key in keys:
            if key in record and record.get(key) not in (None, ""):
                return record.get(key)
        return default

    async def _upsert_sample(self, **kwargs: Any) -> Tuple[str, bool]:
        async with get_db_session() as session:
            existing = None
            external_id = kwargs.get("external_id")
            if external_id:
                result = await session.execute(
                    select(WearableSampleDB).where(
                        WearableSampleDB.user_id == kwargs["user_id"],
                        WearableSampleDB.provider == kwargs["provider"],
                        WearableSampleDB.external_id == external_id,
                    )
                )
                existing = result.scalar_one_or_none()

            created = existing is None
            sample = existing or WearableSampleDB(
                id=str(uuid.uuid4()),
                user_id=kwargs["user_id"],
                provider=kwargs["provider"],
                created_at=datetime.now(timezone.utc),
            )
            if created:
                session.add(sample)

            for key, value in kwargs.items():
                setattr(sample, key, value)
            sample.updated_at = datetime.now(timezone.utc)
            sample.deleted_at = None
            await session.commit()
            await session.refresh(sample)
            return sample.id, created

    async def _upsert_event(self, **kwargs: Any) -> Tuple[str, bool]:
        async with get_db_session() as session:
            existing = None
            external_id = kwargs.get("external_id")
            if external_id:
                result = await session.execute(
                    select(WearableEventDB).where(
                        WearableEventDB.user_id == kwargs["user_id"],
                        WearableEventDB.provider == kwargs["provider"],
                        WearableEventDB.external_id == external_id,
                    )
                )
                existing = result.scalar_one_or_none()

            created = existing is None
            event = existing or WearableEventDB(
                id=str(uuid.uuid4()),
                user_id=kwargs["user_id"],
                provider=kwargs["provider"],
                created_at=datetime.now(timezone.utc),
            )
            if created:
                session.add(event)

            details = kwargs.pop("details", None)
            if details is not None:
                kwargs["details_json"] = json.dumps(details)
            for key, value in kwargs.items():
                setattr(event, key, value)
            event.updated_at = datetime.now(timezone.utc)
            event.deleted_at = None
            await session.commit()
            await session.refresh(event)
            return event.id, created

    async def _emit_internal_signal_for_sample(self, sample: WearableSampleDB, *, created: bool) -> None:
        if not created:
            return
        outbox_event = build_wearable_outbox_event_for_sample(sample)
        if not outbox_event:
            return
        from services.wearable_event_outbox_service import wearable_event_outbox_service

        await wearable_event_outbox_service.enqueue_event(
            user_id=sample.user_id,
            provider=sample.provider,
            connection_id=sample.connection_id,
            source_id=sample.source_id,
            event_type=outbox_event["event_type"],
            related_record_kind="sample",
            related_record_id=sample.id,
            payload=outbox_event.get("payload"),
        )

    async def _emit_internal_signal_for_event(self, event: WearableEventDB, *, created: bool) -> None:
        if not created:
            return
        outbox_event = build_wearable_outbox_event_for_event(event)
        if not outbox_event:
            return
        from services.wearable_event_outbox_service import wearable_event_outbox_service

        await wearable_event_outbox_service.enqueue_event(
            user_id=event.user_id,
            provider=event.provider,
            connection_id=event.connection_id,
            source_id=event.source_id,
            event_type=outbox_event["event_type"],
            related_record_kind="event",
            related_record_id=event.id,
            payload=outbox_event.get("payload"),
        )

    async def _project_and_emit_sample(
        self,
        *,
        user_id: str,
        provider: str,
        sample_id: str,
        created: bool,
    ) -> None:
        sample = await self.get_sample(sample_id)
        if sample and sample.deleted_at is None:
            await self.projection_service.project_sample(user_id=user_id, provider=provider, sample=sample)
            await self._emit_internal_signal_for_sample(sample, created=created)

    async def _project_and_emit_event(
        self,
        *,
        user_id: str,
        provider: str,
        event_id: str,
        created: bool,
    ) -> None:
        event = await self.get_event(event_id)
        if event and event.deleted_at is None:
            await self.projection_service.project_event(user_id=user_id, provider=provider, event=event)
            await self._emit_internal_signal_for_event(event, created=created)

    async def get_sample(self, sample_id: str) -> Optional[WearableSampleDB]:
        async with get_db_session() as session:
            result = await session.execute(select(WearableSampleDB).where(WearableSampleDB.id == sample_id))
            return result.scalar_one_or_none()

    async def get_event(self, event_id: str) -> Optional[WearableEventDB]:
        async with get_db_session() as session:
            result = await session.execute(select(WearableEventDB).where(WearableEventDB.id == event_id))

