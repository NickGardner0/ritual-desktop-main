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

SENSITIVE_DATA_CLASSES = {
    "habit_definition",
    "habit_log",
    "daily_note",
    "computer_activity",
    "browser_activity",
    "ocr_text",
    "screenshot",
    "health_metric",
    "location",
    "ai_content",
    "ai_memory",
    "financial",
    "provider_secret",
}

ACCOUNT_REQUIRED_CLASSES = {"account_metadata", "app_preferences"}
MINIMAL_TELEMETRY_CLASSES = {"product_telemetry", "crash_diagnostics"}

SENSITIVE_TINYBIRD_DATASOURCES = {
    "habit_logs": "habit_log",
    "computer_activity_daily": "computer_activity",
    "heart_rate_1m_rollups": "health_metric",
    "weather_observations": "location",
}

SENSITIVE_TYPESENSE_COLLECTIONS = {
    "habits": "habit_definition",
    "habit_logs": "habit_log",
    "ai_messages": "ai_content",
    "computer_activity": "computer_activity",
    "artifacts": "ai_content",
    "workflows": "ai_content",
    "ai_facts": "ai_memory",
    "log_phrases": "habit_log",
}


@dataclass(frozen=True)
class PrivacyDecision:
    allowed: bool
    reason: str


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
    return data_class in SENSITIVE_DATA_CLASSES


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
