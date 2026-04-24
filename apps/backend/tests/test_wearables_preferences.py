"""Unit tests for Apple Health metric preference compatibility helpers."""

from __future__ import annotations

import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from api.wearables import (
    _build_tracked_metrics_contract,
    _normalize_metric_preferences_v2,
    _parse_metric_preferences_payload,
    _selected_metrics_from_preferences,
)


class MetricPreferenceHelpersTests(unittest.TestCase):
    def setUp(self) -> None:
        self.allowed_metric_types = {"steps", "hr", "sleep_session"}

    def test_normalize_metric_preferences_v2_uses_v2_when_present(self):
        preferences = _normalize_metric_preferences_v2(
            {
                "metric_preferences_v2": {
                    "steps": {"sync_mode": "granular"},
                    "hr": {"sync_mode": "off"},
                },
                "metric_preferences": ["sleep_session"],
            },
            self.allowed_metric_types,
        )

        self.assertEqual(
            preferences,
            {
                "steps": {"sync_mode": "granular"},
                "hr": {"sync_mode": "off"},
            },
        )

    def test_normalize_metric_preferences_v2_falls_back_to_legacy_selected_metrics(self):
        preferences = _normalize_metric_preferences_v2(
            {"metric_preferences": ["steps", "hr"]},
            self.allowed_metric_types,
        )

        self.assertEqual(
            preferences,
            {
                "steps": {"sync_mode": "daily_only"},
                "hr": {"sync_mode": "daily_only"},
            },
        )

    def test_selected_metrics_only_returns_enabled_modes(self):
        selected_metrics = _selected_metrics_from_preferences(
            {
                "steps": {"sync_mode": "granular"},
                "hr": {"sync_mode": "off"},
                "sleep_session": {"sync_mode": "daily_only"},
            }
        )

        self.assertEqual(selected_metrics, ["sleep_session", "steps"])

    def test_build_tracked_metrics_contract_includes_habit_defaults(self):
        metrics = _build_tracked_metrics_contract(
            {
                "steps": {"sync_mode": "granular"},
                "hr": {"sync_mode": "off"},
            },
            {"sleep_session"},
        )

        self.assertEqual(
            metrics,
            {
                "sleep_session": {
                    "sync_mode": "daily_only",
                    "sync_plan": {
                        "provider": "apple_health",
                        "metric_type": "sleep_session",
                        "sync_mode": "daily_only",
                        "delivery_mode": "client_sdk",
                        "backfill_mode": "manual_queue",
                        "safe_history_days": 730,
                        "projects_to_habit_logs": True,
                        "capability_provider": "apple_health",
                    },
                },
                "steps": {
                    "sync_mode": "granular",
                    "sync_plan": {
                        "provider": "apple_health",
                        "metric_type": "steps",
                        "sync_mode": "granular",
                        "delivery_mode": "client_sdk",
                        "backfill_mode": "manual_queue",
                        "safe_history_days": 30,
                        "projects_to_habit_logs": False,
                        "capability_provider": "apple_health",
                    },
                },
            },
        )

    def test_parse_metric_preferences_payload_accepts_v2_shape(self):
        preferences = _parse_metric_preferences_payload(
            {
                "preferences": {
                    "steps": {"sync_mode": "granular"},
                    "hr": {"sync_mode": "off"},
                }
            },
            self.allowed_metric_types,
        )

        self.assertEqual(
            preferences,
            {
                "steps": {"sync_mode": "granular"},
                "hr": {"sync_mode": "off"},
            },
        )

    def test_parse_metric_preferences_payload_accepts_legacy_shape(self):
        preferences = _parse_metric_preferences_payload(
            {"selected_metrics": ["steps", "hr"]},
            self.allowed_metric_types,
        )

        self.assertEqual(
            preferences,
            {
                "steps": {"sync_mode": "daily_only"},
                "hr": {"sync_mode": "daily_only"},
            },
        )

    def test_parse_metric_preferences_payload_rejects_unknown_metric(self):
        with self.assertRaises(ValueError):
            _parse_metric_preferences_payload(
                {"selected_metrics": ["steps", "unknown_metric"]},
                self.allowed_metric_types,
            )


if __name__ == "__main__":
    unittest.main()
