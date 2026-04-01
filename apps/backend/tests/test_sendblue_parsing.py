from types import SimpleNamespace

from api.sendblue import _parse_habit_log_from_text


def _habit(habit_id: str, name: str, unit_type: str):
    return SimpleNamespace(id=habit_id, name=name, unit_type=unit_type)


SAMPLE_HABITS = [
    _habit("habit-caffeine", "Caffeine Consumption", "Milligrams"),
    _habit("habit-steps", "Steps", "Steps"),
    _habit("habit-run", "Running", "Miles"),
    _habit("habit-walk", "Daily Walk", "Miles"),
    _habit("habit-sleep", "Sleep", "Hours"),
    _habit("habit-meditation", "Meditation", "Minutes"),
    _habit("habit-workout", "Morning Workout", "Minutes"),
    _habit("habit-water", "Water Intake", "Ounces"),
    _habit("habit-reading", "Reading", "Minutes"),
]


# --- Basic matching ---

def test_exact_habit_name_match():
    match = _parse_habit_log_from_text("Steps", SAMPLE_HABITS)
    assert match is not None
    assert match["habit_id"] == "habit-steps"


def test_number_with_habit_name():
    match = _parse_habit_log_from_text("30mg caffeine", SAMPLE_HABITS)
    assert match is not None
    assert match["habit_id"] == "habit-caffeine"
    assert match["amount"] == 30.0


def test_thousands_separator():
    match = _parse_habit_log_from_text("I walked 3,000 steps today", SAMPLE_HABITS)
    assert match is not None
    assert match["habit_id"] == "habit-steps"
    assert match["amount"] == 3000.0


def test_decimal_amount():
    match = _parse_habit_log_from_text("I consumed 200.5mg caffeine", SAMPLE_HABITS)
    assert match is not None
    assert match["habit_id"] == "habit-caffeine"
    assert match["amount"] == 200.5


# --- Verb form / stem matching ---

def test_past_tense_verb_matches_habit():
    match = _parse_habit_log_from_text("ran 5 miles", SAMPLE_HABITS)
    assert match is not None
    assert match["habit_id"] == "habit-run"
    assert match["amount"] == 5.0


def test_past_tense_walked_matches_walk_habit():
    match = _parse_habit_log_from_text("walked 2 miles", SAMPLE_HABITS)
    assert match is not None
    assert match["habit_id"] == "habit-walk"
    assert match["amount"] == 2.0


def test_past_tense_slept_matches_sleep():
    match = _parse_habit_log_from_text("slept 8 hours", SAMPLE_HABITS)
    assert match is not None
    assert match["habit_id"] == "habit-sleep"
    assert match["amount"] == 8.0


def test_gerund_form_matches():
    match = _parse_habit_log_from_text("meditating 20 min", SAMPLE_HABITS)
    assert match is not None
    assert match["habit_id"] == "habit-meditation"
    assert match["amount"] == 20.0


def test_past_tense_meditated():
    match = _parse_habit_log_from_text("meditated for 15 minutes", SAMPLE_HABITS)
    assert match is not None
    assert match["habit_id"] == "habit-meditation"
    assert match["amount"] == 15.0


# --- Synonym matching ---

def test_coffee_matches_caffeine():
    match = _parse_habit_log_from_text("200mg coffee", SAMPLE_HABITS)
    assert match is not None
    assert match["habit_id"] == "habit-caffeine"
    assert match["amount"] == 200.0


def test_gym_matches_workout():
    match = _parse_habit_log_from_text("45 min gym", SAMPLE_HABITS)
    assert match is not None
    assert match["habit_id"] == "habit-workout"
    assert match["amount"] == 45.0


# --- Unit matching ---

def test_unit_suffix_helps_match():
    match = _parse_habit_log_from_text("45min workout", SAMPLE_HABITS)
    assert match is not None
    assert match["habit_id"] == "habit-workout"
    assert match["amount"] == 45.0


def test_no_match_returns_none():
    match = _parse_habit_log_from_text("bought groceries", SAMPLE_HABITS)
    assert match is None


def test_no_amount_still_matches():
    match = _parse_habit_log_from_text("meditation", SAMPLE_HABITS)
    assert match is not None
    assert match["habit_id"] == "habit-meditation"
    assert match["amount"] is None


# --- Disambiguation ---

def test_longer_habit_name_wins_over_shorter():
    """'caffeine consumption' in the message should prefer 'Caffeine Consumption' over a shorter match."""
    match = _parse_habit_log_from_text("200mg caffeine consumption", SAMPLE_HABITS)
    assert match is not None
    assert match["habit_id"] == "habit-caffeine"
