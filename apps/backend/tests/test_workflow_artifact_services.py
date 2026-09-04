import json
import os
import sys
import unittest
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from database.models import ActionProfileDB, ArtifactDB, ArtifactRevisionDB, WorkflowDefinitionDB
from schemas.workflows import WorkflowDefinitionUpdate
from services.artifact_service import artifact_service
from services.workflow_service import WorkflowValidationError, workflow_service


class _ScalarResult:
    def __init__(self, values):
        self._values = list(values)

    def all(self):
        return list(self._values)

    def first(self):
        return self._values[0] if self._values else None


class _Result:
    def __init__(self, *, scalars=None, rows=None):
        self._scalars = _ScalarResult(scalars or [])
        self._rows = list(rows or [])

    def scalars(self):
        return self._scalars

    def all(self):
        return list(self._rows)


class _SessionContext:
    def __init__(self, session):
        self._session = session

    async def __aenter__(self):
        return self._session

    async def __aexit__(self, exc_type, exc, tb):
        return False


class WorkflowArtifactServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_ensure_default_action_profiles_creates_all_default_profiles_once(self):
        session = AsyncMock()
        session.execute = AsyncMock(return_value=_Result(scalars=[]))
        session.flush = AsyncMock()
        added = []
        session.add = Mock(side_effect=added.append)

        profiles = await workflow_service.ensure_default_action_profiles(session, "user-1")

        self.assertEqual({profile.mode for profile in profiles}, {"observe", "draft", "organize", "act"})
        self.assertEqual(len(added), 4)
        self.assertEqual(session.flush.await_count, 1)
        self.assertEqual(sum(1 for item in added if isinstance(item, ActionProfileDB)), 4)

    async def test_ensure_default_workflow_definitions_seeds_all_default_workflows(self):
        observe_profile = ActionProfileDB(
            id="observe-1",
            user_id="user-1",
            name="Observe",
            mode="observe",
            is_default=0,
            rules_json="{}",
        )
        draft_profile = ActionProfileDB(
            id="draft-1",
            user_id="user-1",
            name="Draft",
            mode="draft",
            is_default=1,
            rules_json="{}",
        )
        organize_profile = ActionProfileDB(
            id="organize-1",
            user_id="user-1",
            name="Organize",
            mode="organize",
            is_default=0,
            rules_json="{}",
        )
        act_profile = ActionProfileDB(
            id="act-1",
            user_id="user-1",
            name="Act",
            mode="act",
            is_default=0,
            rules_json="{}",
        )

        session = AsyncMock()
        session.execute = AsyncMock(
            side_effect=[
                _Result(scalars=[observe_profile, draft_profile, organize_profile, act_profile]),
                _Result(scalars=[]),
            ]
        )
        session.flush = AsyncMock()
        added = []
        session.add = Mock(side_effect=added.append)

        definitions = await workflow_service.ensure_default_workflow_definitions(
            session,
            user_id="user-1",
            timezone_name="America/Los_Angeles",
        )

        self.assertEqual(
            {definition.kind for definition in definitions},
            {"morning_brief", "shutdown_review", "daily_narrative", "distraction_spiral"},
        )
        self.assertEqual(len(added), 4)
        self.assertTrue(all(isinstance(item, WorkflowDefinitionDB) for item in added))
        self.assertTrue(all(item.action_profile_id == "draft-1" for item in added))
        self.assertTrue(all(item.timezone == "America/Los_Angeles" for item in added))
        self.assertEqual(session.flush.await_count, 1)

    async def test_update_definition_rejects_observe_profile_for_scheduled_workflow(self):
        definition = SimpleNamespace(
            id="wf-1",
            user_id="user-1",
            action_profile_id="observe-1",
            definition_family="routine",
            trigger_type="schedule",
            signal_kind=None,
            status="draft",
            cadence="daily",
            timezone="America/New_York",
            send_hour_local=8,
            send_minute_local=0,
            send_weekdays_json="[0,1,2,3,4]",
            delivery_channel="in_app",
            config_json="{}",
            updated_at=None,
            next_run_at=None,
            last_error=None,
        )
        observe_profile = SimpleNamespace(
            id="observe-1",
            user_id="user-1",
            name="Observe",
            mode="observe",
            is_default=0,
            rules_json="{}",
            created_at=None,
            updated_at=None,
        )
        session = AsyncMock()
        session.get = AsyncMock(side_effect=[definition, observe_profile])

        with patch("services.workflow_service.get_db_session", return_value=_SessionContext(session)), patch.object(
            workflow_service,
            "ensure_default_workflow_definitions",
            AsyncMock(return_value=[]),
        ):
            with self.assertRaises(WorkflowValidationError) as exc:
                await workflow_service.update_definition(
                    user_id="user-1",
                    definition_id="wf-1",
                    timezone_name="America/New_York",
                    payload=WorkflowDefinitionUpdate(status="scheduled"),
                )

        self.assertIn("Observe profile cannot be assigned", str(exc.exception))
        self.assertEqual(session.commit.await_count, 0)

    async def test_update_definition_allows_convert_ambient_to_routine(self):
        definition = SimpleNamespace(
            id="wf-ambient-1",
            user_id="user-1",
            action_profile_id="draft-1",
            definition_family="ambient",
            trigger_type="signal",
            signal_kind="daily_narrative",
            status="paused",
            cadence="daily",
            timezone="America/New_York",
            send_hour_local=8,
            send_minute_local=0,
            send_weekdays_json="[0,1,2,3,4,5,6]",
            delivery_channel="in_app",
            delivery_json="{\"publish\": true, \"inbox\": true}",
            ranking_json="{}",
            quiet_hours_json="{}",
            cooldown_minutes=240,
            expected_duration_minutes=30,
            config_json="{}",
            updated_at=None,
            next_run_at=None,
            last_error=None,
            created_at=None,
            kind="daily_narrative",
            name="Daily Narrative",
            last_run_at=None,
        )
        draft_profile = SimpleNamespace(
            id="draft-1",
            user_id="user-1",
            name="Draft",
            mode="draft",
            is_default=1,
            rules_json="{}",
            created_at=None,
            updated_at=None,
        )
        session = AsyncMock()
        session.get = AsyncMock(side_effect=[definition, draft_profile, draft_profile])

        with patch("services.workflow_service.get_db_session", return_value=_SessionContext(session)), patch.object(
            workflow_service,
            "ensure_default_workflow_definitions",
            AsyncMock(return_value=[]),
        ), patch.object(
            workflow_service,
            "_index_definition",
            AsyncMock(return_value=None),
        ):
            updated = await workflow_service.update_definition(
                user_id="user-1",
                definition_id="wf-ambient-1",
                timezone_name="America/New_York",
                payload=WorkflowDefinitionUpdate(
                    definition_family="routine",
                    trigger_type="schedule",
                    signal_kind=None,
                    status="draft",
                ),
            )

        self.assertEqual(updated.definition_family, "routine")
        self.assertEqual(updated.trigger_type, "schedule")
        self.assertIsNone(updated.signal_kind)
        self.assertEqual(session.commit.await_count, 1)

    async def test_ensure_report_run_artifact_creates_artifact_and_revision(self):
        preview = {
            "subject": "Weekly Ritual report",
            "preheader": "A quick look at your week",
            "title": "Your weekly Ritual report",
            "period_label": "Apr 20 - Apr 26",
            "intro_line": "Hi Nick, here is the compact version.",
            "summary": "Sleep Duration was the most consistent habit this week.",
            "metrics": [
                {
                    "label": "Tracked habits",
                    "value": "13",
                    "unit": "",
                    "note": "Across the selected week.",
                }
            ],
            "highlights": ["Sleep was stable.", "Walking streak held for five days."],
            "cta_label": "Open Ritual",
            "cta_url": "https://desktop.ritualdb.com/reports",
        }
        run = SimpleNamespace(
            id="report-run-1",
            user_id="user-1",
            schedule_id="report-schedule-1",
            cadence="weekly",
            summary_json=json.dumps(preview),
            artifact_id=None,
            generated_at=datetime(2026, 4, 29, 12, 0, 0),
            sent_at=None,
            period_start="2026-04-20",
            period_end="2026-04-26",
        )
        schedule = SimpleNamespace(timezone="America/New_York")

        session = AsyncMock()
        session.get = AsyncMock(return_value=None)
        session.execute = AsyncMock(return_value=_Result(scalars=[]))
        session.flush = AsyncMock()
        added = []
        session.add = Mock(side_effect=added.append)

        artifact = await artifact_service.ensure_report_run_artifact(session, run=run, schedule=schedule)

        self.assertIsNotNone(artifact)
        self.assertIsNotNone(run.artifact_id)
        self.assertEqual(sum(1 for item in added if isinstance(item, ArtifactDB)), 1)
        self.assertEqual(sum(1 for item in added if isinstance(item, ArtifactRevisionDB)), 1)
        stored_artifact = next(item for item in added if isinstance(item, ArtifactDB))
        body = json.loads(stored_artifact.body_json)
        self.assertEqual(stored_artifact.kind, "report")
        self.assertEqual(stored_artifact.source_type, "report_run")
        self.assertEqual(body["schemaVersion"], 1)
        self.assertEqual(body["blocks"][0]["type"], "hero")
        self.assertEqual(session.flush.await_count, 2)


if __name__ == "__main__":
    unittest.main()
