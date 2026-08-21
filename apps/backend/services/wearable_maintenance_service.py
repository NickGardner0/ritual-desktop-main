"""Retention and compaction helpers for canonical wearable data."""

from __future__ import annotations

import json
import logging
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

from sqlalchemy import delete, select

from database.connection import get_db_session
from database.models import WearableEventDB, WearableRawPayloadDB, WearableSampleDB
from services.wearables_unified import (
    BUCKET_15M_RETENTION_DAYS,
    BUCKET_1H_RETENTION_DAYS,
    RAW_RETENTION_DAYS,
    WearableQueryService,
    wearable_sync_service,
)

logger = logging.getLogger(__name__)


class WearableMaintenanceService:
    def __init__(self) -> None:
        self.query_service = WearableQueryService()

    def _aggregate_rows(self, metric_type: str, rows: List[WearableSampleDB]) -> Tuple[Optional[float], Optional[str]]:
        values = [float(row.value) for row in rows if row.value is not None]
        aggregated_value, aggregation = self.query_service._aggregate_metric_values(metric_type, values)
        return aggregated_value, aggregation

    async def _upsert_compacted_sample(
        self,
        *,
        row_template: WearableSampleDB,
        metric_type: str,
        start_time: datetime,
        end_time: datetime,
        attributed_date: Optional[str],
        value: float,
        unit: str,
        rollup_level: str,
        rollup_window_minutes: Optional[int],
        sample_count: int,
        compacted_from_rollup: str,
    ) -> str:
        external_id = (
            f"compact:{row_template.user_id}:{row_template.provider}:{metric_type}:{rollup_level}:"
            f"{(row_template.source_id or 'unknown')}:{start_time.isoformat()}"
        )
        sample_id, _created = await wearable_sync_service._upsert_sample(
            user_id=row_template.user_id,
            connection_id=row_template.connection_id,
            source_id=row_template.source_id,
            provider=row_template.provider,
            metric_type=metric_type,
            provider_metric_type=row_template.provider_metric_type or metric_type,
            external_id=external_id,
            recorded_at=start_time,
            start_time=start_time,
            end_time=end_time,
            attributed_date=attributed_date,
            value=value,
            unit=unit,
            aggregation_kind=rollup_level,
            rollup_level=rollup_level,
            rollup_window_minutes=rollup_window_minutes,
            sample_count=sample_count,
            should_project_to_habit_logs=False,
            confidence=None,
            timezone=row_template.timezone,
            attributes_json=json.dumps(
                {
                    "compacted_from_rollup": compacted_from_rollup,
                    "compacted_from_count": sample_count,
                    "source_device_name": self.query_service._source_device_name_from_sample(row_template),
                    "generated_at": datetime.now(timezone.utc).isoformat(),
                }
            ),
            raw_payload_id=None,
        )
        return sample_id

    async def _compact_rollup_level(
        self,
        *,
        from_rollup: str,
        to_rollup: str,
        older_than_days: int,
        rollup_window_minutes: int,
    ) -> Dict[str, int]:
        cutoff = datetime.now(timezone.utc) - timedelta(days=older_than_days)
        async with get_db_session() as session:
            rows = list(
                (
                    await session.execute(
                        select(WearableSampleDB).where(
                            WearableSampleDB.deleted_at.is_(None),
                            WearableSampleDB.rollup_level == from_rollup,
                            WearableSampleDB.start_time.is_not(None),
                            WearableSampleDB.start_time < cutoff,
                        )
                    )
                ).scalars().all()
            )

        grouped: Dict[Tuple[str, str, str, Optional[str], Optional[str], str], List[WearableSampleDB]] = defaultdict(list)
        for row in rows:
            bucket_start = row.start_time
            if bucket_start is None:
                continue
            if to_rollup == "bucket_1h":
                bucket_start = bucket_start.replace(minute=0, second=0, microsecond=0)
            elif to_rollup == "daily":
                bucket_start = bucket_start.replace(hour=0, minute=0, second=0, microsecond=0)
            bucket_key = (
                row.user_id,
                row.provider,
                row.metric_type,
                row.source_id,
                row.timezone,
                bucket_start.isoformat(),
            )
            grouped[bucket_key].append(row)

        written = 0
        deleted_rows = 0
        for grouped_rows in grouped.values():
            template = grouped_rows[0]
            bucket_start = min(row.start_time for row in grouped_rows if row.start_time is not None)
            if bucket_start is None:
                continue
            if to_rollup == "bucket_1h":
                bucket_end = bucket_start + timedelta(hours=1)
                attributed_date = template.attributed_date or bucket_start.strftime("%Y-%m-%d")
            else:
                bucket_end = bucket_start + timedelta(days=1)
                attributed_date = bucket_start.strftime("%Y-%m-%d")
            aggregated_value, _aggregation = self._aggregate_rows(template.metric_type, grouped_rows)
            if aggregated_value is None:
                continue
            await self._upsert_compacted_sample(
                row_template=template,
                metric_type=template.metric_type,
                start_time=bucket_start,
                end_time=bucket_end,
                attributed_date=attributed_date,
                value=aggregated_value,
                unit=template.unit,
                rollup_level=to_rollup,
                rollup_window_minutes=rollup_window_minutes,
                sample_count=len(grouped_rows),
                compacted_from_rollup=from_rollup,
            )
            written += 1
            async with get_db_session() as session:
                await session.execute(
                    delete(WearableSampleDB).where(
                        WearableSampleDB.id.in_([row.id for row in grouped_rows])
                    )
                )
                await session.commit()
            deleted_rows += len(grouped_rows)

        return {"written": written, "deleted_rows": deleted_rows}

    async def ensure_daily_rollups(self) -> Dict[str, int]:
        async with get_db_session() as session:
            rows = list(
                (
                    await session.execute(
                        select(WearableSampleDB).where(
                            WearableSampleDB.deleted_at.is_(None),
                            WearableSampleDB.rollup_level != "daily",
                            WearableSampleDB.attributed_date.is_not(None),
                        )
                    )
                ).scalars().all()
            )
            existing_daily = {
                (row.user_id, row.provider, row.metric_type, row.source_id, row.attributed_date)
                for row in (
                    await session.execute(
                        select(WearableSampleDB).where(
                            WearableSampleDB.deleted_at.is_(None),
                            WearableSampleDB.rollup_level == "daily",
                            WearableSampleDB.attributed_date.is_not(None),
                        )
                    )
                ).scalars().all()
            }

        grouped: Dict[Tuple[str, str, str, Optional[str], str], List[WearableSampleDB]] = defaultdict(list)
        for row in rows:
            key = (row.user_id, row.provider, row.metric_type, row.source_id, row.attributed_date or "")
            if key in existing_daily:
                continue
            grouped[key].append(row)

        written = 0
        for grouped_rows in grouped.values():
            template = grouped_rows[0]
            if not template.attributed_date:
                continue
            day_start = datetime.fromisoformat(f"{template.attributed_date}T00:00:00+00:00")
            aggregated_value, _aggregation = self._aggregate_rows(template.metric_type, grouped_rows)
            if aggregated_value is None:
                continue
            await self._upsert_compacted_sample(
                row_template=template,
                metric_type=template.metric_type,
                start_time=day_start,
                end_time=day_start + timedelta(days=1),
                attributed_date=template.attributed_date,
                value=aggregated_value,
                unit=template.unit,
                rollup_level="daily",
                rollup_window_minutes=1440,
                sample_count=len(grouped_rows),
                compacted_from_rollup=template.rollup_level,
            )
            written += 1
        return {"written": written}

    async def purge_expired_raw_payloads(self) -> Dict[str, int]:
        now = datetime.now(timezone.utc)
        async with get_db_session() as session:
            payloads = list(
                (
                    await session.execute(
                        select(WearableRawPayloadDB).where(
                            WearableRawPayloadDB.expires_at.is_not(None),
                            WearableRawPayloadDB.expires_at <= now,
                        )
                    )
                ).scalars().all()
            )
            payload_ids = [payload.id for payload in payloads]
            if not payload_ids:
                return {"deleted_payloads": 0}
            sample_rows = list(
                (
                    await session.execute(
                        select(WearableSampleDB).where(WearableSampleDB.raw_payload_id.in_(payload_ids))
                    )
                ).scalars().all()
            )
            for sample in sample_rows:
                sample.raw_payload_id = None

            event_rows = list(
                (
                    await session.execute(
                        select(WearableEventDB).where(WearableEventDB.raw_payload_id.in_(payload_ids))
                    )
                ).scalars().all()
            )
            for event in event_rows:
                event.raw_payload_id = None

            await session.execute(delete(WearableRawPayloadDB).where(WearableRawPayloadDB.id.in_(payload_ids)))
            await session.commit()
            return {"deleted_payloads": len(payload_ids)}

    async def run_once(self) -> Dict[str, Any]:
        raw_to_hourly = await self._compact_rollup_level(
            from_rollup="raw",
            to_rollup="bucket_1h",
            older_than_days=RAW_RETENTION_DAYS,
            rollup_window_minutes=60,
        )
        bucket15_to_hourly = await self._compact_rollup_level(
            from_rollup="bucket_15m",
            to_rollup="bucket_1h",
            older_than_days=BUCKET_15M_RETENTION_DAYS,
            rollup_window_minutes=60,
        )
        hourly_to_daily = await self._compact_rollup_level(
            from_rollup="bucket_1h",
            to_rollup="daily",
            older_than_days=BUCKET_1H_RETENTION_DAYS,
            rollup_window_minutes=1440,
        )
        daily_rollups = await self.ensure_daily_rollups()
        raw_payloads = await self.purge_expired_raw_payloads()
        return {
            "raw_to_hourly": raw_to_hourly,
            "bucket15_to_hourly": bucket15_to_hourly,
            "hourly_to_daily": hourly_to_daily,
            "daily_rollups": daily_rollups,
            "raw_payloads": raw_payloads,
        }


wearable_maintenance_service = WearableMaintenanceService()
