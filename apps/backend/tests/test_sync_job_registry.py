import asyncio

import pytest

from services.sync_job_registry import SyncJobDefinition, SyncJobRegistry


async def processor(payload):
    return {"ok": True, "user_id": payload["user_id"]}


def test_registry_rejects_duplicate_job_names():
    registry = SyncJobRegistry()
    job = SyncJobDefinition(
        name="wearables.sync",
        owner="wearables",
        schedule="hourly:wearables",
        idempotency_key_template="wearables:{user_id}:{day}",
        processor=processor,
    )
    registry.register(job)

    with pytest.raises(ValueError, match="already registered"):
        registry.register(job)


def test_registry_rejects_duplicate_schedule_owners():
    registry = SyncJobRegistry()
    registry.register(
        SyncJobDefinition(
            name="wearables.sync",
            owner="wearables",
            schedule="hourly:wearables",
            idempotency_key_template="wearables:{user_id}:{day}",
            processor=processor,
        )
    )

    with pytest.raises(ValueError, match="already owned"):
        registry.register(
            SyncJobDefinition(
                name="watcher.sync",
                owner="desktop",
                schedule="hourly:wearables",
                idempotency_key_template="watcher:{user_id}:{day}",
                processor=processor,
            )
        )


def test_registry_runs_processor_with_idempotency_key():
    async def run_case():
        registry = SyncJobRegistry()
        registry.register(
            SyncJobDefinition(
                name="wearables.sync",
                owner="wearables",
                schedule=None,
                idempotency_key_template="wearables:{user_id}:{day}",
                processor=processor,
            )
        )

        result = await registry.run("wearables.sync", {"user_id": "user_1", "day": "2026-05-24"})

        assert result == {
            "job": "wearables.sync",
            "owner": "wearables",
            "idempotency_key": "wearables:user_1:2026-05-24",
            "status": "success",
            "attempts": 1,
            "result": {"ok": True, "user_id": "user_1"},
        }

    asyncio.run(run_case())


def test_idempotency_key_requires_payload_fields():
    job = SyncJobDefinition(
        name="wearables.sync",
        owner="wearables",
        schedule=None,
        idempotency_key_template="wearables:{user_id}:{day}",
        processor=processor,
    )

    with pytest.raises(ValueError, match="Missing idempotency payload field"):
        job.idempotency_key({"user_id": "user_1"})


def test_registry_retries_transient_processor_failures():
    async def run_case():
        calls = 0

        async def flaky(payload):
            nonlocal calls
            calls += 1
            if calls == 1:
                raise RuntimeError("temporary backend outage")
            return {"ok": True, "attempt": calls, "user_id": payload["user_id"]}

        registry = SyncJobRegistry()
        registry.register(
            SyncJobDefinition(
                name="wearables.sync",
                owner="wearables",
                schedule=None,
                idempotency_key_template="wearables:{user_id}:{day}",
                processor=flaky,
                max_attempts=2,
            )
        )

        result = await registry.run("wearables.sync", {"user_id": "user_1", "day": "2026-05-24"})

        assert result["status"] == "success"
        assert result["attempts"] == 2
        assert result["result"]["attempt"] == 2
        assert registry.list_dead_letters() == []

    asyncio.run(run_case())


def test_registry_dead_letters_after_retry_exhaustion():
    async def run_case():
        async def failing(_payload):
            raise RuntimeError("provider unavailable")

        registry = SyncJobRegistry()
        registry.register(
            SyncJobDefinition(
                name="wearables.sync",
                owner="wearables",
                schedule=None,
                idempotency_key_template="wearables:{user_id}:{day}",
                processor=failing,
                max_attempts=2,
            )
        )

        result = await registry.run("wearables.sync", {"user_id": "user_1", "day": "2026-05-24"})

        assert result == {
            "job": "wearables.sync",
            "owner": "wearables",
            "idempotency_key": "wearables:user_1:2026-05-24",
            "status": "failed",
            "attempts": 2,
            "error": "provider unavailable",
            "dead_lettered": True,
        }
        assert registry.list_dead_letters() == [
            {
                "job": "wearables.sync",
                "owner": "wearables",
                "idempotency_key": "wearables:user_1:2026-05-24",
                "payload": {"user_id": "user_1", "day": "2026-05-24"},
                "error": "provider unavailable",
                "attempts": 2,
            }
        ]

    asyncio.run(run_case())


def test_registry_rejects_overlapping_runs_with_same_idempotency_key():
    async def run_case():
        started = asyncio.Event()
        release = asyncio.Event()

        async def slow_processor(payload):
            started.set()
            await release.wait()
            return {"ok": True, "user_id": payload["user_id"]}

        registry = SyncJobRegistry()
        registry.register(
            SyncJobDefinition(
                name="wearables.sync",
                owner="wearables",
                schedule=None,
                idempotency_key_template="wearables:{user_id}:{day}",
                processor=slow_processor,
            )
        )

        payload = {"user_id": "user_1", "day": "2026-05-24"}
        first_run = asyncio.create_task(registry.run("wearables.sync", payload))
        await started.wait()

        with pytest.raises(ValueError, match="already running"):
            await registry.run("wearables.sync", payload)

        release.set()
        await first_run

    asyncio.run(run_case())
