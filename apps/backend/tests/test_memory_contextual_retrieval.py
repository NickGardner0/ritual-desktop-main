import os
import sqlite3
import sys
import tempfile
import time
import unittest
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from services.memory_cloud_query_service import (
    _build_recap_diversity_metrics,
    _select_diverse_recap_evidence,
)
from services.day_recap_service import NormalizedEvidence, build_recap_workstreams
from services.memory_story_service import build_story_plan, detect_story_renderer_kind
from services.watcher_service_search import query_memory_impl, search_context_memory_impl


class _DummyWatcherService:
    pass


@asynccontextmanager
async def _null_activity_connection_for_user(*args, **kwargs):
    yield None


def _normalized_evidence(
    *,
    evidence_id: str,
    source: str,
    start_ts: int,
    end_ts: int,
    app: str = "",
    title: str = "",
    raw_text: str = "",
    semantic_summary: str = "",
    document_path: str = "",
    confidence: float = 0.0,
    evidence_grade: str = "passive_presence",
    claim_strength: str = "low",
    entity_tokens: set[str] | None = None,
    metadata: dict | None = None,
) -> NormalizedEvidence:
    return NormalizedEvidence(
        evidence_id=evidence_id,
        source=source,
        start_ts=start_ts,
        end_ts=end_ts,
        app=app,
        title=title,
        raw_text=raw_text,
        semantic_summary=semantic_summary,
        document_path=document_path,
        confidence=confidence,
        evidence_grade=evidence_grade,
        claim_strength=claim_strength,
        entity_tokens=entity_tokens or set(),
        metadata=metadata or {},
    )


def _create_activity_db(path: str, now_ms: int) -> None:
    conn = sqlite3.connect(path)
    cursor = conn.cursor()
    cursor.execute(
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
    cursor.executemany(
        """
        INSERT INTO activity_events (
            id, ts_start, ts_end, app_bundle_id, app_name, window_title, browser_url, browser_domain, is_afk
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (
                1,
                now_ms - 60_000,
                now_ms - 10_000,
                "com.todesktop.230313mzl4w4u92",
                "Cursor",
                "feature branch",
                "",
                "",
                0,
            ),
            (
                2,
                now_ms - 180_000,
                now_ms - 120_000,
                "com.culturedcode.ThingsMac",
                "Things 3",
                "Inbox",
                "",
                "",
                0,
            ),
        ],
    )
    conn.commit()
    conn.close()


def _create_empty_memory_db(path: str) -> None:
    conn = sqlite3.connect(path)
    conn.commit()
    conn.close()


def _create_context_memory_db(path: str, now_ms: int) -> None:
    conn = sqlite3.connect(path)
    cursor = conn.cursor()
    cursor.execute(
        """
        CREATE TABLE context_snapshots (
            id INTEGER PRIMARY KEY,
            device_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            activity_event_id INTEGER,
            session_id INTEGER,
            ts INTEGER NOT NULL,
            source_type TEXT NOT NULL,
            app_bundle_id TEXT NOT NULL,
            app_name TEXT NOT NULL,
            window_title TEXT,
            browser_url TEXT,
            browser_domain TEXT,
            tab_title TEXT,
            document_title TEXT,
            visible_text_raw TEXT NOT NULL DEFAULT '',
            visible_text_norm TEXT NOT NULL DEFAULT '',
            capture_quality REAL NOT NULL DEFAULT 0.0,
            capture_components_json TEXT,
            ax_richness_score REAL NOT NULL DEFAULT 0.0,
            selected_text_present INTEGER NOT NULL DEFAULT 0,
            document_path TEXT,
            ax_source TEXT,
            capture_trigger TEXT,
            trigger_to_snapshot_ms INTEGER,
            ui_elements_json TEXT,
            dedup_key TEXT NOT NULL,
            is_sensitive_redacted INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )
        """
    )
    cursor.execute(
        """
        CREATE TABLE session_retrieval_docs (
            id INTEGER PRIMARY KEY,
            session_id INTEGER NOT NULL UNIQUE,
            device_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            source_kind TEXT NOT NULL DEFAULT 'context_session',
            chunk_start_ts INTEGER NOT NULL,
            chunk_end_ts INTEGER NOT NULL,
            app_name TEXT,
            browser_domain TEXT,
            window_title TEXT,
            document_title TEXT,
            raw_visible_text TEXT NOT NULL DEFAULT '',
            contextual_retrieval_text TEXT NOT NULL DEFAULT '',
            capture_quality REAL NOT NULL DEFAULT 0.0,
            context_version INTEGER NOT NULL DEFAULT 1,
            session_position INTEGER NOT NULL DEFAULT 0,
            session_count INTEGER NOT NULL DEFAULT 1,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )
        """
    )
    cursor.execute(
        """
        INSERT INTO session_retrieval_docs (
            id, session_id, device_id, user_id, source_kind, chunk_start_ts, chunk_end_ts,
            app_name, browser_domain, window_title, document_title, raw_visible_text,
            contextual_retrieval_text, capture_quality, context_version, session_position,
            session_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            1,
            77,
            "device-1",
            "user-1",
            "context_session",
            now_ms - 120_000,
            now_ms - 60_000,
            "Google Chrome",
            "app.ritual.so",
            "Ritual dashboard",
            "Chat",
            "Ritual dashboard visible chat context and implementation notes",
            "App: Google Chrome | Domain: app.ritual.so | Title: Ritual dashboard | Visible content: Ritual dashboard visible chat context and implementation notes",
            0.97,
            1,
            0,
            2,
            now_ms - 120_000,
            now_ms - 60_000,
        ),
    )
    cursor.execute(
        """
        INSERT INTO context_snapshots (
            id, device_id, user_id, activity_event_id, session_id, ts, source_type,
            app_bundle_id, app_name, window_title, browser_url, browser_domain, tab_title,
            document_title, visible_text_raw, visible_text_norm, capture_quality,
            capture_components_json, ax_richness_score, selected_text_present, document_path,
            ax_source, capture_trigger, trigger_to_snapshot_ms, ui_elements_json, dedup_key,
            is_sensitive_redacted, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            10,
            "device-1",
            "user-1",
            None,
            77,
            now_ms - 70_000,
            "browser_extension",
            "com.google.Chrome",
            "Google Chrome",
            "Ritual dashboard",
            "https://app.ritual.so/chat",
            "app.ritual.so",
            "Chat",
            "Chat",
            "A lower-priority raw snapshot body",
            "a lower-priority raw snapshot body",
            0.55,
            "[\"document_title\",\"browser_tab\",\"visible_text\"]",
            0.0,
            0,
            None,
            None,
            "browser_heartbeat",
            None,
            None,
            "snapshot-dedup-1",
            0,
            now_ms - 70_000,
            now_ms - 70_000,
        ),
    )
    conn.commit()
    conn.close()


class ContextualRetrievalTests(unittest.IsolatedAsyncioTestCase):
    def test_build_recap_workstreams_preserves_direct_action_grading(self):
        now_ms = int(time.time() * 1000)
        evidence_rows = [
            _normalized_evidence(
                evidence_id="git:1",
                source="git_commit",
                start_ts=now_ms - 90_000,
                end_ts=now_ms - 90_000,
                app="git",
                title="ritual-desktop-main",
                raw_text="Fix microphone entitlement for native voice mode",
                semantic_summary="Fix microphone entitlement for native voice mode",
                confidence=0.92,
                evidence_grade="direct_action",
                claim_strength="high",
                entity_tokens={"voice", "microphone", "entitlement"},
                metadata={"message": "Fix microphone entitlement for native voice mode"},
            ),
            _normalized_evidence(
                evidence_id="snap:1",
                source="context_snapshot",
                start_ts=now_ms - 75_000,
                end_ts=now_ms - 75_000,
                app="System Settings",
                title="Privacy & Security > Microphone",
                raw_text="Allow the applications below to access your microphone",
                confidence=0.25,
                evidence_grade="low_signal_ui",
                claim_strength="low",
                entity_tokens={"microphone", "settings"},
            ),
        ]

        workstreams = build_recap_workstreams(evidence_rows, [])
        self.assertEqual(len(workstreams), 1)
        self.assertEqual(workstreams[0].evidence_grade, "direct_action")
        self.assertGreaterEqual(workstreams[0].direct_evidence_count, 1)
        self.assertIn(workstreams[0].claim_strength, {"medium", "high"})

    def test_detect_story_renderer_prefers_app_drilldown_over_daypart(self):
        renderer = detect_story_renderer_kind(
            "What was I doing in Cursor this morning?",
            "semantic_lookup",
        )
        self.assertEqual(renderer, "app_drilldown")

    def test_story_plan_extracts_work_items_claims_and_renderer(self):
        now_ms = int(time.time() * 1000)
        citations = [
            {
                "evidence_id": "e1",
                "timestamp": now_ms - 40_000,
                "app_name": "Cursor",
                "window_title": "ritual-desktop-main | apps/backend/services/watcher_service_search.py",
                "document_title": "watcher_service_search.py",
                "browser_domain": "",
                "session_key": "session-cursor",
                "snippet": "Implement search_context_memory renderer and fix recap claim cards in watcher_service_search.py",
                "parent_context": "Cursor / ritual-desktop-main / watcher_service_search.py",
                "score": 0.91,
                "source": "context_session",
            },
            {
                "evidence_id": "e2",
                "timestamp": now_ms - 30_000,
                "app_name": "Google Chrome",
                "window_title": "Anthropic contextual retrieval article",
                "document_title": "Anthropic contextual retrieval",
                "browser_domain": "anthropic.com",
                "session_key": "session-browser",
                "snippet": "Read Anthropic contextual retrieval article and compare retrieval diversity metrics for Ritual search",
                "score": 0.82,
                "source": "context_session",
            },
            {
                "evidence_id": "e3",
                "timestamp": now_ms - 20_000,
                "app_name": "Things 3",
                "window_title": "Today",
                "document_title": "Today",
                "browser_domain": "",
                "session_key": "session-things",
                "snippet": "Finalize Ritual landing page and ship vector search overhaul for launch day",
                "score": 0.79,
                "source": "context_session",
            },
        ]

        story_plan = build_story_plan(
            citations,
            query="What did I work on this morning?",
            intent="broad_overview",
        )

        self.assertIsInstance(story_plan, dict)
        self.assertIsInstance(story_plan.get("main_event"), dict)
        self.assertGreater(len(story_plan.get("work_items") or []), 0)
        self.assertGreater(len(story_plan.get("document_items") or []), 0)
        self.assertGreater(len(story_plan.get("claim_cards") or []), 0)
        self.assertGreater(len(story_plan.get("timeline_segments") or []), 0)
        self.assertIn("renderer", story_plan)

    def test_story_plan_separates_personal_and_research_from_work(self):
        now_ms = int(time.time() * 1000)
        citations = [
            {
                "evidence_id": "w1",
                "timestamp": now_ms - 60_000,
                "app_name": "Codex",
                "window_title": "ritual-desktop-main",
                "document_title": "watcher_service_search.py",
                "browser_domain": "",
                "session_key": "session-work",
                "snippet": "Implement context memory recap renderer and fix sessionization in watcher_service_search.py",
                "parent_context": "Codex / ritual-desktop-main / watcher_service_search.py",
                "score": 0.95,
                "source": "context_session",
            },
            {
                "evidence_id": "r1",
                "timestamp": now_ms - 40_000,
                "app_name": "Google Chrome",
                "window_title": "Mobbin - dashboard inspiration - Google Chrome - Nick",
                "document_title": "Mobbin dashboard inspiration",
                "browser_domain": "mobbin.com",
                "session_key": "session-research",
                "snippet": "Browsing dashboard inspiration and UI patterns for the activity breakdown redesign",
                "score": 0.82,
                "source": "context_session",
            },
            {
                "evidence_id": "p1",
                "timestamp": now_ms - 20_000,
                "app_name": "Perplexity",
                "window_title": "Perplexity",
                "document_title": "Perplexity",
                "browser_domain": "",
                "session_key": "session-personal",
                "snippet": "What benefits does glycine provide for the body/brain and how soon can they be felt/noticed?",
                "score": 0.87,
                "source": "context_session",
            },
        ]

        story_plan = build_story_plan(
            citations,
            query="What did I work on today?",
            intent="broad_overview",
        )

        self.assertEqual((story_plan.get("main_event") or {}).get("activity_class"), "work")
        self.assertTrue(any(item.get("activity_class") == "design_inspiration" for item in story_plan.get("research_browsing") or []))
        self.assertTrue(any(item.get("activity_class") in {"personal", "entertainment"} for item in story_plan.get("personal_activity") or []))
        self.assertEqual((story_plan.get("renderer") or {}).get("kind"), "broad_overview")
        self.assertTrue(any(item.get("parent_contexts") for item in (story_plan.get("document_items") or [])))
        self.assertGreater((story_plan.get("metrics") or {}).get("claim_grounding_rate", 0.0), 0.0)
        self.assertIn("specific_tasks", story_plan)
        self.assertTrue(any("ritual" in task.lower() for task in (story_plan.get("specific_tasks") or [])))
        claim_kinds = {str(card.get("claim_kind")) for card in (story_plan.get("claim_cards") or [])}
        self.assertIn("document_worked_on", claim_kinds)
        self.assertIn("main_event", claim_kinds)

    def test_story_plan_prefers_grounded_task_titles_over_window_shell_noise(self):
        now_ms = int(time.time() * 1000)
        citations = [
            {
                "evidence_id": "paper-1",
                "timestamp": now_ms - 30_000,
                "app_name": "Paper",
                "window_title": "Scratchpad · Paper",
                "document_title": "Scratchpad · Paper",
                "browser_domain": "",
                "session_key": "session-paper",
                "snippet": "Can you help me redesign this Activity Breakdown card that shows app/browser usage statistics? Make the design look polished and sharp.",
                "score": 0.96,
                "source": "context_snapshot",
            },
            {
                "evidence_id": "codex-1",
                "timestamp": now_ms - 20_000,
                "app_name": "Codex",
                "window_title": "Codex",
                "document_title": "Codex",
                "browser_domain": "",
                "session_key": "session-codex",
                "snippet": "Add files and more. Ask for follow-up changes. Implement the screen activity recap formatter and route broad overview queries to context memory instead of habit analytics.",
                "score": 0.94,
                "source": "context_snapshot",
            },
            {
                "evidence_id": "x-noise",
                "timestamp": now_ms - 10_000,
                "app_name": "Google Chrome",
                "window_title": "Notifications / X",
                "document_title": "Notifications / X",
                "browser_domain": "x.com",
                "session_key": "session-x",
                "snippet": "To view keyboard shortcuts, press question mark. Notifications / X.",
                "score": 0.9,
                "source": "context_snapshot",
            },
        ]

        story_plan = build_story_plan(
            citations,
            query="What did I work on today?",
            intent="broad_overview",
        )

        main_event_title = str((story_plan.get("main_event") or {}).get("title") or "").lower()
        tasks = [str(task).lower() for task in (story_plan.get("concrete_tasks_completed") or [])]
        self.assertNotIn("quick look", main_event_title)
        self.assertNotIn("notifications / x", main_event_title)
        self.assertNotIn("add files and more", " ".join(tasks))
        self.assertNotIn("ask for follow-up changes", " ".join(tasks))
        self.assertTrue(
            "activity breakdown card" in main_event_title
            or any("activity breakdown card" in task for task in tasks)
            or any("context memory" in task for task in tasks)
        )

    async def test_search_context_memory_prefers_session_retrieval_docs(self):
        now_ms = int(time.time() * 1000)
        with tempfile.TemporaryDirectory() as tmp:
            memory_db_path = f"{tmp}/memory.db"
            _create_context_memory_db(memory_db_path, now_ms)

            with patch(
                "services.watcher_service_search.get_local_watcher_db_path_impl",
                return_value=memory_db_path,
            ), patch(
                "services.watcher_service_search.get_local_activity_db_path_impl",
                return_value=memory_db_path,
            ):
                result = await search_context_memory_impl(
                    service=_DummyWatcherService(),
                    user_id="user-1",
                    query="ritual dashboard implementation notes",
                    days_back=1,
                    limit=5,
                    allow_legacy_fallback=False,
                )

        self.assertTrue(result["success"])
        self.assertEqual(result["mode_used"], "context-session-docs")
        self.assertEqual(result["result_count"], 1)
        first = result["results"][0]
        self.assertEqual(first["session_id"], 77)
        self.assertEqual(first["source_type"], "context_session")
        self.assertGreater(first["capture_quality"], 0.9)
        self.assertIn("implementation notes", first["snippet"].lower())
        self.assertIsInstance(result.get("story_plan"), dict)
        self.assertIsInstance(result.get("renderer"), dict)
        self.assertGreater((result.get("debug") or {}).get("claim_count", 0), 0)
        self.assertGreater(len((result.get("story_plan") or {}).get("document_items") or []), 0)

    async def test_search_context_memory_uses_per_user_activity_provider_after_cutover(self):
        now_ms = int(time.time() * 1000)
        with tempfile.TemporaryDirectory() as tmp:
            replica_path = f"{tmp}/per-user-activity.db"
            _create_context_memory_db(replica_path, now_ms)

            @asynccontextmanager
            async def _open_per_user_conn(user_id: str, *, write: bool = False):
                self.assertEqual(user_id, "user-1")
                self.assertFalse(write)
                conn = sqlite3.connect(replica_path)
                conn.row_factory = sqlite3.Row
                try:
                    yield conn
                finally:
                    conn.close()

            with patch(
                "services.watcher_service_search.get_local_watcher_db_path_impl",
                return_value=f"{tmp}/missing-memory.db",
            ), patch(
                "services.watcher_service_search.get_local_activity_db_path_impl",
                return_value=f"{tmp}/missing-activity.db",
            ), patch(
                "services.watcher_service_local_db.open_activity_connection_for_user",
                _open_per_user_conn,
            ):
                result = await search_context_memory_impl(
                    service=_DummyWatcherService(),
                    user_id="user-1",
                    query="ritual dashboard implementation notes",
                    days_back=1,
                    limit=5,
                    allow_legacy_fallback=False,
                )

        self.assertTrue(result["success"])
        self.assertEqual(result["mode_used"], "context-session-docs")
        self.assertEqual(result["source_db"], "turso_replica")
        self.assertEqual(result["result_count"], 1)

    async def test_search_context_memory_overview_prefers_snapshots_and_filters_browser_noise(self):
        now_ms = int(time.time() * 1000)
        with tempfile.TemporaryDirectory() as tmp:
            memory_db_path = f"{tmp}/memory.db"
            conn = sqlite3.connect(memory_db_path)
            cursor = conn.cursor()
            cursor.execute(
                """
                CREATE TABLE context_snapshots (
                    id INTEGER PRIMARY KEY,
                    device_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    activity_event_id INTEGER,
                    session_id INTEGER,
                    ts INTEGER NOT NULL,
                    source_type TEXT NOT NULL,
                    app_bundle_id TEXT NOT NULL,
                    app_name TEXT NOT NULL,
                    window_title TEXT,
                    browser_url TEXT,
                    browser_domain TEXT,
                    tab_title TEXT,
                    document_title TEXT,
                    visible_text_raw TEXT NOT NULL DEFAULT '',
                    visible_text_norm TEXT NOT NULL DEFAULT '',
                    capture_quality REAL NOT NULL DEFAULT 0.0,
                    capture_components_json TEXT,
                    ax_richness_score REAL NOT NULL DEFAULT 0.0,
                    selected_text_present INTEGER NOT NULL DEFAULT 0,
                    document_path TEXT,
                    ax_source TEXT,
                    capture_trigger TEXT,
                    trigger_to_snapshot_ms INTEGER,
                    ui_elements_json TEXT,
                    dedup_key TEXT NOT NULL,
                    is_sensitive_redacted INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                )
                """
            )
            cursor.execute(
                """
                CREATE TABLE session_retrieval_docs (
                    id INTEGER PRIMARY KEY,
                    session_id INTEGER NOT NULL UNIQUE,
                    device_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    source_kind TEXT NOT NULL DEFAULT 'context_session',
                    chunk_start_ts INTEGER NOT NULL,
                    chunk_end_ts INTEGER NOT NULL,
                    app_name TEXT,
                    browser_domain TEXT,
                    window_title TEXT,
                    document_title TEXT,
                    raw_visible_text TEXT NOT NULL DEFAULT '',
                    contextual_retrieval_text TEXT NOT NULL DEFAULT '',
                    capture_quality REAL NOT NULL DEFAULT 0.0,
                    context_version INTEGER NOT NULL DEFAULT 1,
                    session_position INTEGER NOT NULL DEFAULT 0,
                    session_count INTEGER NOT NULL DEFAULT 1,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                )
                """
            )
            cursor.execute(
                """
                INSERT INTO session_retrieval_docs (
                    id, session_id, device_id, user_id, source_kind, chunk_start_ts, chunk_end_ts,
                    app_name, browser_domain, window_title, document_title, raw_visible_text,
                    contextual_retrieval_text, capture_quality, context_version, session_position,
                    session_count, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    1,
                    7,
                    "device-1",
                    "user-1",
                    "context_session",
                    now_ms - 30 * 60_000,
                    now_ms - 5 * 60_000,
                    "ritual-desktop",
                    "paper.design",
                    "Quick Look",
                    "Quick Look",
                    "Quick Look\nMCP • Paper - Google Chrome - Nick\nCodex | Ask for follow-up changes",
                    "Quick Look Paper Google Chrome Codex",
                    0.55,
                    1,
                    0,
                    1,
                    now_ms - 30 * 60_000,
                    now_ms - 5 * 60_000,
                ),
            )
            snapshot_rows = [
                (
                    10,
                    "device-1",
                    "user-1",
                    None,
                    7,
                    now_ms - 10 * 60_000,
                    "browser_extension",
                    "com.google.Chrome",
                    "Google Chrome",
                    "Notifications / X",
                    "https://x.com/notifications",
                    "x.com",
                    "Notifications / X",
                    "Notifications / X",
                    "To view keyboard shortcuts, press question mark. Notifications / X.",
                    "to view keyboard shortcuts notifications x",
                    0.98,
                    "[\"document_title\",\"browser_tab\",\"visible_text\"]",
                    0.0,
                    0,
                    None,
                    None,
                    "browser_heartbeat",
                    None,
                    None,
                    "noise-1",
                    0,
                    now_ms - 10 * 60_000,
                    now_ms - 10 * 60_000,
                ),
                (
                    11,
                    "device-1",
                    "user-1",
                    None,
                    7,
                    now_ms - 11 * 60_000,
                    "macos_accessibility",
                    "app.paper",
                    "Paper",
                    "Scratchpad · Paper",
                    "",
                    "",
                    "",
                    "Scratchpad · Paper",
                    "Can you help me redesign this Activity Breakdown card that shows app/browser usage statistics? Make the design look polished and sharp.",
                    "can you help me redesign this activity breakdown card that shows app browser usage statistics make the design look polished and sharp",
                    0.98,
                    "[\"document_identity\",\"focused_node_text\",\"nearby_structural_text\"]",
                    0.91,
                    1,
                    "/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/components/analytics/activity-breakdown-card.tsx",
                    "focused",
                    "ax_event",
                    420,
                    None,
                    "paper-1",
                    0,
                    now_ms - 11 * 60_000,
                    now_ms - 11 * 60_000,
                ),
                (
                    12,
                    "device-1",
                    "user-1",
                    None,
                    7,
                    now_ms - 12 * 60_000,
                    "macos_accessibility",
                    "app.codex",
                    "Codex",
                    "Codex",
                    "",
                    "",
                    "",
                    "Codex",
                    "Implement the screen activity recap formatter and route broad overview queries to context memory instead of habit analytics.",
                    "implement the screen activity recap formatter and route broad overview queries to context memory instead of habit analytics",
                    0.96,
                    "[\"focused_node_text\",\"nearby_structural_text\"]",
                    0.88,
                    0,
                    None,
                    "focused",
                    "ax_event",
                    650,
                    None,
                    "codex-1",
                    0,
                    now_ms - 12 * 60_000,
                    now_ms - 12 * 60_000,
                ),
            ]
            cursor.executemany(
                """
                INSERT INTO context_snapshots (
                    id, device_id, user_id, activity_event_id, session_id, ts, source_type,
                    app_bundle_id, app_name, window_title, browser_url, browser_domain, tab_title,
                    document_title, visible_text_raw, visible_text_norm, capture_quality,
                    capture_components_json, ax_richness_score, selected_text_present, document_path,
                    ax_source, capture_trigger, trigger_to_snapshot_ms, ui_elements_json, dedup_key,
                    is_sensitive_redacted, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                snapshot_rows,
            )
            conn.commit()
            conn.close()

            with patch(
                "services.watcher_service_search.get_local_watcher_db_path_impl",
                return_value=memory_db_path,
            ), patch(
                "services.watcher_service_search.get_local_activity_db_path_impl",
                return_value=memory_db_path,
            ), patch(
                "services.watcher_service_local_db.open_activity_connection_for_user",
                _null_activity_connection_for_user,
            ):
                result = await search_context_memory_impl(
                    service=_DummyWatcherService(),
                    user_id="user-1",
                    query="What did I work on today?",
                    days_back=7,
                    limit=5,
                    allow_legacy_fallback=False,
                )

        self.assertTrue(result["success"])
        self.assertEqual(result["days_back"], 1)
        self.assertIn(result["mode_used"], {"context-session-docs", "context-snapshots"})
        self.assertGreaterEqual(result["result_count"], 1)
        top_windows = [str(item.get("window_title") or "") for item in (result.get("results") or [])]
        self.assertFalse(any("Notifications / X" == window for window in top_windows))
        tasks = (result.get("story_plan") or {}).get("concrete_tasks_completed") or []
        self.assertTrue(any("activity breakdown card" in str(task).lower() or "context memory" in str(task).lower() for task in tasks))
        main_event_title = str(((result.get("story_plan") or {}).get("main_event") or {}).get("title") or "").lower()
        self.assertNotIn("quick look", main_event_title)
        self.assertNotIn("notifications / x", main_event_title)

    async def test_search_context_memory_app_drilldown_hard_filters_to_requested_app(self):
        now_ms = int(time.time() * 1000)
        with tempfile.TemporaryDirectory() as tmp:
            memory_db_path = f"{tmp}/memory.db"
            conn = sqlite3.connect(memory_db_path)
            cursor = conn.cursor()
            cursor.execute(
                """
                CREATE TABLE context_snapshots (
                    id INTEGER PRIMARY KEY,
                    device_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    activity_event_id INTEGER,
                    session_id INTEGER,
                    ts INTEGER NOT NULL,
                    source_type TEXT NOT NULL,
                    app_bundle_id TEXT NOT NULL,
                    app_name TEXT NOT NULL,
                    window_title TEXT,
                    browser_url TEXT,
                    browser_domain TEXT,
                    tab_title TEXT,
                    document_title TEXT,
                    visible_text_raw TEXT NOT NULL DEFAULT '',
                    visible_text_norm TEXT NOT NULL DEFAULT '',
                    capture_quality REAL NOT NULL DEFAULT 0.0,
                    capture_components_json TEXT,
                    ax_richness_score REAL NOT NULL DEFAULT 0.0,
                    selected_text_present INTEGER NOT NULL DEFAULT 0,
                    document_path TEXT,
                    ax_source TEXT,
                    capture_trigger TEXT,
                    trigger_to_snapshot_ms INTEGER,
                    ui_elements_json TEXT,
                    dedup_key TEXT NOT NULL,
                    is_sensitive_redacted INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                )
                """
            )
            cursor.execute(
                """
                CREATE TABLE session_retrieval_docs (
                    id INTEGER PRIMARY KEY,
                    session_id INTEGER NOT NULL UNIQUE,
                    device_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    source_kind TEXT NOT NULL DEFAULT 'context_session',
                    chunk_start_ts INTEGER NOT NULL,
                    chunk_end_ts INTEGER NOT NULL,
                    app_name TEXT,
                    browser_domain TEXT,
                    window_title TEXT,
                    document_title TEXT,
                    raw_visible_text TEXT NOT NULL DEFAULT '',
                    contextual_retrieval_text TEXT NOT NULL DEFAULT '',
                    capture_quality REAL NOT NULL DEFAULT 0.0,
                    context_version INTEGER NOT NULL DEFAULT 1,
                    session_position INTEGER NOT NULL DEFAULT 0,
                    session_count INTEGER NOT NULL DEFAULT 1,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                )
                """
            )
            cursor.executemany(
                """
                INSERT INTO context_snapshots (
                    id, device_id, user_id, activity_event_id, session_id, ts, source_type,
                    app_bundle_id, app_name, window_title, browser_url, browser_domain, tab_title,
                    document_title, visible_text_raw, visible_text_norm, capture_quality,
                    capture_components_json, ax_richness_score, selected_text_present, document_path,
                    ax_source, capture_trigger, trigger_to_snapshot_ms, ui_elements_json, dedup_key,
                    is_sensitive_redacted, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        21,
                        "device-1",
                        "user-1",
                        None,
                        9,
                        now_ms - 45_000,
                        "macos_accessibility_deep",
                        "com.todesktop.230313mzl4w4u92",
                        "Cursor",
                        "ritual-desktop-main",
                        "",
                        "",
                        "",
                        "watcher_service_search.py",
                        "Implement app drilldown result scoping and fix Cursor recap quality in watcher_service_search.py",
                        "implement app drilldown result scoping and fix cursor recap quality in watcher_service_search.py",
                        0.98,
                        "[\"document_identity\",\"selected_text\",\"focused_node_text\"]",
                        0.94,
                        1,
                        "/Users/nickgardner/Desktop/ritual-desktop-main/apps/backend/services/watcher_service_search.py",
                        "focused",
                        "ax_event",
                        210,
                        None,
                        "cursor-1",
                        0,
                        now_ms - 45_000,
                        now_ms - 45_000,
                    ),
                    (
                        22,
                        "device-1",
                        "user-1",
                        None,
                        10,
                        now_ms - 40_000,
                        "browser_extension",
                        "com.google.Chrome",
                        "Google Chrome",
                        "OpenWearables docs",
                        "https://docs.openwearables.io/sdk",
                        "docs.openwearables.io",
                        "iOS SDK",
                        "iOS SDK",
                        "OpenWearables iOS SDK reference and system overview docs.",
                        "openwearables ios sdk reference and system overview docs",
                        0.97,
                        "[\"browser_tab\",\"visible_text\"]",
                        0.0,
                        0,
                        None,
                        None,
                        "browser_heartbeat",
                        None,
                        None,
                        "chrome-1",
                        0,
                        now_ms - 40_000,
                        now_ms - 40_000,
                    ),
                ],
            )
            conn.commit()
            conn.close()

            with patch(
                "services.watcher_service_search.get_local_watcher_db_path_impl",
                return_value=memory_db_path,
            ), patch(
                "services.watcher_service_search.get_local_activity_db_path_impl",
                return_value=memory_db_path,
            ):
                result = await search_context_memory_impl(
                    service=_DummyWatcherService(),
                    user_id="user-1",
                    query="What was I doing in Cursor today?",
                    days_back=1,
                    limit=10,
                    allow_legacy_fallback=False,
                )

        self.assertTrue(result["success"])
        self.assertEqual((result.get("renderer") or {}).get("kind"), "app_drilldown")
        self.assertGreaterEqual(result["result_count"], 1)
        # Primary app results should be the majority for app-scoped queries
        all_results = result.get("results") or []
        cursor_results = [item for item in all_results if str(item.get("app_name") or "").lower() == "cursor"]
        self.assertGreater(len(cursor_results), 0, "At least one result should be from Cursor")
        if len(all_results) > 1:
            self.assertGreaterEqual(
                len(cursor_results) / len(all_results), 0.5,
                f"Cursor results should be the majority for app-scoped query, got {len(cursor_results)}/{len(all_results)}"
            )
        all_citations = result.get("citations") or []
        cursor_citations = [item for item in all_citations if str(item.get("app_name") or "").lower() == "cursor"]
        self.assertGreater(len(cursor_citations), 0, "At least one citation should be from Cursor")
        if len(all_citations) > 1:
            self.assertGreaterEqual(
                len(cursor_citations) / len(all_citations), 0.5,
                f"Cursor citations should be the majority for app-scoped query, got {len(cursor_citations)}/{len(all_citations)}"
            )
        top_snippets = " ".join(str(item.get("snippet") or "") for item in (result.get("results") or []))
        self.assertIn("cursor recap quality", top_snippets.lower())

    def test_diverse_recap_selector_limits_sessions_apps_and_prefers_bucket_coverage(self):
        base = 1_700_000_000_000
        apps = ["Cursor", "Things 3", "Google Chrome", "Finder", "Calendar"]
        items = []
        for idx in range(30):
            session_idx = idx // 3
            bucket_offset = idx % 6
            items.append(
                {
                    "doc_id": f"doc-{idx}",
                    "chunk_id": f"chunk-{idx}",
                    "session_key": f"session-{session_idx}",
                    "app_name": apps[idx % len(apps)],
                    "browser_domain": f"domain-{idx % 4}.example",
                    "chunk_end_ts": base + (bucket_offset * 2 * 60 * 60 * 1000),
                    "chunk_start_ts": base + (bucket_offset * 2 * 60 * 60 * 1000) - 30_000,
                    "context_version": 3,
                    "rerank_score": 1.0 - (idx * 0.01),
                }
            )

        selected = _select_diverse_recap_evidence(items, target=20)
        metrics = _build_recap_diversity_metrics(selected)

        self.assertEqual(len(selected), 20)

        session_counts = {}
        app_counts = {}
        for item in selected:
            session_counts[item["session_key"]] = session_counts.get(item["session_key"], 0) + 1
            app_counts[item["app_name"]] = app_counts.get(item["app_name"], 0) + 1

        self.assertTrue(all(count <= 4 for count in session_counts.values()))
        self.assertTrue(all(count <= 5 for count in app_counts.values()))
        self.assertGreaterEqual(metrics["distinct_time_buckets"], 4)
        self.assertEqual(metrics["distinct_domains"], 4)
        self.assertEqual(metrics["context_version_mix"].get("3"), 20)

    async def test_broad_overview_cloud_query_exposes_recap_debug_contract(self):
        now_ms = int(time.time() * 1000)
        with tempfile.TemporaryDirectory() as tmp:
            memory_db_path = f"{tmp}/memory.db"
            activity_db_path = f"{tmp}/activity.db"
            _create_empty_memory_db(memory_db_path)
            _create_activity_db(activity_db_path, now_ms)

            cloud_payload = {
                "enabled": True,
                "retrieval_tier": "cloud_hybrid",
                "semantic_truth": {
                    "query": "What was I working on today?",
                    "result_count": 12,
                    "mode_used": "cloud-hybrid",
                    "status": "hybrid",
                    "highlights": [],
                    "warning": None,
                    "recap_outline": {
                        "main_workstreams": [{"label": "Implementation and code changes", "evidence_count": 8}],
                        "apps_and_tools_used": [{"app": "Cursor", "evidence_count": 10}],
                        "specific_tasks": ["implement memory ingest contract"],
                        "strongest_evidence": [{"snippet": "evidence snippet 0"}],
                        "uncertainty_or_conflicts": [],
                    },
                    "debug": {
                        "candidate_count_raw": 168,
                        "candidate_count_active": 165,
                        "rerank_input_count": 60,
                        "rerank_items_count": 60,
                        "rerank_provider": "cohere",
                        "rerank_attempted": True,
                        "rerank_fallback_reason": "none",
                        "rerank_latency_ms": 42,
                        "final_evidence_count": 20,
                        "distinct_sessions": 6,
                        "distinct_apps": 4,
                        "distinct_domains": 3,
                        "distinct_time_buckets": 5,
                        "context_version_mix": {"3": 20},
                        "raw_vs_contextual_source": "rerank=contextual_text_compact,citations=raw_text_compact",
                        "vector_rank_mode": "ANN",
                        "lexical_rank_strategy": "bm25_weighted",
                    },
                },
                "citations": [
                    {
                        "chunk_id": f"chunk-{idx}",
                        "frame_id": None,
                        "timestamp": now_ms - (idx * 60_000),
                        "app_name": "Cursor" if idx < 10 else "Things 3",
                        "window_title": "workstream",
                        "snippet": f"evidence snippet {idx}",
                        "score": 0.9 - (idx * 0.01),
                        "source": "cloud_hybrid",
                        "session_key": f"session-{idx // 3}",
                        "context_version": 3,
                    }
                    for idx in range(12)
                ],
                "confidence": {
                    "level": "high",
                    "score": 0.88,
                    "corroborating_chunks": 6,
                    "reason": "test",
                },
                "provider_path": {
                    "retrieval": "turbopuffer",
                    "rerank": "cohere",
                    "vector_rank_mode": "ANN",
                    "answer": "openai",
                },
            }

            with patch(
                "services.watcher_service_search.get_local_memory_db_path_impl",
                return_value=memory_db_path,
            ), patch(
                "services.watcher_service_search.get_local_activity_db_path_impl",
                return_value=activity_db_path,
            ), patch(
                "services.watcher_service_search.memory_cloud_enabled",
                return_value=True,
            ), patch(
                "services.watcher_service_search._compute_freshness",
                return_value={"status": "healthy", "source_mismatch": False, "reasons": []},
            ), patch(
                "services.watcher_service_search._auto_backfill_cloud_if_needed",
                AsyncMock(return_value=None),
            ), patch(
                "services.watcher_service_search.query_semantic_cloud",
                AsyncMock(return_value=cloud_payload),
            ):
                result = await query_memory_impl(
                    service=_DummyWatcherService(),
                    user_id="user-1",
                    query="What was I working on today?",
                    intent="broad_overview",
                    days_back=1,
                    limit=20,
                )

        self.assertTrue(result["success"])
        self.assertEqual(result["intent_resolved"], "broad_overview")
        self.assertEqual(result["retrieval_tier"], "cloud_hybrid")
        self.assertEqual(result["answer_mode"], "full_hybrid")
        self.assertGreater(len(result.get("citations") or []), 0)
        self.assertIsInstance(result.get("retrieval_debug"), dict)
        self.assertEqual(result["retrieval_debug"]["final_evidence_count"], 20)
        self.assertIsInstance(result.get("recap_debug"), dict)
        self.assertEqual(result["recap_debug"]["distinct_sessions"], 6)
        self.assertEqual(result["recap_debug"]["distinct_apps"], 4)
        self.assertEqual(result["recap_debug"]["distinct_domains"], 3)
        self.assertEqual(result["recap_debug"]["distinct_time_buckets"], 5)
        self.assertEqual(result["recap_debug"]["candidate_count_raw"], 168)
        self.assertEqual(result["recap_debug"]["candidate_count_active"], 165)
        self.assertEqual(result["recap_debug"]["rerank_provider"], "cohere")
        self.assertTrue(result["recap_debug"]["rerank_attempted"])
        self.assertEqual(result["recap_debug"]["rerank_fallback_reason"], "none")
        self.assertEqual(result["recap_debug"]["vector_rank_mode"], "ANN")
        self.assertEqual(result["recap_debug"]["lexical_rank_strategy"], "bm25_weighted")
        self.assertIsInstance((result.get("semantic_truth") or {}).get("recap_outline"), dict)
        self.assertIsInstance((result.get("semantic_truth") or {}).get("story_plan"), dict)
        self.assertIsInstance((result.get("semantic_truth") or {}).get("renderer"), dict)
        self.assertIn("main_workstreams", result["semantic_truth"]["recap_outline"])
        self.assertIn("apps_and_tools_used", result["semantic_truth"]["recap_outline"])
        self.assertIn("specific_tasks", result["semantic_truth"]["recap_outline"])
        self.assertIn("document_items", result["semantic_truth"]["recap_outline"])
        self.assertIn("timeline_segments", result["semantic_truth"]["recap_outline"])
        self.assertIn("strongest_evidence", result["semantic_truth"]["recap_outline"])
        self.assertIn("uncertainty_or_conflicts", result["semantic_truth"]["recap_outline"])
        self.assertIn("main_event", result["semantic_truth"]["recap_outline"])
        self.assertIn("claim_cards", result["semantic_truth"]["recap_outline"])
        self.assertGreater((result.get("recap_debug") or {}).get("claim_count", 0), 0)
        self.assertIn("main_event_work_item_id", result["recap_debug"])

    async def test_recap_eval_queries_require_grounded_hybrid_metrics(self):
        now_ms = int(time.time() * 1000)
        with tempfile.TemporaryDirectory() as tmp:
            memory_db_path = f"{tmp}/memory.db"
            activity_db_path = f"{tmp}/activity.db"
            _create_empty_memory_db(memory_db_path)
            _create_activity_db(activity_db_path, now_ms)

            async def _fake_cloud_query(*, query: str, intent: str, **kwargs):
                return {
                    "enabled": True,
                    "retrieval_tier": "cloud_hybrid",
                    "semantic_truth": {
                        "query": query,
                        "result_count": 10,
                        "mode_used": "cloud-hybrid",
                        "status": "hybrid",
                        "highlights": [],
                        "warning": None,
                        "debug": {
                            "candidate_count_raw": 120,
                            "candidate_count_active": 110,
                            "rerank_input_count": 60,
                            "rerank_items_count": 40,
                            "final_evidence_count": 20 if intent == "broad_overview" else 10,
                            "distinct_sessions": 5,
                            "distinct_apps": 3,
                            "distinct_time_buckets": 4,
                            "context_version_mix": {"3": 10},
                            "raw_vs_contextual_source": "rerank=contextual_text_compact,citations=raw_text_compact",
                        },
                    },
                    "citations": [
                        {
                            "chunk_id": f"{intent}-{idx}",
                            "frame_id": None,
                            "timestamp": now_ms - (idx * 60_000),
                            "app_name": "Cursor" if idx < 5 else "Things 3",
                            "window_title": "workstream",
                            "snippet": f"{query} evidence {idx}",
                            "score": 0.9 - (idx * 0.01),
                            "source": "cloud_hybrid",
                            "session_key": f"session-{idx // 2}",
                            "context_version": 3,
                        }
                        for idx in range(10)
                    ],
                    "confidence": {
                        "level": "high",
                        "score": 0.8,
                        "corroborating_chunks": 4,
                        "reason": "test",
                    },
                    "provider_path": {
                        "retrieval": "turbopuffer",
                        "rerank": "cohere",
                        "answer": "openai",
                    },
                }

            eval_cases = [
                ("What was I working on today?", "broad_overview"),
                ("What did I do in Cursor today?", "semantic_lookup"),
                ("What admin/planning work did I do this week?", "broad_overview"),
            ]

            with patch(
                "services.watcher_service_search.get_local_memory_db_path_impl",
                return_value=memory_db_path,
            ), patch(
                "services.watcher_service_search.get_local_activity_db_path_impl",
                return_value=activity_db_path,
            ), patch(
                "services.watcher_service_search.memory_cloud_enabled",
                return_value=True,
            ), patch(
                "services.watcher_service_search._compute_freshness",
                return_value={"status": "healthy", "source_mismatch": False, "reasons": []},
            ), patch(
                "services.watcher_service_search._auto_backfill_cloud_if_needed",
                AsyncMock(return_value=None),
            ), patch(
                "services.watcher_service_search.query_semantic_cloud",
                AsyncMock(side_effect=_fake_cloud_query),
            ):
                for query, intent in eval_cases:
                    with self.subTest(query=query):
                        result = await query_memory_impl(
                            service=_DummyWatcherService(),
                            user_id="user-1",
                            query=query,
                            intent=intent,
                            days_back=7,
                            limit=20,
                        )
                        self.assertTrue(result["success"])
                        self.assertEqual(result["retrieval_tier"], "cloud_hybrid")
                        self.assertGreater((result.get("retrieval_debug") or {}).get("candidate_count_raw", 0), 0)
                        self.assertGreater((result.get("retrieval_debug") or {}).get("rerank_items_count", 0), 0)
                        self.assertIsInstance((result.get("semantic_truth") or {}).get("renderer"), dict)
                        self.assertGreater((result.get("retrieval_debug") or {}).get("claim_count", 0), 0)
                        if intent == "broad_overview":
                            self.assertGreaterEqual((result.get("recap_debug") or {}).get("distinct_time_buckets", 0), 4)


if __name__ == "__main__":
    unittest.main()
