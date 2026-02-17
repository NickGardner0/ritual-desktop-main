#!/usr/bin/env python3
"""
Migration: Watcher V2 - Add browser tracking and AFK events

Adds:
- browser_url, browser_domain, is_incognito columns to activity_events
- afk_events table for AFK tracking
- domain_daily_rollups table for per-domain analytics
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
# V2 MIGRATIONS - Browser tracking and AFK
# ============================================================================

V2_MIGRATIONS = [
    # 1. Add browser tracking columns to activity_events
    {
        "name": "Add browser_url to activity_events",
        "check": "SELECT COUNT(*) FROM pragma_table_info('activity_events') WHERE name='browser_url'",
        "sql": "ALTER TABLE activity_events ADD COLUMN browser_url TEXT"
    },
    {
        "name": "Add browser_domain to activity_events",
        "check": "SELECT COUNT(*) FROM pragma_table_info('activity_events') WHERE name='browser_domain'",
        "sql": "ALTER TABLE activity_events ADD COLUMN browser_domain TEXT"
    },
    {
        "name": "Add is_incognito to activity_events",
        "check": "SELECT COUNT(*) FROM pragma_table_info('activity_events') WHERE name='is_incognito'",
        "sql": "ALTER TABLE activity_events ADD COLUMN is_incognito INTEGER NOT NULL DEFAULT 0"
    },
    
    # 2. Create AFK events table
    {
        "name": "Create afk_events table",
        "check": "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='afk_events'",
        "sql": """
            CREATE TABLE IF NOT EXISTS afk_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                ts_start INTEGER NOT NULL,
                ts_end INTEGER NOT NULL,
                status TEXT NOT NULL,
                created_at INTEGER NOT NULL
            )
        """
    },
    
    # 3. Create domain daily rollups table
    {
        "name": "Create domain_daily_rollups table",
        "check": "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='domain_daily_rollups'",
        "sql": """
            CREATE TABLE IF NOT EXISTS domain_daily_rollups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                day TEXT NOT NULL,
                device_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                domain TEXT NOT NULL,
                active_ms INTEGER NOT NULL DEFAULT 0,
                events_count INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )
        """
    },
    
    # 4. Add browser_domain to daily_activity_rollups
    {
        "name": "Add browser_domain to daily_activity_rollups",
        "check": "SELECT COUNT(*) FROM pragma_table_info('daily_activity_rollups') WHERE name='browser_domain'",
        "sql": "ALTER TABLE daily_activity_rollups ADD COLUMN browser_domain TEXT"
    },
    
    # 5. Add afk_ms to daily_activity_rollups
    {
        "name": "Add afk_ms to daily_activity_rollups",
        "check": "SELECT COUNT(*) FROM pragma_table_info('daily_activity_rollups') WHERE name='afk_ms'",
        "sql": "ALTER TABLE daily_activity_rollups ADD COLUMN afk_ms INTEGER NOT NULL DEFAULT 0"
    },
]

V2_INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_activity_events_domain ON activity_events(browser_domain)",
    "CREATE INDEX IF NOT EXISTS idx_afk_events_device_ts ON afk_events(device_id, ts_start)",
    "CREATE INDEX IF NOT EXISTS idx_afk_events_user_ts ON afk_events(user_id, ts_start)",
    "CREATE INDEX IF NOT EXISTS idx_domain_rollups_user_day ON domain_daily_rollups(user_id, day)",
    "CREATE INDEX IF NOT EXISTS idx_domain_rollups_domain ON domain_daily_rollups(domain, day)",
]


async def run_migration():
    """Run the V2 watcher migrations"""
    print("🔄 Starting Ritual Watcher V2 migration...")
    print("   Adding browser URL tracking and AFK detection")
    print("=" * 60)
    
    async with async_session_factory() as session:
        # Run each migration
        for migration in V2_MIGRATIONS:
            try:
                # Check if migration is needed
                result = await session.execute(text(migration["check"]))
                count = result.scalar()
                
                if count and count > 0:
                    print(f"   ⏭️  Skipping '{migration['name']}' (already applied)")
                    continue
                
                # Apply migration
                await session.execute(text(migration["sql"]))
                await session.commit()
                print(f"   ✓ Applied: {migration['name']}")
                
            except Exception as e:
                print(f"   ⚠️ Error in '{migration['name']}': {e}")
                # Continue with other migrations
        
        # Create indexes
        print("\n📇 Creating indexes...")
        for index_sql in V2_INDEXES:
            try:
                await session.execute(text(index_sql))
                await session.commit()
                index_name = index_sql.split("IF NOT EXISTS ")[1].split(" ON")[0]
                print(f"   ✓ Created index: {index_name}")
            except Exception as e:
                print(f"   ⚠️ Index error (may already exist): {e}")
        
        await session.commit()
        
        print("\n" + "=" * 60)
        print("🎉 Ritual Watcher V2 migration complete!")
        print("\nNew features enabled:")
        print("  • Browser URL/domain tracking")
        print("  • Incognito/private mode detection")
        print("  • AFK (Away From Keyboard) tracking")
        print("  • Per-domain analytics")
        print("\nNext steps:")
        print("  1. Rebuild the ritual-watcher: cd apps/desktop/src-tauri/bin/ritual-watcher && cargo build --release")
        print("  2. Restart the Ritual app")
        
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
