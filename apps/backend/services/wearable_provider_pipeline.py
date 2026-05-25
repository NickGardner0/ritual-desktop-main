"""Provider-neutral wearable ingest pipeline contracts.

The current provider services still own their API-specific fetch/write logic.
This module defines the boundary they should migrate behind: provider clients
fetch raw records, transformers normalize them, checkpoint stores own cursor
state, and sinks persist idempotent batches.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional, Protocol


@dataclass(frozen=True)
class SyncCheckpoint:
    provider: str
    user_id: str
    cursor: Optional[str] = None
    synced_through: Optional[datetime] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class SyncRequest:
    provider: str
    user_id: str
    start_at: Optional[datetime] = None
    end_at: Optional[datetime] = None
    force_full_sync: bool = False
    idempotency_key: Optional[str] = None


@dataclass(frozen=True)
class ProviderFetchResult:
    raw_payloads: List[Dict[str, Any]]
    next_checkpoint: Optional[SyncCheckpoint] = None


@dataclass(frozen=True)
class WearableIngestBatch:
    samples: List[Dict[str, Any]] = field(default_factory=list)
    events: List[Dict[str, Any]] = field(default_factory=list)
    raw_payloads: List[Dict[str, Any]] = field(default_factory=list)
    next_checkpoint: Optional[SyncCheckpoint] = None
    items_seen: Optional[int] = None


@dataclass(frozen=True)
class WearableIngestResult:
    status: str
    attempts: int
    items_seen: int
    items_written: int
    checkpoint: Optional[SyncCheckpoint] = None
    error: Optional[str] = None


class ProviderClient(Protocol):
    async def fetch(self, request: SyncRequest, checkpoint: Optional[SyncCheckpoint]) -> ProviderFetchResult:
        """Fetch provider-specific raw records for a sync request."""


class ProviderTransformer(Protocol):
    def transform(self, request: SyncRequest, fetch_result: ProviderFetchResult) -> WearableIngestBatch:
        """Transform provider-specific raw records into normalized ingest records."""


class SyncCheckpointStore(Protocol):
    async def get_checkpoint(self, provider: str, user_id: str) -> Optional[SyncCheckpoint]:
        """Return the last durable checkpoint for a provider/user."""

    async def commit_checkpoint(self, checkpoint: SyncCheckpoint) -> None:
        """Commit the next checkpoint after the ingest sink has written records."""


class WearableIngestSink(Protocol):
    async def write_batch(self, request: SyncRequest, batch: WearableIngestBatch) -> int:
        """Persist a normalized batch idempotently and return written item count."""


class WearableIngestPipeline:
    def __init__(
        self,
        *,
        client: ProviderClient,
        transformer: ProviderTransformer,
        checkpoint_store: SyncCheckpointStore,
        sink: WearableIngestSink,
        max_attempts: int = 2,
    ) -> None:
        if max_attempts < 1:
            raise ValueError("max_attempts must be at least 1")
        self._client = client
        self._transformer = transformer
        self._checkpoint_store = checkpoint_store
        self._sink = sink
        self._max_attempts = max_attempts

    async def run(self, request: SyncRequest) -> WearableIngestResult:
        checkpoint = None if request.force_full_sync else await self._checkpoint_store.get_checkpoint(
            request.provider,
            request.user_id,
        )
        last_error: Optional[str] = None

        for attempt in range(1, self._max_attempts + 1):
            try:
                fetch_result = await self._client.fetch(request, checkpoint)
                batch = self._transformer.transform(request, fetch_result)
                items_seen = batch.items_seen
                if items_seen is None:
                    items_seen = len(batch.samples) + len(batch.events)
                items_written = await self._sink.write_batch(request, batch)
                next_checkpoint = batch.next_checkpoint or fetch_result.next_checkpoint
                if next_checkpoint:
                    await self._checkpoint_store.commit_checkpoint(next_checkpoint)
                return WearableIngestResult(
                    status="success",
                    attempts=attempt,
                    items_seen=items_seen,
                    items_written=items_written,
                    checkpoint=next_checkpoint,
                )
            except Exception as exc:
                last_error = str(exc)
                if attempt < self._max_attempts:
                    await asyncio.sleep(0)

        return WearableIngestResult(
            status="failed",
            attempts=self._max_attempts,
            items_seen=0,
            items_written=0,
            checkpoint=checkpoint,
            error=last_error,
        )
