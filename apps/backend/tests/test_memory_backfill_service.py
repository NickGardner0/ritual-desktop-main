import os
import sqlite3
import tempfile
import unittest
from contextlib import asynccontextmanager
from unittest.mock import patch

from services.memory_backfill_service import backfill_cloud_from_local_chunks


class MemoryBackfillServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_backfill_reads_from_activity_connection_for_user(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = os.path.join(tmpdir, "activity.db")
            conn = sqlite3.connect(db_path)
            conn.execute(
                """
                CREATE TABLE session_retrieval_docs (
                    session_id INTEGER NOT NULL,
                    device_id TEXT,
                    user_id TEXT,
                    chunk_start_ts INTEGER NOT NULL,
                    chunk_end_ts INTEGER NOT NULL,
                    app_name TEXT,
                    window_title TEXT,
                    document_title TEXT,
                    browser_domain TEXT,
                    raw_visible_text TEXT,
                    contextual_retrieval_text TEXT,
                    capture_quality REAL,
                    context_version INTEGER,
                    session_position INTEGER,
                    session_count INTEGER
                )
                """
            )
            conn.execute(
                """
                INSERT INTO session_retrieval_docs (
                    session_id, device_id, user_id, chunk_start_ts, chunk_end_ts,
                    app_name, window_title, document_title, browser_domain,
                    raw_visible_text, contextual_retrieval_text, capture_quality,
                    context_version, session_position, session_count
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    42,
                    "device-1",
                    "user-1",
                    1000,
                    2000,
                    "Cursor",
                    "file.py",
                    "file.py",
                    "",
                    "raw text",
                    "retrieval text",
                    0.9,
                    1,
                    0,
                    1,
                ),
            )
            conn.commit()
            conn.close()

            @asynccontextmanager
            async def _activity_conn(*args, **kwargs):
                ro = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=2.0)
                ro.row_factory = sqlite3.Row
                try:
                    yield ro
                finally:
                    ro.close()

            async def _fake_ingest_memory_chunks(*, user_id, device_id, chunks, process_batch_after_ingest):
                self.assertEqual(user_id, "user-1")
                self.assertEqual(device_id, "device-1")
                self.assertEqual(len(chunks), 1)
                self.assertEqual(chunks[0]["logical_chunk_id"], "context-session-42")
                return {"accepted": 1, "deduped": 0, "failed": 0}

            async def _fake_process_embedding_jobs_with_guard(batch_size=64):
                return {"processed": 1, "failed": 0, "skipped": 0, "running": False}

            with (
                patch("services.memory_backfill_service.open_activity_connection_for_user", _activity_conn),
                patch("services.memory_backfill_service.ingest_memory_chunks", _fake_ingest_memory_chunks),
                patch(
                    "services.memory_backfill_service.process_embedding_jobs_with_guard",
                    _fake_process_embedding_jobs_with_guard,
                ),
            ):
                result = await backfill_cloud_from_local_chunks(user_id="user-1")

            self.assertTrue(result["success"])
            self.assertEqual(result["local_chunks_scanned"], 1)
            self.assertEqual(result["accepted"], 1)
            self.assertEqual(result["embedding_processed"], 1)


if __name__ == "__main__":
    unittest.main()
