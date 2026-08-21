from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.privacy_policy import (
    PRIVACY_CATEGORY_SPECS,
    can_send_to_cloud,
    category_allows_analytics,
    category_is_deletable,
    category_is_exportable,
    category_retention_days,
    data_class_for_entity_type,
    data_class_for_tinybird_datasource,
    request_cloud_consents,
    request_privacy_mode,
    should_redact_observability_key,
)


def test_entity_types_map_to_privacy_classes():
    assert data_class_for_entity_type("habit") == "habit_definition"
    assert data_class_for_entity_type("task") == "task"
    assert data_class_for_entity_type("routine") == "routine"
    assert data_class_for_entity_type("artifact") == "ai_content"
    assert data_class_for_entity_type("report") == "ai_content"
    assert data_class_for_entity_type("calendar_block") == "task"
    assert data_class_for_entity_type("calendar") == "task"
    assert data_class_for_entity_type("experiment") == "task"
    assert data_class_for_entity_type("day") == "habit_log"
    assert data_class_for_entity_type("time_window") == "habit_log"


def test_local_only_blocks_sensitive_cloud_egress(monkeypatch):
    monkeypatch.delenv("RITUAL_PRIVACY_MODE", raising=False)
    monkeypatch.delenv("RITUAL_CLOUD_CONSENTS", raising=False)

    decision = can_send_to_cloud(
        data_class="habit_log",
        destination="tinybird",
        purpose="analytics",
    )

    assert decision.allowed is False
    assert "local-only" in decision.reason


def test_cloud_intelligence_requires_specific_consent(monkeypatch):
    monkeypatch.setenv("RITUAL_PRIVACY_MODE", "cloud_intelligence")
    monkeypatch.setenv("RITUAL_CLOUD_CONSENTS", "analytics")

    ai_decision = can_send_to_cloud(
        data_class="screenshot",
        destination="openai",
        purpose="vision",
    )
    analytics_decision = can_send_to_cloud(
        data_class="habit_log",
        destination="tinybird",
        purpose="analytics",
    )

    assert ai_decision.allowed is False
    assert analytics_decision.allowed is True


def test_private_sync_blocks_plaintext_secondary_stores(monkeypatch):
    monkeypatch.setenv("RITUAL_PRIVACY_MODE", "private_sync")
    monkeypatch.setenv("RITUAL_CLOUD_CONSENTS", "analytics,search")

    decision = can_send_to_cloud(
        data_class="computer_activity",
        destination="tinybird",
        purpose="analytics",
    )

    assert decision.allowed is False
    assert "encrypted envelope" in decision.reason


def test_request_headers_can_narrow_mode_and_add_consents(monkeypatch):
    monkeypatch.setenv("RITUAL_PRIVACY_MODE", "cloud_intelligence")
    monkeypatch.setenv("RITUAL_CLOUD_CONSENTS", "search")

    headers = {
        "x-ritual-privacy-mode": "local_only",
        "x-ritual-cloud-consents": "vision",
    }

    assert request_privacy_mode(headers) == "local_only"
    assert request_cloud_consents(headers) == {"search", "vision"}


def test_destination_classification_and_redaction():
    assert data_class_for_tinybird_datasource("habit_logs") == "habit_log"
    assert should_redact_observability_key("habit_id") is True
    assert should_redact_observability_key("duration_ms") is False


def test_category_registry_owns_lifecycle_and_analytics_policy():
    assert category_retention_days("location") == 30
    assert category_is_exportable("provider_secret") is False
    assert category_is_deletable("habit_log") is True
    assert category_allows_analytics("habit_log") is True
    assert category_allows_analytics("financial") is False
    assert set(PRIVACY_CATEGORY_SPECS) >= {
        "habit_log",
        "health_metric",
        "location",
        "financial",
        "provider_secret",
    }

    decision = can_send_to_cloud(
        data_class="financial",
        destination="tinybird",
        purpose="analytics",
        mode="cloud_intelligence",
        consents={"analytics"},
    )
    assert decision.allowed is False
