"""DB-backed queue for heavy wearable ingest and replay jobs."""

from __future__ import annotations

import hashlib
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import select

from database.connection import get_db_session
from database.models import (
    WearableConnectionDB,
    WearableIngestJobBatchDB,
    WearableIngestJobDB,
)
from services.garmin_service import garmin_service
from services.oura_service import oura_service
from services.unified_wearables_service import (
    PROVIDER_CAPABILITIES,
    wearable_connection_service,
    wearable_sync_service,
)
from services.wearable_provider_sync_registry import (
    WearableProviderSyncServices,
    sync_wearable_provider_account,
)
from services.whoop_service import whoop_service

logger = logging.getLogger(__name__)

PROVIDER_SYNC_SERVICES = WearableProviderSyncServices(
    whoop_service=whoop_service,
    oura_service=oura_service,
    garmin_service=garmin_service,
)


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


class WearableIngestJobService:
    def _should_emit_completion_outbox_event(self, job: WearableIngestJobDB) -> bool:
        return job.job_type in {"provider_backfill", "apple_legacy_backfill"}

    def _build_completion_outbox_payload(
        self,
        *,
        job: WearableIngestJobDB,
        result: Dict[str, Any],
    ) -> Dict[str, Any]:
        metric_scope = _json_loads(job.metric_scope_json) or {}
        return {
            "job_id": job.id,
            "provider": job.provider,
            "job_type": job.job_type,
            "metric_scope": metric_scope,
            "start_date": job.start_date,
            "end_date": job.end_date,
            "result": result,
        }

    async def _get_connection_id(self, *, user_id: str, provider: str) -> Optional[str]:
        connection = await wearable_connection_service.get_connection(user_id, provider)
        return connection.id if connection else None

    async def create_batch(
        self,
        *,
        provider: Optional[str],
        trigger: str,
        requested_by_user_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> WearableIngestJobBatchDB:
        async with get_db_session() as session:
            batch = WearableIngestJobBatchDB(
                id=str(uuid.uuid4()),
                provider=provider,
                requested_by_user_id=requested_by_user_id,
                trigger=trigger,
                status="queued",
                metadata_json=_json_dumps(metadata),
                created_at=datetime.now(timezone.utc),
            )
            session.add(batch)
            await session.commit()
            await session.refresh(batch)
            return batch

    def _idempotency_key(
        self,
        *,
        provider: str,
        user_id: str,
        job_type: str,
        metric_scope: Optional[Dict[str, Any]],
        start_date: Optional[str],
        end_date: Optional[str],
        payload: Optional[Dict[str, Any]],
    ) -> str:
        canonical = json.dumps(
            {
                "provider": provider,
                "user_id": user_id,
                "job_type": job_type,
                "metric_scope": metric_scope or {},
                "start_date": start_date,
                "end_date": end_date,
                "payload": payload or {},
            },
            sort_keys=True,
            default=str,
        )
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    async def _find_existing_job(self, idempotency_key: str) -> Optional[WearableIngestJobDB]:
        async with get_db_session() as session:
            result = await session.execute(
                select(WearableIngestJobDB).where(WearableIngestJobDB.idempotency_key == idempotency_key)
            )
            return result.scalar_one_or_none()

    async def enqueue_job(
        self,
        *,
        user_id: str,
        provider: str,
        job_type: str,
        trigger: str,
        metric_scope: Optional[Dict[str, Any]] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        payload: Optional[Dict[str, Any]] = None,
        batch_id: Optional[str] = None,
        requested_by_user_id: Optional[str] = None,
        max_attempts: int = 3,
    ) -> WearableIngestJobDB:
        if provider not in PROVIDER_CAPABILITIES:
            raise ValueError(f"Unsupported provider: {provider}")

        idempotency_key = self._idempotency_key(
            provider=provider,
            user_id=user_id,
            job_type=job_type,
            metric_scope=metric_scope,
            start_date=start_date,
            end_date=end_date,
            payload=payload,
        )
        existing = await self._find_existing_job(idempotency_key)
        if existing:
            return existing

        connection_id = await self._get_connection_id(user_id=user_id, provider=provider)
        if batch_id is None:
            batch = await self.create_batch(
                provider=provider,
                trigger=trigger,
                requested_by_user_id=requested_by_user_id,
                metadata={"job_type": job_type},
            )
            batch_id = batch.id

        async with get_db_session() as session:
            job = WearableIngestJobDB(
                id=str(uuid.uuid4()),
                batch_id=batch_id,
                user_id=user_id,
                connection_id=connection_id,
                provider=provider,
                job_type=job_type,
                trigger=trigger,
                status="queued",
                metric_scope_json=_json_dumps(metric_scope),
                start_date=start_date,
                end_date=end_date,
                payload_json=_json_dumps(payload),
                idempotency_key=idempotency_key,
                max_attempts=max_attempts,
                created_at=datetime.now(timezone.utc),
            )
            session.add(job)
            batch = await session.get(WearableIngestJobBatchDB, batch_id)
            if batch is not None:
                batch.total_jobs = int(batch.total_jobs or 0) + 1
                batch.updated_at = datetime.now(timezone.utc)
            await session.commit()
            await session.refresh(job)
            return job

    async def enqueue_backfill_job(
        self,
        *,
        user_id: str,
        provider: str,
        metric_scope: Optional[Dict[str, Any]] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        trigger: str = "manual_backfill",
        requested_by_user_id: Optional[str] = None,
    ) -> WearableIngestJobDB:
        if provider != "apple_health" and not PROVIDER_CAPABILITIES[provider].supports_async_backfill:
            raise ValueError(f"{provider} does not support async backfill")
        job_type = "apple_legacy_backfill" if provider == "apple_health" else "provider_backfill"
        return await self.enqueue_job(
            user_id=user_id,
            provider=provider,
            job_type=job_type,
            trigger=trigger,
            metric_scope=metric_scope,
            start_date=start_date,
            end_date=end_date,
            requested_by_user_id=requested_by_user_id,
        )

    async def enqueue_raw_payload_replay(
        self,
        *,
        payload_id: str,
        requested_by_user_id: Optional[str] = None,
    ) -> WearableIngestJobDB:
        payload_record = await wearable_sync_service.get_raw_payload(payload_id)
        if payload_record is None:
            raise ValueError("Raw payload not found")
        return await self.enqueue_job(
            user_id=payload_record.user_id,
            provider=payload_record.provider,
            job_type="raw_payload_replay",
            trigger="raw_payload_replay",
            payload={"raw_payload_id": payload_id},
            requested_by_user_id=requested_by_user_id,
        )

    async def list_jobs(
        self,
        *,
        user_id: Optional[str] = None,
        provider: Optional[str] = None,
        status: Optional[str] = None,
        limit: int = 100,
    ) -> List[WearableIngestJobDB]:
        async with get_db_session() as session:
            query = select(WearableIngestJobDB)
            if user_id:
                query = query.where(WearableIngestJobDB.user_id == user_id)
            if provider:
                query = query.where(WearableIngestJobDB.provider == provider)
            if status:
                query = query.where(WearableIngestJobDB.status == status)
            query = query.order_by(WearableIngestJobDB.created_at.desc()).limit(limit)
            result = await session.execute(query)
            return list(result.scalars().all())

    async def get_job(self, job_id: str) -> Optional[WearableIngestJobDB]:
        async with get_db_session() as session:
            return await session.get(WearableIngestJobDB, job_id)

    async def claim_next_job(self) -> Optional[WearableIngestJobDB]:
        async with get_db_session() as session:
            result = await session.execute(
                select(WearableIngestJobDB)
                .where(WearableIngestJobDB.status == "queued")
                .order_by(WearableIngestJobDB.created_at.asc())
                .limit(1)
            )
            job = result.scalar_one_or_none()
            if job is None:
                return None
            now = datetime.now(timezone.utc)
            job.status = "running"
            job.started_at = now
            job.last_attempt_at = now
            job.updated_at = now
            job.attempts = int(job.attempts or 0) + 1
            if job.batch_id:
                batch = await session.get(WearableIngestJobBatchDB, job.batch_id)
                if batch is not None:
                    batch.status = "running"
                    batch.started_at = batch.started_at or now
                    batch.updated_at = now
            await session.commit()
            await session.refresh(job)
            return job

    async def _complete_batch_for_job(self, session: Any, job: WearableIngestJobDB) -> None:
        if not job.batch_id:
            return
        batch = await session.get(WearableIngestJobBatchDB, job.batch_id)
        if batch is None:
            return
        batch.completed_jobs = int(batch.completed_jobs or 0) + (1 if job.status == "succeeded" else 0)
        batch.failed_jobs = int(batch.failed_jobs or 0) + (1 if job.status == "failed" else 0)
        total_done = int(batch.completed_jobs or 0) + int(batch.failed_jobs or 0)
        if total_done >= int(batch.total_jobs or 0):
            batch.completed_at = datetime.now(timezone.utc)
            batch.status = "failed" if int(batch.failed_jobs or 0) else "succeeded"
        batch.updated_at = datetime.now(timezone.utc)

    async def _finish_job(
        self,
        job_id: str,
        *,
        status: str,
        result: Optional[Dict[str, Any]] = None,
        error: Optional[Dict[str, Any]] = None,
        sync_run_id: Optional[str] = None,
    ) -> Optional[WearableIngestJobDB]:
        async with get_db_session() as session:
            job = await session.get(WearableIngestJobDB, job_id)
            if job is None:
                return None
            job.status = status
            job.result_json = _json_dumps(result)
            job.error_json = _json_dumps(error)
            job.sync_run_id = sync_run_id
            job.completed_at = datetime.now(timezone.utc)
            job.updated_at = datetime.now(timezone.utc)
            await self._complete_batch_for_job(session, job)
            await session.commit()
            await session.refresh(job)
            return job

    async def _requeue_job(self, job_id: str, *, error: Dict[str, Any]) -> Optional[WearableIngestJobDB]:
        async with get_db_session() as session:
            job = await session.get(WearableIngestJobDB, job_id)
            if job is None:
                return None
            job.status = "queued" if int(job.attempts or 0) < int(job.max_attempts or 3) else "failed"
            job.error_json = _json_dumps(error)
            job.updated_at = datetime.now(timezone.utc)
            if job.status == "failed":
                job.completed_at = datetime.now(timezone.utc)
            await session.commit()
            await session.refresh(job)
            return job

    def _days_back(self, start_date: Optional[str], end_date: Optional[str]) -> Optional[int]:
        if not start_date or not end_date:
            return None
        try:
            start_dt = datetime.strptime(start_date, "%Y-%m-%d")
            end_dt = datetime.strptime(end_date, "%Y-%m-%d")
        except ValueError:
            return None
        return max((end_dt - start_dt).days + 1, 1)

    def _sync_counts_from_result(self, result: Dict[str, Any]) -> Dict[str, int]:
        counts = {"items_seen": 0, "items_written": 0}
        for value in result.values():
            if isinstance(value, int):
                counts["items_seen"] += int(value)
                counts["items_written"] += int(value)
            elif isinstance(value, dict):
                for nested_value in value.values():
                    if isinstance(nested_value, int):
                        counts["items_seen"] += int(nested_value)
                        counts["items_written"] += int(nested_value)
        return counts

    async def _execute_job(self, job: WearableIngestJobDB) -> Dict[str, Any]:
        payload = _json_loads(job.payload_json) or {}
        metric_scope = _json_loads(job.metric_scope_json) or {}
        connection_id = job.connection_id or await self._get_connection_id(user_id=job.user_id, provider=job.provider)
        sync_run = await wearable_sync_service.start_sync_run(
            provider=job.provider,
            trigger=job.job_type,
            connection_id=connection_id,
            metadata={
                "job_id": job.id,
                "metric_scope": metric_scope,
                "start_date": job.start_date,
                "end_date": job.end_date,
                "payload": payload,
            },
        )
        try:
            result: Dict[str, Any]
            counts: Dict[str, int]
            if job.job_type == "provider_backfill":
                days_back = self._days_back(job.start_date, job.end_date)
                provider_result = await sync_wearable_provider_account(
                    provider=job.provider,
                    user_id=job.user_id,
                    services=PROVIDER_SYNC_SERVICES,
                    days_back=days_back,
                    force_full_sync=True,
                    full_history=bool(metric_scope.get("full_history", False)),
                    unsupported_as_partial=False,
                )
                if provider_result.status in {"retryable_failed", "terminal_failed"}:
                    failure_message = (
                        (provider_result.error or {}).get("message")
                        or provider_result.message
                        or f"{job.provider} sync failed"
                    )
                    raise RuntimeError(failure_message)
                result = provider_result.data
                counts = {
                    "items_seen": provider_result.items_seen,
                    "items_written": provider_result.items_written,
                }
            elif job.job_type == "apple_legacy_backfill":
                result = await wearable_sync_service.backfill_legacy_apple_metrics(job.user_id)
                counts = self._sync_counts_from_result(result if isinstance(result, dict) else {"result": 1})
            elif job.job_type == "raw_payload_replay":
                raw_payload_id = payload.get("raw_payload_id")
                if not raw_payload_id:
                    raise ValueError("raw_payload_replay job is missing raw_payload_id")
                result = await wearable_sync_service.replay_raw_payload(payload_id=str(raw_payload_id))
                counts = self._sync_counts_from_result(result if isinstance(result, dict) else {"result": 1})
            else:
                raise ValueError(f"Unsupported wearable ingest job type: {job.job_type}")

            await wearable_sync_service.finish_sync_run(
                sync_run.id,
                status="success",
                items_seen=counts["items_seen"],
                items_written=counts["items_written"],
            )
            if self._should_emit_completion_outbox_event(job):
                from services.wearable_event_outbox_service import wearable_event_outbox_service

                await wearable_event_outbox_service.enqueue_event(
                    user_id=job.user_id,
                    provider=job.provider,
                    connection_id=job.connection_id,
                    event_type="wearable_backfill_completed",
                    related_record_kind="job",
                    related_record_id=job.id,
                    payload=self._build_completion_outbox_payload(job=job, result=result),
                )
            await self._finish_job(
                job.id,
                status="succeeded",
                result=result,
                sync_run_id=sync_run.id,
            )
            return result
        except Exception as exc:
            await wearable_sync_service.finish_sync_run(
                sync_run.id,
                status="failed",
                error={"message": str(exc), "job_id": job.id},
            )
            requeued = await self._requeue_job(
                job.id,
                error={"message": str(exc), "sync_run_id": sync_run.id},
            )
            if requeued and requeued.status == "failed":
                await self._finish_job(
                    job.id,
                    status="failed",
                    error={"message": str(exc), "sync_run_id": sync_run.id},
                    sync_run_id=sync_run.id,
                )
            raise

    async def process_next_job(self) -> Optional[Dict[str, Any]]:
        job = await self.claim_next_job()
        if job is None:
            return None
        try:
            result = await self._execute_job(job)
            return {"job_id": job.id, "status": "succeeded", "result": result}
        except Exception as exc:
            logger.exception("Wearable ingest job %s failed", job.id)
            return {"job_id": job.id, "status": "failed", "error": str(exc)}


wearable_ingest_job_service = WearableIngestJobService()
