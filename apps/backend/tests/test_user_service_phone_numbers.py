import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from services.user_service import UserService, _normalize_phone_number


def test_normalize_phone_number_handles_common_us_formats():
    assert _normalize_phone_number("+1 (631) 745-0064") == "+16317450064"
    assert _normalize_phone_number("631-745-0064") == "+16317450064"
    assert _normalize_phone_number("16317450064") == "+16317450064"


def test_normalize_phone_number_preserves_non_us_digit_strings():
    assert _normalize_phone_number("+44 20 7946 0958") == "+442079460958"
    assert _normalize_phone_number("442079460958") == "442079460958"


def test_normalize_phone_number_handles_empty_values():
    assert _normalize_phone_number(None) is None
    assert _normalize_phone_number("   ") is None


def test_row_projection_includes_timezone_for_sms_phone_lookups():
    user = UserService._row_to_user_projection(
        (
            "user-1",
            "nick@example.com",
            "Nick Gardner",
            "+16317450064",
            "25-34",
            "Male",
            "US",
            '["Productivity"]',
            '["Whoop"]',
            True,
            None,
            None,
            "America/New_York",
            None,
        )
    )

    assert user.timezone == "America/New_York"
