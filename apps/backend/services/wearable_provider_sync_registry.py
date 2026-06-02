"""Provider sync dispatch for wearable integrations.

This keeps router code out of provider-specific sync details and gives every
provider sync path a single result contract.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Literal, Optional

from services.wearable_provider_service_pipeline import run_service_backed_provider_sync


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


ProviderSyncFn = Callable[
    [str, WearableProviderSyncServices, Optional[int], bool, bool],
    Awaitable[dict[str, Any]],
]
ProviderCountFn = Callable[[dict[str, Any]], int]


@dataclass(frozen=True)
class WearableProviderSyncAdapter:
    provider: str
    message: str
    sync: ProviderSyncFn
    count_items: ProviderCountFn


def _sum_numeric_values(values: dict[str, Any]) -> int:
    total = 0
    for value in values.values():
        try:
            total += int(value or 0)
        except (TypeError, ValueError):
            continue
    return total


def _dict_result(result: Any) -> dict[str, Any]:
    return result if isinstance(result, dict) else {"raw": result}


async def _sync_whoop(
    user_id: str,
    services: WearableProviderSyncServices,
    days_back: Optional[int],
    force_full_sync: bool,
    full_history: bool,
) -> dict[str, Any]:
    return _dict_result(
        await services.whoop_service.sync_whoop_data(
            user_id,
            days_back=days_back,
            force_full_sync=force_full_sync,
            full_history=full_history,
        )
    )


async def _sync_oura(
    user_id: str,
    services: WearableProviderSyncServices,
    days_back: Optional[int],
    force_full_sync: bool,
    full_history: bool,
) -> dict[str, Any]:
    del full_history
    return _dict_result(
        await services.oura_service.sync_oura_data(
            user_id,
            days_back=days_back,
            force_full_sync=force_full_sync,
        )
    )


async def _sync_garmin(
    user_id: str,
    services: WearableProviderSyncServices,
    days_back: Optional[int],
    force_full_sync: bool,
    full_history: bool,
) -> dict[str, Any]:
    del days_back, force_full_sync, full_history
    return _dict_result(await services.garmin_service.sync_garmin_account(user_id))


def _count_whoop_items(result: dict[str, Any]) -> int:
    data = result.get("data", {}) if isinstance(result.get("data", {}), dict) else {}
    return _sum_numeric_values(data)


def _count_oura_items(result: dict[str, Any]) -> int:
    data = result.get("data", {}) if isinstance(result.get("data", {}), dict) else {}
    return int(data.get("samples", 0) or 0) + int(data.get("events", 0) or 0)


def _count_garmin_items(result: dict[str, Any]) -> int:
    data = result.get("data", {}) if isinstance(result.get("data", {}), dict) else {}
    return 1 if data.get("permissions_loaded") else 0


PROVIDER_SYNC_ADAPTERS: dict[str, WearableProviderSyncAdapter] = {
    "whoop": WearableProviderSyncAdapter(
        provider="whoop",
        message="Whoop sync completed.",
        sync=_sync_whoop,
        count_items=_count_whoop_items,
    ),
    "oura": WearableProviderSyncAdapter(
        provider="oura",
        message="Oura sync completed.",
        sync=_sync_oura,
        count_items=_count_oura_items,
    ),
    "garmin": WearableProviderSyncAdapter(
        provider="garmin",
        message="Garmin account refreshed. Data ingestion is webhook-driven.",
        sync=_sync_garmin,
        count_items=_count_garmin_items,
    ),
}


def list_provider_sync_adapters() -> list[str]:
    return sorted(PROVIDER_SYNC_ADAPTERS)


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

    adapter = PROVIDER_SYNC_ADAPTERS.get(normalized_provider)
    if adapter is not None:
        async def run_provider_service() -> dict[str, Any]:
            return await adapter.sync(user_id, services, days_back, force_full_sync, full_history)

        provider_result = await run_service_backed_provider_sync(
            provider=adapter.provider,
            user_id=user_id,
            sync=run_provider_service,
            count_items=adapter.count_items,
            force_full_sync=force_full_sync,
        )
        if provider_result.ingest.status != "success":
            raise RuntimeError(provider_result.ingest.error or f"{adapter.provider} sync failed")

        return WearableProviderSyncResult(
            status="success",
            items_seen=provider_result.ingest.items_seen,
            items_written=provider_result.ingest.items_written,
            data=provider_result.data,
            message=adapter.message,
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
