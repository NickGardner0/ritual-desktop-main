from datetime import datetime
from pathlib import Path
import sys

import pytest
from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from schemas.reports import HabitReportScheduleCreate
from schemas.workflows import WorkflowSchedule
from services.recurrence import next_report_run_at, next_workflow_run_at


@pytest.mark.parametrize(
    ("reference", "expected"),
    [
        (datetime(2025, 3, 8, 14, 0), datetime(2025, 3, 9, 13, 0)),
        (datetime(2025, 11, 1, 13, 0), datetime(2025, 11, 2, 14, 0)),
    ],
)
def test_workflow_adapter_preserves_local_time_across_dst(reference, expected):
    assert next_workflow_run_at(
        cadence="daily",
        timezone_name="America/New_York",
        send_hour_local=9,
        send_minute_local=0,
        send_weekdays=[],
        reference_utc=reference,
    ) == expected


def test_workflow_adapter_empty_daily_weekdays_means_every_day():
    assert next_workflow_run_at(
        cadence="daily",
        timezone_name="UTC",
        send_hour_local=8,
        send_minute_local=0,
        send_weekdays=[],
        reference_utc=datetime(2025, 1, 7, 8, 0),
    ) == datetime(2025, 1, 8, 8, 0)


def test_workflow_adapter_daily_subset_preserves_legacy_weekday_filter():
    assert next_workflow_run_at(
        cadence="daily",
        timezone_name="UTC",
        send_hour_local=18,
        send_minute_local=0,
        send_weekdays=[0, 1, 2, 3, 4],
        reference_utc=datetime(2025, 1, 10, 18, 0),  # Friday
    ) == datetime(2025, 1, 13, 18, 0)


def test_workflow_adapter_characterizes_legacy_unknown_cadence_rows():
    assert next_workflow_run_at(
        cadence="legacy-value",
        timezone_name="UTC",
        send_hour_local=18,
        send_minute_local=0,
        send_weekdays=[0, 1, 2, 3, 4],
        reference_utc=datetime(2025, 1, 10, 18, 0),
    ) == datetime(2025, 1, 13, 18, 0)


def test_report_adapter_caps_month_end_and_is_strictly_after_reference():
    assert next_report_run_at(
        cadence="monthly",
        timezone_name="UTC",
        send_hour_local=7,
        send_minute_local=30,
        send_weekday=None,
        send_day_of_month=31,
        reference_utc=datetime(2025, 1, 31, 7, 30),
    ) == datetime(2025, 2, 28, 7, 30)


def test_report_adapter_uses_shared_invalid_timezone_fallback():
    assert next_report_run_at(
        cadence="weekly",
        timezone_name="not/a-timezone",
        send_hour_local=9,
        send_minute_local=0,
        send_weekday=0,
        send_day_of_month=None,
        reference_utc=datetime(2025, 1, 6, 14, 0),
    ) == datetime(2025, 1, 13, 14, 0)


def test_schedule_schemas_reject_unsupported_combinations():
    with pytest.raises(ValidationError):
        WorkflowSchedule(cadence="monthly")
    with pytest.raises(ValidationError):
        WorkflowSchedule(cadence="weekly", send_weekdays=[])
    with pytest.raises(ValidationError):
        HabitReportScheduleCreate(
            name="Weekly",
            cadence="weekly",
            delivery_label="Weekly",
        )
