"""Apple Health ingest and legacy backfill operations."""

from .common import *
from .capabilities import RAW_PAYLOAD_TTL_DAYS, _default_source_priority_rank
from .outbox import build_wearable_outbox_event_for_event, build_wearable_outbox_event_for_sample

class WearableAppleSyncMixin:
    async def ingest_apple_metrics(
        self,
        *,
        user_id: str,
        device_id: str,
        metrics: Iterable[Any],
    ) -> List[Tuple[str, str]]:
        connection = await self.connection_service.get_or_create_connection(
            user_id=user_id,
            provider="apple_health",
            auth_method="sdk",
            status="active",
        )
        source = await self.upsert_source(
            user_id=user_id,
            provider="apple_health",
            connection_id=connection.id,
            source_kind="device",
            external_source_id=device_id,
            device_name="Apple Health Device",
            platform="ios",
        )

        stored: List[Tuple[str, str]] = []
        for metric in metrics:
            canonical_type = self.normalization.canonicalize_metric_type("apple_health", metric.metric_type.value)
            raw_payload = metric.raw_payload
            raw_record = None
            if raw_payload is not None:
                raw_record = await self.store_raw_payload(
                    user_id=user_id,
                    provider="apple_health",
                    direction="sdk_ingest",
                    connection_id=connection.id,
                    payload=raw_payload,
                    external_id=metric.external_id,
                )

            start_time = datetime.fromisoformat(metric.start_time.replace("Z", "+00:00"))
            end_time = datetime.fromisoformat(metric.end_time.replace("Z", "+00:00"))
            recorded_at = None
            if metric.recorded_at:
                recorded_at = datetime.fromisoformat(metric.recorded_at.replace("Z", "+00:00"))
            aggregation_kind = metric.aggregation_kind or (
                "interval" if metric.start_time != metric.end_time else "point"
            )
            if aggregation_kind == "daily":
                rollup_level = "daily"
            elif aggregation_kind == "bucket_15m":
                rollup_level = "bucket_15m"
            elif aggregation_kind == "bucket_1h":
                rollup_level = "bucket_1h"
            else:
                rollup_level = "raw"
            should_project_to_habit_logs = (
                True if metric.should_project_to_habit_logs is None else bool(metric.should_project_to_habit_logs)
            )

            if metric.metric_type.value in {"sleep_session", "workout"}:
                event_id, created = await self._upsert_event(
                    user_id=user_id,
                    connection_id=connection.id,
                    source_id=source.id,
                    provider="apple_health",
                    event_type=canonical_type if metric.metric_type.value != "workout" else "workout",
                    provider_event_type=metric.metric_type.value,
                    external_id=metric.external_id,
                    start_time=start_time,
                    end_time=end_time,
                    attributed_date=metric.attributed_date,
                    timezone=metric.timezone,
                    title=metric.metric_type.value.replace("_", " ").title(),
                    summary_value=metric.value,
                    summary_unit=metric.unit.value,
                    details={
                        "source_bundle_id": metric.source_bundle_id,
                        "source_device_name": metric.source_device_name,
                        "recorded_at": metric.recorded_at,
                        "raw_payload": raw_payload,
                    },
                    raw_payload_id=raw_record.id if raw_record else None,
                )
                await self._project_and_emit_event(
                    user_id=user_id,
                    provider="apple_health",
                    event_id=event_id,
                    created=created,
                )
                stored.append((event_id, "event"))
                continue

            sample_id, created = await self._upsert_sample(
                user_id=user_id,
                connection_id=connection.id,
                source_id=source.id,
                provider="apple_health",
                metric_type=canonical_type,
                provider_metric_type=metric.metric_type.value,
                external_id=metric.external_id,
                recorded_at=recorded_at,
                start_time=start_time,
                end_time=end_time,
                attributed_date=metric.attributed_date,
                value=metric.value,
                unit=metric.unit.value,
                aggregation_kind=aggregation_kind,
                rollup_level=rollup_level,
                rollup_window_minutes=metric.rollup_window_minutes,
                sample_count=metric.sample_count,
                should_project_to_habit_logs=should_project_to_habit_logs,
                confidence=metric.confidence,
                timezone=metric.timezone,
                attributes_json=self.normalization.sample_attributes(
                    provider_metric_type=metric.metric_type.value,
                    raw_payload=raw_payload,
                    source_bundle_id=metric.source_bundle_id,
                    source_device_name=metric.source_device_name,
                ),
                raw_payload_id=raw_record.id if raw_record else None,
            )
            await self._project_and_emit_sample(
                user_id=user_id,
                provider="apple_health",
                sample_id=sample_id,
                created=created,
            )
            stored.append((sample_id, "sample"))

        await self.update_connection_sync_state(connection_id=connection.id)
        return stored

    async def delete_records_by_external_ids(
        self,
        *,
        user_id: str,
        provider: str,
        external_ids: Iterable[str],
    ) -> Dict[str, int]:
        deleted_samples = 0
        deleted_events = 0
        async with get_db_session() as session:
            for external_id in external_ids:
                samples_result = await session.execute(
                    select(WearableSampleDB).where(
                        WearableSampleDB.user_id == user_id,
                        WearableSampleDB.provider == provider,
                        WearableSampleDB.external_id == external_id,
                        WearableSampleDB.deleted_at.is_(None),
                    )
                )
                for sample in samples_result.scalars().all():
                    sample.deleted_at = datetime.now(timezone.utc)
                    deleted_samples += 1

                events_result = await session.execute(
                    select(WearableEventDB).where(
                        WearableEventDB.user_id == user_id,
                        WearableEventDB.provider == provider,
                        WearableEventDB.external_id == external_id,
                        WearableEventDB.deleted_at.is_(None),
                    )
                )
                for event in events_result.scalars().all():
                    event.deleted_at = datetime.now(timezone.utc)
                    deleted_events += 1
            await session.commit()

        async with get_db_session() as session:
            samples_result = await session.execute(
                select(WearableSampleDB.id).where(
                    WearableSampleDB.user_id == user_id,
                    WearableSampleDB.provider == provider,
                    WearableSampleDB.external_id.in_(list(external_ids)),
                )
            )
            for sample_id in [row[0] for row in samples_result.fetchall()]:
                await self.projection_service.delete_projection("sample", sample_id)

            events_result = await session.execute(
                select(WearableEventDB.id).where(
                    WearableEventDB.user_id == user_id,
                    WearableEventDB.provider == provider,
                    WearableEventDB.external_id.in_(list(external_ids)),
                )
            )
            for event_id in [row[0] for row in events_result.fetchall()]:
                await self.projection_service.delete_projection("event", event_id)

        return {"samples": deleted_samples, "events": deleted_events}

    async def backfill_legacy_apple_metrics(self, user_id: str) -> Dict[str, int]:
        connection = await self.connection_service.get_or_create_connection(
            user_id=user_id,
            provider="apple_health",
            auth_method="sdk",
            status="active",
        )
        source = await self.upsert_source(
            user_id=user_id,
            provider="apple_health",
            connection_id=connection.id,
            source_kind="device",
            external_source_id="legacy-apple-health",
            device_name="Legacy Apple Health",
            platform="ios",
        )
        written = 0
        skipped = 0
        async with get_db_session() as session:
            result = await session.execute(
                select(WearableMetricDB).where(
                    WearableMetricDB.user_id == user_id,
                    WearableMetricDB.source == "apple_health",
                )
            )
            legacy_rows = result.scalars().all()

        for row in legacy_rows:
            canonical_type = self.normalization.canonicalize_metric_type("apple_health", row.metric_type)
            if row.metric_type in {"sleep_session", "workout"}:
                _, created = await self._upsert_event(
                    user_id=user_id,
                    connection_id=connection.id,
                    source_id=source.id,
                    provider="apple_health",
                    event_type=canonical_type if row.metric_type != "workout" else "workout",
                    provider_event_type=row.metric_type,
                    external_id=row.external_id,
                    start_time=row.start_time,
                    end_time=row.end_time,
                    attributed_date=None,
                    timezone=row.timezone,
                    title=row.metric_type.replace("_", " ").title(),
                    summary_value=row.value,
                    summary_unit=row.unit,
                    details=json.loads(row.raw_payload) if row.raw_payload else None,
                    raw_payload_id=None,
                )
                written += 1 if created else 0
                skipped += 0 if created else 1
                continue

            _, created = await self._upsert_sample(
                user_id=user_id,
                connection_id=connection.id,
                source_id=source.id,
                provider="apple_health",
                metric_type=canonical_type,
                provider_metric_type=row.metric_type,
                external_id=row.external_id,
                recorded_at=row.recorded_at,
                start_time=row.start_time,
                end_time=row.end_time,
                attributed_date=None,
                value=row.value,
                unit=row.unit,
                aggregation_kind="interval" if row.start_time != row.end_time else "point",
                confidence=row.confidence,
                timezone=row.timezone,
                attributes_json=row.raw_payload,
                raw_payload_id=None,
            )
            written += 1 if created else 0
            skipped += 0 if created else 1

