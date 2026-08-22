"""Single scheduler registry, runtime health, and durable occurrence fencing."""

from __future__ import annotations

import asyncio
import os
import socket
import time
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable, Dict, Iterable, Literal, Optional

from sqlalchemy import delete, or_, select, update

from database.connection import force_local_replica_sync, get_db_session
from database.models import SchedulerOccurrenceClaimDB


SchedulerJobMode = Literal["clock_occurrence", "queue_claim"]
SchedulerCallable = Callable[[], Awaitable[Any]]


@dataclass(frozen=True)
class SchedulerJobDefinition:
    job_key: str
    loop_key: str
    cadence_seconds: int
    mode: SchedulerJobMode
    lease_seconds: int
    description: str


SCHEDULER_JOB_DEFINITIONS = (
    SchedulerJobDefinition("proactive_sms", "hourly_domain", 3600, "clock_occurrence", 3300, "Proactive SMS sweep"),
    SchedulerJobDefinition("whoop_auto_sync", "hourly_domain", 3600, "clock_occurrence", 3300, "Whoop account sync"),
    SchedulerJobDefinition("oura_garmin_auto_sync", "hourly_domain", 3600, "clock_occurrence", 3300, "Oura and Garmin account sync"),
    SchedulerJobDefinition("tesla_odometer_sync", "hourly_domain", 3600, "clock_occurrence", 3300, "Tesla odometer sync"),
    SchedulerJobDefinition("financial_sync", "hourly_domain", 3600, "clock_occurrence", 3300, "Financial connection sync"),
    SchedulerJobDefinition("location_ping_retention", "hourly_domain", 3600, "clock_occurrence", 3300, "Location ping retention"),
    SchedulerJobDefinition("habit_reports", "habit_reports", 900, "clock_occurrence", 720, "Habit report dispatch and processing"),
    SchedulerJobDefinition("workflow_runs", "workflow_runs", 300, "clock_occurrence", 240, "Scheduled workflow dispatch and processing"),
    SchedulerJobDefinition("ambient_signals", "ambient_signals", 900, "clock_occurrence", 720, "Ambient signal evaluation"),
    SchedulerJobDefinition("sms_copilot", "sms_copilot", 300, "clock_occurrence", 240, "SMS copilot evaluation"),
    SchedulerJobDefinition("wearable_ingest", "wearable_ingest", 15, "queue_claim", 60, "Wearable ingest queue worker"),
    SchedulerJobDefinition("wearable_maintenance", "wearable_maintenance", 86400, "clock_occurrence", 7200, "Wearable retention and compaction"),
    SchedulerJobDefinition("wearable_event_outbox", "wearable_event_outbox", 15, "queue_claim", 60, "Wearable event outbox worker"),
)
SCHEDULER_JOBS_BY_KEY = {item.job_key: item for item in SCHEDULER_JOB_DEFINITIONS}


@dataclass
class SchedulerJobRuntimeState:
    registered: bool = False
    loop_key: Optional[str] = None
    last_attempted_at: Optional[str] = None
    last_successful_at: Optional[str] = None
    last_duration_ms: Optional[int] = None
    last_error: Optional[str] = None
    lease_state: str = "not_started"
    last_occurrence: Optional[str] = None


@dataclass(frozen=True)
class SchedulerExecutionResult:
    job_key: str
    scope_key: str
    scheduled_for: Optional[str]
    status: Literal["completed", "duplicate", "failed"]
    result: Any = None


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _utc_naive(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def _utc_iso(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def normalize_scheduled_occurrence(job_key: str, now: Optional[datetime] = None) -> datetime:
    definition = SCHEDULER_JOBS_BY_KEY[job_key]
    if definition.mode != "clock_occurrence":
        raise ValueError(f"{job_key} is queue-driven and has no clock occurrence")
    current = now or utc_now()
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    epoch_seconds = int(current.timestamp())
    normalized = epoch_seconds - (epoch_seconds % definition.cadence_seconds)
    return datetime.fromtimestamp(normalized, tz=timezone.utc)


def resolve_hourly_delivery_occurrence(
    requested_hour: Optional[int],
    now: Optional[datetime] = None,
) -> datetime:
    """Resolve a legacy hourly delivery to its nearest non-future UTC occurrence."""
    current = now or utc_now()
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    else:
        current = current.astimezone(timezone.utc)
    if requested_hour is None:
        return current
    if requested_hour < 0 or requested_hour > 23:
        raise ValueError("hour must be between 0 and 23")
    occurrence = current.replace(hour=requested_hour, minute=0, second=0, microsecond=0)
    if occurrence > current:
        occurrence -= timedelta(days=1)
    return occurrence


class SchedulerRuntimeRegistry:
    def __init__(self) -> None:
        self.enabled = False
        self.started_at: Optional[str] = None
        self.states: Dict[str, SchedulerJobRuntimeState] = {
            definition.job_key: SchedulerJobRuntimeState()
            for definition in SCHEDULER_JOB_DEFINITIONS
        }

    def reset(self) -> None:
        self.enabled = False
        self.started_at = None
        self.states = {
            definition.job_key: SchedulerJobRuntimeState()
            for definition in SCHEDULER_JOB_DEFINITIONS
        }

    def configure(self, enabled: bool) -> None:
        self.enabled = enabled
        self.started_at = _utc_iso(utc_now()) if enabled else None

    def register_loop(self, loop_key: str, job_keys: Iterable[str]) -> None:
        for job_key in job_keys:
            if job_key not in self.states:
                raise ValueError(f"Unknown scheduler job {job_key}")
            state = self.states[job_key]
            state.registered = True
            state.loop_key = loop_key
            state.lease_state = "registered"

    def record_attempt(
        self,
        job_key: str,
        *,
        lease_state: str,
        occurrence: Optional[datetime] = None,
    ) -> float:
        state = self.states[job_key]
        state.last_attempted_at = _utc_iso(utc_now())
        state.lease_state = lease_state
        state.last_occurrence = _utc_iso(occurrence) if occurrence else None
        return time.perf_counter()

    def record_success(
        self,
        job_key: str,
        started: float,
        *,
        lease_state: str = "completed",
        successful_at: Optional[datetime] = None,
    ) -> None:
        state = self.states[job_key]
        state.last_successful_at = _utc_iso(successful_at or utc_now())
        state.last_duration_ms = max(0, round((time.perf_counter() - started) * 1000))
        state.last_error = None
        state.lease_state = lease_state

    def record_failure(self, job_key: str, started: float, error: BaseException) -> None:
        state = self.states[job_key]
        state.last_duration_ms = max(0, round((time.perf_counter() - started) * 1000))
        state.last_error = str(error)
        state.lease_state = "failed"

    def readiness_snapshot(self, tasks: Dict[str, Any]) -> Dict[str, Any]:
        if not self.enabled:
            return {"status": "disabled", "enabled": False, "missingLoops": []}
        expected_loops = {item.loop_key for item in SCHEDULER_JOB_DEFINITIONS}
        missing = sorted(
            loop_key
            for loop_key in expected_loops
            if loop_key not in tasks or tasks[loop_key] is None or tasks[loop_key].done()
        )
        unregistered = sorted(key for key, state in self.states.items() if not state.registered)
        status = "ready" if not missing and not unregistered else "degraded"
        return {
            "status": status,
            "enabled": True,
            "missingLoops": missing,
            "unregisteredJobs": unregistered,
        }

    async def health_snapshot(self, tasks: Dict[str, Any]) -> Dict[str, Any]:
        readiness = self.readiness_snapshot(tasks)
        now = utc_now()
        jobs = []
        stale_jobs = []
        never_succeeded = []
        for definition in SCHEDULER_JOB_DEFINITIONS:
            state = self.states[definition.job_key]
            stale = False
            if state.last_successful_at:
                last_success = datetime.fromisoformat(state.last_successful_at)
                allowed_age = max(definition.cadence_seconds * 2, 120)
                stale = (now - last_success).total_seconds() > allowed_age
            else:
                never_succeeded.append(definition.job_key)
            if stale:
                stale_jobs.append(definition.job_key)
            jobs.append({
                **asdict(definition),
                **asdict(state),
                "stale": stale,
            })

        active_leases, overlapping_leases = await self._lease_health(now)
        if readiness["status"] == "disabled":
            status = "disabled"
        elif readiness["status"] != "ready":
            status = "degraded"
        elif never_succeeded:
            status = "starting" if not stale_jobs and not overlapping_leases else "degraded"
        elif stale_jobs or overlapping_leases or any(item["last_error"] for item in jobs):
            status = "degraded"
        else:
            status = "healthy"
        return {
            "schemaVersion": 1,
            "status": status,
            "enabled": self.enabled,
            "startedAt": self.started_at,
            "jobCount": len(SCHEDULER_JOB_DEFINITIONS),
            "readiness": readiness,
            "neverSucceeded": never_succeeded,
            "staleJobs": stale_jobs,
            "activeLeases": active_leases,
            "overlappingLeases": overlapping_leases,
            "jobs": jobs,
        }

    async def _lease_health(self, now: datetime) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        now_naive = _utc_naive(now)
        async with get_db_session() as session:
            result = await session.execute(
                select(SchedulerOccurrenceClaimDB).where(
                    SchedulerOccurrenceClaimDB.status == "running",
                    SchedulerOccurrenceClaimDB.lease_expires_at > now_naive,
                )
            )
            rows = list(result.scalars().all())
        active = [
            {
                "jobKey": row.job_key,
                "scopeKey": row.scope_key,
                "scheduledFor": _utc_iso(row.scheduled_for),
                "leaseOwner": row.lease_owner,
                "leaseExpiresAt": _utc_iso(row.lease_expires_at),
            }
            for row in rows
        ]
        counts: Dict[tuple[str, str], int] = {}
        for row in rows:
            key = (row.job_key, row.scope_key)
            counts[key] = counts.get(key, 0) + 1
        overlaps = [
            {"jobKey": key[0], "scopeKey": key[1], "activeLeaseCount": count}
            for key, count in sorted(counts.items())
            if count > 1
        ]
        return active, overlaps


scheduler_runtime = SchedulerRuntimeRegistry()


_OCCURRENCE_UNIQUE_COLUMNS = (
    "scheduler_occurrence_claims.job_key",
    "scheduler_occurrence_claims.scope_key",
    "scheduler_occurrence_claims.scheduled_for",
)


def _is_occurrence_unique_conflict(error: BaseException) -> bool:
    """Recognize only the durable occurrence identity conflict across DB drivers."""
    message = str(error).lower()
    return "unique constraint failed" in message and all(
        column in message for column in _OCCURRENCE_UNIQUE_COLUMNS
    )


async def _load_occurrence_after_conflict(
    *,
    definition: SchedulerJobDefinition,
    scope_key: str,
    scheduled_naive: datetime,
    conflict: BaseException,
) -> SchedulerOccurrenceClaimDB:
    """Read the winning remote claim after a duplicate insert loses its race."""
    for attempt in range(3):
        await force_local_replica_sync(timeout_seconds=2.5)
        async with get_db_session() as session:
            result = await session.execute(
                select(SchedulerOccurrenceClaimDB).where(
                    SchedulerOccurrenceClaimDB.job_key == definition.job_key,
                    SchedulerOccurrenceClaimDB.scope_key == scope_key,
                    SchedulerOccurrenceClaimDB.scheduled_for == scheduled_naive,
                )
            )
            existing = result.scalar_one_or_none()
        if existing is not None:
            return existing
        if attempt < 2:
            await asyncio.sleep(0.05 * (attempt + 1))
    raise RuntimeError(
        "scheduler occurrence conflict was accepted remotely but its winning claim "
        "was not visible after replica sync"
    ) from conflict


def _lease_owner() -> str:
    return f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:12]}"


async def _claim_occurrence(
    *,
    definition: SchedulerJobDefinition,
    scope_key: str,
    scheduled_for: datetime,
    lease_owner: str,
) -> tuple[SchedulerOccurrenceClaimDB, bool]:
    now = utc_now()
    now_naive = _utc_naive(now)
    scheduled_naive = _utc_naive(scheduled_for)
    lease_expires = _utc_naive(now + timedelta(seconds=definition.lease_seconds))
    row = SchedulerOccurrenceClaimDB(
        id=str(uuid.uuid4()),
        job_key=definition.job_key,
        scope_key=scope_key,
        scheduled_for=scheduled_naive,
        status="running",
        lease_owner=lease_owner,
        lease_expires_at=lease_expires,
        attempt_count=1,
        started_at=now_naive,
        created_at=now_naive,
        updated_at=now_naive,
    )
    conflict: Optional[BaseException] = None
    async with get_db_session() as session:
        session.add(row)
        try:
            await session.commit()
            await session.refresh(row)
            return row, True
        except Exception as error:
            await session.rollback()
            if not _is_occurrence_unique_conflict(error):
                raise
            conflict = error

    if conflict is None:
        raise RuntimeError("scheduler occurrence insert exited without a result")
    existing = await _load_occurrence_after_conflict(
        definition=definition,
        scope_key=scope_key,
        scheduled_naive=scheduled_naive,
        conflict=conflict,
    )
    async with get_db_session() as session:
        if existing.status == "succeeded":
            return existing, False
        if existing.lease_expires_at and existing.lease_expires_at > now_naive:
            return existing, False

        claim = await session.execute(
            update(SchedulerOccurrenceClaimDB)
            .where(
                SchedulerOccurrenceClaimDB.id == existing.id,
                SchedulerOccurrenceClaimDB.status != "succeeded",
                or_(
                    SchedulerOccurrenceClaimDB.lease_expires_at.is_(None),
                    SchedulerOccurrenceClaimDB.lease_expires_at <= now_naive,
                ),
            )
            .values(
                status="running",
                lease_owner=lease_owner,
                lease_expires_at=lease_expires,
                attempt_count=SchedulerOccurrenceClaimDB.attempt_count + 1,
                started_at=now_naive,
                completed_at=None,
                last_error=None,
                updated_at=now_naive,
            )
        )
        await session.commit()
        if int(claim.rowcount or 0) != 1:
            return existing, False
        refreshed = await session.get(SchedulerOccurrenceClaimDB, existing.id)
        if refreshed is None:
            raise RuntimeError("scheduler occurrence disappeared after claim")
        return refreshed, True


async def _finish_occurrence(
    claim_id: str,
    lease_owner: str,
    *,
    status: Literal["succeeded", "failed"],
    error: Optional[str] = None,
) -> None:
    now_naive = _utc_naive(utc_now())
    async with get_db_session() as session:
        result = await session.execute(
            update(SchedulerOccurrenceClaimDB)
            .where(
                SchedulerOccurrenceClaimDB.id == claim_id,
                SchedulerOccurrenceClaimDB.status == "running",
                SchedulerOccurrenceClaimDB.lease_owner == lease_owner,
            )
            .values(
                status=status,
                lease_expires_at=None,
                completed_at=now_naive,
                last_error=error,
                updated_at=now_naive,
            )
        )
        await session.commit()
        if int(result.rowcount or 0) != 1:
            raise RuntimeError("scheduler occurrence lease was lost before completion")


async def run_clock_job(
    job_key: str,
    work: SchedulerCallable,
    *,
    scope_key: str = "global",
    now: Optional[datetime] = None,
) -> SchedulerExecutionResult:
    definition = SCHEDULER_JOBS_BY_KEY[job_key]
    if definition.mode != "clock_occurrence":
        raise ValueError(f"{job_key} must use its durable queue claim")
    occurrence = normalize_scheduled_occurrence(job_key, now)
    owner = _lease_owner()
    claim, acquired = await _claim_occurrence(
        definition=definition,
        scope_key=scope_key,
        scheduled_for=occurrence,
        lease_owner=owner,
    )
    started = scheduler_runtime.record_attempt(
        job_key,
        lease_state="claimed" if acquired else "duplicate",
        occurrence=occurrence,
    )
    if not acquired:
        if claim.status == "succeeded":
            scheduler_runtime.record_success(
                job_key,
                started,
                lease_state="duplicate_completed",
                successful_at=claim.completed_at,
            )
        return SchedulerExecutionResult(
            job_key=job_key,
            scope_key=scope_key,
            scheduled_for=_utc_iso(occurrence),
            status="duplicate",
        )
    try:
        result = await work()
        await _finish_occurrence(claim.id, owner, status="succeeded")
        scheduler_runtime.record_success(job_key, started)
        return SchedulerExecutionResult(
            job_key=job_key,
            scope_key=scope_key,
            scheduled_for=_utc_iso(occurrence),
            status="completed",
            result=result,
        )
    except asyncio.CancelledError:
        try:
            await asyncio.shield(
                _finish_occurrence(
                    claim.id,
                    owner,
                    status="failed",
                    error="scheduler task canceled",
                )
            )
        finally:
            scheduler_runtime.record_failure(job_key, started, RuntimeError("scheduler task canceled"))
        raise
    except Exception as exc:
        try:
            await _finish_occurrence(claim.id, owner, status="failed", error=str(exc))
        except Exception as finish_error:
            scheduler_runtime.record_failure(job_key, started, finish_error)
            raise finish_error from exc
        scheduler_runtime.record_failure(job_key, started, exc)
        raise


async def run_queue_job(job_key: str, work: SchedulerCallable) -> SchedulerExecutionResult:
    definition = SCHEDULER_JOBS_BY_KEY[job_key]
    if definition.mode != "queue_claim":
        raise ValueError(f"{job_key} must use an occurrence claim")
    started = scheduler_runtime.record_attempt(job_key, lease_state="durable_row_claim")
    try:
        result = await work()
        scheduler_runtime.record_success(job_key, started, lease_state="durable_row_claim")
        return SchedulerExecutionResult(
            job_key=job_key,
            scope_key="queue",
            scheduled_for=None,
            status="completed",
            result=result,
        )
    except Exception as exc:
        scheduler_runtime.record_failure(job_key, started, exc)
        raise


async def cleanup_scheduler_occurrences(retention_days: int = 30) -> int:
    """Bound terminal occurrence history without adding another recurring owner."""
    cutoff = _utc_naive(utc_now() - timedelta(days=max(1, retention_days)))
    async with get_db_session() as session:
        result = await session.execute(
            delete(SchedulerOccurrenceClaimDB).where(
                SchedulerOccurrenceClaimDB.status.in_(("succeeded", "failed")),
                SchedulerOccurrenceClaimDB.completed_at < cutoff,
            )
        )
        await session.commit()
        return int(result.rowcount or 0)
