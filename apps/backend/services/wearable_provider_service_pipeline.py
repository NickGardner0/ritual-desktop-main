"""Service-backed provider sync adapters.

Whoop, Oura, and Garmin still contain provider-specific API details. This
module gives those services the same client/transformer/sink boundary as the
new ingest pipeline so orchestration code no longer calls provider services
directly.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Optional

from services.wearable_provider_pipeline import (
    ProviderFetchResult,
    SyncCheckpoint,
    SyncCheckpointStore,
    SyncRequest,
    WearableIngestBatch,
    WearableIngestPipeline,
    WearableIngestResult,
)


ProviderServiceSyncFn = Callable[[], Awaitable[dict[str, Any]]]
ProviderServiceCountFn = Callable[[dict[str, Any]], int]


def _dict_result(result: Any) -> dict[str, Any]:
    return result if isinstance(result, dict) else {"raw": result}


@dataclass(frozen=True)
class ServiceBackedProviderSyncResult:
    ingest: WearableIngestResult
    data: dict[str, Any]


class NoopCheckpointStore(SyncCheckpointStore):
    async def get_checkpoint(self, provider: str, user_id: str) -> Optional[SyncCheckpoint]:
        del provider, user_id
        return None

    async def commit_checkpoint(self, checkpoint: SyncCheckpoint) -> None:
        del checkpoint


class ServiceBackedProviderClient:
    def __init__(self, *, provider: str, sync: ProviderServiceSyncFn) -> None:
        self._provider = provider
        self._sync = sync
        self.last_result: dict[str, Any] = {}

    async def fetch(self, request: SyncRequest, checkpoint: Optional[SyncCheckpoint]) -> ProviderFetchResult:
        del checkpoint
        result = _dict_result(await self._sync())
        self.last_result = result
        return ProviderFetchResult(
            raw_payloads=[
                {
                    "provider": self._provider,
                    "user_id": request.user_id,
                    "result": result,
                }
            ],
        )


class ProviderResultTransformer:
    def __init__(self, *, count_items: ProviderServiceCountFn) -> None:
        self._count_items = count_items

    def transform(self, request: SyncRequest, fetch_result: ProviderFetchResult) -> WearableIngestBatch:
        del request
        payload = fetch_result.raw_payloads[0] if fetch_result.raw_payloads else {}
        result = _dict_result(payload.get("result", {}))
        items_seen = self._count_items(result)
        return WearableIngestBatch(
            raw_payloads=fetch_result.raw_payloads,
            items_seen=items_seen,
        )


class AlreadyPersistedProviderSink:
    async def write_batch(self, request: SyncRequest, batch: WearableIngestBatch) -> int:
        del request
        return int(batch.items_seen or 0)


async def run_service_backed_provider_sync(
    *,
    provider: str,
    user_id: str,
    sync: ProviderServiceSyncFn,
    count_items: ProviderServiceCountFn,
    force_full_sync: bool = False,
    max_attempts: int = 1,
) -> ServiceBackedProviderSyncResult:
    client = ServiceBackedProviderClient(provider=provider, sync=sync)
    pipeline = WearableIngestPipeline(
        client=client,
        transformer=ProviderResultTransformer(count_items=count_items),
        checkpoint_store=NoopCheckpointStore(),
        sink=AlreadyPersistedProviderSink(),
        max_attempts=max_attempts,
    )
    ingest = await pipeline.run(
        SyncRequest(
            provider=provider,
            user_id=user_id,
            force_full_sync=force_full_sync,
            idempotency_key=f"{provider}:{user_id}:service-backed-sync",
        )
    )
    return ServiceBackedProviderSyncResult(ingest=ingest, data=client.last_result)
