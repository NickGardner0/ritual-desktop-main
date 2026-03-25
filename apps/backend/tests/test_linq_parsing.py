from types import SimpleNamespace

from api.linq import _parse_habit_log_from_text


def _habit(habit_id: str, name: str, unit_type: str):
    return SimpleNamespace(id=habit_id, name=name, unit_type=unit_type)


def test_parse_habit_log_from_text_supports_thousands_separators():
    match = _parse_habit_log_from_text(
        "I walked 3,000 steps today",
        [_habit("habit-steps", "Steps", "Steps")],
    )

    assert match is not None
    assert match["habit_id"] == "habit-steps"
    assert match["amount"] == 3000.0


def test_parse_habit_log_from_text_still_supports_decimal_amounts():
    match = _parse_habit_log_from_text(
        "I consumed 200.5mg caffeine",
        [_habit("habit-caffeine", "Caffeine Consumption", "Milligrams")],
    )

    assert match is not None
    assert match["habit_id"] == "habit-caffeine"
    assert match["amount"] == 200.5
