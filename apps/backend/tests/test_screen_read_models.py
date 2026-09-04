"""Tests for canonical dashboard screen read models."""

from __future__ import annotations

import pathlib
import sys
import unittest
from contextlib import asynccontextmanager
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.metric_facts_service import MetricFactService  # noqa: E402
from services.screen_read_models_service import ScreenReadModelsService  # noqa: E402


class _FakeScalarResult:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _FakeExecuteResult:
    def __init__(self, rows=None, scalar_value=None):
        self._rows = rows or []
        self._scalar_value = scalar_value

    def scalars(self):
        return _FakeScalarResult(self._rows)

    def scalar(self):
        return self._scalar_value


class _SequencedSession:
    def __init__(self, results):
        self._results = list(results)

    async def execute(self, _query):
        if not self._results:
            return _FakeExecuteResult([])
        return self._results.pop(0)


def _habit(
    habit_id: str,
    name: str,
    *,
    category: str = "Health",
    unit_type: str = "Hours",
    metric_type: str | None = None,
    integration_source: str | None = None,
):
    now = datetime(2026, 5, 29)
    return SimpleNamespace(
        id=habit_id,
        user_id="user-1",
        name=name,
        category=category,
        icon=None,
        is_custom=True,
        integration_source=integration_source,
        unit_type=unit_type,
        sensor_type=None,
        metric_type=metric_type,
        created_at=now,
        updated_at=now,
    )


def _fact(habit, date: str, value: float, *, metric_key: str = "manual", provider=None):
    return SimpleNamespace(
        id=f"fact-{habit.id}-{date}",
        user_id="user-1",
        habit_id=habit.id,
        habit_name=habit.name,
        metric_key=metric_key,
        date=date,
        value=value,
        unit=habit.unit_type,
        source_family="manual" if metric_key == "manual" else "watcher",
        provider=provider,
        record_count=1,
        status="complete",
    )


def _log(log_id: str, habit, date: str, amount: float):
    return SimpleNamespace(
        id=log_id,
        habit_id=habit.id,
        habit_name=habit.name,
        duration=None,
        amount=amount,
        date=date,
        completed_at=f"{date}T12:00:00",
        status="completed",
        notes=None,
        source="ai_log_v2",
        log_metadata=None,
    )


class ScreenReadModelTests(unittest.IsolatedAsyncioTestCase):
    async def test_metrics_snapshot_is_complete_and_fact_backed(self):
        workout = _habit("habit-workout", "Workout")
        caffeine = _habit("habit-caffeine", "Caffeine", unit_type="MG")
        facts = [
            _fact(workout, "2026-05-29", 1.0),
            _fact(caffeine, "2026-05-29", 250.0),
            _fact(caffeine, "2026-05-28", 200.0),
        ]
        session = _SequencedSession([
            _FakeExecuteResult([workout, caffeine]),
            _FakeExecuteResult(facts),
        ])

        @asynccontextmanager
        async def fake_get_db_session():
            yield session

        with patch("services.metric_facts_service.get_db_session", fake_get_db_session):
            snapshot = await MetricFactService().get_metrics_snapshot(
                user_id="user-1",
                start_date="2026-05-28",
                end_date="2026-05-29",
            )

        self.assertEqual(snapshot["meta"]["source"], "metric_facts")
        self.assertFalse(snapshot["meta"]["partial"])
        self.assertEqual(snapshot["overviewStats"]["habit-workout"]["total"], 1.0)
        self.assertEqual(snapshot["overviewStats"]["habit-caffeine"]["total"], 450.0)
        self.assertEqual(snapshot["metricsSummaryMetrics"]["habit-caffeine"]["total_value"], 450.0)
        self.assertEqual(len(snapshot["metricsAnalyticsData"]["habit-caffeine"]), 2)

    async def test_logs_read_model_adds_daily_iphone_rollups_without_raw_event_flood(self):
        nicotine = _habit("habit-nicotine", "Nicotine", unit_type="MG")
        iphone = _habit("habit-iphone", "iPhone Time", unit_type="Hours", metric_type="iphone_time")
        log = _log("log-1", nicotine, "2026-05-29", 8.0)
        iphone_fact = _fact(iphone, "2026-05-29", 3.5, metric_key="iphone_time", provider="biome_iphone")
        session = _SequencedSession([
            _FakeExecuteResult([nicotine, iphone]),
            _FakeExecuteResult(scalar_value=1),
            _FakeExecuteResult([log]),
            _FakeExecuteResult([iphone_fact]),
        ])

        @asynccontextmanager
        async def fake_get_db_session():
            yield session

        with patch("services.screen_read_models_service.get_db_session", fake_get_db_session):
            model = await ScreenReadModelsService().get_logs_read_model(
                user_id="user-1",
                start_date="2026-05-29",
                end_date="2026-05-29",
            )

        self.assertEqual(model["pagination"]["total"], 1)
        self.assertEqual(model["sourceCounts"]["ai_log_v2"], 1)
        self.assertEqual(model["sourceCounts"]["biome_iphone_rollup"], 1)
        self.assertEqual(model["rollups"]["iphoneTime"][0]["amount"], 3.5)
        self.assertTrue(model["rollups"]["iphoneTime"][0]["readOnly"])

if __name__ == "__main__":
    unittest.main()
