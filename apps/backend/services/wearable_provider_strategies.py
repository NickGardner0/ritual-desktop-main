"""Provider strategies for cloud wearable sync.

These strategies are the canonical dispatch boundary for provider sync jobs.
Provider-specific services may still own OAuth/API details during migration, but
the sync registry should talk to explicit strategies instead of fake
"already-persisted" pipeline adapters.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Literal, Optional, Protocol

from services.wearable_provider_canonical_ingest import (
    persist_garmin_payload,
    persist_oura_payload,
    persist_whoop_payload,
)
from services.wearable_provider_clients import (
    GarminProviderClient,
    GarminProviderTransformer,
    OuraProviderClient,
    OuraProviderTransformer,
    ProviderFetchRequest,
    WhoopProviderClient,
    WhoopProviderTransformer,
)


logger = logging.getLogger(__name__)

StrategyStatus = Literal["success", "partial", "retryable_failed", "terminal_failed"]


@dataclass(frozen=True)
class ProviderRetryPolicy:
    max_attempts: int = 1
    retryable_errors: tuple[str, ...] = ("timeout", "rate_limit", "temporary")


@dataclass(frozen=True)
class WearableProviderCapabilities:
    provider: str
    auth_type: str
    supports_pull: bool
    supports_webhook: bool
    supports_backfill: bool
    supported_metrics: tuple[str, ...]
    checkpoint_type: str
    retry_policy: ProviderRetryPolicy = ProviderRetryPolicy()
    supports_raw_replay: bool = True


@dataclass(frozen=True)
class ProviderStrategyContext:
    user_id: str
    services: Any
    days_back: Optional[int] = None
    force_full_sync: bool = False
    full_history: bool = False


@dataclass(frozen=True)
class ProviderStrategyResult:
    provider: str
    status: StrategyStatus
    items_seen: int
    items_written: int
    message: str
    data: dict[str, Any]
    error: Optional[dict[str, Any]] = None


class WearableProviderStrategy(Protocol):
    capabilities: WearableProviderCapabilities

    async def sync(self, context: ProviderStrategyContext) -> ProviderStrategyResult:
        ...


def _dict_result(result: Any) -> dict[str, Any]:
    return result if isinstance(result, dict) else {"raw": result}


def _sum_numeric_values(values: dict[str, Any]) -> int:
    total = 0
    for value in values.values():
        try:
            total += int(value or 0)
        except (TypeError, ValueError):
            continue
    return total


def _int_value(values: dict[str, Any], key: str) -> int:
    try:
        return int(values.get(key, 0) or 0)
    except (TypeError, ValueError):
        return 0


def _partial_error(provider: str, result: dict[str, Any]) -> dict[str, Any]:
    return {
        "message": (
            result.get("canonical_sync_error")
            or result.get("metric_facts_error")
            or result.get("error")
            or f"{provider} sync completed partially."
        )
    }


def _classify_provider_exception(provider: str, exc: Exception) -> ProviderStrategyResult:
    message = str(exc) or exc.__class__.__name__
    lowered = message.lower()
    retryable_markers = (
        "timeout",
        "timed out",
        "temporarily",
        "temporary",
        "rate limit",
        "rate_limit",
        "too many requests",
        "connection reset",
        "connection refused",
        "service unavailable",
        "bad gateway",
        "gateway timeout",
    )
    terminal_markers = (
        "auth",
        "authorization",
        "unauthorized",
        "forbidden",
        "invalid token",
        "refresh token",
        "not found",
        "configuration missing",
        "connection not found",
    )
    if any(marker in lowered for marker in retryable_markers):
        status: StrategyStatus = "retryable_failed"
    elif any(marker in lowered for marker in terminal_markers):
        status = "terminal_failed"
    else:
        status = "retryable_failed"

    logger.warning(
        "Wearable provider strategy failed provider=%s status=%s error=%s",
        provider,
        status,
        message,
    )
    return ProviderStrategyResult(
        provider=provider,
        status=status,
        items_seen=0,
        items_written=0,
        message=f"{provider.title()} sync failed.",
        data={},
        error={
            "message": message,
            "type": exc.__class__.__name__,
            "retryable": status == "retryable_failed",
        },
    )


class WhoopProviderStrategy:
    capabilities = WearableProviderCapabilities(
        provider="whoop",
        auth_type="oauth",
        supports_pull=True,
        supports_webhook=True,
        supports_backfill=True,
        supported_metrics=(
            "sleep_total",
            "workout",
            "recovery_score",
            "heart_rate",
            "steps",
            "distance",
        ),
        checkpoint_type="last_successful_post_ingest",
        retry_policy=ProviderRetryPolicy(max_attempts=1),
    )

    async def sync(self, context: ProviderStrategyContext) -> ProviderStrategyResult:
        try:
            fetched = await WhoopProviderClient(context.services.whoop_service).fetch(
                ProviderFetchRequest(
                    user_id=context.user_id,
                    days_back=context.days_back,
                    force_full_sync=context.force_full_sync,
                    full_history=context.full_history,
                )
            )
            payload = WhoopProviderTransformer().to_canonical_payload(fetched)
            result = _dict_result(
                await persist_whoop_payload(
                    context.services.whoop_service,
                    context.user_id,
                    payload,
                )
            )
            data = result.get("data", {}) if isinstance(result.get("data", {}), dict) else {}
            items_seen = _sum_numeric_values(data)
            status: StrategyStatus = "success" if result.get("status", "success") == "success" else "partial"
            return ProviderStrategyResult(
                provider="whoop",
                status=status,
                items_seen=items_seen,
                items_written=items_seen,
                data=result,
                message="Whoop sync completed." if status == "success" else "Whoop sync completed partially.",
                error=None if status == "success" else _partial_error("Whoop", result),
            )
        except Exception as exc:
            return _classify_provider_exception("whoop", exc)


class OuraProviderStrategy:
    capabilities = WearableProviderCapabilities(
        provider="oura",
        auth_type="oauth",
        supports_pull=True,
        supports_webhook=False,
        supports_backfill=True,
        supported_metrics=(
            "sleep_total",
            "sleep_score",
            "workout",
            "steps",
            "heart_rate",
            "hrv_rmssd",
            "readiness_score",
        ),
        checkpoint_type="connection_last_sync_at",
        retry_policy=ProviderRetryPolicy(max_attempts=1),
    )

    async def sync(self, context: ProviderStrategyContext) -> ProviderStrategyResult:
        try:
            fetched = await OuraProviderClient(context.services.oura_service).fetch(
                ProviderFetchRequest(
                    user_id=context.user_id,
                    days_back=context.days_back,
                    force_full_sync=context.force_full_sync,
                )
            )
            payload = OuraProviderTransformer().to_canonical_payload(fetched)
            counts = await persist_oura_payload(
                context.services.oura_service,
                context.user_id,
                payload,
            )
            counts = counts if isinstance(counts, dict) else {}
            items_seen = _int_value(counts, "samples") + _int_value(counts, "events")
            post_ingest_success = bool(counts.get("post_ingest_success", True))
            status: StrategyStatus = "success" if post_ingest_success else "partial"
            return ProviderStrategyResult(
                provider="oura",
                status=status,
                items_seen=items_seen,
                items_written=items_seen,
                data={
                    "status": "success" if status == "success" else "partial",
                    "sync_period": {
                        "start_date": str(payload.get("start_date")),
                        "end_date": str(payload.get("end_date")),
                    },
                    "data": counts,
                },
                message="Oura sync completed." if status == "success" else "Oura sync completed partially.",
                error=None if status == "success" else _partial_error("Oura", counts),
            )
        except Exception as exc:
            return _classify_provider_exception("oura", exc)


class GarminProviderStrategy:
    capabilities = WearableProviderCapabilities(
        provider="garmin",
        auth_type="oauth",
        supports_pull=True,
        supports_webhook=True,
        supports_backfill=False,
        supported_metrics=("sleep_total", "workout", "steps", "distance", "heart_rate"),
        checkpoint_type="webhook_event_time",
        retry_policy=ProviderRetryPolicy(max_attempts=1),
        supports_raw_replay=True,
    )

    async def sync(self, context: ProviderStrategyContext) -> ProviderStrategyResult:
        try:
            fetched = await GarminProviderClient(context.services.garmin_service).fetch(
                ProviderFetchRequest(user_id=context.user_id)
            )
            payload = GarminProviderTransformer().to_canonical_payload(fetched)
            await persist_garmin_payload(
                context.services.garmin_service,
                context.user_id,
                payload,
            )
            data = {
                "status": "success",
                "data": {
                    "permissions_loaded": bool(payload.get("permissions")),
                    "webhook_driven": True,
                },
            }
            return ProviderStrategyResult(
                provider="garmin",
                status="success",
                items_seen=1 if payload.get("permissions") else 0,
                items_written=1 if payload.get("permissions") else 0,
                data=data,
                message="Garmin account refreshed. Data ingestion is webhook-driven.",
            )
        except Exception as exc:
            return _classify_provider_exception("garmin", exc)


PROVIDER_STRATEGIES: dict[str, WearableProviderStrategy] = {
    "garmin": GarminProviderStrategy(),
    "oura": OuraProviderStrategy(),
    "whoop": WhoopProviderStrategy(),
}


def list_provider_strategies() -> list[str]:
    return sorted(PROVIDER_STRATEGIES)


async def sync_provider_with_strategy(
    *,
    provider: str,
    user_id: str,
    services: Any,
    days_back: Optional[int] = None,
    force_full_sync: bool = False,
    full_history: bool = False,
) -> ProviderStrategyResult:
    normalized_provider = provider.strip().lower()
    strategy = PROVIDER_STRATEGIES.get(normalized_provider)
    if strategy is None:
        raise ValueError(f"Unsupported wearable provider strategy: {normalized_provider}")
    return await strategy.sync(
        ProviderStrategyContext(
            user_id=user_id,
            services=services,
            days_back=days_back,
            force_full_sync=force_full_sync,
            full_history=full_history,
        )
    )
