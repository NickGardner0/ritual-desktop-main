from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.search_service import SearchService, QUICK_ACTIONS


def test_search_is_sql_not_typesense():
    service = SearchService()
    assert service.is_available is True
    payload = service._fallback_search("log")
    assert payload["fallback"] is True
    assert payload["quick_actions"]
    assert any(action["id"] == "log-habit" for action in QUICK_ACTIONS)
    assert "typesense" not in payload["quick_actions"][0]


def test_quick_actions_match_keywords():
    service = SearchService()
    results = service._search_quick_actions("whoop")
    assert results
    assert results[0]["id"] == "connect-wearables"
