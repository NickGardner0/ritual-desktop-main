from __future__ import annotations

import asyncio
import tempfile
import unittest
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock, patch
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from api.scheduler import create_scheduler_router
import background_tasks
from database.models import (
    Base,
    SchedulerOccurrenceClaimDB,
    UserDB,
    WearableIngestJobDB,
    WearableOutboxEventDB,
)
from services import scheduler_service as service_module
from services import wearable_event_outbox_service as outbox_module
from services import wearable_ingest_job_service as ingest_module
from services.scheduler_service import (
    SCHEDULER_JOB_DEFINITIONS,
    SchedulerRuntimeRegistry,
    normalize_scheduled_occurrence,
    resolve_hourly_delivery_occurrence,
    run_clock_job,
)
from services.wearable_event_outbox_service import WearableEventOutboxService
from services.wearable_ingest_job_service import WearableIngestJobService


class _RunningTask:
    def done(self) -> bool:
        return False


class SchedulerServiceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        db_path = Path(self._tmpdir.name) / "scheduler.db"
        self.engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
        self.Session = async_sessionmaker(self.engine, expire_on_commit=False)
        async with self.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with self.Session() as session:
            session.add(UserDB(id="scheduler-user", email="scheduler@example.com"))
            await session.commit()

        @asynccontextmanager
        async def test_session():
            async with self.Session() as session:
                try:
                    yield session
                except Exception:
                    await session.rollback()
                    raise

        self._original_get_db_session = service_module.get_db_session
        self._original_force_local_replica_sync = service_module.force_local_replica_sync
        self._original_ingest_session = ingest_module.get_db_session
        self._original_outbox_session = outbox_module.get_db_session
        service_module.get_db_session = test_session
        service_module.force_local_replica_sync = AsyncMock(return_value=False)
        ingest_module.get_db_session = test_session
        outbox_module.get_db_session = test_session
        service_module.scheduler_runtime.reset()

    async def asyncTearDown(self):
        service_module.get_db_session = self._original_get_db_session
        service_module.force_local_replica_sync = self._original_force_local_replica_sync
        ingest_module.get_db_session = self._original_ingest_session
        outbox_module.get_db_session = self._original_outbox_session
        service_module.scheduler_runtime.reset()
        await self.engine.dispose()
        self._tmpdir.cleanup()

    async def test_registry_contains_all_thirteen_named_owners(self):
        self.assertEqual(len(SCHEDULER_JOB_DEFINITIONS), 13)
        self.assertEqual(
            {item.job_key for item in SCHEDULER_JOB_DEFINITIONS},
            {
                "proactive_sms",
                "whoop_auto_sync",
                "oura_garmin_auto_sync",
                "tesla_odometer_sync",
                "financial_sync",
                "location_ping_retention",
                "habit_reports",
                "workflow_runs",
                "ambient_signals",
                "sms_copilot",
                "wearable_ingest",
                "wearable_maintenance",
                "wearable_event_outbox",
            },
        )
        self.assertEqual(
            {item.job_key for item in SCHEDULER_JOB_DEFINITIONS if item.mode == "queue_claim"},
            {"wearable_ingest", "wearable_event_outbox"},
        )

    async def test_normalization_is_stable_inside_one_cadence(self):
        first = normalize_scheduled_occurrence(
            "proactive_sms", datetime(2026, 8, 22, 10, 1, tzinfo=timezone.utc)
        )
        second = normalize_scheduled_occurrence(
            "proactive_sms", datetime(2026, 8, 22, 10, 59, tzinfo=timezone.utc)
        )
        self.assertEqual(first, second)
        self.assertEqual(first.minute, 0)

    async def test_explicit_delivery_hour_resolves_to_nearest_past_occurrence(self):
        now = datetime(2026, 8, 22, 2, 15, tzinfo=timezone.utc)
        same_day = resolve_hourly_delivery_occurrence(1, now)
        prior_day = resolve_hourly_delivery_occurrence(23, now)
        self.assertEqual(same_day, datetime(2026, 8, 22, 1, 0, tzinfo=timezone.utc))
        self.assertEqual(prior_day, datetime(2026, 8, 21, 23, 0, tzinfo=timezone.utc))
        with self.assertRaisesRegex(ValueError, "hour must be between 0 and 23"):
            resolve_hourly_delivery_occurrence(24, now)

    async def test_duplicate_occurrence_runs_domain_effect_once(self):
        started = asyncio.Event()
        release = asyncio.Event()
        effects = 0
        occurrence = datetime(2026, 8, 22, 10, 5, tzinfo=timezone.utc)

        async def work():
            nonlocal effects
            effects += 1
            started.set()
            await release.wait()
            return {"effects": effects}

        first_task = asyncio.create_task(run_clock_job("proactive_sms", work, now=occurrence))
        await started.wait()
        duplicate = await run_clock_job("proactive_sms", work, now=occurrence)
        active_duplicate_state = service_module.scheduler_runtime.states["proactive_sms"]
        self.assertIsNone(active_duplicate_state.last_successful_at)
        self.assertEqual(active_duplicate_state.lease_state, "duplicate")
        release.set()
        first = await first_task

        self.assertEqual(first.status, "completed")
        self.assertEqual(duplicate.status, "duplicate")
        self.assertEqual(effects, 1)
        async with self.Session() as session:
            count = await session.scalar(select(func.count(SchedulerOccurrenceClaimDB.id)))
            row = (await session.execute(select(SchedulerOccurrenceClaimDB))).scalar_one()
        self.assertEqual(count, 1)
        self.assertEqual(row.status, "succeeded")
        self.assertEqual(row.attempt_count, 1)

    async def test_turso_value_error_duplicate_is_read_from_winning_claim(self):
        occurrence = datetime(2026, 8, 22, 10, 5, tzinfo=timezone.utc)
        first = await run_clock_job(
            "proactive_sms",
            lambda: asyncio.sleep(0, result={"effects": 1}),
            now=occurrence,
        )
        self.assertEqual(first.status, "completed")

        base_get_db_session = service_module.get_db_session

        class TursoSessionProxy:
            def __init__(self, session):
                self._session = session

            def __getattr__(self, name):
                return getattr(self._session, name)

            async def commit(self):
                try:
                    await self._session.commit()
                except IntegrityError as error:
                    raise ValueError(
                        "Hrana: SQLite error: UNIQUE constraint failed: "
                        "scheduler_occurrence_claims.job_key, "
                        "scheduler_occurrence_claims.scope_key, "
                        "scheduler_occurrence_claims.scheduled_for"
                    ) from error

        @asynccontextmanager
        async def turso_session():
            async with base_get_db_session() as session:
                yield TursoSessionProxy(session)

        work = AsyncMock(return_value={"effects": 2})
        service_module.scheduler_runtime.reset()
        service_module.get_db_session = turso_session
        duplicate = await run_clock_job("proactive_sms", work, now=occurrence)

        self.assertEqual(duplicate.status, "duplicate")
        work.assert_not_awaited()
        service_module.force_local_replica_sync.assert_awaited()
        runtime = service_module.scheduler_runtime.states["proactive_sms"]
        self.assertIsNotNone(runtime.last_successful_at)
        self.assertEqual(runtime.lease_state, "duplicate_completed")

    async def test_occurrence_conflict_classifier_rejects_unrelated_errors(self):
        self.assertTrue(
            service_module._is_occurrence_unique_conflict(
                ValueError(
                    "UNIQUE constraint failed: scheduler_occurrence_claims.job_key, "
                    "scheduler_occurrence_claims.scope_key, "
                    "scheduler_occurrence_claims.scheduled_for"
                )
            )
        )
        self.assertFalse(
            service_module._is_occurrence_unique_conflict(
                ValueError("UNIQUE constraint failed: scheduler_occurrence_claims.id")
            )
        )
        self.assertFalse(
            service_module._is_occurrence_unique_conflict(ValueError("driver disconnected"))
        )

    async def test_failed_occurrence_retries_same_identity(self):
        occurrence = datetime(2026, 8, 22, 12, 7, tzinfo=timezone.utc)

        async def fail():
            raise RuntimeError("temporary outage")

        with self.assertRaisesRegex(RuntimeError, "temporary outage"):
            await run_clock_job("habit_reports", fail, now=occurrence)
        retry = await run_clock_job("habit_reports", lambda: asyncio.sleep(0, result="ok"), now=occurrence)
        self.assertEqual(retry.status, "completed")
        async with self.Session() as session:
            rows = list((await session.execute(select(SchedulerOccurrenceClaimDB))).scalars())
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].status, "succeeded")
        self.assertEqual(rows[0].attempt_count, 2)

    async def test_stale_external_proactive_delivery_uses_internal_occurrence_claim(self):
        occurrence = datetime(2026, 8, 22, 14, 10, tzinfo=timezone.utc)
        work = AsyncMock(return_value=[{"sent": 1}])
        with patch.object(background_tasks, "_run_proactive_sms", work):
            internal = await background_tasks.run_proactive_sms_scheduler_job(now=occurrence)
            stale_external = await background_tasks.run_proactive_sms_scheduler_job(now=occurrence)
        self.assertEqual(internal.status, "completed")
        self.assertEqual(stale_external.status, "duplicate")
        work.assert_awaited_once_with("all", None)

    async def test_retained_sync_deliveries_share_internal_occurrence_claims(self):
        occurrence = datetime(2026, 8, 22, 14, 10, tzinfo=timezone.utc)
        cases = (
            (
                lambda work: background_tasks.run_whoop_scheduler_job(work, now=occurrence),
                "whoop_auto_sync",
                "global",
            ),
            (
                lambda work: background_tasks.run_oura_garmin_scheduler_job(
                    "oura", work, now=occurrence
                ),
                "oura_garmin_auto_sync",
                "provider:oura",
            ),
            (
                lambda work: background_tasks.run_oura_garmin_scheduler_job(
                    "garmin", work, now=occurrence
                ),
                "oura_garmin_auto_sync",
                "provider:garmin",
            ),
            (
                lambda work: background_tasks.run_tesla_scheduler_job(work, now=occurrence),
                "tesla_odometer_sync",
                "global",
            ),
            (
                lambda work: background_tasks.run_financial_scheduler_job(work, now=occurrence),
                "financial_sync",
                "global",
            ),
        )
        for run_delivery, job_key, scope_key in cases:
            with self.subTest(job_key=job_key, scope_key=scope_key):
                work = AsyncMock(return_value={"mutations": 1})
                internal = await run_delivery(work)
                stale_external = await run_delivery(work)
                self.assertEqual(internal.status, "completed")
                self.assertEqual(internal.job_key, job_key)
                self.assertEqual(internal.scope_key, scope_key)
                self.assertEqual(stale_external.status, "duplicate")
                work.assert_awaited_once()

    async def test_trigger_era_endpoints_call_occurrence_fenced_owners(self):
        backend_root = Path(__file__).resolve().parent.parent
        source_expectations = {
            "api/integrations.py": {
                "run_whoop_scheduler_job",
                "run_tesla_scheduler_job",
            },
            "api/financial.py": {"run_financial_scheduler_job"},
            "api/wearables_routes/sync_runs.py": {
                "run_whoop_scheduler_job",
                "run_oura_garmin_scheduler_job",
            },
            "api/proactive_sms.py": {"run_proactive_sms_scheduler_job"},
        }
        for relative_path, expected_fragments in source_expectations.items():
            source = (backend_root / relative_path).read_text()
            for fragment in expected_fragments:
                self.assertIn(fragment, source, f"{relative_path} bypasses {fragment}")

    async def test_readiness_degrades_when_an_enabled_loop_is_absent(self):
        registry = SchedulerRuntimeRegistry()
        registry.configure(True)
        for definition in SCHEDULER_JOB_DEFINITIONS:
            registry.register_loop(definition.loop_key, [definition.job_key])
        tasks = {item.loop_key: _RunningTask() for item in SCHEDULER_JOB_DEFINITIONS}
        self.assertEqual(registry.readiness_snapshot(tasks)["status"], "ready")
        tasks.pop("hourly_domain")
        snapshot = registry.readiness_snapshot(tasks)
        self.assertEqual(snapshot["status"], "degraded")
        self.assertEqual(snapshot["missingLoops"], ["hourly_domain"])

    async def test_health_requires_a_recent_success_from_every_owner(self):
        registry = SchedulerRuntimeRegistry()
        registry.configure(True)
        tasks = {}
        for definition in SCHEDULER_JOB_DEFINITIONS:
            registry.register_loop(definition.loop_key, [definition.job_key])
            tasks[definition.loop_key] = _RunningTask()
        starting = await registry.health_snapshot(tasks)
        self.assertEqual(starting["status"], "starting")
        self.assertEqual(len(starting["neverSucceeded"]), 13)
        for definition in SCHEDULER_JOB_DEFINITIONS:
            started = registry.record_attempt(definition.job_key, lease_state="test")
            registry.record_success(definition.job_key, started)
        healthy = await registry.health_snapshot(tasks)
        self.assertEqual(healthy["status"], "healthy")
        self.assertEqual(healthy["neverSucceeded"], [])
        self.assertEqual(healthy["overlappingLeases"], [])

    async def test_wearable_ingest_duplicate_delivery_reaches_one_row_claim(self):
        async with self.Session() as session:
            session.add(
                WearableIngestJobDB(
                    id="ingest-claim",
                    user_id="scheduler-user",
                    provider="whoop",
                    job_type="provider_backfill",
                    trigger="scheduled",
                    status="queued",
                    attempts=0,
                )
            )
            await session.commit()
        service = WearableIngestJobService()
        first = await service.claim_next_job()
        duplicate = await service.claim_next_job()
        self.assertEqual(first.id, "ingest-claim")
        self.assertIsNone(duplicate)
        self.assertEqual(first.status, "running")
        self.assertEqual(first.attempts, 1)

    async def test_wearable_outbox_duplicate_delivery_reaches_one_row_claim(self):
        now = datetime.now(timezone.utc)
        async with self.Session() as session:
            session.add(
                WearableOutboxEventDB(
                    id="outbox-claim",
                    user_id="scheduler-user",
                    provider="whoop",
                    event_type="sleep_session_ingested",
                    related_record_kind="event",
                    related_record_id="sleep-1",
                    status="queued",
                    available_at=now,
                    attempts=0,
                )
            )
            await session.commit()
        service = WearableEventOutboxService()
        first = await service.claim_next_event()
        duplicate = await service.claim_next_event()
        self.assertEqual(first.id, "outbox-claim")
        self.assertIsNone(duplicate)
        self.assertEqual(first.status, "running")
        self.assertEqual(first.attempts, 1)


class SchedulerHealthApiTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.state.scheduler_tasks = {}
        app.include_router(create_scheduler_router())
        self.client = TestClient(app)

    def test_health_requires_internal_token(self):
        with patch("api.scheduler.INTERNAL_BACKEND_TOKEN", "secret"):
            response = self.client.get("/api/internal/scheduler/health")
        self.assertEqual(response.status_code, 401)

    def test_health_is_non_200_until_all_jobs_are_current(self):
        snapshot = {"status": "starting", "enabled": True, "jobs": []}
        with (
            patch("api.scheduler.INTERNAL_BACKEND_TOKEN", "secret"),
            patch.object(service_module.scheduler_runtime, "health_snapshot", AsyncMock(return_value=snapshot)),
        ):
            response = self.client.get(
                "/api/internal/scheduler/health",
                headers={"x-backend-token": "secret"},
            )
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["status"], "starting")


if __name__ == "__main__":
    unittest.main()
