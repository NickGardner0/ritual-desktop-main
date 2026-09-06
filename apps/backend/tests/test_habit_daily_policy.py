"""Golden matrix for canonical raw habit-log daily semantics."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from services.habit_daily_policy import aggregate_logs_by_date, daily_policy_v2_enabled


def habit(*, metric_type: str = "manual", unit: str = "count", name: str = "Metric"):
    return SimpleNamespace(
        id="habit-1",
        user_id="user-1",
        name=name,
        category="Health",
        metric_type=metric_type,
        integration_source=None,
        unit_type=unit,
    )


def log(identifier: str, *, status=None, duration=None, amount=None, date="2026-08-16"):
    return SimpleNamespace(id=identifier, status=status, duration=duration, amount=amount, date=date)


@pytest.mark.parametrize("status", [None, "", "completed", "success"])
def test_completed_legacy_statuses_are_included(status):
    values = aggregate_logs_by_date(habit(), [log("one", status=status)])
    assert values["2026-08-16"]["value"] == 1


@pytest.mark.parametrize("status", ["skipped", "missed"])
def test_non_completed_statuses_are_excluded(status):
    assert aggregate_logs_by_date(habit(), [log("one", status=status)]) == {}


def test_zero_negative_both_and_neither_values_follow_precedence():
    values = aggregate_logs_by_date(
        habit(unit="Hours"),
        [
            log("zero", amount=0),
            log("negative", amount=-3),
            log("both", duration=7200, amount=99),
            log("neither"),
        ],
    )
    day = values["2026-08-16"]
    assert day["value"] == 0 - 3 + 2 + 1
    assert day["entries"] == 4
    assert day["duration_seconds"] == 7200
    assert day["amount"] == -3


@pytest.mark.parametrize("metric_type", ["sleep", "sleep_session", "sleep_duration", "sleep_total", "in_bed"])
def test_sleep_aliases_use_maximum_daily_duration(metric_type):
    values = aggregate_logs_by_date(
        habit(metric_type=metric_type, unit="Hours", name="Sleep"),
        [log("short", duration=3600), log("long", duration=8 * 3600)],
    )
    assert values["2026-08-16"]["value"] == 8


def test_non_sleep_multi_session_duration_sums():
    values = aggregate_logs_by_date(
        habit(metric_type="computer_time", unit="Minutes", name="Computer Time"),
        [log("one", duration=600), log("two", duration=900)],
    )
    assert values["2026-08-16"]["value"] == 25


def test_sleep_max_preserves_a_negative_amount_instead_of_turning_it_into_zero():
    values = aggregate_logs_by_date(
        habit(metric_type="sleep_total", unit="score", name="Sleep Score"),
        [log("negative", amount=-2)],
    )
    assert values["2026-08-16"]["value"] == -2


@pytest.mark.parametrize(
    ("setting", "expected"),
    [("0", False), ("false", False), ("100", True), ("true", True)],
)
def test_rollout_flag_defaults_off_and_accepts_percentage(monkeypatch, setting, expected):
    monkeypatch.setenv("RITUAL_DAILY_POLICY_V2", setting)
    assert daily_policy_v2_enabled("user-1") is expected
