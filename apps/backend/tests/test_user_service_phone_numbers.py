from services.user_service import _normalize_phone_number


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
