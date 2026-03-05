import os
import sqlite3
import sys
import tempfile
import time
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from services.watcher_service_search import query_memory_impl, search_screen_recordings_impl


class _DummyWatcherService:
    pass


def _create_activity_only_db(path: str, now_ms: int) -> None:
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
                "com.google.Chrome",
                "Google Chrome",
                "Ritual dashboard",
                "https://app.ritual.so/chat",
                "app.ritual.so",
                0,
            ),
            (
                2,
                now_ms - 180_000,
                now_ms - 120_000,
                "com.openai.chatgpt",
                "ChatGPT",
                "Debugging screen search",
                "https://chatgpt.com/",
                "chatgpt.com",
                0,
            ),
            (
                3,
                now_ms - 400_000,
                now_ms - 360_000,
                "com.todesktop.230313mzl4w4u92",
                "Cursor",
                "watcher_service_search.py",
                "",
                "",
                0,
            ),
        ],
    )
    conn.commit()
    conn.close()


class WatcherScreenSearchTests(unittest.IsolatedAsyncioTestCase):
    async def test_broad_weekly_query_returns_recent_activity_when_bridge_is_empty(self):
        now_ms = int(time.time() * 1000)
        with tempfile.TemporaryDirectory() as tmp:
            db_path = f"{tmp}/ritual.db"
            _create_activity_only_db(db_path, now_ms)

            bridge_empty_result = {
                "success": True,
                "query": "What did I do this week?",
                "days_back": 7,
                "result_count": 0,
                "results": [],
                "mode_used": "hybrid",
                "status": "hybrid",
            }

            with patch(
                "services.watcher_service_search.get_local_watcher_db_path_impl",
                return_value=db_path,
            ), patch(
                "services.watcher_service_search.search_screen_via_hybrid_bridge_impl",
                AsyncMock(return_value=bridge_empty_result),
            ):
                result = await search_screen_recordings_impl(
                    _DummyWatcherService(),
                    user_id="user-1",
                    query="What did I do this week?",
                    days_back=7,
                    limit=5,
                )

        self.assertTrue(result["success"])
        self.assertGreater(result["result_count"], 0)
        self.assertEqual(result["mode_used"], "activity-fallback")
        self.assertEqual(result["status"], "activity-only")
        self.assertIn("overview", (result.get("warning") or "").lower())

    async def test_specific_query_still_returns_no_results_when_no_match_exists(self):
        now_ms = int(time.time() * 1000)
        with tempfile.TemporaryDirectory() as tmp:
            db_path = f"{tmp}/ritual.db"
            _create_activity_only_db(db_path, now_ms)

            with patch(
                "services.watcher_service_search.get_local_watcher_db_path_impl",
                return_value=db_path,
            ), patch(
                "services.watcher_service_search.search_screen_via_hybrid_bridge_impl",
                AsyncMock(return_value=None),
            ):
                result = await search_screen_recordings_impl(
                    _DummyWatcherService(),
                    user_id="user-1",
                    query="nonexistentkeyword123",
                    days_back=7,
                    limit=5,
                )

        self.assertTrue(result["success"])
        self.assertEqual(result["result_count"], 0)
        self.assertEqual(result["mode_used"], "none")
        self.assertEqual(result["status"], "activity-only")

    async def test_query_memory_topic_specificity_filters_weak_partial_matches(self):
        now_ms = int(time.time() * 1000)
        with tempfile.TemporaryDirectory() as tmp:
            db_path = f"{tmp}/ritual.db"
            _create_activity_only_db(db_path, now_ms)

            bridge_like_semantic_result = {
                "success": True,
                "query": "When did I last work on my ritual landing page?",
                "days_back": 30,
                "result_count": 2,
                "mode_used": "like-fallback",
                "status": "text-only",
                "results": [
                    {
                        "frame_id": 10,
                        "timestamp": now_ms - 120_000,
                        "app_bundle_id": "com.todesktop.230313mzl4w4u92",
                        "app_name": "ritual-desktop",
                        "window_title": "ritual-desktop-main - Modified",
                        "ocr_text": "RITUAL-DESKTOP-MAIN README and terminal output",
                        "relevance_score": 0.91,
                        "source": "text",
                        "fts_matched": False,
                    },
                    {
                        "frame_id": 11,
                        "timestamp": now_ms - 360_000,
                        "app_bundle_id": "com.todesktop.230313mzl4w4u92",
                        "app_name": "ritual-desktop",
                        "window_title": "new thread",
                        "ocr_text": "Ritual desktop logs and output panel",
                        "relevance_score": 0.87,
                        "source": "text",
                        "fts_matched": False,
                    },
                ],
            }

            with patch(
                "services.watcher_service_search.get_local_watcher_db_path_impl",
                return_value=db_path,
            ), patch(
                "services.watcher_service_search.search_screen_recordings_impl",
                AsyncMock(return_value=bridge_like_semantic_result),
            ):
                result = await query_memory_impl(
                    service=_DummyWatcherService(),
                    user_id="user-1",
                    query="When did I last work on my ritual landing page?",
                    intent="semantic_lookup",
                    days_back=30,
                    limit=8,
                )

        self.assertTrue(result["success"])
        self.assertEqual(result["intent_resolved"], "semantic_lookup")
        self.assertEqual(result["confidence"]["level"], "low")
        self.assertEqual(len(result["citations"]), 0)
        semantic_truth = result.get("semantic_truth") or {}
        self.assertEqual(semantic_truth.get("result_count"), 0)
        self.assertIn("grounded topic evidence", (result.get("warning") or "").lower())

    async def test_query_memory_topic_specificity_keeps_grounded_matches(self):
        now_ms = int(time.time() * 1000)
        with tempfile.TemporaryDirectory() as tmp:
            db_path = f"{tmp}/ritual.db"
            _create_activity_only_db(db_path, now_ms)

            strongly_grounded_result = {
                "success": True,
                "query": "When did I last work on my ritual landing page?",
                "days_back": 30,
                "result_count": 2,
                "mode_used": "hybrid",
                "status": "hybrid",
                "results": [
                    {
                        "frame_id": 20,
                        "timestamp": now_ms - 120_000,
                        "app_bundle_id": "com.todesktop.230313mzl4w4u92",
                        "app_name": "Cursor",
                        "window_title": "home-client.tsx - ritual landing page",
                        "ocr_text": "Updated ritual landing page hero copy and CTA blocks",
                        "relevance_score": 0.92,
                        "source": "hybrid",
                        "fts_matched": True,
                    },
                    {
                        "frame_id": 21,
                        "timestamp": now_ms - 30 * 90_000,  # ensure distinct chunk_id
                        "app_bundle_id": "com.todesktop.230313mzl4w4u92",
                        "app_name": "Cursor",
                        "window_title": "landing page spacing",
                        "ocr_text": "Refined ritual landing page spacing and typography",
                        "relevance_score": 0.89,
                        "source": "hybrid",
                        "fts_matched": True,
                    },
                ],
            }

            with patch(
                "services.watcher_service_search.get_local_watcher_db_path_impl",
                return_value=db_path,
            ), patch(
                "services.watcher_service_search.search_screen_recordings_impl",
                AsyncMock(return_value=strongly_grounded_result),
            ):
                result = await query_memory_impl(
                    service=_DummyWatcherService(),
                    user_id="user-1",
                    query="When did I last work on my ritual landing page?",
                    intent="semantic_lookup",
                    days_back=30,
                    limit=8,
                )

        self.assertTrue(result["success"])
        self.assertGreater(len(result["citations"]), 0)
        self.assertIn(result["confidence"]["level"], {"medium", "high"})
        semantic_truth = result.get("semantic_truth") or {}
        self.assertGreater(semantic_truth.get("result_count") or 0, 0)

    async def test_query_memory_cloud_contract_sets_hybrid_tier_and_turbopuffer_path(self):
        now_ms = int(time.time() * 1000)
        with tempfile.TemporaryDirectory() as tmp:
            db_path = f"{tmp}/ritual.db"
            _create_activity_only_db(db_path, now_ms)

            cloud_payload = {
                "enabled": True,
                "retrieval_tier": "cloud_hybrid",
                "semantic_truth": {
                    "query": "what was i doing in chatgpt",
                    "result_count": 1,
                    "mode_used": "cloud-hybrid",
                    "status": "hybrid",
                    "highlights": [],
                    "warning": None,
                },
                "citations": [
                    {
                        "chunk_id": "chunk-1",
                        "frame_id": None,
                        "timestamp": now_ms - 10_000,
                        "app_name": "ChatGPT",
                        "window_title": "Chat",
                        "snippet": "Discussing retrieval ranking",
                        "score": 0.88,
                        "source": "cloud_hybrid",
                    }
                ],
                "confidence": {
                    "level": "high",
                    "score": 0.88,
                    "corroborating_chunks": 1,
                    "reason": "test",
                },
                "provider_path": {
                    "retrieval": "unexpected-provider",
                    "rerank": "cohere",
                    "answer": "openai",
                },
            }

            with patch(
                "services.watcher_service_search.get_local_watcher_db_path_impl",
                return_value=db_path,
            ), patch(
                "services.watcher_service_search.memory_cloud_enabled",
                return_value=True,
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
                    query="what was i doing in chatgpt",
                    intent="semantic_lookup",
                    days_back=7,
                    limit=8,
                )

        self.assertTrue(result["success"])
        self.assertEqual(result["retrieval_tier"], "cloud_hybrid")
        self.assertEqual((result.get("provider_path") or {}).get("retrieval"), "turbopuffer")

    async def test_query_memory_cloud_fail_closed_blocks_ungrounded_semantic(self):
        now_ms = int(time.time() * 1000)
        with tempfile.TemporaryDirectory() as tmp:
            db_path = f"{tmp}/ritual.db"
            _create_activity_only_db(db_path, now_ms)

            cloud_payload = {
                "enabled": True,
                "retrieval_tier": "unavailable",
                "semantic_truth": {
                    "query": "what was i doing in chatgpt",
                    "result_count": 0,
                    "mode_used": "cloud-hybrid",
                    "status": "unavailable",
                    "highlights": [],
                    "warning": "No cloud semantic evidence matched query in selected range.",
                },
                "citations": [],
                "confidence": {
                    "level": "low",
                    "score": 0.0,
                    "corroborating_chunks": 0,
                    "reason": "test",
                },
                "provider_path": {
                    "retrieval": "turbopuffer",
                    "rerank": "cohere",
                    "answer": "openai",
                },
            }

            with patch(
                "services.watcher_service_search.get_local_watcher_db_path_impl",
                return_value=db_path,
            ), patch(
                "services.watcher_service_search.memory_cloud_enabled",
                return_value=True,
            ), patch(
                "services.watcher_service_search.memory_fail_closed",
                return_value=True,
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
                    query="what was i doing in chatgpt",
                    intent="semantic_lookup",
                    days_back=7,
                    limit=8,
                )

        self.assertTrue(result["success"])
        self.assertEqual(result["retrieval_tier"], "unavailable")
        self.assertEqual(len(result.get("citations") or []), 0)
        self.assertIn("fail-closed", str(result.get("warning") or "").lower())


if __name__ == "__main__":
    unittest.main()
