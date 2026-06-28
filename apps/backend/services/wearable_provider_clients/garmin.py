"""Garmin provider client and transformer."""

from __future__ import annotations

from typing import Any

from services.garmin_account_payload import fetch_garmin_account_payload
from services.wearable_provider_clients.base import ProviderFetchRequest, ProviderPayload


class GarminProviderClient:
    """Refreshes Garmin account metadata; data ingest is webhook-driven."""

    def __init__(self, service: Any) -> None:
        self._service = service

    async def fetch(self, request: ProviderFetchRequest) -> ProviderPayload:
        if hasattr(self._service, "fetch_garmin_account_payload"):
            payload = await self._service.fetch_garmin_account_payload(request.user_id)
        else:
            payload = await fetch_garmin_account_payload(self._service, request.user_id)
        payload = payload if isinstance(payload, dict) else {"raw": payload}
        return ProviderPayload(
            provider="garmin",
            payload=payload,
            upstream_count=1 if payload.get("permissions") else 0,
        )


class GarminProviderTransformer:
    """Normalizes fetched Garmin account payloads for canonical ingest."""

    def to_canonical_payload(self, fetched: ProviderPayload) -> dict[str, Any]:
        payload = dict(fetched.payload)
        payload.setdefault("provider", "garmin")
        return payload
