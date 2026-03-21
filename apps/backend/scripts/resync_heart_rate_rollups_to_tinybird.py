"""
Re-sync canonical heart-rate 1-minute rollups from Turso to Tinybird.
Uses sync sqlite3 for DB reads to avoid aiolibsql/SQLAlchemy async issues.

Usage:
    python scripts/resync_heart_rate_rollups_to_tinybird.py
    python scripts/resync_heart_rate_rollups_to_tinybird.py --user-id user_123
"""

from __future__ import annotations

import argparse
import asyncio
import sqlite3
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv

load_dotenv()

from services.tinybird_service import TinybirdService


def load_rollups_from_db(db_path: Path, user_id: str | None = None) -> list[dict]:
    """Load heart-rate rollups from Turso replica using sync sqlite3."""
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        query = """
            SELECT id, user_id, bucket_start, source_preference, sample_count,
                   bpm_avg, bpm_min, bpm_max, created_at
            FROM heart_rate_1m_rollups
            ORDER BY user_id ASC, bucket_start ASC
        """
        params = ()
        if user_id:
            query = """
                SELECT id, user_id, bucket_start, source_preference, sample_count,
                       bpm_avg, bpm_min, bpm_max, created_at
                FROM heart_rate_1m_rollups
                WHERE user_id = ?
                ORDER BY bucket_start ASC
            """
            params = (user_id,)

        cursor = conn.execute(query, params)
        rows = cursor.fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()


async def resync(user_id: str | None = None, batch_size: int = 500) -> None:
    backend_dir = Path(__file__).resolve().parent.parent
    db_path = backend_dir / ".turso_replica.db"

    if not db_path.exists():
        raise FileNotFoundError(
            f"Database not found at {db_path}. Start the backend server first."
        )

    rows = load_rollups_from_db(db_path, user_id=user_id)
    if not rows:
        print("No heart-rate rollups found in Turso.")
        return

    tinybird = TinybirdService()
    total_rows = 0

    for start in range(0, len(rows), batch_size):
        chunk = rows[start : start + batch_size]
        payload = [
            {
                "id": r["id"],
                "user_id": r["user_id"],
                "bucket_start": r["bucket_start"],
                "source_type": r["source_preference"],
                "sample_count": r["sample_count"],
                "bpm_avg": r["bpm_avg"],
                "bpm_min": r["bpm_min"],
                "bpm_max": r["bpm_max"],
                "created_at": r["created_at"],
            }
            for r in chunk
        ]

        result = await tinybird.ingest_heart_rate_rollups(payload, batch_size=batch_size)
        if not result.get("success"):
            raise RuntimeError(
                f"Failed syncing chunk at {start}: {result.get('errors') or result.get('error')}"
            )
        total_rows += len(chunk)
        print(f"Synced {total_rows}/{len(rows)} heart-rate rollups")

    print(f"Completed Tinybird heart-rate rollup sync: {total_rows} rows")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Re-sync heart-rate 1-minute rollups to Tinybird"
    )
    parser.add_argument("--user-id", help="Optional user_id filter")
    parser.add_argument(
        "--batch-size", type=int, default=500, help="Tinybird ingest batch size"
    )
    args = parser.parse_args()

    asyncio.run(resync(user_id=args.user_id, batch_size=max(1, args.batch_size)))


if __name__ == "__main__":
    main()
