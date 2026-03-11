import asyncio
import json
import os
import sqlite3
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, List

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from services.watcher_service_search import query_memory_impl


FIXTURE_PATH = Path(__file__).parent / "fixtures" / "memory_golden_queries.json"


def _load_fixture() -> Dict[str, Any]:
    with FIXTURE_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def _collect_evidence_text(result: Dict[str, Any]) -> str:
    parts: List[str] = []
    for citation in result.get("citations") or []:
        parts.append(str(citation.get("app_name") or ""))
        parts.append(str(citation.get("window_title") or ""))
        parts.append(str(citation.get("snippet") or ""))
    return " ".join(parts).lower()


def _case_passed(case: Dict[str, Any], result: Dict[str, Any]) -> bool:
    if not result.get("success"):
        return False

    expected_intent = case.get("intent")
    if expected_intent and result.get("intent_resolved") != expected_intent:
        return False

    evidence_text = _collect_evidence_text(result)
    expected_tokens = [str(token).lower() for token in (case.get("expect_any_tokens") or [])]
    forbidden_tokens = [str(token).lower() for token in (case.get("forbid_tokens") or [])]

    if expected_tokens and not any(token in evidence_text for token in expected_tokens):
        return False
    if forbidden_tokens and any(token in evidence_text for token in forbidden_tokens):
        return False

    return True


def _is_high_conf_false_claim(case: Dict[str, Any], result: Dict[str, Any]) -> bool:
    confidence = result.get("confidence") or {}
    level = str(confidence.get("level") or "").lower()
    if level not in {"high", "medium"}:
        return False

    expected_tokens = [str(token).lower() for token in (case.get("expect_any_tokens") or [])]
    if not expected_tokens:
        return False

    evidence_text = _collect_evidence_text(result)
    return not any(token in evidence_text for token in expected_tokens)


def _create_default_golden_db(path: str) -> None:
    now_ms = int(time.time() * 1000)
    conn = sqlite3.connect(path)
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE ocr_frames (
            id INTEGER PRIMARY KEY,
            timestamp INTEGER NOT NULL,
            app_bundle_id TEXT,
            app_name TEXT,
            window_title TEXT,
            ocr_text TEXT
        )
        """
    )
    cur.execute(
        """
        CREATE VIRTUAL TABLE ocr_frames_fts
        USING fts5(ocr_text)
        """
    )
    cur.execute(
        """
        CREATE TABLE activity_events (
            id INTEGER PRIMARY KEY,
            ts_start INTEGER NOT NULL,
            ts_end INTEGER NOT NULL,
            app_bundle_id TEXT,
            app_name TEXT,
            window_title TEXT,
            browser_url TEXT,
            browser_domain TEXT,
            is_afk INTEGER DEFAULT 0
        )
        """
    )
    ocr_rows = [
        (
            1,
            now_ms - 2_000_000,
            "com.todesktop.230313mzl4w4u92",
            "Cursor",
            "Implement authentication login flow",
            "Implemented authentication login flow and fixed signin redirect bug",
        ),
        (
            2,
            now_ms - 1_700_000,
            "com.google.Chrome",
            "Google Chrome",
            "Auth docs and signin bugfix notes",
            "Read authentication docs and OAuth signin troubleshooting notes",
        ),
        (
            3,
            now_ms - 1_200_000,
            "com.openai.chatgpt",
            "ChatGPT",
            "Weekly planning and time summary",
            "Summarized weekly time spent and planning notes",
        ),
        (
            4,
            now_ms - 1_500_000,
            "com.todesktop.230313mzl4w4u92",
            "Cursor",
            "Refine authentication redirect callback",
            "Updated Cursor auth redirect callback handling and fixed signin session mismatch",
        ),
    ]
    cur.executemany(
        """
        INSERT INTO ocr_frames (
            id, timestamp, app_bundle_id, app_name, window_title, ocr_text
        ) VALUES (?, ?, ?, ?, ?, ?)
        """,
        ocr_rows,
    )
    cur.executemany(
        """
        INSERT INTO ocr_frames_fts (rowid, ocr_text) VALUES (?, ?)
        """,
        [(row[0], row[5]) for row in ocr_rows],
    )

    cur.executemany(
        """
        INSERT INTO activity_events (
            id, ts_start, ts_end, app_bundle_id, app_name, window_title, browser_url, browser_domain, is_afk
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (
                1,
                now_ms - 2_000_000,
                now_ms - 1_900_000,
                "com.todesktop.230313mzl4w4u92",
                "Cursor",
                "Implement authentication login flow",
                "",
                "",
                0,
            ),
            (
                2,
                now_ms - 1_700_000,
                now_ms - 1_600_000,
                "com.google.Chrome",
                "Google Chrome",
                "Auth docs and signin bugfix notes",
                "https://auth0.com/docs",
                "auth0.com",
                0,
            ),
            (
                3,
                now_ms - 1_200_000,
                now_ms - 1_100_000,
                "com.openai.chatgpt",
                "ChatGPT",
                "Weekly planning and time summary",
                "https://chatgpt.com",
                "chatgpt.com",
                0,
            ),
            (
                4,
                now_ms - 1_500_000,
                now_ms - 1_420_000,
                "com.todesktop.230313mzl4w4u92",
                "Cursor",
                "Refine authentication redirect callback",
                "",
                "",
                0,
            ),
        ],
    )
    conn.commit()
    conn.close()


def test_memory_golden_gate() -> None:
    if not FIXTURE_PATH.exists():
        pytest.fail(f"Missing golden fixture file: {FIXTURE_PATH}")

    fixture = _load_fixture()
    cases = fixture.get("cases") or []
    if not isinstance(cases, list) or not cases:
        pytest.fail("Golden query fixture must include at least 1 case.")

    configured_db_path = (os.environ.get("RITUAL_ACTIVITY_DB_PATH") or "").strip()
    generated_tmp_dir: tempfile.TemporaryDirectory[str] | None = None
    if configured_db_path:
        db_path = configured_db_path
    else:
        generated_tmp_dir = tempfile.TemporaryDirectory()
        db_path = str(Path(generated_tmp_dir.name) / "memory_golden.db")
        _create_default_golden_db(db_path)
    if not Path(db_path).exists():
        pytest.fail(f"Configured RITUAL_ACTIVITY_DB_PATH does not exist: {db_path}")

    thresholds = fixture.get("thresholds") or {}
    min_precision = float(thresholds.get("min_precision", 0.85))
    max_high_conf_false_claims = int(thresholds.get("max_high_conf_false_claims", 0))

    passed = 0
    high_conf_false_claims = 0
    failures: List[str] = []
    original_db_override = os.environ.get("RITUAL_ACTIVITY_DB_PATH")
    os.environ["RITUAL_ACTIVITY_DB_PATH"] = db_path
    try:
        for case in cases:
            query = str(case.get("query") or "").strip()
            if not query:
                failures.append(f"{case.get('id') or 'unknown'}: missing query")
                continue

            result = asyncio.run(
                query_memory_impl(
                    service=None,
                    user_id="golden-test-user",
                    query=query,
                    intent=str(case.get("intent") or "auto"),
                    days_back=int(case.get("days_back") or 7),
                    start_date=case.get("start_date"),
                    end_date=case.get("end_date"),
                    group_by=str(case.get("group_by") or "app"),
                    limit=int(case.get("limit") or 20),
                )
            )

            if _case_passed(case, result):
                passed += 1
            else:
                failures.append(f"{case.get('id') or query}: expected evidence constraints not met")

            if _is_high_conf_false_claim(case, result):
                high_conf_false_claims += 1
                failures.append(f"{case.get('id') or query}: high/medium confidence without expected evidence")
    finally:
        if original_db_override is None:
            os.environ.pop("RITUAL_ACTIVITY_DB_PATH", None)
        else:
            os.environ["RITUAL_ACTIVITY_DB_PATH"] = original_db_override
        if generated_tmp_dir is not None:
            generated_tmp_dir.cleanup()

    precision = passed / max(len(cases), 1)
    diagnostics = (
        f"precision={precision:.3f} (min={min_precision:.3f}), "
        f"high_conf_false_claims={high_conf_false_claims} (max={max_high_conf_false_claims}), "
        f"cases={len(cases)}"
    )

    if precision < min_precision:
        failures.append(f"Precision gate failed: {diagnostics}")
    if high_conf_false_claims > max_high_conf_false_claims:
        failures.append(f"High-confidence false-claim gate failed: {diagnostics}")

    if failures:
        pytest.fail("\n".join(failures))
