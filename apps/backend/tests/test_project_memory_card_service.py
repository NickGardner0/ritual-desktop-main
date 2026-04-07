import os
import sqlite3
import sys
import tempfile
import time
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from services.project_memory_card_service import (
    _upsert_project_memory_card,
    build_story_plan_from_project_memory_cards,
    ensure_project_memory_card_schema,
    load_project_memory_cards_for_range,
    process_project_memory_cards_for_user_sync,
    select_relevant_project_memory_cards,
)
from services.watcher_service_search import query_memory_impl


class _DummyWatcherService:
    pass


def _create_empty_memory_db(path: str) -> None:
    conn = sqlite3.connect(path)
    conn.commit()
    conn.close()


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
            is_afk INTEGER DEFAULT 0,
            source TEXT DEFAULT 'ritual_watcher_v2',
            is_incognito INTEGER DEFAULT 0
        )
        """
    )
    cursor.executemany(
        """
        INSERT INTO activity_events (
            id, ts_start, ts_end, app_bundle_id, app_name, window_title, browser_url, browser_domain, is_afk, source, is_incognito
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (
                1,
                now_ms - 90_000,
                now_ms - 30_000,
                "com.google.Chrome",
                "Google Chrome",
                "Ritual dashboard",
                "https://app.ritual.so/chat",
                "app.ritual.so",
                0,
                "ritual_watcher_v2",
                0,
            ),
            (
                2,
                now_ms - 210_000,
                now_ms - 120_000,
                "com.openai.chatgpt",
                "ChatGPT",
                "Debugging recap quality",
                "https://chatgpt.com/",
                "chatgpt.com",
                0,
                "ritual_watcher_v2",
                0,
            ),
        ],
    )
    conn.commit()
    conn.close()


def _create_project_context_tables(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE context_sessions (
            id INTEGER PRIMARY KEY,
            user_id TEXT NOT NULL,
            start_ts INTEGER NOT NULL,
            end_ts INTEGER NOT NULL,
            primary_app_name TEXT,
            primary_domain TEXT,
            dominant_title TEXT,
            representative_text TEXT,
            coverage_score REAL NOT NULL DEFAULT 0.0,
            snapshot_count INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE session_retrieval_docs (
            id INTEGER PRIMARY KEY,
            session_id INTEGER NOT NULL UNIQUE,
            user_id TEXT NOT NULL,
            chunk_start_ts INTEGER NOT NULL,
            chunk_end_ts INTEGER NOT NULL,
            app_name TEXT,
            browser_domain TEXT,
            window_title TEXT,
            document_title TEXT,
            raw_visible_text TEXT NOT NULL DEFAULT '',
            contextual_retrieval_text TEXT NOT NULL DEFAULT '',
            capture_quality REAL NOT NULL DEFAULT 0.0,
            updated_at INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE context_snapshots (
            id INTEGER PRIMARY KEY,
            session_id INTEGER NOT NULL,
            document_path TEXT,
            semantic_summary TEXT,
            ax_richness_score REAL NOT NULL DEFAULT 0.0,
            ts INTEGER NOT NULL
        );
        """
    )
    conn.commit()


class ProjectMemoryCardServiceTests(unittest.IsolatedAsyncioTestCase):
    def test_upsert_project_memory_card_updates_existing_row_and_replaces_evidence(self):
        conn = sqlite3.connect(":memory:")
        conn.row_factory = sqlite3.Row
        ensure_project_memory_card_schema(conn)
        now_ms = int(time.time() * 1000)

        base_card = {
            "card_key": "session:user-1:101",
            "card_level": "session",
            "source_scope": "session_closure",
            "status": "active",
            "activity_class": "work",
            "start_ts": now_ms - 5_000,
            "end_ts": now_ms,
            "primary_session_id": 101,
            "primary_app": "Google Chrome",
            "title": "Clerk auth configuration",
            "summary_hook": "Clerk auth configuration: Updated auth handoff flow",
            "narrative_text": "From 9:00 AM - 9:20 AM, updated Clerk auth handoff flow.",
            "outcomes": ["Updated auth handoff flow"],
            "blockers": [],
            "project_nouns": ["Clerk auth", "habit pipes UI"],
            "apps": ["Google Chrome"],
            "domains": ["clerk.com"],
            "files": ["apps/dashboard/hooks/use-habits-query.ts"],
            "artifacts": ["Configure | Clerk.com"],
            "commands": ["npm run build"],
            "summary_hook_tokens": "clerk auth updated handoff habit pipes ui",
            "canonical_identity": {"primary_directory": "apps/dashboard/hooks"},
            "freshness_score": 0.9,
            "confidence": 0.82,
            "source_hash": "hash-a",
            "evidence_rows": [
                {
                    "session_id": 101,
                    "evidence_id": "session-doc:101",
                    "evidence_kind": "session_doc",
                    "timestamp": now_ms,
                    "score": 0.82,
                    "snippet": "Updated auth handoff flow",
                },
                {
                    "session_id": 101,
                    "evidence_id": "snapshot-best:101",
                    "evidence_kind": "snapshot",
                    "timestamp": now_ms,
                    "score": 0.75,
                    "snippet": "Clerk auth fix",
                },
            ],
        }

        card_id, inserted = _upsert_project_memory_card(conn, user_id="user-1", card=base_card)
        self.assertTrue(inserted)
        self.assertGreater(card_id, 0)

        updated_card = dict(base_card)
        updated_card["title"] = "Clerk auth handoff repair"
        updated_card["source_hash"] = "hash-b"
        updated_card["evidence_rows"] = [
            {
                "session_id": 101,
                "evidence_id": "session-doc:101",
                "evidence_kind": "session_doc",
                "timestamp": now_ms,
                "score": 0.91,
                "snippet": "Repaired Clerk auth handoff",
            }
        ]

        updated_id, inserted = _upsert_project_memory_card(conn, user_id="user-1", card=updated_card)
        self.assertFalse(inserted)
        self.assertEqual(card_id, updated_id)

        row = conn.execute(
            "SELECT title, source_hash FROM project_memory_cards WHERE id = ?",
            (card_id,),
        ).fetchone()
        evidence_count = conn.execute(
            "SELECT COUNT(*) FROM project_memory_card_evidence WHERE card_id = ?",
            (card_id,),
        ).fetchone()[0]
        conn.close()

        self.assertEqual(row["title"], "Clerk auth handoff repair")
        self.assertEqual(row["source_hash"], "hash-b")
        self.assertEqual(evidence_count, 1)

    def test_select_relevant_project_memory_cards_prefers_primary_session_overlap(self):
        manifest = [
            {
                "id": 1,
                "card_level": "thread",
                "title": "Clerk auth configuration",
                "summary_hook": "Updated Clerk auth flow",
                "project_nouns": ["Clerk auth", "habit pipes UI"],
                "apps": ["Google Chrome"],
                "domains": ["clerk.com"],
                "files": ["apps/dashboard/hooks/use-habits-query.ts"],
                "status": "active",
                "activity_class": "work",
                "start_ts": 1_000,
                "end_ts": 5_000,
                "freshness_score": 0.8,
                "confidence": 0.9,
                "summary_hook_tokens": "clerk auth habit pipes updated flow",
                "primary_session_id": 77,
            },
            {
                "id": 2,
                "card_level": "thread",
                "title": "Clerk auth configuration",
                "summary_hook": "Updated Clerk auth flow",
                "project_nouns": ["Clerk auth", "habit pipes UI"],
                "apps": ["Google Chrome"],
                "domains": ["clerk.com"],
                "files": ["apps/dashboard/hooks/use-habits-query.ts"],
                "status": "active",
                "activity_class": "work",
                "start_ts": 1_000,
                "end_ts": 5_000,
                "freshness_score": 0.8,
                "confidence": 0.9,
                "summary_hook_tokens": "clerk auth habit pipes updated flow",
                "primary_session_id": 999,
            },
        ]

        selected = select_relevant_project_memory_cards(
            manifest,
            query="What did I get done with Clerk auth and habit pipes UI?",
            query_start_ts=1_000,
            query_end_ts=5_000,
            retrieved_session_ids=[77],
            limit=4,
        )

        self.assertGreaterEqual(len(selected), 2)
        self.assertEqual(selected[0], 1)

    def test_process_project_memory_cards_builds_session_and_thread_cards(self):
        now_ms = int(time.time() * 1000) - (10 * 60 * 1000)
        conn = sqlite3.connect(":memory:")
        conn.row_factory = sqlite3.Row
        _create_project_context_tables(conn)
        ensure_project_memory_card_schema(conn)

        conn.executemany(
            """
            INSERT INTO context_sessions (
                id, user_id, start_ts, end_ts, primary_app_name, primary_domain, dominant_title,
                representative_text, coverage_score, snapshot_count
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    101,
                    "user-1",
                    now_ms - 7_200_000,
                    now_ms - 6_900_000,
                    "Google Chrome",
                    "clerk.com",
                    "Configure | Clerk.com",
                    "Configured Clerk auth flow for habit pipes UI",
                    0.92,
                    2,
                ),
                (
                    102,
                    "user-1",
                    now_ms - 6_000_000,
                    now_ms - 5_700_000,
                    "Cursor",
                    "",
                    "apps/dashboard/hooks/use-habit-logs.ts",
                    "Reworked habit logs caching for habit pipes UI",
                    0.94,
                    2,
                ),
            ],
        )
        conn.executemany(
            """
            INSERT INTO session_retrieval_docs (
                id, session_id, user_id, chunk_start_ts, chunk_end_ts, app_name, browser_domain,
                window_title, document_title, raw_visible_text, contextual_retrieval_text,
                capture_quality, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    1,
                    101,
                    "user-1",
                    now_ms - 7_200_000,
                    now_ms - 6_900_000,
                    "Google Chrome",
                    "clerk.com",
                    "Configure | Clerk.com",
                    "Configure | Clerk.com",
                    "Updated auth handoff flow and habit pipes UI caching",
                    "Configured Clerk auth flow for habit pipes UI. Updated apps/dashboard/hooks/use-habits-query.ts and fixed auth handoff. Ran npm run build.",
                    0.96,
                    now_ms - 6_800_000,
                ),
                (
                    2,
                    102,
                    "user-1",
                    now_ms - 6_000_000,
                    now_ms - 5_700_000,
                    "Cursor",
                    "",
                    "apps/dashboard/hooks/use-habit-logs.ts",
                    "use-habit-logs.ts",
                    "Reworked habit logs caching and sidebar sync",
                    "Reworked habit logs caching for habit pipes UI. Updated apps/dashboard/hooks/use-habit-logs.ts, touched apps/dashboard/hooks/use-habits-query.ts, and verified sidebar refresh.",
                    0.95,
                    now_ms - 5_600_000,
                ),
            ],
        )
        conn.executemany(
            """
            INSERT INTO context_snapshots (
                id, session_id, document_path, semantic_summary, ax_richness_score, ts
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    1,
                    101,
                    "apps/dashboard/hooks/use-habits-query.ts",
                    "Updated use-habits-query.ts to fix Clerk auth handoff and cache habit pipes UI results.",
                    0.98,
                    now_ms - 6_950_000,
                ),
                (
                    2,
                    102,
                    "apps/dashboard/hooks/use-habit-logs.ts",
                    "Reworked use-habit-logs.ts and related hooks for faster habit pipes UI refresh.",
                    0.97,
                    now_ms - 5_750_000,
                ),
            ],
        )
        conn.commit()

        result = process_project_memory_cards_for_user_sync(conn, user_id="user-1", limit=32)
        cards = load_project_memory_cards_for_range(
            conn,
            user_id="user-1",
            range_start_ts=now_ms - 8_000_000,
            range_end_ts=now_ms - 5_000_000,
            limit=16,
        )
        conn.close()

        self.assertTrue(result["enabled"])
        self.assertGreaterEqual(result["generated"], 2)
        self.assertGreaterEqual(result["thread_cards_generated"] + result["thread_cards_updated"], 1)
        self.assertTrue(any(card.get("card_level") == "thread" for card in cards))
        self.assertTrue(
            any("use-habits-query.ts" in " ".join(card.get("files") or []) for card in cards)
        )

    def test_build_story_plan_from_project_memory_cards_returns_card_first_story_plan(self):
        selected_cards = [
            {
                "id": 10,
                "card_key": "thread:user-1:clerk:20260319",
                "card_level": "thread",
                "status": "active",
                "activity_class": "work",
                "start_ts": 1_000,
                "end_ts": 3_000,
                "primary_session_id": 101,
                "primary_app": "Google Chrome",
                "title": "Clerk auth repair",
                "summary_hook": "Clerk auth repair: Updated handoff flow",
                "narrative_text": "Updated Clerk auth handoff flow and refreshed habit pipes UI caching.",
                "outcomes": ["Updated Clerk auth handoff", "Refreshed habit pipes UI caching"],
                "blockers": ["Oauth callback mismatch"],
                "project_nouns": ["Clerk auth", "habit pipes UI"],
                "apps": ["Google Chrome", "Cursor"],
                "domains": ["clerk.com"],
                "files": ["apps/dashboard/hooks/use-habits-query.ts"],
                "artifacts": ["Configure | Clerk.com"],
                "commands": ["npm run build"],
                "canonical_identity": {"primary_directory": "apps/dashboard/hooks"},
                "freshness_score": 0.8,
                "confidence": 0.92,
            },
            {
                "id": 11,
                "card_key": "session:user-1:102",
                "card_level": "session",
                "status": "shipped",
                "activity_class": "work",
                "start_ts": 4_000,
                "end_ts": 5_000,
                "primary_session_id": 102,
                "primary_app": "Cursor",
                "title": "Sidebar cache update",
                "summary_hook": "Sidebar cache update: Reworked use-habit-logs.ts",
                "narrative_text": "Reworked use-habit-logs.ts and synced the sidebar refresh path.",
                "outcomes": ["Reworked use-habit-logs.ts"],
                "blockers": [],
                "project_nouns": ["sidebar refresh"],
                "apps": ["Cursor"],
                "domains": [],
                "files": ["apps/dashboard/hooks/use-habit-logs.ts"],
                "artifacts": ["sidebar.tsx"],
                "commands": [],
                "canonical_identity": {"primary_directory": "apps/dashboard/hooks"},
                "freshness_score": 0.7,
                "confidence": 0.83,
            },
        ]

        story_plan = build_story_plan_from_project_memory_cards(
            selected_cards,
            query="What did I get done with Clerk auth and habit pipes UI?",
            intent="broad_overview",
        )

        self.assertIsInstance(story_plan, dict)
        self.assertEqual((story_plan.get("main_event") or {}).get("label"), "Clerk auth repair")
        self.assertTrue((story_plan.get("metrics") or {}).get("card_first_used"))
        self.assertIn("Updated Clerk auth handoff", story_plan.get("specific_tasks") or [])
        self.assertIsInstance(story_plan.get("renderer"), dict)

    async def test_query_memory_impl_prefers_card_first_story_plan_when_cards_exist(self):
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
                    "query": "What did I get done this week?",
                    "result_count": 4,
                    "mode_used": "cloud-hybrid",
                    "status": "hybrid",
                    "highlights": [],
                    "warning": None,
                    "debug": {
                        "candidate_count_raw": 12,
                        "candidate_count_active": 12,
                        "rerank_input_count": 8,
                        "rerank_items_count": 8,
                        "rerank_provider": "cohere",
                        "rerank_attempted": True,
                        "rerank_fallback_reason": "none",
                        "rerank_latency_ms": 18,
                        "final_evidence_count": 4,
                        "distinct_sessions": 2,
                        "distinct_apps": 2,
                        "distinct_domains": 2,
                        "distinct_time_buckets": 2,
                        "context_version_mix": {"3": 4},
                        "raw_vs_contextual_source": "rerank=contextual_text_compact,citations=raw_text_compact",
                        "vector_rank_mode": "ANN",
                        "lexical_rank_strategy": "bm25_weighted",
                    },
                },
                "citations": [
                    {
                        "chunk_id": "chunk-1",
                        "timestamp": now_ms - 60_000,
                        "app_name": "Google Chrome",
                        "window_title": "Configure | Clerk.com",
                        "snippet": "Configured Clerk auth flow and updated habit pipes UI.",
                        "score": 0.92,
                        "source": "cloud_hybrid",
                        "session_key": "77",
                        "session_id": 77,
                        "context_version": 3,
                    }
                ],
                "confidence": {"level": "high", "score": 0.91, "corroborating_chunks": 2, "reason": "test"},
                "provider_path": {
                    "retrieval": "turbopuffer",
                    "rerank": "cohere",
                    "vector_rank_mode": "ANN",
                    "answer": "openai",
                },
            }

            selected_cards_payload = {
                "cards": [
                    {
                        "id": 10,
                        "card_key": "thread:user-1:clerk:20260319",
                        "card_level": "thread",
                        "status": "active",
                        "activity_class": "work",
                        "start_ts": now_ms - 120_000,
                        "end_ts": now_ms - 30_000,
                        "primary_session_id": 77,
                        "primary_app": "Google Chrome",
                        "title": "Clerk auth repair",
                        "summary_hook": "Clerk auth repair: Updated handoff flow",
                        "narrative_text": "Updated Clerk auth handoff flow and refreshed habit pipes UI caching.",
                        "outcomes": ["Updated Clerk auth handoff", "Refreshed habit pipes UI caching"],
                        "blockers": [],
                        "project_nouns": ["Clerk auth", "habit pipes UI"],
                        "apps": ["Google Chrome", "Cursor"],
                        "domains": ["clerk.com"],
                        "files": ["apps/dashboard/hooks/use-habits-query.ts"],
                        "artifacts": ["Configure | Clerk.com"],
                        "commands": ["npm run build"],
                        "canonical_identity": {"primary_directory": "apps/dashboard/hooks"},
                        "freshness_score": 0.84,
                        "confidence": 0.93,
                    }
                ],
                "selected_card_ids": [10],
                "debug": {"candidate_cards": 4, "selected_cards": 1, "generated_on_demand": False},
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
            ), patch(
                "services.watcher_service_search.load_selected_project_memory_cards",
                AsyncMock(return_value=selected_cards_payload),
            ):
                result = await query_memory_impl(
                    service=_DummyWatcherService(),
                    user_id="user-1",
                    query="What did I get done this week?",
                    intent="broad_overview",
                    days_back=7,
                    limit=8,
                )

        semantic_truth = result.get("semantic_truth") or {}
        story_plan = semantic_truth.get("story_plan") or {}
        self.assertTrue(result["success"])
        self.assertEqual(semantic_truth.get("generation_mode"), "card_first")
        self.assertEqual((story_plan.get("metrics") or {}).get("card_first_used"), True)
        self.assertEqual(len(semantic_truth.get("selected_project_memory_cards") or []), 1)
        self.assertEqual((story_plan.get("main_event") or {}).get("label"), "Clerk auth repair")
