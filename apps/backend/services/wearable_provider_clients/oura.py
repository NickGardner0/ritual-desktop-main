"""Oura provider client and transformer."""

from __future__ import annotations

from typing import Any

from services.oura_sync_payload import fetch_oura_sync_payload
from services.wearable_provider_clients.base import ProviderFetchRequest, ProviderPayload


def _count_oura_payload(payload: dict[str, Any]) -> int:
    total = 0
    for key in (
        "daily_sleep_records",
        "sleep_records",
        "daily_readiness_records",
        "daily_activity_records",
        "workout_records",
        "heartrate_records",
    ):
        value = payload.get(key)
        if isinstance(value, list):
            total += len(value)
    return total


class OuraProviderClient:
    """Fetches Oura API payloads; persistence remains in canonical ingest."""

    def __init__(self, service: Any) -> None:
        self._service = service

    async def fetch(self, request: ProviderFetchRequest) -> ProviderPayload:
        if hasattr(self._service, "fetch_oura_sync_payload"):
            payload = await self._service.fetch_oura_sync_payload(
                request.user_id,
                days_back=request.days_back,
                force_full_sync=request.force_full_sync,
            )
        else:
            payload = await fetch_oura_sync_payload(
                self._service,
                request.user_id,
                days_back=request.days_back,
                force_full_sync=request.force_full_sync,
            )
        payload = payload if isinstance(payload, dict) else {"raw": payload}
        return ProviderPayload(
            provider="oura",
            payload=payload,
            upstream_count=_count_oura_payload(payload),
        )


class OuraProviderTransformer:
    """Normalizes fetched Oura payloads for canonical ingest."""

    def to_canonical_payload(self, fetched: ProviderPayload) -> dict[str, Any]:
        payload = dict(fetched.payload)
        payload.setdefault("provider", "oura")
        return payload
