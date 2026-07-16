"""Focused tests for first-run activation state decisions."""

from __future__ import annotations

import os
import pathlib
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

os.environ.setdefault("DATABASE_URL", "sqlite:///activation-test.db")
os.environ.setdefault("RITUAL_DB_LOCAL_ONLY", "1")

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from models.user_models import FirstBehaviorRequest  # noqa: E402
from services.activation_service import ActivationService  # noqa: E402


class _SessionContext:
    def __init__(self, session):
        self._session = session

    async def __aenter__(self):
        return self._session

    async def __aexit__(self, exc_type, exc, tb):
        return False


class ActivationServiceTests(unittest.TestCase):
    def setUp(self):
        self.service = ActivationService()

    def _bootstrap(self, *, full_name="Nick", timezone="America/New_York", first_logged=False, permissions_seen=False):
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
                permissions_seen_at="2026-06-04T14:05:00Z" if permissions_seen else None,
            ),
            checklist_rows=[],
            connected_providers=set(),
        )

    def test_bootstrap_routes_missing_profile_to_signup_step(self):
        bootstrap = self._bootstrap(full_name="", timezone=None)

        self.assertFalse(bootstrap.profileComplete)
        self.assertEqual(bootstrap.nextRoute, "/onboarding?s=signup")

    def test_bootstrap_routes_completed_setup_with_missing_profile_to_dashboard(self):
        bootstrap = self._bootstrap(
            full_name="Nick",
            timezone=None,
            permissions_seen=True,
        )

        self.assertFalse(bootstrap.profileComplete)
        self.assertTrue(bootstrap.permissionsSeen)
        self.assertEqual(bootstrap.nextRoute, "/dashboard")

    def test_bootstrap_routes_missing_permissions_seen_to_setup_step(self):
        bootstrap = self._bootstrap()

        self.assertTrue(bootstrap.profileComplete)
        self.assertFalse(bootstrap.permissionsSeen)
        self.assertEqual(bootstrap.nextRoute, "/onboarding?s=setup")

    def test_bootstrap_routes_setup_seen_user_to_dashboard(self):
        bootstrap = self._bootstrap(first_logged=True, permissions_seen=True)

        self.assertTrue(bootstrap.firstBehaviorLogged)
        self.assertTrue(bootstrap.activation.activationCompleted)
        self.assertTrue(bootstrap.permissionsSeen)
        self.assertEqual(bootstrap.nextRoute, "/dashboard")

    def test_bootstrap_routes_existing_activation_without_setup_seen_to_dashboard(self):
        bootstrap = self._bootstrap(first_logged=True)

        self.assertTrue(bootstrap.firstBehaviorLogged)
        self.assertTrue(bootstrap.activation.activationCompleted)
        self.assertFalse(bootstrap.permissionsSeen)
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
                permissions_seen_at="2026-06-04T14:05:00Z",
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


class ActivationCompletionTests(unittest.IsolatedAsyncioTestCase):
    async def test_existing_permissions_seen_state_is_backfilled_as_completed(self):
        service = ActivationService()
        user = SimpleNamespace(
            id="user-1",
            full_name="Nick",
            timezone=None,
            onboarding_completed=False,
            updated_at=None,
        )
        state = SimpleNamespace(
            profile_completed_at=None,
            first_habit_id=None,
            first_log_id=None,
            first_behavior_logged_at=None,
            activation_completed_at=None,
            permissions_seen_at="2026-07-16T18:38:46Z",
            updated_at=None,
        )
        session = AsyncMock()
        session.get = AsyncMock(return_value=state)

        with patch.object(
            service,
            "_get_first_existing_log",
            AsyncMock(return_value=None),
        ):
            result = await service._ensure_activation_state(session, user)

        self.assertIs(result, state)
        self.assertTrue(user.onboarding_completed)
        self.assertIsNotNone(state.activation_completed_at)

    async def test_mark_permissions_seen_completes_onboarding_and_routes_to_dashboard(self):
        service = ActivationService()
        user = SimpleNamespace(
            id="user-1",
            email="user@example.com",
            full_name="Nick",
            timezone=None,
            onboarding_completed=False,
            updated_at=None,
        )
        state = SimpleNamespace(
            first_habit_id=None,
            first_log_id=None,
            first_behavior_logged_at=None,
            activation_completed_at=None,
            permissions_seen_at=None,
            updated_at=None,
        )
        session = AsyncMock()
        session.get = AsyncMock(return_value=user)
        session.commit = AsyncMock()

        with patch(
            "services.activation_service.get_db_session",
            return_value=_SessionContext(session),
        ), patch.object(
            service,
            "_ensure_activation_state",
            AsyncMock(return_value=state),
        ), patch.object(
            service,
            "_get_checklist_rows",
            AsyncMock(return_value=[]),
        ), patch.object(
            service,
            "_get_connected_providers",
            AsyncMock(return_value=set()),
        ):
            bootstrap = await service.mark_permissions_seen(user_id="user-1")

        self.assertTrue(user.onboarding_completed)
        self.assertIsNotNone(state.permissions_seen_at)
        self.assertIsNotNone(state.activation_completed_at)
        self.assertEqual(bootstrap.nextRoute, "/dashboard")
        session.commit.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
