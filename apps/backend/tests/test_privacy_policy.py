from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.privacy_policy import (
    can_send_to_cloud,
    data_class_for_tinybird_datasource,
    data_class_for_typesense_collection,
    request_cloud_consents,
    request_privacy_mode,
    should_redact_observability_key,
)


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
    monkeypatch.setenv("RITUAL_CLOUD_CONSENTS", "search")

    ai_decision = can_send_to_cloud(
        data_class="screenshot",
        destination="openai",
        purpose="vision",
    )
    search_decision = can_send_to_cloud(
        data_class="habit_log",
        destination="typesense",
        purpose="search",
    )

    assert ai_decision.allowed is False
    assert search_decision.allowed is True


def test_private_sync_blocks_plaintext_secondary_stores(monkeypatch):
    monkeypatch.setenv("RITUAL_PRIVACY_MODE", "private_sync")
    monkeypatch.setenv("RITUAL_CLOUD_CONSENTS", "analytics,search")

    decision = can_send_to_cloud(
        data_class="computer_activity",
        destination="typesense",
        purpose="search",
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
    assert data_class_for_typesense_collection("ai_messages") == "ai_content"
    assert should_redact_observability_key("habit_id") is True
    assert should_redact_observability_key("duration_ms") is False
