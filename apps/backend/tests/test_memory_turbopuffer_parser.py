import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from services.memory_turbopuffer_service import (
    TurbopufferService,
    _LEGACY_INT_QUALITY_SCORE_NAMESPACES,
)


class TurbopufferParserTests(unittest.TestCase):
    def test_parse_rows_with_top_level_attributes(self):
        service = TurbopufferService()
        payload = {
            "results": [
                {
                    "rows": [
                        {
                            "id": "doc-1",
                            "$dist": 0.2,
                            "chunk_id": "chunk-1",
                            "logical_chunk_id": "logical-1",
                            "source_kind": "context_session",
                            "session_id": "77",
                            "text_compact": "hello world",
                            "raw_visible_text": "hello world raw",
                            "contextual_retrieval_text": "hello world contextual",
                            "parent_context": "Cursor / watcher_service_search.py",
                            "app_name": "Cursor",
                        }
                    ]
                }
            ]
        }

        parsed = service._parse_query_results(payload, list_meta=[{"source": "fts", "query_type": "original", "query_text": "hello", "weight": 2.0}])
        rows = parsed["lists"][0]["items"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["doc_id"], "doc-1")
        self.assertEqual(rows[0]["chunk_id"], "chunk-1")
        self.assertEqual(rows[0]["logical_chunk_id"], "logical-1")
        self.assertEqual(rows[0]["source_kind"], "context_session")
        self.assertEqual(rows[0]["session_id"], "77")
        self.assertEqual(rows[0]["raw_visible_text"], "hello world raw")
        self.assertEqual(rows[0]["parent_context"], "Cursor / watcher_service_search.py")
        self.assertGreater(rows[0]["score"], 0.0)

    def test_parse_rows_with_nested_attributes_and_multi_query(self):
        service = TurbopufferService()
        payload = {
            "results": [
                {
                    "rows": [
                        {
                            "id": "doc-1",
                            "score": 0.9,
                            "attributes": {
                                "chunk_id": "chunk-1",
                                "logical_chunk_id": "logical-1",
                                "text_compact": "alpha",
                            },
                        }
                    ]
                },
                {
                    "rows": [
                        {
                            "id": "doc-1",
                            "score": 0.4,
                            "attributes": {
                                "chunk_id": "chunk-1",
                                "logical_chunk_id": "logical-1",
                            },
                        },
                        {
                            "id": "doc-2",
                            "score": 0.8,
                            "attributes": {
                                "chunk_id": "chunk-2",
                                "logical_chunk_id": "logical-2",
                                "text_compact": "beta",
                            },
                        },
                    ]
                },
            ]
        }

        parsed = service._parse_query_results(
            payload,
            list_meta=[
                {"source": "fts", "query_type": "original", "query_text": "alpha", "weight": 2.0},
                {"source": "vec", "query_type": "vec", "query_text": "beta", "weight": 1.0},
            ],
        )
        self.assertEqual(len(parsed["lists"]), 2)
        self.assertEqual([row["doc_id"] for row in parsed["lists"][0]["items"]], ["doc-1"])
        self.assertEqual(parsed["lists"][0]["items"][0]["score"], 0.9)
        self.assertEqual(parsed["lists"][1]["items"][0]["logical_chunk_id"], "logical-2")


class _FakeResponse:
    def __init__(self, status_code: int, text: str):
        self.status_code = status_code
        self.text = text


class TurbopufferCompatibilityTests(unittest.IsolatedAsyncioTestCase):
    async def test_upsert_retries_without_quality_score_on_legacy_int_schema(self):
        _LEGACY_INT_QUALITY_SCORE_NAMESPACES.clear()
        captured_payloads = []

        class _FakeAsyncClient:
            def __init__(self, timeout):
                self.timeout = timeout

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return False

            async def post(self, url, headers=None, json=None):
                captured_payloads.append(json or {})
                if len(captured_payloads) == 1:
                    return _FakeResponse(
                        400,
                        (
                            "{\"error\":\"inferred schema type for attribute "
                            "'quality_score' as int, but got an incompatible value\"}"
                        ),
                    )
                return _FakeResponse(200, "{}")

        service = TurbopufferService()
        with patch.dict(os.environ, {"TURBOPUFFER_API_KEY": "test-key"}, clear=False), patch(
            "services.memory_turbopuffer_service.httpx.AsyncClient",
            _FakeAsyncClient,
        ):
            service.api_key = "test-key"
            await service.upsert_chunk(
                user_id="user-1",
                doc_id="doc-1",
                vector=[0.1, 0.2],
                attributes={
                    "text_compact": "hello",
                    "quality_score": 0.8,
                },
            )

        self.assertEqual(len(captured_payloads), 2)
        self.assertIn("quality_score", captured_payloads[0].get("schema", {}))
        self.assertIn("quality_score", captured_payloads[0].get("upsert_rows", [{}])[0])
        self.assertNotIn("quality_score", captured_payloads[1].get("schema", {}))
        self.assertNotIn("quality_score", captured_payloads[1].get("upsert_rows", [{}])[0])


if __name__ == "__main__":
    unittest.main()
