#!/usr/bin/env python3
"""
Migration: Add Ritual Watcher tables
Creates tables for computer activity tracking:
- watcher_devices: Device info
- watcher_state: Watcher configuration and state
- activity_events: Raw activity events (append-only)
- daily_activity_rollups: Aggregated daily data
- watcher_sync_outbox: Optional sync queue
"""

import os
import sys
import asyncio
from pathlib import Path

# Add backend directory to path
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from dotenv import load_dotenv
from sqlalchemy import text
from database.connection import engine, async_session_factory

# Load environment variables
load_dotenv()


# ============================================================================
# WATCHER TABLES - Each statement separate for Turso compatibility
# ============================================================================

WATCHER_TABLES = [
    # 1. Device table
    """
    CREATE TABLE IF NOT EXISTS watcher_devices (
        device_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        device_name TEXT NOT NULL,
        platform TEXT NOT NULL DEFAULT 'macos',
        os_version TEXT,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER
    )
    """,
    
    # 2. Watcher state table
    """
    CREATE TABLE IF NOT EXISTS watcher_state (
        id INTEGER PRIMARY KEY,
        device_id TEXT NOT NULL UNIQUE,
        is_enabled INTEGER NOT NULL DEFAULT 0,
        poll_interval_ms INTEGER NOT NULL DEFAULT 2000,
        last_seen_ts INTEGER,
        accessibility_status TEXT NOT NULL DEFAULT 'unknown',
        title_mode TEXT NOT NULL DEFAULT 'off',
        truncate_length INTEGER DEFAULT 80,
        excluded_bundle_ids TEXT,
        sync_analytics INTEGER NOT NULL DEFAULT 0,
        sync_raw_to_cloud INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
    )
    """,
    
    # 3. Activity events table
    """
    CREATE TABLE IF NOT EXISTS activity_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        ts_start INTEGER NOT NULL,
        ts_end INTEGER NOT NULL,
        app_bundle_id TEXT NOT NULL,
        app_name TEXT NOT NULL,
        window_title TEXT,
        window_title_hash TEXT,
        window_owner_pid INTEGER,
        is_afk INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'ritual_watcher_v1',
        created_at INTEGER NOT NULL
    )
    """,
    
    # 4. Daily activity rollups table
    """
    CREATE TABLE IF NOT EXISTS daily_activity_rollups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        day TEXT NOT NULL,
        device_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        app_bundle_id TEXT NOT NULL,
        app_name TEXT NOT NULL,
        window_title TEXT,
        window_title_hash TEXT,
        active_ms INTEGER NOT NULL DEFAULT 0,
        events_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    )
    """,
    
    # 5. Sync outbox table
    """
    CREATE TABLE IF NOT EXISTS watcher_sync_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        last_attempt_at INTEGER
    )
    """,
    
    # 6. App exclusions table
    """
    CREATE TABLE IF NOT EXISTS watcher_app_exclusions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        bundle_id TEXT NOT NULL,
        app_name TEXT,
        reason TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE(user_id, bundle_id)
    )
    """,
]

# Indexes - created after tables
WATCHER_INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_watcher_devices_user_id ON watcher_devices(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_watcher_state_device_id ON watcher_state(device_id)",
    "CREATE INDEX IF NOT EXISTS idx_activity_events_ts_start ON activity_events(ts_start)",
    "CREATE INDEX IF NOT EXISTS idx_activity_events_device_ts ON activity_events(device_id, ts_start)",
    "CREATE INDEX IF NOT EXISTS idx_activity_events_user_ts ON activity_events(user_id, ts_start)",
    "CREATE INDEX IF NOT EXISTS idx_activity_events_app_ts ON activity_events(app_bundle_id, ts_start)",
    "CREATE INDEX IF NOT EXISTS idx_daily_rollups_user_day ON daily_activity_rollups(user_id, day)",
    "CREATE INDEX IF NOT EXISTS idx_daily_rollups_device_day ON daily_activity_rollups(device_id, day)",
    "CREATE INDEX IF NOT EXISTS idx_daily_rollups_app ON daily_activity_rollups(app_bundle_id, day)",
    "CREATE INDEX IF NOT EXISTS idx_sync_outbox_status ON watcher_sync_outbox(status, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_sync_outbox_device ON watcher_sync_outbox(device_id, status)",
    "CREATE INDEX IF NOT EXISTS idx_app_exclusions_user ON watcher_app_exclusions(user_id)",
]


async def check_table_exists(session, table_name: str) -> bool:
    """Check if a table exists"""
    result = await session.execute(
        text(f"SELECT name FROM sqlite_master WHERE type='table' AND name='{table_name}'")
    )
    return result.fetchone() is not None


async def run_migration():
    """Run the watcher tables migration"""
    print("🔄 Starting Ritual Watcher tables migration...")
    print("=" * 60)
    
    tables_to_create = [
        'watcher_devices',
        'watcher_state', 
        'activity_events',
        'daily_activity_rollups',
        'watcher_sync_outbox',
        'watcher_app_exclusions'
    ]
    
    async with async_session_factory() as session:
        # Check if tables already exist
        existing = []
        for table in tables_to_create:
            if await check_table_exists(session, table):
                existing.append(table)
        
        if existing:
            print(f"\n📋 Tables already exist: {', '.join(existing)}")
            response = input("\n⚠️  Drop and recreate these tables? (yes/no): ")
            if response.lower() != 'yes':
                print("❌ Migration aborted. No changes made.")
                return False
            
            # Drop existing tables in reverse order
            print("\n🗑️  Dropping existing watcher tables...")
            for table in reversed(existing):
                try:
                    await session.execute(text(f"DROP TABLE IF EXISTS {table}"))
                    await session.commit()
                    print(f"   ✓ Dropped {table}")
                except Exception as e:
                    print(f"   ⚠️ Could not drop {table}: {e}")
        
        # Create tables one by one
        print("\n📝 Creating watcher tables...")
        
        for i, create_sql in enumerate(WATCHER_TABLES):
            table_name = tables_to_create[i]
            try:
                await session.execute(text(create_sql))
                await session.commit()
                print(f"   ✓ Created table: {table_name}")
            except Exception as e:
                print(f"   ❌ Failed to create {table_name}: {e}")
                return False
        
        # Create indexes
        print("\n📇 Creating indexes...")
        for index_sql in WATCHER_INDEXES:
            try:
                await session.execute(text(index_sql))
                await session.commit()
                # Extract index name for logging
                index_name = index_sql.split("IF NOT EXISTS ")[1].split(" ON")[0]
                print(f"   ✓ Created index: {index_name}")
            except Exception as e:
                print(f"   ⚠️ Index error (non-fatal): {e}")
        
        # Final commit
        await session.commit()
        
        # Verify tables
        print("\n🔍 Verifying table creation...")
        all_created = True
        for table in tables_to_create:
            if await check_table_exists(session, table):
                print(f"   ✓ {table}")
            else:
                print(f"   ✗ {table} (MISSING)")
                all_created = False
        
        if not all_created:
            print("\n❌ Some tables were not created. Check errors above.")
            return False
        
        print("\n" + "=" * 60)
        print("🎉 Ritual Watcher migration complete!")
        print("\nNext steps:")
        print("  1. Build the ritual-watcher sidecar: cd apps/desktop/src-tauri && cargo build --release")
        print("  2. Restart the backend server")
        print("  3. Enable Computer Tracking in Settings")
        
        return True


async def main():
    try:
        success = await run_migration()
        sys.exit(0 if success else 1)
    except Exception as e:
        print(f"\n❌ Fatal error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
