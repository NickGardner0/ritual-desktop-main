from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, Optional
import asyncio

from services.wearable_provider_pipeline import (
    ProviderFetchResult,
    SyncCheckpoint,
    SyncRequest,
    WearableIngestBatch,
    WearableIngestPipeline,
)


@dataclass
class MemoryCheckpointStore:
    checkpoints: Dict[tuple[str, str], SyncCheckpoint] = field(default_factory=dict)

    async def get_checkpoint(self, provider: str, user_id: str) -> Optional[SyncCheckpoint]:
        return self.checkpoints.get((provider, user_id))

    async def commit_checkpoint(self, checkpoint: SyncCheckpoint) -> None:
        self.checkpoints[(checkpoint.provider, checkpoint.user_id)] = checkpoint


@dataclass
class IdempotentSink:
    seen_keys: set[str] = field(default_factory=set)
    writes: list[WearableIngestBatch] = field(default_factory=list)

    async def write_batch(self, request: SyncRequest, batch: WearableIngestBatch) -> int:
        key = request.idempotency_key or f"{request.provider}:{request.user_id}:{len(self.writes)}"
        if key in self.seen_keys:
            return 0
        self.seen_keys.add(key)
        self.writes.append(batch)
        return len(batch.samples) + len(batch.events)


class StaticClient:
    def __init__(self, result: ProviderFetchResult) -> None:
        self.result = result
        self.calls: list[Optional[SyncCheckpoint]] = []

    async def fetch(self, request: SyncRequest, checkpoint: Optional[SyncCheckpoint]) -> ProviderFetchResult:
        del request
        self.calls.append(checkpoint)
        return self.result


class FlakyClient(StaticClient):
    def __init__(self, result: ProviderFetchResult) -> None:
        super().__init__(result)
        self.failed = False

    async def fetch(self, request: SyncRequest, checkpoint: Optional[SyncCheckpoint]) -> ProviderFetchResult:
        if not self.failed:
            self.failed = True
            raise RuntimeError("temporary provider outage")
        return await super().fetch(request, checkpoint)


class StaticTransformer:
    def transform(self, request: SyncRequest, fetch_result: ProviderFetchResult) -> WearableIngestBatch:
        samples = [
            {
                "provider": request.provider,
                "user_id": request.user_id,
                "metric_type": payload["metric_type"],
                "value": payload["value"],
            }
            for payload in fetch_result.raw_payloads
        ]
        return WearableIngestBatch(
            samples=samples,
            raw_payloads=fetch_result.raw_payloads,
            next_checkpoint=fetch_result.next_checkpoint,
        )


def test_pipeline_transforms_writes_and_commits_checkpoint():
    async def run_case():
        checkpoint = SyncCheckpoint(
            provider="oura",
            user_id="user_1",
            cursor="cursor_2",
            synced_through=datetime(2026, 5, 24, tzinfo=timezone.utc),
        )
        client = StaticClient(
            ProviderFetchResult(
                raw_payloads=[{"metric_type": "sleep", "value": 7.25}],
                next_checkpoint=checkpoint,
            )
        )
        store = MemoryCheckpointStore()
        sink = IdempotentSink()
        pipeline = WearableIngestPipeline(
            client=client,
            transformer=StaticTransformer(),
            checkpoint_store=store,
            sink=sink,
        )

        result = await pipeline.run(SyncRequest(provider="oura", user_id="user_1", idempotency_key="sync_1"))

        assert result.status == "success"
        assert result.items_seen == 1
        assert result.items_written == 1
        assert store.checkpoints[("oura", "user_1")] == checkpoint
        assert sink.writes[0].samples == [
            {"provider": "oura", "user_id": "user_1", "metric_type": "sleep", "value": 7.25}
        ]

    asyncio.run(run_case())


def test_pipeline_passes_prior_checkpoint_unless_forced_full_sync():
    async def run_case():
        prior = SyncCheckpoint(provider="whoop", user_id="user_1", cursor="cursor_1")
        store = MemoryCheckpointStore({("whoop", "user_1"): prior})
        client = StaticClient(ProviderFetchResult(raw_payloads=[]))
        pipeline = WearableIngestPipeline(
            client=client,
            transformer=StaticTransformer(),
            checkpoint_store=store,
            sink=IdempotentSink(),
        )

        await pipeline.run(SyncRequest(provider="whoop", user_id="user_1"))
        await pipeline.run(SyncRequest(provider="whoop", user_id="user_1", force_full_sync=True))

        assert client.calls == [prior, None]

    asyncio.run(run_case())


def test_pipeline_retries_transient_provider_failure():
    async def run_case():
        client = FlakyClient(ProviderFetchResult(raw_payloads=[{"metric_type": "strain", "value": 11}]))
        pipeline = WearableIngestPipeline(
            client=client,
            transformer=StaticTransformer(),
            checkpoint_store=MemoryCheckpointStore(),
            sink=IdempotentSink(),
            max_attempts=2,
        )

        result = await pipeline.run(SyncRequest(provider="whoop", user_id="user_1"))

        assert result.status == "success"
        assert result.attempts == 2
        assert result.items_written == 1

    asyncio.run(run_case())


def test_pipeline_sink_idempotency_prevents_duplicate_writes():
    async def run_case():
        sink = IdempotentSink()
        pipeline = WearableIngestPipeline(
            client=StaticClient(ProviderFetchResult(raw_payloads=[{"metric_type": "steps", "value": 1200}])),
            transformer=StaticTransformer(),
            checkpoint_store=MemoryCheckpointStore(),
            sink=sink,
        )
        request = SyncRequest(provider="apple_health", user_id="user_1", idempotency_key="event_1")

        first = await pipeline.run(request)
        second = await pipeline.run(request)

        assert first.items_written == 1
        assert second.items_written == 0
        assert len(sink.writes) == 1

    asyncio.run(run_case())
