"""Provider sync dispatch for wearable integrations.

This keeps router code out of provider-specific sync details and gives every
provider sync path a single result contract.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal, Optional

from services.wearable_provider_strategies import (
    PROVIDER_STRATEGIES,
    list_provider_strategies,
    sync_provider_with_strategy,
)


SyncStatus = Literal["success", "partial"]


@dataclass(frozen=True)
class WearableProviderSyncResult:
    status: SyncStatus
    items_seen: int
    items_written: int
    message: str
    data: dict[str, Any]
    error: Optional[dict[str, Any]] = None


@dataclass(frozen=True)
class WearableProviderSyncServices:
    whoop_service: Any
    oura_service: Any
    garmin_service: Any


def list_provider_sync_adapters() -> list[str]:
    return list_provider_strategies()


async def sync_wearable_provider_account(
    *,
    provider: str,
    user_id: str,
    services: WearableProviderSyncServices,
    days_back: Optional[int] = None,
    force_full_sync: bool = False,
    full_history: bool = False,
    unsupported_as_partial: bool = True,
) -> WearableProviderSyncResult:
    normalized_provider = provider.strip().lower()

    if normalized_provider == "apple_health":
        return WearableProviderSyncResult(
            status="success",
            items_seen=0,
            items_written=0,
            data={},
            message="Apple Health sync uses the iOS companion background ingest pipeline.",
        )

    if normalized_provider in PROVIDER_STRATEGIES:
        provider_result = await sync_provider_with_strategy(
            provider=normalized_provider,
            user_id=user_id,
            services=services,
            days_back=days_back,
            force_full_sync=force_full_sync,
            full_history=full_history,
        )
        if provider_result.status in {"retryable_failed", "terminal_failed"}:
            raise RuntimeError(
                (provider_result.error or {}).get("message")
                or f"{normalized_provider} sync failed"
            )

        return WearableProviderSyncResult(
            status="success" if provider_result.status == "success" else "partial",
            items_seen=provider_result.items_seen,
            items_written=provider_result.items_written,
            data=provider_result.data,
            message=provider_result.message,
            error=provider_result.error,
        )

    message = f"{normalized_provider.title()} connection exists, but cloud sync is not configured in this environment yet."
    error = {"message": f"{normalized_provider} cloud sync is scaffolded but not configured in this environment."}
    if not unsupported_as_partial:
        raise ValueError(error["message"])
    return WearableProviderSyncResult(
        status="partial",
        items_seen=0,
        items_written=0,
        data={},
        message=message,
        error=error,
    )
