"""Wearable sync run, raw payload, and cursor operations."""

from .common import *
from .capabilities import RAW_PAYLOAD_TTL_DAYS, _default_source_priority_rank
from .outbox import build_wearable_outbox_event_for_event, build_wearable_outbox_event_for_sample

class WearableSyncLifecycleMixin:
    async def start_sync_run(
        self,
        *,
        provider: str,
        trigger: str,
        connection_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> WearableSyncRunDB:
        async with get_db_session() as session:
            run = WearableSyncRunDB(
                id=str(uuid.uuid4()),
                connection_id=connection_id,
                provider=provider,
                trigger=trigger,
                status="running",
                started_at=datetime.now(timezone.utc),
                metadata_json=json.dumps(metadata or {}),
            )
            session.add(run)
            await session.commit()
            await session.refresh(run)
            return run

    async def finish_sync_run(
        self,
        run_id: str,
        *,
        status: str,
        items_seen: int = 0,
        items_written: int = 0,
        items_updated: int = 0,
        items_deleted: int = 0,
        error: Optional[Dict[str, Any]] = None,
    ) -> None:
        async with get_db_session() as session:
            result = await session.execute(select(WearableSyncRunDB).where(WearableSyncRunDB.id == run_id))
            run = result.scalar_one_or_none()
            if run is None:
                return
            run.status = status
            run.completed_at = datetime.now(timezone.utc)
            run.items_seen = items_seen
            run.items_written = items_written
            run.items_updated = items_updated
            run.items_deleted = items_deleted
            run.error_json = json.dumps(error) if error is not None else None
            await session.commit()

    async def upsert_source(
        self,
        *,
        user_id: str,
        provider: str,
        connection_id: Optional[str],
        source_kind: str,
        external_source_id: Optional[str],
        external_source_name: Optional[str] = None,
        device_name: Optional[str] = None,
        device_model: Optional[str] = None,
        device_type: Optional[str] = None,
        platform: Optional[str] = None,
        source_bundle_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> WearableSourceDB:
        async with get_db_session() as session:
            query = select(WearableSourceDB).where(
                WearableSourceDB.user_id == user_id,
                WearableSourceDB.provider == provider,
            )
            if external_source_id:
                query = query.where(WearableSourceDB.external_source_id == external_source_id)
            else:
                query = query.where(WearableSourceDB.device_name == device_name)
            result = await session.execute(query.limit(1))
            source = result.scalar_one_or_none()
            if source is None:
                source = WearableSourceDB(
                    id=str(uuid.uuid4()),
                    user_id=user_id,
                    provider=provider,
                    created_at=datetime.now(timezone.utc),
                )
                session.add(source)
            source.connection_id = connection_id
            source.source_kind = source_kind
            source.external_source_id = external_source_id
            source.external_source_name = external_source_name
            source.device_name = device_name
            source.device_model = device_model
            source.device_type = device_type
            source.platform = platform
            source.source_bundle_id = source_bundle_id
            source.priority_rank = _default_source_priority_rank(
                source_kind=source_kind,
                device_type=device_type,
                device_name=device_name,
                platform=platform,
            )
            source.metadata_json = json.dumps(metadata) if metadata else source.metadata_json
            source.updated_at = datetime.now(timezone.utc)
            await session.commit()
            await session.refresh(source)
            return source

    async def store_raw_payload(
        self,
        *,
        user_id: str,
        provider: str,
        direction: str,
        payload: Any,
        connection_id: Optional[str] = None,
        external_id: Optional[str] = None,
        expires_at: Optional[datetime] = None,
    ) -> WearableRawPayloadDB:
        payload_json = payload if isinstance(payload, str) else json.dumps(payload, default=str)
        digest = hashlib.sha256(payload_json.encode("utf-8")).hexdigest()
        async with get_db_session() as session:
            record = WearableRawPayloadDB(
                id=str(uuid.uuid4()),
                user_id=user_id,
                connection_id=connection_id,
                provider=provider,
                direction=direction,
                external_id=external_id,
                payload_sha256=digest,
                payload_json=payload_json,
                received_at=datetime.now(timezone.utc),
                expires_at=expires_at or (datetime.now(timezone.utc) + timedelta(days=RAW_PAYLOAD_TTL_DAYS)),
            )
            session.add(record)
            await session.commit()
            await session.refresh(record)
            return record

    async def get_raw_payload(self, payload_id: str) -> Optional[WearableRawPayloadDB]:
        async with get_db_session() as session:
            result = await session.execute(select(WearableRawPayloadDB).where(WearableRawPayloadDB.id == payload_id))
            return result.scalar_one_or_none()

    async def list_raw_payloads(
        self,
        *,
        user_id: Optional[str] = None,
        provider: Optional[str] = None,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        has_error: Optional[bool] = None,
        limit: int = 100,
    ) -> List[WearableRawPayloadDB]:
        async with get_db_session() as session:
            query = select(WearableRawPayloadDB)
            if user_id:
                query = query.where(WearableRawPayloadDB.user_id == user_id)
            if provider:
                query = query.where(WearableRawPayloadDB.provider == provider)
            if start_time:
                query = query.where(WearableRawPayloadDB.received_at >= start_time)
            if end_time:
                query = query.where(WearableRawPayloadDB.received_at <= end_time)
            if has_error is True:
                query = query.where(WearableRawPayloadDB.normalization_error_json.is_not(None))
            elif has_error is False:
                query = query.where(WearableRawPayloadDB.normalization_error_json.is_(None))
            query = query.order_by(WearableRawPayloadDB.received_at.desc()).limit(limit)
            result = await session.execute(query)
            return list(result.scalars().all())

    async def record_raw_payload_error(
        self,
        *,
        payload_id: str,
        error: Dict[str, Any],
    ) -> None:
        async with get_db_session() as session:
            result = await session.execute(select(WearableRawPayloadDB).where(WearableRawPayloadDB.id == payload_id))
            payload = result.scalar_one_or_none()
            if payload is None:
                return
            payload.normalization_error_json = json.dumps(error)
            await session.commit()

    async def clear_raw_payload_error(self, payload_id: str) -> None:
        async with get_db_session() as session:
            result = await session.execute(select(WearableRawPayloadDB).where(WearableRawPayloadDB.id == payload_id))
            payload = result.scalar_one_or_none()
            if payload is None:
                return
            payload.normalization_error_json = None
            await session.commit()

    async def replay_raw_payload(
        self,
        *,
        payload_id: str,
    ) -> Dict[str, Any]:
        payload_record = await self.get_raw_payload(payload_id)
        if payload_record is None:
            raise ValueError("Raw payload not found")

        try:
            payload = json.loads(payload_record.payload_json)
        except Exception as exc:
            await self.record_raw_payload_error(
                payload_id=payload_id,
                error={"message": "Raw payload is not valid JSON", "detail": str(exc)},
            )
            raise ValueError("Raw payload is not valid JSON") from exc

        try:
            if payload_record.provider == "garmin" and payload_record.direction == "webhook":
                provider_user_id = payload_record.external_id or "garmin-replay"
                result = await self.ingest_garmin_payload(
                    user_id=payload_record.user_id,
                    provider_user_id=provider_user_id,
                    payload=payload,
                    access_token=None,
                    refresh_token=None,
                    token_expires_at=None,
                )
            elif payload_record.provider == "whoop" and payload_record.direction == "oauth_pull":
                result = await self.ingest_whoop_data(
                    user_id=payload_record.user_id,
                    provider_user_id=payload_record.external_id or "whoop-replay",
                    recovery_data=payload.get("recovery_data"),
                    sleep_data=payload.get("sleep_data"),
                    workout_data=payload.get("workout_data"),
                    cycle_data=payload.get("cycle_data"),
                    access_token=None,
                    refresh_token=None,
                    token_expires_at=None,
                )
            elif payload_record.provider == "oura" and payload_record.direction == "oauth_pull":
                result = await self.ingest_oura_data(
                    user_id=payload_record.user_id,
                    provider_user_id=payload_record.external_id or "oura-replay",
                    personal_info=payload.get("personal_info"),
                    access_token=None,
                    refresh_token=None,
                    token_expires_at=None,
                    daily_sleep_records=payload.get("daily_sleep_records") or [],
                    sleep_records=payload.get("sleep_records") or [],
                    daily_readiness_records=payload.get("daily_readiness_records") or [],
                    daily_activity_records=payload.get("daily_activity_records") or [],
                    workout_records=payload.get("workout_records") or [],
                    heartrate_records=payload.get("heartrate_records") or [],
                )
            else:
                raise ValueError(
                    f"Replay is not supported for provider={payload_record.provider} direction={payload_record.direction}"
                )
            await self.clear_raw_payload_error(payload_id)
            return {"success": True, "payload_id": payload_id, "result": result}
        except Exception as exc:
            await self.record_raw_payload_error(
                payload_id=payload_id,
                error={
                    "message": "Normalization replay failed",
                    "detail": str(exc),
                    "provider": payload_record.provider,
                    "direction": payload_record.direction,
                    "failed_at": datetime.now(timezone.utc).isoformat(),
                },
            )
            raise

    async def update_connection_sync_state(
        self,
        *,
        connection_id: Optional[str],
        status: str = "active",
        error: Optional[Dict[str, Any]] = None,
    ) -> None:
        if not connection_id:
            return
        async with get_db_session() as session:
            result = await session.execute(select(WearableConnectionDB).where(WearableConnectionDB.id == connection_id))
            connection = result.scalar_one_or_none()
            if connection is None:
                return
            now = datetime.now(timezone.utc)
            connection.updated_at = now
            connection.status = status
            if error is None:
                connection.last_sync_at = now
                connection.last_successful_sync_at = now
                connection.last_error_json = None
            else:
                connection.last_error_json = json.dumps(error)
            await session.commit()

    async def upsert_sync_cursor(
        self,
        *,
        connection_id: str,
        cursor_key: str,
        cursor_type: str,
        cursor_value: str,
        source_id: Optional[str] = None,
    ) -> WearableSyncCursorDB:
        async with get_db_session() as session:
            result = await session.execute(
                select(WearableSyncCursorDB).where(
                    WearableSyncCursorDB.connection_id == connection_id,
                    WearableSyncCursorDB.cursor_key == cursor_key,
                    WearableSyncCursorDB.source_id == source_id,
                )
            )
            cursor = result.scalar_one_or_none()
            if cursor is None:
                cursor = WearableSyncCursorDB(
                    id=str(uuid.uuid4()),
                    connection_id=connection_id,
                    source_id=source_id,
                    cursor_key=cursor_key,
                    created_at=datetime.now(timezone.utc),
                )
                session.add(cursor)
            cursor.cursor_type = cursor_type
            cursor.cursor_value = cursor_value
            cursor.last_synced_at = datetime.now(timezone.utc)
            cursor.updated_at = datetime.now(timezone.utc)
            await session.commit()
            await session.refresh(cursor)
            return cursor
