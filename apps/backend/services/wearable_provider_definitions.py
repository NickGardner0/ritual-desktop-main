"""Single ownership registry for wearable provider behavior and capabilities."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from services.wearable_provider_adapters import (
    AppleHealthAdapter,
    FitbitAdapter,
    GarminAdapter,
    OuraAdapter,
    WearableProviderAdapter,
    WhoopAdapter,
)
from services.wearable_provider_strategies import (
    GarminProviderStrategy,
    OuraProviderStrategy,
    WearableProviderStrategy,
    WhoopProviderStrategy,
)
from services.wearables_unified.capabilities import PROVIDER_CAPABILITIES, ProviderCapabilityDef


@dataclass(frozen=True)
class ProviderDefinition:
    provider: str
    capability: ProviderCapabilityDef
    adapter: WearableProviderAdapter
    strategy: Optional[WearableProviderStrategy]
    ingest_strategy: str
    scheduling_policy: str
    supported_metrics: tuple[str, ...] = ()
    checkpoint_type: str = "none"


class UnsupportedProviderCapability(ValueError):
    def __init__(self, definition: ProviderDefinition, capability: str):
        self.definition = definition
        self.capability = capability
        super().__init__(f"{definition.capability.display_name} does not support {capability.replace('_', ' ')}.")


PROVIDER_DEFINITIONS: dict[str, ProviderDefinition] = {
    "apple_health": ProviderDefinition(
        provider="apple_health",
        capability=PROVIDER_CAPABILITIES["apple_health"],
        adapter=AppleHealthAdapter(),
        strategy=None,
        ingest_strategy="device_ingest",
        scheduling_policy="device_managed",
        checkpoint_type="healthkit_anchor",
    ),
    "whoop": ProviderDefinition(
        provider="whoop",
        capability=PROVIDER_CAPABILITIES["whoop"],
        adapter=WhoopAdapter(),
        strategy=WhoopProviderStrategy(),
        ingest_strategy="rest_pull",
        scheduling_policy="queued_backfill",
        supported_metrics=("sleep_total", "workout", "recovery_score", "heart_rate", "steps", "distance"),
        checkpoint_type="last_successful_post_ingest",
    ),
    "garmin": ProviderDefinition(
        provider="garmin",
        capability=PROVIDER_CAPABILITIES["garmin"],
        adapter=GarminAdapter(),
        strategy=GarminProviderStrategy(),
        ingest_strategy="webhook_stream",
        scheduling_policy="webhook_only",
        supported_metrics=("sleep_total", "workout", "steps", "distance", "heart_rate"),
        checkpoint_type="webhook_event_time",
    ),
    "oura": ProviderDefinition(
        provider="oura",
        capability=PROVIDER_CAPABILITIES["oura"],
        adapter=OuraAdapter(),
        strategy=OuraProviderStrategy(),
        ingest_strategy="rest_pull",
        scheduling_policy="queued_backfill",
        supported_metrics=("sleep_total", "sleep_score", "workout", "steps", "heart_rate", "hrv_rmssd", "readiness_score"),
        checkpoint_type="connection_last_sync_at",
    ),
    "fitbit": ProviderDefinition(
        provider="fitbit",
        capability=PROVIDER_CAPABILITIES["fitbit"],
        adapter=FitbitAdapter(),
        strategy=None,
        ingest_strategy="unavailable",
        scheduling_policy="disabled",
    ),
}


def get_provider_definition(provider: str) -> ProviderDefinition:
    normalized = provider.strip().lower()
    definition = PROVIDER_DEFINITIONS.get(normalized)
    if definition is None:
        raise ValueError(f"Unsupported provider: {normalized}")
    return definition


def list_provider_definitions() -> list[ProviderDefinition]:
    return list(PROVIDER_DEFINITIONS.values())


def require_async_backfill(provider: str) -> ProviderDefinition:
    definition = get_provider_definition(provider)
    if not definition.capability.supports_async_backfill:
        raise UnsupportedProviderCapability(definition, "async_backfill")
    return definition


def serialize_provider_definition(definition: ProviderDefinition) -> dict[str, object]:
    capability = definition.capability
    return {
        "provider": definition.provider,
        "display_name": capability.display_name,
        "auth_method": capability.auth_method,
        "supports_sync": definition.strategy is not None or definition.provider == "apple_health",
        "delivery_modes": list(capability.delivery_modes),
        "supports_webhook": capability.supports_webhook,
        "supports_import_fallback": capability.supports_import_fallback,
        "supports_metric_selection": capability.supports_metric_selection,
        "supports_backfill": capability.supports_backfill,
        "supports_async_backfill": capability.supports_async_backfill,
        "supports_live_sync_mode_selection": capability.supports_live_sync_mode_selection,
        "max_historical_days": capability.max_historical_days,
        "default_live_sync_mode": capability.default_live_sync_mode,
        "supports_anchor_confirmed_ingest": capability.supports_anchor_confirmed_ingest,
    }


def validate_provider_definitions() -> None:
    if set(PROVIDER_DEFINITIONS) != set(PROVIDER_CAPABILITIES):
        raise RuntimeError("Provider definitions and public capabilities are out of sync")
    for provider, definition in PROVIDER_DEFINITIONS.items():
        if definition.provider != provider or definition.adapter.provider != provider:
            raise RuntimeError(f"Provider definition identity mismatch: {provider}")
        if definition.capability.provider != provider:
            raise RuntimeError(f"Provider capability identity mismatch: {provider}")
        if definition.capability.supports_async_backfill and definition.strategy is None:
            raise RuntimeError(f"Async backfill provider lacks a strategy: {provider}")


validate_provider_definitions()
