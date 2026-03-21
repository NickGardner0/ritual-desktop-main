"""Focused unit tests for the unified wearable backend scaffolding."""

from __future__ import annotations

import base64
import json
import os
import pathlib
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.unified_wearables_service import WearableNormalizationService, WearableProjectionService
from services.garmin_service import GarminService
from services.wearable_provider_adapters import GarminAdapter, OuraAdapter, WhoopAdapter


def _decode_state(encoded: str) -> dict:
    padding = "=" * (-len(encoded) % 4)
    return json.loads(base64.urlsafe_b64decode(encoded + padding).decode("utf-8"))


class WearableNormalizationTests(unittest.TestCase):
    def test_apple_metric_aliases_are_canonicalized(self):
        service = WearableNormalizationService()

        self.assertEqual(service.canonicalize_metric_type("apple_health", "hr"), "heart_rate")
        self.assertEqual(service.canonicalize_metric_type("apple_health", "sleep_core"), "sleep_light")
        self.assertEqual(service.canonicalize_metric_type("apple_health", "steps"), "steps")

    def test_whoop_metric_aliases_are_canonicalized(self):
        service = WearableNormalizationService()

        self.assertEqual(service.canonicalize_metric_type("whoop", "strain"), "strain_score")
        self.assertEqual(service.canonicalize_metric_type("whoop", "hrv_rmssd"), "hrv")


class WearableProjectionTests(unittest.TestCase):
    def test_sleep_total_matches_legacy_sleep_metric_types(self):
        projection = WearableProjectionService(WearableNormalizationService())
        habit = SimpleNamespace(name="Sleep Duration", metric_type="sleep_session")

        self.assertTrue(projection._habit_matches_metric_type(habit, "sleep_total"))

    def test_sleep_total_matches_null_metric_sleep_habit(self):
        projection = WearableProjectionService(WearableNormalizationService())
        habit = SimpleNamespace(name="Sleep Duration", metric_type=None)

        self.assertTrue(projection._habit_matches_metric_type(habit, "sleep_total"))


class WearableProviderAdapterTests(unittest.TestCase):
    def test_whoop_adapter_builds_auth_url(self):
        with patch.dict(
            os.environ,
            {
                "WHOOP_CLIENT_ID": "whoop-client",
                "NEXT_PUBLIC_WHOOP_REDIRECT_URI": "http://127.0.0.1:8000/api/wearables/oauth/whoop/callback",
            },
            clear=False,
        ):
            auth = WhoopAdapter().begin_auth("user_123")

        parsed = urlparse(auth.authorization_url)
        params = parse_qs(parsed.query)
        self.assertEqual(parsed.netloc, "api.prod.whoop.com")
        self.assertEqual(params["client_id"][0], "whoop-client")
        state = _decode_state(params["state"][0])
        self.assertEqual(state["user_id"], "user_123")
        self.assertEqual(state["provider"], "whoop")

    def test_garmin_adapter_builds_auth_url(self):
        with patch.dict(
            os.environ,
            {
                "GARMIN_CLIENT_ID": "garmin-client",
                "GARMIN_REDIRECT_URI": "http://127.0.0.1:8000/api/wearables/oauth/garmin/callback",
            },
            clear=False,
        ):
            auth = GarminAdapter().begin_auth("user_456")

        parsed = urlparse(auth.authorization_url)
        params = parse_qs(parsed.query)
        self.assertEqual(params["client_id"][0], "garmin-client")
        self.assertIn("code_challenge", params)
        self.assertEqual(params["code_challenge_method"][0], "S256")
        self.assertIsNotNone(auth.transient_settings)
        self.assertIn("pkce_verifier", auth.transient_settings)
        state = _decode_state(params["state"][0])
        self.assertEqual(state["user_id"], "user_456")
        self.assertEqual(state["provider"], "garmin")

    def test_oura_adapter_builds_auth_url(self):
        with patch.dict(
            os.environ,
            {
                "OURA_CLIENT_ID": "oura-client",
                "OURA_REDIRECT_URI": "http://127.0.0.1:8000/api/wearables/oauth/oura/callback",
            },
            clear=False,
        ):
            auth = OuraAdapter().begin_auth("user_789")

        parsed = urlparse(auth.authorization_url)
        params = parse_qs(parsed.query)
        self.assertEqual(params["client_id"][0], "oura-client")
        state = _decode_state(params["state"][0])
        self.assertEqual(state["user_id"], "user_789")
        self.assertEqual(state["provider"], "oura")

    def test_garmin_service_extracts_provider_user_id(self):
        payload = {"meta": {"userId": "garmin-user-1"}}
        self.assertEqual(GarminService.extract_provider_user_id(payload), "garmin-user-1")


if __name__ == "__main__":
    unittest.main()
