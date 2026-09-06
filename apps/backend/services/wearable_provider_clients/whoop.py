"""Whoop provider client and transformer."""

from __future__ import annotations

from typing import Any

from services.wearable_provider_clients.base import ProviderFetchRequest, ProviderPayload
from services.whoop_sync_payload import fetch_whoop_sync_payload


def _count_whoop_payload(payload: dict[str, Any]) -> int:
    synced_data = payload.get("synced_data")
    if not isinstance(synced_data, dict):
        return 0
    total = 0
    for value in synced_data.values():
        try:
            total += int(value or 0)
        except (TypeError, ValueError):
            continue
    return total


class WhoopProviderClient:
    """Fetches Whoop API payloads; it does not persist or project data."""

    def __init__(self, service: Any) -> None:
        self._service = service

    async def fetch(self, request: ProviderFetchRequest) -> ProviderPayload:
        if hasattr(self._service, "fetch_whoop_sync_payload"):
            payload = await self._service.fetch_whoop_sync_payload(
                request.user_id,
                days_back=request.days_back,
                force_full_sync=request.force_full_sync,
                full_history=request.full_history,
            )
        else:
            payload = await fetch_whoop_sync_payload(
                self._service,
                request.user_id,
                days_back=request.days_back,
                force_full_sync=request.force_full_sync,
                full_history=request.full_history,
            )
        payload = payload if isinstance(payload, dict) else {"raw": payload}
        return ProviderPayload(
            provider="whoop",
            payload=payload,
            upstream_count=_count_whoop_payload(payload),
        )


class WhoopProviderTransformer:
    """Normalizes fetched Whoop payloads for canonical ingest."""

    def to_canonical_payload(self, fetched: ProviderPayload) -> dict[str, Any]:
        payload = dict(fetched.payload)
        payload.setdefault("provider", "whoop")
        return payload
