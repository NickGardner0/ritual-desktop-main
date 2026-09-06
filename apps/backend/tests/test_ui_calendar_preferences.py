from services.ui_preferences_service import _normalize_calendar_preferences


def test_calendar_preferences_migrate_legacy_planner_defaults_to_week():
    normalized = _normalize_calendar_preferences(
        {
            "version": 2,
            "view": "day",
            "tasks_open": True,
            "agents_open": True,
            "snap_minutes": 15,
        }
    )

    assert normalized["version"] == 3
    assert normalized["view"] == "week"
    assert normalized["tasks_open"] is False
    assert normalized["side_panel_open"] is True
    assert normalized["snap_minutes"] == 30


def test_calendar_preferences_preserve_explicit_v3_view_and_display_settings():
    normalized = _normalize_calendar_preferences(
        {
            "version": 3,
            "view": "day",
            "tasks_open": True,
            "side_panel_open": False,
            "show_weekends": False,
            "time_format": "24h",
            "snap_minutes": 15,
        }
    )

    assert normalized["view"] == "day"
    assert normalized["tasks_open"] is True
    assert normalized["side_panel_open"] is False
    assert normalized["show_weekends"] is False
    assert normalized["time_format"] == "24h"
    assert normalized["snap_minutes"] == 15
