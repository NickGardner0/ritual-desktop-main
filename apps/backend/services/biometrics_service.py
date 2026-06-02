"""
Canonical WHOOP BLE heart-rate biometrics service.

The iPhone companion is the primary collector of record. This service owns the
auth-scoped canonical sample/session/live/rollup pipeline that both the iPhone
companion and dashboard consume.
"""

from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple

from sqlalchemy import delete, func, select

from database.connection import get_db_session
from database.models import (
    HabitDB,
    HabitLogDB,
    HeartRateRollup1mDB,
    HeartRateSampleDB,
    HeartRateSessionDB,
    LiveBiometricsStateDB,
)
from schemas.biometrics import (
    HeartRateDaySummaryOut,
    HeartRateSampleBatchIn,
    HeartRateSessionCreate,
    HeartRateSessionEndRequest,
    LiveBiometricsOut,
)

logger = logging.getLogger(__name__)

SOURCE_PREFERENCE = {
    "whoop_ble_ios": 0,
    "whoop_ble_mac": 1,
}

STALE_AFTER_SECONDS = 45
LIVE_LOOKBACK_SECONDS = 300
HEART_RATE_PROJECTION_ORIGIN_KIND = "biometric_rollup_day"
HEART_RATE_PROJECTION_NOTE = "Projected from WHOOP BLE heart-rate rollups"


@dataclass(frozen=True)
class BatchIngestResult:
    inserted_count: int
    duplicate_count: int
    rollup_buckets_updated: int
    live: LiveBiometricsOut


class BiometricsService:
    def _normalize_datetime(self, value: datetime) -> datetime:
        if value.tzinfo is None:
            return value
        return value.astimezone(timezone.utc).replace(tzinfo=None)

    def _bucket_start(self, value: datetime) -> datetime:
        value = self._normalize_datetime(value)
        return value.replace(second=0, microsecond=0)

    def _source_rank(self, source_type: Optional[str]) -> int:
        return SOURCE_PREFERENCE.get(source_type or "", 99)

    def _serialize_live(self, row: Optional[LiveBiometricsStateDB]) -> LiveBiometricsOut:
        if row is None or row.latest_sample_at is None:
            return LiveBiometricsOut()

        latest_sample_at = row.latest_sample_at
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        is_stale = (now - latest_sample_at) > timedelta(seconds=STALE_AFTER_SECONDS)
        connection_state = row.connection_state or "receiving"
        if is_stale:
            connection_state = "stale"

        return LiveBiometricsOut(
            current_bpm=row.current_bpm,
            current_source_type=row.current_source_type,
            latest_sample_at=latest_sample_at,
            connection_state=connection_state,
            is_stale=is_stale,
        )

    async def create_session(self, user_id: str, payload: HeartRateSessionCreate) -> HeartRateSessionDB:
        now = datetime.utcnow()
        async with get_db_session() as session:
            session_id = payload.id or self._make_session_id()
            session_row = await session.get(HeartRateSessionDB, session_id)
            if session_row is not None and session_row.user_id != user_id:
                raise ValueError("Heart-rate session ID already belongs to another user")
            if session_row is None:
                session_row = HeartRateSessionDB(
                    id=session_id,
                    user_id=user_id,
                    created_at=now,
                )
                session.add(session_row)

            session_row.user_id = user_id
            session_row.source_type = payload.source_type.value
            session_row.source_device_id = payload.source_device_id
            session_row.status = payload.status.value
            session_row.started_at = self._normalize_datetime(payload.started_at)
            session_row.ended_at = None
            session_row.app_version = payload.app_version
            session_row.device_model = payload.device_model
            session_row.updated_at = now
            await session.commit()
            await session.refresh(session_row)
            return session_row

    async def end_session(
        self,
        user_id: str,
        session_id: str,
        payload: HeartRateSessionEndRequest,
    ) -> Optional[HeartRateSessionDB]:
        async with get_db_session() as session:
            result = await session.execute(
                select(HeartRateSessionDB).where(
                    HeartRateSessionDB.id == session_id,
                    HeartRateSessionDB.user_id == user_id,
                )
            )
            session_row = result.scalar_one_or_none()
            if session_row is None:
                return None

            session_row.status = payload.status.value
            session_row.ended_at = self._normalize_datetime(payload.ended_at or datetime.utcnow())
            session_row.updated_at = datetime.utcnow()
            await session.commit()
            await session.refresh(session_row)
            return session_row

    async def ingest_samples(self, user_id: str, payload: HeartRateSampleBatchIn) -> BatchIngestResult:
        sample_ids = [sample.id for sample in payload.samples]
        session_ids = sorted({sample.session_id for sample in payload.samples})
        now = datetime.utcnow()

        async with get_db_session() as session:
            sessions_result = await session.execute(
                select(HeartRateSessionDB).where(
                    HeartRateSessionDB.id.in_(session_ids),
                    HeartRateSessionDB.user_id == user_id,
                )
            )
            valid_session_ids = {row.id for row in sessions_result.scalars().all()}
            missing_sessions = [item for item in session_ids if item not in valid_session_ids]
            if missing_sessions:
                raise ValueError(f"Unknown heart-rate session(s): {', '.join(missing_sessions)}")

            existing_result = await session.execute(
                select(HeartRateSampleDB.id).where(HeartRateSampleDB.id.in_(sample_ids))
            )
            existing_ids = {row[0] for row in existing_result.all()}

            inserted_rows: List[HeartRateSampleDB] = []
            for sample in payload.samples:
                if sample.id in existing_ids:
                    continue
                inserted_rows.append(
                    HeartRateSampleDB(
                        id=sample.id,
                        user_id=user_id,
                        session_id=sample.session_id,
                        source_type=sample.source_type.value,
                        source_device_id=sample.source_device_id,
                        bpm_raw=sample.bpm_raw,
                        bpm_display=sample.bpm_display,
                        quality_score=sample.quality_score,
                        is_outlier=sample.is_outlier,
                        rr_intervals_json=json.dumps(sample.rr_intervals_ms) if sample.rr_intervals_ms else None,
                        contact_detected=sample.contact_detected,
                        received_at=self._normalize_datetime(sample.received_at),
                        created_at=now,
                    )
                )

            if inserted_rows:
                session.add_all(inserted_rows)
                await session.flush()

            updated_rollups = await self._rebuild_rollups(session, user_id, inserted_rows)
            projected_logs = await self._upsert_projected_habit_logs(
                session,
                user_id=user_id,
                updated_rollups=updated_rollups,
            )
            live = await self._refresh_live_state(session, user_id)
            await session.commit()

        await self._sync_rollups_to_tinybird(updated_rollups)
        await self._sync_projected_logs_to_tinybird(projected_logs)

        return BatchIngestResult(
            inserted_count=len(inserted_rows),
            duplicate_count=len(sample_ids) - len(inserted_rows),
            rollup_buckets_updated=len(updated_rollups),
            live=live,
        )

    async def get_live(self, user_id: str) -> LiveBiometricsOut:
        async with get_db_session() as session:
            row = await session.get(LiveBiometricsStateDB, user_id)
            return self._serialize_live(row)

    async def get_range(
        self,
        user_id: str,
        *,
        start: datetime,
        end: datetime,
        resolution: str,
        source_type: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        start_dt = self._normalize_datetime(start)
        end_dt = self._normalize_datetime(end)
        if end_dt < start_dt:
            raise ValueError("end must be after start")

        async with get_db_session() as session:
            if resolution == "raw":
                query = (
                    select(HeartRateSampleDB)
                    .where(HeartRateSampleDB.user_id == user_id)
                    .where(HeartRateSampleDB.received_at >= start_dt)
                    .where(HeartRateSampleDB.received_at <= end_dt)
                    .order_by(HeartRateSampleDB.received_at.asc())
                )
                if source_type:
                    query = query.where(HeartRateSampleDB.source_type == source_type)
                rows = (await session.execute(query)).scalars().all()
                return [
                    {
                        "source_type": row.source_type,
                        "received_at": row.received_at,
                        "bpm_raw": row.bpm_raw,
                        "bpm_display": row.bpm_display,
                        "is_outlier": bool(row.is_outlier),
                    }
                    for row in rows
                ]

            query = (
                select(HeartRateRollup1mDB)
                .where(HeartRateRollup1mDB.user_id == user_id)
                .where(HeartRateRollup1mDB.bucket_start >= self._bucket_start(start_dt))
                .where(HeartRateRollup1mDB.bucket_start <= self._bucket_start(end_dt))
                .order_by(HeartRateRollup1mDB.bucket_start.asc(), HeartRateRollup1mDB.source_preference.asc())
            )
            if source_type:
                query = query.where(HeartRateRollup1mDB.source_preference == source_type)

            rows = (await session.execute(query)).scalars().all()
            return [
                {
                    "source_type": row.source_preference,
                    "bucket_start": row.bucket_start,
                    "bpm_avg": row.bpm_avg,
                    "bpm_min": row.bpm_min,
                    "bpm_max": row.bpm_max,
                    "sample_count": row.sample_count,
                }
                for row in rows
            ]

    async def get_day_summary(self, user_id: str, target_day: date) -> HeartRateDaySummaryOut:
        start_dt = datetime.combine(target_day, time.min)
        end_dt = datetime.combine(target_day, time.max)

        async with get_db_session() as session:
            summary_result = await session.execute(
                select(
                    func.avg(HeartRateSampleDB.bpm_display),
                    func.min(HeartRateSampleDB.bpm_raw),
                    func.max(HeartRateSampleDB.bpm_raw),
                    func.count(HeartRateSampleDB.id),
                )
                .where(HeartRateSampleDB.user_id == user_id)
                .where(HeartRateSampleDB.received_at >= start_dt)
                .where(HeartRateSampleDB.received_at <= end_dt)
            )
            average_bpm, min_bpm, max_bpm, total_samples = summary_result.one()

            source_result = await session.execute(
                select(
                    HeartRateSampleDB.source_type,
                    func.count(HeartRateSampleDB.id),
                    func.avg(HeartRateSampleDB.bpm_display),
                    func.min(HeartRateSampleDB.bpm_raw),
                    func.max(HeartRateSampleDB.bpm_raw),
                )
                .where(HeartRateSampleDB.user_id == user_id)
                .where(HeartRateSampleDB.received_at >= start_dt)
                .where(HeartRateSampleDB.received_at <= end_dt)
                .group_by(HeartRateSampleDB.source_type)
                .order_by(func.count(HeartRateSampleDB.id).desc())
            )
            source_rows = source_result.all()

            bucket_rows = (
                await session.execute(
                    select(HeartRateRollup1mDB)
                    .where(HeartRateRollup1mDB.user_id == user_id)
                    .where(HeartRateRollup1mDB.bucket_start >= self._bucket_start(start_dt))
                    .where(HeartRateRollup1mDB.bucket_start <= self._bucket_start(end_dt))
                    .order_by(HeartRateRollup1mDB.bpm_avg.asc(), HeartRateRollup1mDB.bucket_start.asc())
                )
            ).scalars().all()

        lowest_window = None
        highest_window = None
        if bucket_rows:
            lowest = min(bucket_rows, key=lambda row: (row.bpm_avg, row.bucket_start))
            highest = max(bucket_rows, key=lambda row: (row.bpm_avg, row.bucket_start))
            lowest_window = {
                "bucket_start": lowest.bucket_start,
                "bpm_avg": lowest.bpm_avg,
                "bpm_min": lowest.bpm_min,
                "bpm_max": lowest.bpm_max,
                "sample_count": lowest.sample_count,
                "source_type": lowest.source_preference,
            }
            highest_window = {
                "bucket_start": highest.bucket_start,
                "bpm_avg": highest.bpm_avg,
                "bpm_min": highest.bpm_min,
                "bpm_max": highest.bpm_max,
                "sample_count": highest.sample_count,
                "source_type": highest.source_preference,
            }

        return HeartRateDaySummaryOut(
            day=target_day,
            average_bpm=float(average_bpm) if average_bpm is not None else None,
            min_bpm=int(min_bpm) if min_bpm is not None else None,
            max_bpm=int(max_bpm) if max_bpm is not None else None,
            total_samples=int(total_samples or 0),
            lowest_window=lowest_window,
            highest_window=highest_window,
            source_breakdown=[
                {
                    "source_type": source_type,
                    "sample_count": int(sample_count or 0),
                    "average_bpm": float(avg_bpm) if avg_bpm is not None else None,
                    "min_bpm": int(source_min) if source_min is not None else None,
                    "max_bpm": int(source_max) if source_max is not None else None,
                }
                for source_type, sample_count, avg_bpm, source_min, source_max in source_rows
            ],
        )

    async def delete_user_data(self, user_id: str) -> Dict[str, int]:
        async with get_db_session() as session:
            habit_ids_result = await session.execute(
                select(HabitDB.id).where(HabitDB.user_id == user_id)
            )
            habit_ids = [row[0] for row in habit_ids_result.all()]
            deleted_projected_logs = 0
            if habit_ids:
                deleted_projected_logs_result = await session.execute(
                    delete(HabitLogDB).where(
                        HabitLogDB.habit_id.in_(habit_ids),
                        HabitLogDB.origin_record_kind == HEART_RATE_PROJECTION_ORIGIN_KIND,
                    )
                )
                deleted_projected_logs = int(deleted_projected_logs_result.rowcount or 0)

            deleted_samples = await session.execute(
                delete(HeartRateSampleDB).where(HeartRateSampleDB.user_id == user_id)
            )
            deleted_rollups = await session.execute(
                delete(HeartRateRollup1mDB).where(HeartRateRollup1mDB.user_id == user_id)
            )
            await session.execute(
                delete(LiveBiometricsStateDB).where(LiveBiometricsStateDB.user_id == user_id)
            )
            deleted_sessions = await session.execute(
                delete(HeartRateSessionDB).where(HeartRateSessionDB.user_id == user_id)
            )
            await session.commit()

        await self._delete_tinybird_user_data(user_id)

        return {
            "deleted_samples": int(deleted_samples.rowcount or 0),
            "deleted_sessions": int(deleted_sessions.rowcount or 0),
            "deleted_rollups": int(deleted_rollups.rowcount or 0),
            "deleted_projected_logs": deleted_projected_logs,
        }

    async def sync_projected_heart_rate_habits(self, user_id: str, habit_id: Optional[str] = None) -> int:
        async with get_db_session() as session:
            projected_logs = await self._upsert_projected_habit_logs(
                session,
                user_id=user_id,
                updated_rollups=None,
                habit_id=habit_id,
            )
            await session.commit()

        await self._sync_projected_logs_to_tinybird(projected_logs)
        return len(projected_logs)

    async def _sync_rollups_to_tinybird(self, rollups: Sequence[HeartRateRollup1mDB]) -> None:
        if not rollups:
            return

        try:
            from services.tinybird_service import TinybirdService

            tinybird = TinybirdService()
        except Exception as exc:
            logger.info("Tinybird heart-rate sync disabled: %s", exc)
            return

        payload = [
            {
                "id": row.id,
                "user_id": row.user_id,
                "bucket_start": row.bucket_start,
                "source_type": row.source_preference,
                "sample_count": row.sample_count,
                "bpm_avg": row.bpm_avg,
                "bpm_min": row.bpm_min,
                "bpm_max": row.bpm_max,
                "created_at": row.created_at,
            }
            for row in rollups
        ]

        try:
            result = await tinybird.ingest_heart_rate_rollups(payload)
            if not result.get("success"):
                logger.warning("Heart-rate Tinybird sync failed: %s", result.get("errors") or result.get("error"))
        except Exception as exc:
            logger.warning("Heart-rate Tinybird sync failed: %s", exc)

    async def _delete_tinybird_user_data(self, user_id: str) -> None:
        try:
            from services.tinybird_service import TinybirdService

            tinybird = TinybirdService()
        except Exception as exc:
            logger.info("Tinybird heart-rate delete skipped: %s", exc)
            return

        escaped_user_id = user_id.replace("'", "''")
        try:
            result = await tinybird.delete_by_condition(
                "heart_rate_1m_rollups",
                f"user_id = '{escaped_user_id}'",
            )
            if not result.get("success"):
                logger.warning("Heart-rate Tinybird delete failed: %s", result.get("error"))
        except Exception as exc:
            logger.warning("Heart-rate Tinybird delete failed: %s", exc)

        try:
            result = await tinybird.delete_by_condition(
                "habit_logs",
                (
                    f"user_id = '{escaped_user_id}' "
                    "AND source = 'whoop' "
                    "AND integration_id = 'whoop' "
                    "AND JSONExtractString(metadata, 'projection_kind') = "
                    f"'{HEART_RATE_PROJECTION_ORIGIN_KIND}'"
                ),
            )
            if not result.get("success"):
                logger.warning("Projected heart-rate habit Tinybird delete failed: %s", result.get("error"))
        except Exception as exc:
            logger.warning("Projected heart-rate habit Tinybird delete failed: %s", exc)

    async def _sync_projected_logs_to_tinybird(self, logs: Sequence[Dict[str, Any]]) -> None:
        if not logs:
            return

        try:
            from services.tinybird_service import TinybirdService

            tinybird = TinybirdService()
        except Exception as exc:
            logger.info("Tinybird projected heart-rate habit sync disabled: %s", exc)
            return

        try:
            result = await tinybird.ingest_habit_logs_batch(list(logs))
            if not result.get("success"):
                logger.warning(
                    "Projected heart-rate habit Tinybird sync failed: %s",
                    result.get("errors") or result.get("error"),
                )
        except Exception as exc:
            logger.warning("Projected heart-rate habit Tinybird sync failed: %s", exc)

    async def _refresh_live_state(self, session, user_id: str) -> LiveBiometricsOut:
        cutoff = datetime.utcnow() - timedelta(seconds=LIVE_LOOKBACK_SECONDS)
        latest_rows = (
            await session.execute(
                select(HeartRateSampleDB)
                .where(HeartRateSampleDB.user_id == user_id)
                .where(HeartRateSampleDB.received_at >= cutoff)
                .order_by(HeartRateSampleDB.received_at.desc())
                .limit(100)
            )
        ).scalars().all()

        if latest_rows:
            now = datetime.utcnow()
            fresh_rows = [
                row for row in latest_rows if (now - row.received_at) <= timedelta(seconds=STALE_AFTER_SECONDS)
            ]
            preferred = fresh_rows or latest_rows
            selected = sorted(
                preferred,
                key=lambda row: (self._source_rank(row.source_type), -row.received_at.timestamp()),
            )[0]
            is_stale = (now - selected.received_at) > timedelta(seconds=STALE_AFTER_SECONDS)
            state = await session.get(LiveBiometricsStateDB, user_id)
            if state is None:
                state = LiveBiometricsStateDB(user_id=user_id)
                session.add(state)
            state.current_bpm = int(selected.bpm_display)
            state.current_source_type = selected.source_type
            state.latest_sample_at = selected.received_at
            state.connection_state = "stale" if is_stale else "receiving"
            state.updated_at = datetime.utcnow()
            return self._serialize_live(state)

        state = await session.get(LiveBiometricsStateDB, user_id)
        if state is not None:
            state.current_bpm = None
            state.current_source_type = None
            state.latest_sample_at = None
            state.connection_state = "disconnected"
            state.updated_at = datetime.utcnow()
        return LiveBiometricsOut()

    async def _rebuild_rollups(
        self,
        session,
        user_id: str,
        samples: Sequence[HeartRateSampleDB],
    ) -> List[HeartRateRollup1mDB]:
        if not samples:
            return []

        bucket_source_pairs = {
            (self._bucket_start(sample.received_at), sample.source_type)
            for sample in samples
        }
        updated_rows: List[HeartRateRollup1mDB] = []

        for bucket_start, source_type in bucket_source_pairs:
            await session.execute(
                delete(HeartRateRollup1mDB).where(
                    HeartRateRollup1mDB.user_id == user_id,
                    HeartRateRollup1mDB.bucket_start == bucket_start,
                    HeartRateRollup1mDB.source_preference == source_type,
                )
            )

            bucket_end = bucket_start + timedelta(minutes=1)
            aggregate = (
                await session.execute(
                    select(
                        func.count(HeartRateSampleDB.id),
                        func.avg(HeartRateSampleDB.bpm_display),
                        func.min(HeartRateSampleDB.bpm_raw),
                        func.max(HeartRateSampleDB.bpm_raw),
                    )
                    .where(HeartRateSampleDB.user_id == user_id)
                    .where(HeartRateSampleDB.source_type == source_type)
                    .where(HeartRateSampleDB.received_at >= bucket_start)
                    .where(HeartRateSampleDB.received_at < bucket_end)
                )
            ).one()
            sample_count, avg_bpm, min_bpm, max_bpm = aggregate
            if not sample_count:
                continue

            row = HeartRateRollup1mDB(
                id=self._make_rollup_id(bucket_start, source_type, user_id),
                user_id=user_id,
                bucket_start=bucket_start,
                source_preference=source_type,
                sample_count=int(sample_count),
                bpm_avg=float(avg_bpm),
                bpm_min=int(min_bpm),
                bpm_max=int(max_bpm),
                created_at=datetime.utcnow(),
            )
            session.add(row)
            updated_rows.append(row)

        return updated_rows

    async def _upsert_projected_habit_logs(
        self,
        session,
        *,
        user_id: str,
        updated_rollups: Optional[Sequence[HeartRateRollup1mDB]],
        habit_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        habits = await self._load_matching_heart_rate_habits(session, user_id=user_id, habit_id=habit_id)
        if not habits:
            return []

        target_days = None
        if updated_rollups is not None:
            target_days = {row.bucket_start.date().isoformat() for row in updated_rollups}
            if not target_days:
                return []

        daily_projection = await self._build_daily_projection(session, user_id=user_id, target_days=target_days)
        if target_days:
            stale_days = target_days - set(daily_projection.keys())
            if stale_days:
                await self._delete_projected_logs_for_days(
                    session,
                    habits=habits,
                    target_days=stale_days,
                )

        if not daily_projection:
            return []

        existing_logs_result = await session.execute(
            select(HabitLogDB).where(
                HabitLogDB.habit_id.in_([habit.id for habit in habits]),
                HabitLogDB.origin_record_kind == HEART_RATE_PROJECTION_ORIGIN_KIND,
            )
        )
        existing_logs = {
            (log.habit_id, log.origin_record_id): log
            for log in existing_logs_result.scalars().all()
        }

        tinybird_logs: List[Dict[str, Any]] = []
        for habit in habits:
            for day_value, projection in sorted(daily_projection.items()):
                origin_id = self._projected_origin_id(day_value)
                existing = existing_logs.get((habit.id, origin_id))
                metadata = json.dumps(
                    {
                        "projection_kind": HEART_RATE_PROJECTION_ORIGIN_KIND,
                        "day": day_value,
                        "average_bpm": round(projection["average_bpm"], 3),
                        "min_bpm": projection["min_bpm"],
                        "max_bpm": projection["max_bpm"],
                        "total_samples": projection["total_samples"],
                        "source_types": projection["source_types"],
                    }
                )
                completed_at = projection["completed_at"].isoformat()

                if existing is None:
                    existing = HabitLogDB(
                        id=str(uuid.uuid4()),
                        habit_id=habit.id,
                        habit_name=habit.name,
                        date=day_value,
                        completed_at=completed_at,
                        status="completed",
                        amount=projection["average_bpm"],
                        source="whoop",
                        notes=HEART_RATE_PROJECTION_NOTE,
                        log_metadata=metadata,
                        origin_record_kind=HEART_RATE_PROJECTION_ORIGIN_KIND,
                        origin_record_id=origin_id,
                    )
                    session.add(existing)
                    existing_logs[(habit.id, origin_id)] = existing
                else:
                    existing.habit_name = habit.name
                    existing.date = day_value
                    existing.completed_at = completed_at
                    existing.status = "completed"
                    existing.duration = None
                    existing.amount = projection["average_bpm"]
                    existing.source = "whoop"
                    existing.notes = HEART_RATE_PROJECTION_NOTE
                    existing.log_metadata = metadata
                    existing.origin_record_kind = HEART_RATE_PROJECTION_ORIGIN_KIND
                    existing.origin_record_id = origin_id

                # Location enrichment (Phase: Location Tracking) — best-effort
                try:
                    from services.location.enrichment import enrich_habit_log
                    if existing.location_lat is None:
                        await enrich_habit_log(existing, user_id=user_id)
                except Exception as _loc_exc:  # noqa: BLE001
                    logger.debug("Location enrichment skipped (heart rate projection): %s", _loc_exc)

                tinybird_logs.append(
                    {
                        "id": existing.id,
                        "habit_id": habit.id,
                        "habit_name": habit.name,
                        "user_id": user_id,
                        "date": day_value,
                        "duration": None,
                        "amount": projection["average_bpm"],
                        "unit": habit.unit_type or "BPM",
                        "status": "completed",
                        "notes": HEART_RATE_PROJECTION_NOTE,
                        "source": "whoop",
                        "integration_source": habit.integration_source or "whoop",
                        "metric_type": habit.metric_type or "heart_rate",
                        "metadata": metadata,
                        "completed_at": completed_at,
                    }
                )

        return tinybird_logs

    async def _load_matching_heart_rate_habits(
        self,
        session,
        *,
        user_id: str,
        habit_id: Optional[str] = None,
    ) -> List[HabitDB]:
        query = select(HabitDB).where(
            HabitDB.user_id == user_id,
            HabitDB.integration_source == "whoop",
        )
        if habit_id:
            query = query.where(HabitDB.id == habit_id)

        result = await session.execute(query)
        habits = result.scalars().all()
        matching: List[HabitDB] = []
        for habit in habits:
            metric_type = (habit.metric_type or "").strip().lower()
            name = (habit.name or "").strip().lower()
            if metric_type in {"heart_rate", "hr"} or name == "heart rate":
                matching.append(habit)
        return matching

    async def _build_daily_projection(
        self,
        session,
        *,
        user_id: str,
        target_days: Optional[Set[str]],
    ) -> Dict[str, Dict[str, Any]]:
        query = (
            select(HeartRateRollup1mDB)
            .where(HeartRateRollup1mDB.user_id == user_id)
            .order_by(HeartRateRollup1mDB.bucket_start.asc(), HeartRateRollup1mDB.source_preference.asc())
        )

        if target_days:
            ordered_days = sorted(target_days)
            start_dt = datetime.combine(date.fromisoformat(ordered_days[0]), time.min)
            end_dt = datetime.combine(date.fromisoformat(ordered_days[-1]), time.max)
            query = query.where(HeartRateRollup1mDB.bucket_start >= start_dt)
            query = query.where(HeartRateRollup1mDB.bucket_start <= end_dt)

        rows = (await session.execute(query)).scalars().all()
        preferred_buckets: Dict[datetime, HeartRateRollup1mDB] = {}
        for row in rows:
            day_value = row.bucket_start.date().isoformat()
            if target_days and day_value not in target_days:
                continue

            existing = preferred_buckets.get(row.bucket_start)
            if existing is None or self._source_rank(row.source_preference) < self._source_rank(existing.source_preference):
                preferred_buckets[row.bucket_start] = row

        by_day: Dict[str, Dict[str, Any]] = {}
        for row in preferred_buckets.values():
            day_value = row.bucket_start.date().isoformat()
            if target_days and day_value not in target_days:
                continue

            current = by_day.setdefault(
                day_value,
                {
                    "weighted_bpm_sum": 0.0,
                    "total_samples": 0,
                    "min_bpm": row.bpm_min,
                    "max_bpm": row.bpm_max,
                    "completed_at": row.bucket_start,
                    "source_types": set(),
                },
            )
            current["weighted_bpm_sum"] += float(row.bpm_avg) * int(row.sample_count)
            current["total_samples"] += int(row.sample_count)
            current["min_bpm"] = min(int(current["min_bpm"]), int(row.bpm_min))
            current["max_bpm"] = max(int(current["max_bpm"]), int(row.bpm_max))
            if row.bucket_start > current["completed_at"]:
                current["completed_at"] = row.bucket_start
            current["source_types"].add(row.source_preference)

        projection: Dict[str, Dict[str, Any]] = {}
        for day_value, current in by_day.items():
            total_samples = int(current["total_samples"] or 0)
            if total_samples <= 0:
                continue

            projection[day_value] = {
                "average_bpm": float(current["weighted_bpm_sum"]) / total_samples,
                "min_bpm": int(current["min_bpm"]),
                "max_bpm": int(current["max_bpm"]),
                "total_samples": total_samples,
                "completed_at": current["completed_at"],
                "source_types": sorted(current["source_types"]),
            }

        return projection

    async def _delete_projected_logs_for_days(
        self,
        session,
        *,
        habits: Sequence[HabitDB],
        target_days: Set[str],
    ) -> None:
        if not habits or not target_days:
            return

        await session.execute(
            delete(HabitLogDB).where(
                HabitLogDB.habit_id.in_([habit.id for habit in habits]),
                HabitLogDB.origin_record_kind == HEART_RATE_PROJECTION_ORIGIN_KIND,
                HabitLogDB.origin_record_id.in_([self._projected_origin_id(day) for day in target_days]),
            )
        )

    def _projected_origin_id(self, day_value: str) -> str:
        return f"heart_rate_day:{day_value}"

    def _make_session_id(self) -> str:
        return f"hrs_{datetime.utcnow().strftime('%Y%m%d%H%M%S%f')}"

    def _make_rollup_id(self, bucket_start: datetime, source_type: str, user_id: str) -> str:
        return f"hrr_{user_id}_{source_type}_{bucket_start.strftime('%Y%m%d%H%M')}"


biometrics_service = BiometricsService()
