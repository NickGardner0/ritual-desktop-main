"""Dependency bundle for split wearable route modules."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Awaitable, Callable, Literal, Mapping, Optional, Protocol


class RouteLimiter(Protocol):
    def limit(self, limit_value: str) -> Callable[[Callable[..., object]], Callable[..., object]]: ...


class AppleIngestResultLike(Protocol):
    outcome: Literal["accepted", "duplicate", "rejected"]
    success: bool
    error: Optional[str]
    error_code: Optional[str]
    results: list[object]


class AppleIngestResultV2Like(Protocol):
    outcome: Literal["accepted", "duplicate", "rejected"]
    success: bool
    error: Optional[str]
    error_code: Optional[str]
    added_results: list[object]
    deleted_results: list[object]
    modified_results: list[object]


class WearableAppleIngest(Protocol):
    async def process_ingest_request(self, user_id: str, request: object) -> AppleIngestResultLike: ...
    async def process_ingest_request_v2(
        self,
        user_id: str,
        request: object,
    ) -> AppleIngestResultV2Like: ...


class WearableDeviceSecurity(Protocol):
    async def register_device(
        self,
        user_id: str,
        device_name: str,
        platform: str,
        *,
        provider: str = "apple_health",
        create_connection: bool = True,
    ) -> tuple[str, str]: ...

    async def list_devices(self, user_id: str, provider: Optional[str] = None) -> list[object]: ...
    async def deactivate_device(self, device_id: str, user_id: str) -> bool: ...
    async def get_device_sync_status(self, device_id: str, user_id: str) -> Optional[dict[str, object]]: ...


class WhoopProviderService(Protocol):
    async def exchange_code_for_token(self, code: str) -> dict[str, object]: ...
    async def get_whoop_user_info(self, access_token: str) -> dict[str, object]: ...
    async def save_integration(self, *args: object, **kwargs: object) -> object: ...
    async def disconnect_integration(self, user_id: str) -> object: ...


class OuraProviderService(Protocol):
    async def exchange_code_for_token(self, code: str) -> dict[str, object]: ...
    async def get_personal_info(self, access_token: str) -> dict[str, object]: ...


class GarminProviderService(Protocol):
    async def exchange_code_for_token(self, code: str, code_verifier: str) -> dict[str, object]: ...
    async def get_user_id(self, access_token: str) -> str: ...
    async def get_permissions(self, access_token: str) -> list[object]: ...
    async def ingest_webhook_payload(self, payload: object) -> object: ...


class WearableConnectionReader(Protocol):
    async def list_connections(self, user_id: str) -> list[dict[str, object]]: ...
    async def get_connection(self, user_id: str, provider: str) -> Optional[object]: ...
    async def get_or_create_connection(self, **kwargs: object) -> object: ...
    async def disconnect(self, user_id: str, provider: str) -> Optional[object]: ...


class WearableProjectionReader(Protocol):
    async def get_projection_policy(self, user_id: str, provider: str) -> Optional[object]: ...
    async def update_projection_policy(self, **kwargs: object) -> object: ...


class WearableQueryReader(Protocol):
    async def get_samples(self, **kwargs: object) -> list[object]: ...
    async def get_timeline(self, **kwargs: object) -> tuple[list[object], Optional[str]]: ...
    async def get_series(self, **kwargs: object) -> list[object]: ...
    async def get_daily_totals(self, **kwargs: object) -> list[object]: ...
    async def get_events(self, **kwargs: object) -> list[object]: ...
    async def get_sync_runs(self, **kwargs: object) -> list[object]: ...


class WearableSyncRunner(Protocol):
    async def start_sync_run(self, **kwargs: object) -> object: ...
    async def finish_sync_run(self, run_id: str, **kwargs: object) -> object: ...
    async def list_raw_payloads(self, **kwargs: object) -> list[object]: ...


class WearableEventOutbox(Protocol):
    async def list_events(self, **kwargs: object) -> list[object]: ...
    async def get_event(self, event_id: str) -> Optional[object]: ...


class WearableIngestJobQueue(Protocol):
    async def enqueue_backfill_job(self, **kwargs: object) -> object: ...
    async def enqueue_raw_payload_replay(self, **kwargs: object) -> object: ...
    async def list_jobs(self, **kwargs: object) -> list[object]: ...
    async def get_job(self, job_id: str) -> Optional[object]: ...


class WearableMaintenanceRunner(Protocol):
    async def run_once(self) -> dict[str, object]: ...


@dataclass(frozen=True)
class WearablesRouterDeps:
    limiter: RouteLimiter
    get_current_user: Callable[..., object]
    wearable_apple_ingest_service: WearableAppleIngest
    wearable_device_security_service: WearableDeviceSecurity
    whoop_service: WhoopProviderService
    oura_service: OuraProviderService
    garmin_service: GarminProviderService
    wearable_connection_service: WearableConnectionReader
    wearable_projection_service: WearableProjectionReader
    wearable_query_service: WearableQueryReader
    wearable_sync_service: WearableSyncRunner
    wearable_event_outbox_service: WearableEventOutbox
    wearable_ingest_job_service: WearableIngestJobQueue
    wearable_maintenance_service: WearableMaintenanceRunner
    provider_sync_services: Mapping[str, object]
    mark_activation_completed: Callable[[str, str, Optional[dict[str, object]]], Awaitable[None]]
