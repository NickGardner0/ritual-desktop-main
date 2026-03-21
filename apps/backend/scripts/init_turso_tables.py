#!/usr/bin/env python3
"""
Initialize Turso database tables.
Run this script to create all required tables in your Turso database.
Uses sync sqlite3/SQLAlchemy to avoid aiolibsql async compatibility issues.
"""

import sqlite3
import sys
from pathlib import Path

# Add backend directory to path
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from dotenv import load_dotenv
from sqlalchemy import create_engine

load_dotenv()

from database.models import Base

db_path = backend_dir / ".turso_replica.db"


def check_tables_exist(conn: sqlite3.Connection) -> list:
    """Return list of existing table names."""
    try:
        cursor = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        )
        return [row[0] for row in cursor.fetchall()]
    except Exception as e:
        print(f"Error checking tables: {e}")
        return []


def main():
    print("🗄️  Initializing Turso Database Tables")
    print("=" * 50)

    if not db_path.exists():
        print(f"❌ Database not found at {db_path}")
        print("   Start your backend server first to create the Turso replica.")
        print("   Or set RITUAL_DB_LOCAL_ONLY=1 and DATABASE_URL, then start the server.")
        return False

    # Check current tables
    conn = sqlite3.connect(str(db_path))
    existing_tables = check_tables_exist(conn)
    conn.close()

    if existing_tables:
        print(f"\n📋 Existing tables: {', '.join(existing_tables)}")
        response = input("\n⚠️  Tables already exist. Drop and recreate? (yes/no): ")
        if response.lower() != "yes":
            print("❌ Aborting. No changes made.")
            return False

        # Drop existing tables
        print("\n🗑️  Dropping existing tables...")
        engine = create_engine(f"sqlite:///{db_path}")
        Base.metadata.drop_all(engine)
        engine.dispose()
        print("✅ Existing tables dropped")

    # Create all tables
    print("\n📝 Creating database tables...")
    try:
        engine = create_engine(f"sqlite:///{db_path}")
        Base.metadata.create_all(engine)
        engine.dispose()
        print("✅ Tables created successfully")
    except Exception as e:
        print(f"❌ Error creating tables: {e}")
        import traceback

        traceback.print_exc()
        return False

    # Verify tables were created
    print("\n🔍 Verifying table creation...")
    conn = sqlite3.connect(str(db_path))
    tables = check_tables_exist(conn)
    conn.close()

    expected_tables = [
        "users",
        "habits",
        "habit_logs",
        "habit_aliases",
        "financial_connections",
        "financial_accounts",
        "financial_transactions",
        "financial_sync_cursors",
        "financial_sync_runs",
        "whoop_integrations",
        "integrations",
        "ai_conversations",
        "ai_messages",
        "wearable_devices",
        "wearable_metrics",
        "wearable_ingest_events",
        "heart_rate_sessions",
        "heart_rate_samples",
        "heart_rate_1m_rollups",
        "live_biometrics_state",
    ]

    if not tables:
        print("❌ No tables found after creation!")
        return False

    print(f"\n✅ Found {len(tables)} table(s):")
    for table in tables:
        status = "✓" if table in expected_tables else "?"
        print(f"   {status} {table}")

    missing_tables = set(expected_tables) - set(tables)
    if missing_tables:
        print(f"\n⚠️  Missing expected tables: {', '.join(missing_tables)}")
        return False

    print("\n" + "=" * 50)
    print("🎉 Database initialization complete!")
    print("\nNext steps:")
    print("  1. Restart your backend server")
    print("  2. Sign in to your app")
    print("  3. Complete onboarding (will create your user record)")

    return True


if __name__ == "__main__":
    try:
        success = main()
        sys.exit(0 if success else 1)
    except Exception as e:
        print(f"\n❌ Fatal error: {e}")
        import traceback

        traceback.print_exc()
        sys.exit(1)
