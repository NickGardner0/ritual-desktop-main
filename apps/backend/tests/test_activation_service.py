"""Focused tests for first-run activation state decisions."""

from __future__ import annotations

import os
import pathlib
import sys
import unittest
from types import SimpleNamespace

os.environ.setdefault("DATABASE_URL", "sqlite:///activation-test.db")
os.environ.setdefault("RITUAL_DB_LOCAL_ONLY", "1")

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from models.user_models import FirstBehaviorRequest  # noqa: E402
from services.activation_service import ActivationService  # noqa: E402


class ActivationServiceTests(unittest.TestCase):
    def setUp(self):
        self.service = ActivationService()

    def _bootstrap(self, *, full_name="Nick", timezone="America/New_York", first_logged=False):
        return self.service._build_response(
            user=SimpleNamespace(
                id="user-1",
                email="user@example.com",
                full_name=full_name,
                timezone=timezone,
            ),
            state=SimpleNamespace(
                first_habit_id="habit-1" if first_logged else None,
                first_log_id="log-1" if first_logged else None,
                first_behavior_logged_at="2026-06-04T14:00:00Z" if first_logged else None,
                activation_completed_at="2026-06-04T14:00:00Z" if first_logged else None,
                permissions_seen_at=None,
            ),
            checklist_rows=[],
            connected_providers=set(),
        )

    def test_bootstrap_routes_missing_profile_to_profile_step(self):
        bootstrap = self._bootstrap(full_name="", timezone=None)

        self.assertFalse(bootstrap.profileComplete)
        self.assertEqual(bootstrap.nextRoute, "/onboarding?s=profile")

    def test_bootstrap_routes_missing_first_behavior_to_first_behavior_step(self):
        bootstrap = self._bootstrap()

        self.assertTrue(bootstrap.profileComplete)
        self.assertFalse(bootstrap.firstBehaviorLogged)
        self.assertEqual(bootstrap.nextRoute, "/onboarding?s=first-behavior")

    def test_bootstrap_routes_activated_user_to_dashboard(self):
        bootstrap = self._bootstrap(first_logged=True)

        self.assertTrue(bootstrap.firstBehaviorLogged)
        self.assertTrue(bootstrap.activation.activationCompleted)
        self.assertEqual(bootstrap.nextRoute, "/dashboard")

    def test_connected_provider_marks_checklist_completed(self):
        bootstrap = self.service._build_response(
            user=SimpleNamespace(
                id="user-1",
                email="user@example.com",
                full_name="Nick",
                timezone="America/New_York",
            ),
            state=SimpleNamespace(
                first_habit_id="habit-1",
                first_log_id="log-1",
                first_behavior_logged_at="2026-06-04T14:00:00Z",
                activation_completed_at="2026-06-04T14:00:00Z",
                permissions_seen_at=None,
            ),
            checklist_rows=[
                SimpleNamespace(key="whoop", status="seen", metadata_json=None),
            ],
            connected_providers={"whoop"},
        )

        whoop = next(item for item in bootstrap.activation.checklist if item.key == "whoop")
        self.assertEqual(whoop.status, "completed")
        self.assertEqual(bootstrap.integrations["whoop"].status, "completed")

    def test_custom_template_requires_name(self):
        with self.assertRaises(ValueError):
            self.service._resolve_template(
                FirstBehaviorRequest(
                    templateKey="custom",
                    customName=" ",
                    date="2026-06-04",
                    completedAt="2026-06-04T14:00:00Z",
                    clientEventId="event-1",
                )
            )

        template = self.service._resolve_template(
            FirstBehaviorRequest(
                templateKey="custom",
                customName="Reading",
                date="2026-06-04",
                completedAt="2026-06-04T14:00:00Z",
                clientEventId="event-2",
            )
        )
        self.assertEqual(template["name"], "Reading")
        self.assertTrue(template["is_custom"])


if __name__ == "__main__":
    unittest.main()
