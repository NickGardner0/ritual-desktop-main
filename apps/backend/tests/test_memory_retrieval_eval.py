import json
import os
import sqlite3
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from services.memory_cloud_query_service import _rrf_fuse, _strong_signal_short_circuit
from services.memory_query_expansion import expand_memory_query
from services.memory_rerank_service import rerank_candidates
from services.watcher_service_search import search_context_memory_impl


class _DummyWatcherService:
    pass


def _create_context_db(path: str, now_ms: int) -> None:
    conn = sqlite3.connect(path)
    cursor = conn.cursor()
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
            "Cursor",
            "",
            "apps/backend/services/watcher_service_search.py",
            "watcher_service_search.py",
            "Implemented typed query expansion, RRF fusion, and rerank cache support.",
            "Project / Cursor / watcher_service_search.py | Implemented typed query expansion, RRF fusion, and rerank cache support.",
            0.98,
            1,
            0,
            1,
            now_ms - 120_000,
            now_ms - 60_000,
        ),
    )
    conn.commit()
    conn.close()


class RetrievalEvalTests(unittest.IsolatedAsyncioTestCase):
    def test_expand_memory_query_returns_typed_variants(self):
        expanded = expand_memory_query("auth flow in Clerk sign-in page")
        self.assertGreaterEqual(len(expanded), 2)
        self.assertEqual(expanded[0]["type"], "original")
        self.assertEqual(expanded[0]["weight"], 2.0)
        self.assertTrue(any(item["type"] == "vec" for item in expanded))

    def test_expand_memory_query_keeps_hyde_disabled_without_eval_gate(self):
        expanded = expand_memory_query("what did i work on this morning", include_hyde=True)
        self.assertFalse(any(item["type"] == "hyde" for item in expanded))

    def test_expand_memory_query_enables_hyde_only_with_eval_gate(self):
        with patch.dict(os.environ, {"RITUAL_MEMORY_HYDE_EVAL_ENABLED": "1"}, clear=False):
            expanded = expand_memory_query("what did i work on this morning", include_hyde=True)
        self.assertTrue(any(item["type"] == "hyde" for item in expanded))

    def test_expand_memory_query_uses_route_specific_profile_variants(self):
        expanded = expand_memory_query(
            "when did i fix voice mode",
            intent="semantic_lookup",
            query_profile={
                "document_refs": ["entitlements.plist", "SpeechRecognition.swift"],
                "artifact_refs": ["com.apple.security.device.audio-input"],
                "entity_refs": ["voice mode", "microphone entitlement"],
                "task_phrases": ["fix voice mode entitlement"],
            },
        )
        expanded_texts = {item["text"] for item in expanded}
        self.assertIn("entitlements.plist SpeechRecognition.swift", expanded_texts)
        self.assertIn("fix voice mode entitlement", expanded_texts)

    def test_rrf_fuse_returns_trace_and_top_rank_bonus(self):
        fused, trace = _rrf_fuse(
            [
                {
                    "source": "fts",
                    "query_type": "original",
                    "query_text": "clerk redirect loop",
                    "weight": 2.0,
                    "items": [
                        {
                            "doc_id": "doc-1",
                            "score": 0.9,
                            "app_name": "Cursor",
                            "document_title": "watcher_service_search.py",
                            "window_title": "watcher_service_search.py",
                            "chunk_end_ts": int(time.time() * 1000),
                            "capture_quality": 0.9,
                            "source_kind": "context_session",
                        },
                        {
                            "doc_id": "doc-2",
                            "score": 0.5,
                            "app_name": "Google Chrome",
                            "document_title": "Clerk docs",
                            "window_title": "Clerk docs",
                            "chunk_end_ts": int(time.time() * 1000),
                            "capture_quality": 0.6,
                            "source_kind": "context_session",
                        },
                    ],
                },
                {
                    "source": "vec",
                    "query_type": "vec",
                    "query_text": "fix redirect loop in auth callback",
                    "weight": 1.0,
                    "items": [
                        {
                            "doc_id": "doc-2",
                            "score": 0.8,
                            "app_name": "Google Chrome",
                            "document_title": "Clerk docs",
                            "window_title": "Clerk docs",
                            "chunk_end_ts": int(time.time() * 1000),
                            "capture_quality": 0.6,
                            "source_kind": "context_session",
                        }
                    ],
                },
            ],
            query="clerk redirect loop",
            query_profile={"document_refs": ["watcher_service_search.py"], "entity_refs": [], "task_phrases": [], "artifact_refs": []},
        )
        self.assertGreater(len(fused), 0)
        self.assertEqual(fused[0]["doc_id"], "doc-1")
        self.assertGreater(len(trace), 0)
        self.assertGreater(trace[0]["top_rank_bonus"], 0.0)

    async def test_rerank_candidates_uses_persistent_cache(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = f"{tmp}/memory_cloud.db"
            candidates = [
                {
                    "app_name": "Cursor",
                    "window_title": "watcher_service_search.py",
                    "browser_domain": "",
                    "contextual_text_compact": "Typed expansion and RRF fusion for Ritual retrieval",
                }
            ]
            with patch.dict(os.environ, {"RITUAL_MEMORY_DB_PATH": db_path}, clear=False):
                with patch(
                    "services.memory_rerank_service._cohere_rerank",
                    AsyncMock(return_value=[(0, 0.91)]),
                ) as first_rerank:
                    first = await rerank_candidates(
                        query="typed expansion",
                        rerank_intent="documents: watcher_service_search.py",
                        candidates=candidates,
                        top_n=1,
                    )
                self.assertEqual(first["provider"], "cohere")
                self.assertEqual(first_rerank.await_count, 1)

                with patch(
                    "services.memory_rerank_service._cohere_rerank",
                    AsyncMock(side_effect=AssertionError("cache should satisfy rerank")),
                ):
                    second = await rerank_candidates(
                        query="typed expansion",
                        rerank_intent="documents: watcher_service_search.py",
                        candidates=candidates,
                        top_n=1,
                    )
                self.assertEqual(second["provider"], "cache")
                self.assertFalse(second["rerank_attempted"])
                self.assertGreater(second["cache_hits"], 0)

    async def test_rerank_candidates_reports_openai_fallback_provenance(self):
        candidates = [
            {
                "app_name": "Cursor",
                "window_title": "entitlements.plist",
                "document_title": "entitlements.plist",
                "browser_domain": "",
                "contextual_text_compact": "Fix microphone entitlement for native voice mode.",
                "parent_context": "ritual-desktop-main",
            }
        ]
        with patch(
            "services.memory_rerank_service._cohere_rerank",
            AsyncMock(side_effect=RuntimeError("cohere exploded")),
        ), patch(
            "services.memory_rerank_service._openai_rerank",
            AsyncMock(return_value=[(0, 0.88)]),
        ):
            result = await rerank_candidates(
                query="fix voice mode entitlement",
                rerank_intent="documents: entitlements.plist",
                candidates=candidates,
                top_n=1,
            )

        self.assertEqual(result["provider"], "openai_fallback")
        self.assertTrue(result["rerank_attempted"])
        self.assertTrue(result["cohere_attempted"])
        self.assertTrue(result["openai_attempted"])
        self.assertEqual(result["fallback_reason"], "cohere_error")

    def test_strong_signal_short_circuit_detects_dominant_lexical_hit(self):
        result = _strong_signal_short_circuit(
            query="watcher_service_search.py",
            ranked_lists=[
                {
                    "source": "fts",
                    "items": [
                        {
                            "doc_id": "doc-1",
                            "document_title": "watcher_service_search.py",
                            "window_title": "watcher_service_search.py",
                            "raw_visible_text": "search_context_memory_impl",
                        },
                        {
                            "doc_id": "doc-2",
                            "document_title": "other_file.py",
                            "window_title": "other_file.py",
                            "raw_visible_text": "something else",
                        },
                    ],
                }
            ],
        )
        self.assertIsInstance(result, dict)
        self.assertTrue(result["exact_match"])

    async def test_search_context_memory_sets_strong_signal_debug_for_exact_doc(self):
        now_ms = int(time.time() * 1000)
        with tempfile.TemporaryDirectory() as tmp:
            memory_db_path = f"{tmp}/memory.db"
            _create_context_db(memory_db_path, now_ms)
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
                    query="watcher_service_search.py",
                    days_back=1,
                    limit=5,
                    allow_legacy_fallback=False,
                )
        self.assertTrue(result["success"])
        self.assertEqual(result["mode_used"], "context-session-docs")
        self.assertTrue((result.get("debug") or {}).get("strong_signal_short_circuit"))

    def test_retrieval_eval_fixture_covers_required_buckets(self):
        fixture_path = Path(__file__).resolve().parent / "fixtures" / "memory_retrieval_eval_queries.json"
        payload = json.loads(fixture_path.read_text(encoding="utf-8"))
        buckets = {item["bucket"] for item in payload}
        self.assertTrue({"exact", "semantic", "time_bounded", "fusion", "recap_support"}.issubset(buckets))


if __name__ == "__main__":
    unittest.main()
