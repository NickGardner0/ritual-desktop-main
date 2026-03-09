import os
import sqlite3
import sys
import tempfile
import time
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from services.memory_cloud_query_service import (
    _build_recap_diversity_metrics,
    _select_diverse_recap_evidence,
)
from services.watcher_service_search import query_memory_impl


class _DummyWatcherService:
    pass


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


class ContextualRetrievalTests(unittest.IsolatedAsyncioTestCase):
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
                        "final_evidence_count": 20,
                        "distinct_sessions": 6,
                        "distinct_apps": 4,
                        "distinct_time_buckets": 5,
                        "context_version_mix": {"3": 20},
                        "raw_vs_contextual_source": "rerank=contextual_text_compact,citations=raw_text_compact",
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
        self.assertEqual(result["recap_debug"]["distinct_time_buckets"], 5)
        self.assertEqual(result["recap_debug"]["candidate_count_raw"], 168)
        self.assertEqual(result["recap_debug"]["candidate_count_active"], 165)
        self.assertIsInstance((result.get("semantic_truth") or {}).get("recap_outline"), dict)
        self.assertIn("main_workstreams", result["semantic_truth"]["recap_outline"])
        self.assertIn("apps_and_tools_used", result["semantic_truth"]["recap_outline"])
        self.assertIn("specific_tasks", result["semantic_truth"]["recap_outline"])
        self.assertIn("strongest_evidence", result["semantic_truth"]["recap_outline"])
        self.assertIn("uncertainty_or_conflicts", result["semantic_truth"]["recap_outline"])

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
                        if intent == "broad_overview":
                            self.assertGreaterEqual((result.get("recap_debug") or {}).get("distinct_time_buckets", 0), 4)


if __name__ == "__main__":
    unittest.main()
