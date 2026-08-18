"""Privacy mode and cloud egress guardrails.

This module is intentionally small and dependency-free so services can ask a
single policy question before sending sensitive data to cloud destinations.
Pass 2A stores settings in process/env/header state only; persistent per-user
settings can be added in a later migration-backed stage.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Mapping, Optional


PRIVACY_MODES = {"local_only", "private_sync", "cloud_intelligence"}

@dataclass(frozen=True)
class PrivacyCategorySpec:
    category: str
    sensitive: bool
    storage: tuple[str, ...]
    retention_days: int | None
    exportable: bool
    deletable: bool
    analytics_allowed: bool
    tinybird_datasources: tuple[str, ...] = ()
    typesense_collections: tuple[str, ...] = ()


def _sensitive(
    category: str,
    *,
    storage: tuple[str, ...] = ("local_vault", "backend_turso"),
    retention_days: int | None = None,
    exportable: bool = True,
    analytics_allowed: bool = False,
    tinybird_datasources: tuple[str, ...] = (),
    typesense_collections: tuple[str, ...] = (),
) -> PrivacyCategorySpec:
    return PrivacyCategorySpec(
        category=category,
        sensitive=True,
        storage=storage,
        retention_days=retention_days,
        exportable=exportable,
        deletable=True,
        analytics_allowed=analytics_allowed,
        tinybird_datasources=tinybird_datasources,
        typesense_collections=typesense_collections,
    )


PRIVACY_CATEGORY_SPECS: dict[str, PrivacyCategorySpec] = {
    "habit_definition": _sensitive("habit_definition", analytics_allowed=True, typesense_collections=("habits",)),
    "habit_log": _sensitive(
        "habit_log",
        analytics_allowed=True,
        tinybird_datasources=("habit_logs",),
        typesense_collections=("habit_logs", "log_phrases"),
    ),
    "daily_note": _sensitive("daily_note"),
    "task": _sensitive("task"),
    "routine": _sensitive("routine"),
    "computer_activity": _sensitive(
        "computer_activity",
        retention_days=365,
        analytics_allowed=True,
        tinybird_datasources=("computer_activity_daily",),
        typesense_collections=("computer_activity",),
    ),
    "browser_activity": _sensitive("browser_activity", retention_days=365),
    "ocr_text": _sensitive("ocr_text", retention_days=30),
    "screenshot": _sensitive("screenshot", retention_days=30),
    "health_metric": _sensitive(
        "health_metric",
        analytics_allowed=True,
        tinybird_datasources=(
            "heart_rate_1m_rollups",
            "whoop_sleep_data",
            "whoop_recovery_data",
            "whoop_workout_data",
        ),
    ),
    "location": _sensitive(
        "location",
        retention_days=30,
        analytics_allowed=True,
        tinybird_datasources=("weather_observations",),
    ),
    "ai_content": _sensitive(
        "ai_content",
        typesense_collections=("ai_messages", "artifacts", "workflows"),
    ),
    "ai_memory": _sensitive("ai_memory", typesense_collections=("ai_facts",)),
    "financial": _sensitive("financial"),
    "provider_secret": _sensitive("provider_secret", storage=("backend_secret_store",), exportable=False),
    "account_metadata": PrivacyCategorySpec(
        "account_metadata", False, ("backend_turso",), None, True, True, False
    ),
    "app_preferences": PrivacyCategorySpec(
        "app_preferences", False, ("local_vault", "backend_turso"), None, True, True, False
    ),
    "product_telemetry": PrivacyCategorySpec(
        "product_telemetry", False, ("telemetry",), 90, False, True, True
    ),
    "crash_diagnostics": PrivacyCategorySpec(
        "crash_diagnostics", False, ("telemetry",), 30, False, True, False
    ),
}

SENSITIVE_DATA_CLASSES = {
    name for name, spec in PRIVACY_CATEGORY_SPECS.items() if spec.sensitive
}
ACCOUNT_REQUIRED_CLASSES = {"account_metadata", "app_preferences"}
MINIMAL_TELEMETRY_CLASSES = {"product_telemetry", "crash_diagnostics"}
SENSITIVE_TINYBIRD_DATASOURCES = {
    datasource: name
    for name, spec in PRIVACY_CATEGORY_SPECS.items()
    for datasource in spec.tinybird_datasources
}
SENSITIVE_TYPESENSE_COLLECTIONS = {
    collection: name
    for name, spec in PRIVACY_CATEGORY_SPECS.items()
    for collection in spec.typesense_collections
}


@dataclass(frozen=True)
class PrivacyDecision:
    allowed: bool
    reason: str


def privacy_category_spec(category: str) -> PrivacyCategorySpec:
    return PRIVACY_CATEGORY_SPECS.get(category, PRIVACY_CATEGORY_SPECS["product_telemetry"])


def current_privacy_mode() -> str:
    raw = os.getenv("RITUAL_PRIVACY_MODE", "local_only").strip().lower()
    return raw if raw in PRIVACY_MODES else "local_only"


def parse_cloud_consents(raw: Optional[str] = None) -> set[str]:
    value = os.getenv("RITUAL_CLOUD_CONSENTS", "") if raw is None else raw
    return {
        item.strip().lower()
        for item in value.split(",")
        if item.strip()
    }


def request_privacy_mode(headers: Optional[Mapping[str, str]] = None) -> str:
    if not headers:
        return current_privacy_mode()
    raw = str(headers.get("x-ritual-privacy-mode") or "").strip().lower()
    return raw if raw in PRIVACY_MODES else current_privacy_mode()


def request_cloud_consents(headers: Optional[Mapping[str, str]] = None) -> set[str]:
    consents = parse_cloud_consents()
    if not headers:
        return consents
    raw = headers.get("x-ritual-cloud-consents")
    if raw:
        consents |= parse_cloud_consents(str(raw))
    return consents


def is_sensitive_data_class(data_class: str) -> bool:
    return privacy_category_spec(data_class).sensitive


def category_retention_days(data_class: str) -> int | None:
    return privacy_category_spec(data_class).retention_days


def category_is_exportable(data_class: str) -> bool:
    return privacy_category_spec(data_class).exportable


def category_is_deletable(data_class: str) -> bool:
    return privacy_category_spec(data_class).deletable


def category_allows_analytics(data_class: str) -> bool:
    return privacy_category_spec(data_class).analytics_allowed


def consent_enabled(consents: set[str], consent: str) -> bool:
    return consent.strip().lower() in consents


def can_send_to_cloud(
    *,
    data_class: str,
    destination: str,
    purpose: str,
    mode: Optional[str] = None,
    consents: Optional[set[str]] = None,
) -> PrivacyDecision:
    normalized_mode = mode if mode in PRIVACY_MODES else current_privacy_mode()
    normalized_consents = consents if consents is not None else parse_cloud_consents()

    if purpose == "analytics" and not category_allows_analytics(data_class):
        return PrivacyDecision(False, f"analytics is not allowed for {data_class}")

    if destination == "backend" and purpose == "account" and data_class in ACCOUNT_REQUIRED_CLASSES:
        return PrivacyDecision(True, "account-required metadata")

    if destination == "turso_encrypted_sync" or purpose == "encrypted_sync":
        if normalized_mode in {"private_sync", "cloud_intelligence"}:
            return PrivacyDecision(True, "encrypted sync mode")
        return PrivacyDecision(False, "encrypted sync is not enabled in Local Only mode")

    if normalized_mode == "local_only":
        if data_class in MINIMAL_TELEMETRY_CLASSES:
            consent = "crash_diagnostics" if data_class == "crash_diagnostics" else "product_telemetry"
            if consent_enabled(normalized_consents, consent):
                return PrivacyDecision(True, f"{consent} consent enabled")
            return PrivacyDecision(False, f"{consent} consent is required in Local Only mode")
        if is_sensitive_data_class(data_class):
            return PrivacyDecision(False, "sensitive data is local-only by default")

    if normalized_mode == "private_sync" and is_sensitive_data_class(data_class):
        if destination in {"turso_cloud", "tinybird", "typesense"}:
            return PrivacyDecision(False, "Private Sync only permits encrypted envelope sync")

    if purpose not in {"account", "local_api", "encrypted_sync"}:
        if not consent_enabled(normalized_consents, purpose):
            return PrivacyDecision(False, f"{purpose} consent is required")

    return PrivacyDecision(True, "policy permits destination")


ENTITY_TYPE_PRIVACY_CLASS = {
    "habit": "habit_definition",
    "habit_log": "habit_log",
    "task": "task",
    "routine": "routine",
    "artifact": "ai_content",
    "conversation": "ai_content",
    "experiment": "task",
    "calendar_block": "task",
    "day": "habit_log",
    "time_window": "habit_log",
}


def data_class_for_entity_type(entity_type: str) -> str:
    aliases = {"report": "artifact", "calendar": "calendar_block"}
    canonical = aliases.get(entity_type, entity_type)
    return ENTITY_TYPE_PRIVACY_CLASS.get(canonical, "account_metadata")


def data_class_for_tinybird_datasource(datasource: str) -> str:
    return SENSITIVE_TINYBIRD_DATASOURCES.get(datasource, "product_telemetry")


def data_class_for_typesense_collection(collection: str) -> str:
    return SENSITIVE_TYPESENSE_COLLECTIONS.get(collection, "product_telemetry")


def should_redact_observability_key(key: str) -> bool:
    normalized = key.strip().lower()
    return (
        not normalized
        or "email" in normalized
        or "phone" in normalized
        or "name" in normalized
        or "note" in normalized
        or "text" in normalized
        or "title" in normalized
        or "url" in normalized
        or "domain" in normalized
        or "location" in normalized
        or normalized.endswith("id")
        or "_id" in normalized
        or "token" in normalized
        or "secret" in normalized
    )
