import os
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from services.memory_cloud_store import get_memory_db
from services.memory_embedding_service import (
    MAX_RETRIES,
    process_embedding_jobs,
    process_embedding_jobs_freshness_first,
)


class _FakeEmbeddingItem:
    def __init__(self, embedding):
        self.embedding = embedding


class _FakeEmbeddingResponse:
    def __init__(self, count: int):
        self.data = [_FakeEmbeddingItem([0.1, 0.2, 0.3]) for _ in range(max(0, count))]


class _FakeEmbeddingsAPI:
    async def create(self, model, input):
        return _FakeEmbeddingResponse(len(input))


class _FakeOpenAIClient:
    def __init__(self):
        self.embeddings = _FakeEmbeddingsAPI()


class _FakeTurbopuffer:
    configured = True

    def __init__(self):
        self.upserts = []

    async def upsert_chunk(self, **kwargs):
        self.upserts.append(kwargs)


def _now_ms() -> int:
    return int(time.time() * 1000)


def _insert_chunk_and_job(
    *,
    user_id: str,
    device_id: str,
    chunk_id: str,
    logical_chunk_id: str,
    text_compact: str,
    start_ts: int,
    end_ts: int,
    job_status: str,
    retry_count: int,
    next_retry_at,
    raw_text_compact: str | None = None,
    contextual_text_compact: str | None = None,
    context_version: int = 1,
    session_key: str = "",
    session_position: int = 0,
    session_chunk_count: int = 1,
):
    now_ms = _now_ms()
    with get_memory_db() as conn:
        cur = conn.execute(
            """
            INSERT INTO memory_chunks (
                user_id, device_id, chunk_id, logical_chunk_id,
                chunk_start_ts, chunk_end_ts, app_name, window_title, browser_domain,
                text_compact, raw_text_compact, contextual_text_compact, context_version,
                session_key, session_position, session_chunk_count,
                quality_score, source_frame_ids_json, content_hash,
                embedding_status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
            """,
            (
                user_id,
                device_id,
                chunk_id,
                logical_chunk_id,
                start_ts,
                end_ts,
                "Cursor",
                "editor",
                "",
                text_compact,
                raw_text_compact or text_compact,
                contextual_text_compact or text_compact,
                context_version,
                session_key,
                session_position,
                session_chunk_count,
                0.8,
                "[]",
                f"hash-{chunk_id}",
                now_ms,
                now_ms,
            ),
        )
        chunk_pk = int(cur.lastrowid)
        conn.execute(
            """
            INSERT INTO memory_embedding_jobs (
                chunk_pk, status, retry_count, next_retry_at, last_error, created_at, updated_at
            ) VALUES (?, ?, ?, ?, NULL, ?, ?)
            """,
            (chunk_pk, job_status, retry_count, next_retry_at, now_ms, now_ms),
        )
        return chunk_pk


class MemoryEmbeddingServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_watermarks_not_advanced_when_no_successful_upserts(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = os.path.join(tmp, "memory.db")
            with patch.dict(os.environ, {"RITUAL_MEMORY_DB_PATH": db_path}, clear=False):
                now_ms = _now_ms()
                _insert_chunk_and_job(
                    user_id="user-1",
                    device_id="device-1",
                    chunk_id="chunk-empty",
                    logical_chunk_id="chunk-empty",
                    text_compact="",
                    start_ts=now_ms - 1000,
                    end_ts=now_ms,
                    job_status="pending",
                    retry_count=0,
                    next_retry_at=None,
                )

                fake_tp = _FakeTurbopuffer()
                with patch("services.memory_embedding_service._openai_client", return_value=_FakeOpenAIClient()), patch(
                    "services.memory_embedding_service.TurbopufferService", return_value=fake_tp
                ):
                    result = await process_embedding_jobs(batch_size=8)

                self.assertEqual(result["processed"], 0)
                with get_memory_db() as conn:
                    row = conn.execute(
                        "SELECT last_embed_ts, last_upsert_ts FROM memory_pipeline_watermarks WHERE id = 1"
                    ).fetchone()
                    self.assertIsNotNone(row)
                    self.assertIsNone(row[0])
                    self.assertIsNone(row[1])

    async def test_freshness_first_respects_retry_window_and_max_retries(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = os.path.join(tmp, "memory.db")
            with patch.dict(os.environ, {"RITUAL_MEMORY_DB_PATH": db_path}, clear=False):
                now_ms = _now_ms()
                start_ms = now_ms - 60_000
                end_ms = now_ms + 60_000

                pending_pk = _insert_chunk_and_job(
                    user_id="user-1",
                    device_id="device-1",
                    chunk_id="chunk-pending",
                    logical_chunk_id="chunk-pending",
                    text_compact="ready to embed",
                    start_ts=now_ms - 20_000,
                    end_ts=now_ms - 10_000,
                    job_status="pending",
                    retry_count=0,
                    next_retry_at=None,
                )
                _insert_chunk_and_job(
                    user_id="user-1",
                    device_id="device-1",
                    chunk_id="chunk-failed-backoff",
                    logical_chunk_id="chunk-failed-backoff",
                    text_compact="should wait for next retry",
                    start_ts=now_ms - 20_000,
                    end_ts=now_ms - 10_000,
                    job_status="failed",
                    retry_count=1,
                    next_retry_at=now_ms + 120_000,
                )
                _insert_chunk_and_job(
                    user_id="user-1",
                    device_id="device-1",
                    chunk_id="chunk-failed-max",
                    logical_chunk_id="chunk-failed-max",
                    text_compact="already max retries",
                    start_ts=now_ms - 20_000,
                    end_ts=now_ms - 10_000,
                    job_status="failed",
                    retry_count=MAX_RETRIES,
                    next_retry_at=now_ms - 1000,
                )

                fake_tp = _FakeTurbopuffer()
                with patch("services.memory_embedding_service._openai_client", return_value=_FakeOpenAIClient()), patch(
                    "services.memory_embedding_service.TurbopufferService", return_value=fake_tp
                ):
                    result = await process_embedding_jobs_freshness_first(
                        start_ms=start_ms,
                        end_ms=end_ms,
                        batch_size=10,
                    )

                self.assertEqual(result["processed"], 1)
                self.assertEqual(len(fake_tp.upserts), 1)
                with get_memory_db() as conn:
                    rows = conn.execute(
                        "SELECT chunk_pk, status FROM memory_embedding_jobs ORDER BY chunk_pk ASC"
                    ).fetchall()
                    statuses = {int(row[0]): str(row[1]) for row in rows}
                    self.assertEqual(statuses[pending_pk], "ok")

    async def test_embedding_upsert_prefers_contextual_text_and_preserves_raw_fields(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = os.path.join(tmp, "memory.db")
            with patch.dict(os.environ, {"RITUAL_MEMORY_DB_PATH": db_path}, clear=False):
                now_ms = _now_ms()
                _insert_chunk_and_job(
                    user_id="user-1",
                    device_id="device-1",
                    chunk_id="chunk-contextual",
                    logical_chunk_id="logical-contextual",
                    text_compact="legacy fallback text",
                    raw_text_compact="Things 3\nInbox",
                    contextual_text_compact=(
                        "Session: task planning session in Things 3\n"
                        "Primary app: Things 3\n"
                        "Observed content: Things 3\nInbox"
                    ),
                    context_version=3,
                    session_key="session-ctx",
                    session_position=1,
                    session_chunk_count=3,
                    start_ts=now_ms - 20_000,
                    end_ts=now_ms - 10_000,
                    job_status="pending",
                    retry_count=0,
                    next_retry_at=None,
                )

                fake_tp = _FakeTurbopuffer()
                with patch("services.memory_embedding_service._openai_client", return_value=_FakeOpenAIClient()), patch(
                    "services.memory_embedding_service.TurbopufferService", return_value=fake_tp
                ):
                    result = await process_embedding_jobs(batch_size=8)

                self.assertEqual(result["processed"], 1)
                self.assertEqual(len(fake_tp.upserts), 1)
                payload = fake_tp.upserts[0]
                self.assertIn("task planning session", payload["attributes"]["contextual_text_compact"])
                self.assertEqual(payload["attributes"]["raw_text_compact"], "Things 3\nInbox")
                self.assertEqual(payload["attributes"]["text_compact"], payload["attributes"]["contextual_text_compact"])
                self.assertEqual(payload["attributes"]["context_version"], 3)
                self.assertEqual(payload["attributes"]["session_key"], "session-ctx")
                self.assertEqual(payload["attributes"]["session_position"], 1)
                self.assertEqual(payload["attributes"]["session_chunk_count"], 3)


if __name__ == "__main__":
    unittest.main()
