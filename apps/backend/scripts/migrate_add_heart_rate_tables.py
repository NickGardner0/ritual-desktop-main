#!/usr/bin/env python3
"""
Migration script to add heart-rate tables to Turso.
Creates heart_rate_sessions, heart_rate_samples, heart_rate_1m_rollups if missing.
Uses sync sqlite3 to avoid aiolibsql/SQLAlchemy async compatibility issues.
Requires: users table (for foreign key).

Usage:
  cd apps/backend
  python3 scripts/migrate_add_heart_rate_tables.py
"""

import sqlite3
import sys
from pathlib import Path

backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))

db_path = backend_dir / ".turso_replica.db"


def check_table_exists(conn: sqlite3.Connection, table_name: str) -> bool:
    cursor = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        (table_name,),
    )
    return cursor.fetchone() is not None


def migrate():
    print("🗄️  Heart-Rate Tables Migration")
    print("=" * 50)

    if not db_path.exists():
        print(f"❌ Database not found at {db_path}")
        print("   Start your backend server first to create the Turso replica.")
        return False

    conn = sqlite3.connect(str(db_path))

    try:
        if not check_table_exists(conn, "users"):
            print("❌ Table 'users' does not exist. Heart-rate tables require it (foreign key).")
            print("   Run: python3 scripts/init_turso_tables.py")
            return False

        tables_sql = [
            (
                "heart_rate_sessions",
                """
                CREATE TABLE IF NOT EXISTS heart_rate_sessions (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    source_type TEXT NOT NULL,
                    source_device_id TEXT NOT NULL,
                    status TEXT NOT NULL,
                    started_at DATETIME NOT NULL,
                    ended_at DATETIME,
                    app_version TEXT,
                    device_model TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(user_id) REFERENCES users(id)
                )
                """,
            ),
            (
                "heart_rate_samples",
                """
                CREATE TABLE IF NOT EXISTS heart_rate_samples (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    session_id TEXT NOT NULL,
                    source_type TEXT NOT NULL,
                    source_device_id TEXT NOT NULL,
                    bpm_raw INTEGER NOT NULL,
                    bpm_display INTEGER NOT NULL,
                    quality_score REAL,
                    is_outlier BOOLEAN NOT NULL DEFAULT 0,
                    rr_intervals_json TEXT,
                    contact_detected BOOLEAN,
                    received_at DATETIME NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(user_id) REFERENCES users(id),
                    FOREIGN KEY(session_id) REFERENCES heart_rate_sessions(id)
                )
                """,
            ),
            (
                "heart_rate_1m_rollups",
                """
                CREATE TABLE IF NOT EXISTS heart_rate_1m_rollups (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    bucket_start DATETIME NOT NULL,
                    source_preference TEXT NOT NULL,
                    sample_count INTEGER NOT NULL,
                    bpm_avg REAL NOT NULL,
                    bpm_min INTEGER NOT NULL,
                    bpm_max INTEGER NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(user_id) REFERENCES users(id)
                )
                """,
            ),
        ]

        for table_name, sql in tables_sql:
            if check_table_exists(conn, table_name):
                print(f"✅ {table_name}: already exists")
            else:
                print(f"⏳ {table_name}: creating...")
                conn.execute(sql)
                conn.commit()
                print(f"   ✅ {table_name} created")

        indexes_sql = [
            ("idx_heart_rate_sessions_user_started", "CREATE INDEX IF NOT EXISTS idx_heart_rate_sessions_user_started ON heart_rate_sessions (user_id, started_at)"),
            ("idx_heart_rate_sessions_user_status", "CREATE INDEX IF NOT EXISTS idx_heart_rate_sessions_user_status ON heart_rate_sessions (user_id, status)"),
            ("idx_heart_rate_samples_user_received", "CREATE INDEX IF NOT EXISTS idx_heart_rate_samples_user_received ON heart_rate_samples (user_id, received_at)"),
            ("idx_heart_rate_samples_session_received", "CREATE INDEX IF NOT EXISTS idx_heart_rate_samples_session_received ON heart_rate_samples (session_id, received_at)"),
            ("idx_heart_rate_rollups_user_bucket_source", "CREATE UNIQUE INDEX IF NOT EXISTS idx_heart_rate_rollups_user_bucket_source ON heart_rate_1m_rollups (user_id, bucket_start, source_preference)"),
        ]

        for index_name, sql in indexes_sql:
            try:
                conn.execute(sql)
                conn.commit()
            except sqlite3.OperationalError as e:
                if "already exists" not in str(e).lower():
                    print(f"   ⚠️ Index {index_name}: {e}")

        print("\n" + "=" * 50)
        print("🎉 Heart-rate tables migration complete!")
        print("\nYou can now run the Tinybird backfill:")
        print("  python3 scripts/resync_heart_rate_rollups_to_tinybird.py")
        return True

    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        conn.close()


if __name__ == "__main__":
    success = migrate()
    sys.exit(0 if success else 1)
