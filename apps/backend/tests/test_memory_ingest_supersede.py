import os
import sys
import tempfile
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from services.memory_cloud_store import get_memory_db
from services.memory_ingest_service import ingest_memory_chunks


class MemoryIngestSupersedeTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self._prev_db_path = os.environ.get("RITUAL_MEMORY_DB_PATH")
        os.environ["RITUAL_MEMORY_DB_PATH"] = os.path.join(
            self._tmpdir.name, "memory_test.db"
        )

    def tearDown(self) -> None:
        if self._prev_db_path is None:
            os.environ.pop("RITUAL_MEMORY_DB_PATH", None)
        else:
            os.environ["RITUAL_MEMORY_DB_PATH"] = self._prev_db_path
        self._tmpdir.cleanup()

    async def test_dedupes_same_logical_chunk_and_content_hash(self):
        now_ms = int(time.time() * 1000)
        chunk = {
            "chunk_id": "legacy-id-1",
            "logical_chunk_id": "logical-1",
            "chunk_start_ts": now_ms - 10_000,
            "chunk_end_ts": now_ms,
            "app_name": "Cursor",
            "window_title": "README.md",
            "browser_domain": "",
            "text_compact": "same text",
            "quality_score": 0.8,
            "source_frame_ids": [1, 2, 3],
            "content_hash": "hash-same",
        }
        first = await ingest_memory_chunks(
            user_id="user-1",
            device_id="device-1",
            chunks=[chunk],
            process_batch_after_ingest=False,
        )
        second = await ingest_memory_chunks(
            user_id="user-1",
            device_id="device-1",
            chunks=[dict(chunk, chunk_id="legacy-id-2")],
            process_batch_after_ingest=False,
        )

        self.assertEqual(int(first.get("accepted") or 0), 1)
        self.assertEqual(int(second.get("accepted") or 0), 0)
        self.assertEqual(int(second.get("deduped") or 0), 1)
        self.assertEqual(int(second.get("superseded") or 0), 0)

        with get_memory_db() as conn:
            active_count = int(
                conn.execute(
                    """
                    SELECT COUNT(*)
                    FROM memory_chunks
                    WHERE user_id = ?
                      AND device_id = ?
                      AND logical_chunk_id = ?
                      AND deleted_at IS NULL
                    """,
                    ("user-1", "device-1", "logical-1"),
                ).fetchone()[0]
                or 0
            )
        self.assertEqual(active_count, 1)

    async def test_supersedes_old_active_chunk_and_queues_provider_delete(self):
        now_ms = int(time.time() * 1000)
        first_chunk = {
            "chunk_id": "legacy-id-1",
            "logical_chunk_id": "logical-1",
            "chunk_start_ts": now_ms - 20_000,
            "chunk_end_ts": now_ms - 10_000,
            "app_name": "Cursor",
            "window_title": "main.rs",
            "browser_domain": "",
            "text_compact": "first version",
            "quality_score": 0.8,
            "source_frame_ids": [10, 11],
            "content_hash": "hash-v1",
        }
        second_chunk = {
            "chunk_id": "legacy-id-2",
            "logical_chunk_id": "logical-1",
            "chunk_start_ts": now_ms - 20_000,
            "chunk_end_ts": now_ms - 10_000,
            "app_name": "Cursor",
            "window_title": "main.rs",
            "browser_domain": "",
            "text_compact": "second version",
            "quality_score": 0.85,
            "source_frame_ids": [12],
            "content_hash": "hash-v2",
        }

        first = await ingest_memory_chunks(
            user_id="user-1",
            device_id="device-1",
            chunks=[first_chunk],
            process_batch_after_ingest=False,
        )
        self.assertEqual(int(first.get("accepted") or 0), 1)

        with get_memory_db() as conn:
            conn.execute(
                """
                UPDATE memory_chunks
                SET provider_doc_id = ?, embedding_status = 'ok'
                WHERE user_id = ?
                  AND device_id = ?
                  AND logical_chunk_id = ?
                  AND deleted_at IS NULL
                """,
                ("provider-doc-v1", "user-1", "device-1", "logical-1"),
            )

        second = await ingest_memory_chunks(
            user_id="user-1",
            device_id="device-1",
            chunks=[second_chunk],
            process_batch_after_ingest=False,
        )

        self.assertEqual(int(second.get("accepted") or 0), 1)
        self.assertEqual(int(second.get("superseded") or 0), 1)
        self.assertEqual(int(second.get("provider_delete_queued") or 0), 1)

        with get_memory_db() as conn:
            active_count = int(
                conn.execute(
                    """
                    SELECT COUNT(*)
                    FROM memory_chunks
                    WHERE user_id = ?
                      AND device_id = ?
                      AND logical_chunk_id = ?
                      AND deleted_at IS NULL
                    """,
                    ("user-1", "device-1", "logical-1"),
                ).fetchone()[0]
                or 0
            )
            superseded_count = int(
                conn.execute(
                    """
                    SELECT COUNT(*)
                    FROM memory_chunks
                    WHERE user_id = ?
                      AND device_id = ?
                      AND logical_chunk_id = ?
                      AND deleted_at IS NOT NULL
                    """,
                    ("user-1", "device-1", "logical-1"),
                ).fetchone()[0]
                or 0
            )
            queued_deletes = int(
                conn.execute(
                    """
                    SELECT COUNT(*)
                    FROM memory_provider_deletes
                    WHERE user_id = ?
                      AND provider_doc_id = ?
                      AND status IN ('pending', 'failed')
                      AND deleted_at IS NULL
                    """,
                    ("user-1", "provider-doc-v1"),
                ).fetchone()[0]
                or 0
            )

        self.assertEqual(active_count, 1)
        self.assertEqual(superseded_count, 1)
        self.assertEqual(queued_deletes, 1)

    async def test_persists_contextual_and_raw_chunk_fields(self):
        now_ms = int(time.time() * 1000)
        chunk = {
            "chunk_id": "legacy-id-ctx-1",
            "logical_chunk_id": "logical-ctx-1",
            "chunk_start_ts": now_ms - 10_000,
            "chunk_end_ts": now_ms,
            "app_name": "Things 3",
            "window_title": "Inbox",
            "browser_domain": "",
            "text_compact": "fallback contextual text",
            "raw_text_compact": "buy groceries\nplan sprint",
            "contextual_text_compact": (
                "Session: task planning session in Things 3\n"
                "Primary app: Things 3\n"
                "Observed content: buy groceries\nplan sprint"
            ),
            "context_version": 3,
            "session_key": "session-123",
            "session_position": 2,
            "session_chunk_count": 5,
            "quality_score": 0.8,
            "source_frame_ids": [1, 2, 3],
            "content_hash": "hash-contextual",
        }

        result = await ingest_memory_chunks(
            user_id="user-1",
            device_id="device-1",
            chunks=[chunk],
            process_batch_after_ingest=False,
        )

        self.assertEqual(int(result.get("accepted") or 0), 1)

        with get_memory_db() as conn:
            row = conn.execute(
                """
                SELECT raw_text_compact, contextual_text_compact, text_compact,
                       context_version, session_key, session_position, session_chunk_count
                FROM memory_chunks
                WHERE user_id = ? AND device_id = ? AND logical_chunk_id = ? AND deleted_at IS NULL
                """,
                ("user-1", "device-1", "logical-ctx-1"),
            ).fetchone()

        self.assertIsNotNone(row)
        self.assertEqual(row[0], "buy groceries\nplan sprint")
        self.assertIn("task planning session", row[1])
        self.assertEqual(row[2], row[1])
        self.assertEqual(int(row[3]), 3)
        self.assertEqual(row[4], "session-123")
        self.assertEqual(int(row[5]), 2)
        self.assertEqual(int(row[6]), 5)


if __name__ == "__main__":
    unittest.main()
