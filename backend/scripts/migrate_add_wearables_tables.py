#!/usr/bin/env python3
"""
Migration script to add wearable device and metrics tables.
Run this to add:
- wearable_devices
- wearable_metrics  
- wearable_ingest_events

Usage:
  cd backend
  python3 scripts/migrate_add_wearables_tables.py
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
from database.models import (
    Base, 
    WearableDeviceDB, 
    WearableMetricDB, 
    WearableIngestEventDB
)

# Load environment variables
load_dotenv()


async def check_table_exists(table_name: str) -> bool:
    """Check if a specific table exists."""
    async with async_session_factory() as session:
        try:
            result = await session.execute(
                text(f"SELECT name FROM sqlite_master WHERE type='table' AND name='{table_name}'")
            )
            return result.fetchone() is not None
        except Exception as e:
            print(f"Error checking table {table_name}: {e}")
            return False


async def create_wearables_tables():
    """Create wearable tables if they don't exist."""
    print("🗄️  Wearables Tables Migration")
    print("=" * 50)
    
    tables_to_create = [
        ('wearable_devices', WearableDeviceDB),
        ('wearable_metrics', WearableMetricDB),
        ('wearable_ingest_events', WearableIngestEventDB),
    ]
    
    # Check which tables need to be created
    tables_needed = []
    for table_name, model_class in tables_to_create:
        exists = await check_table_exists(table_name)
        if exists:
            print(f"✅ {table_name}: already exists")
        else:
            print(f"⏳ {table_name}: needs to be created")
            tables_needed.append((table_name, model_class))
    
    if not tables_needed:
        print("\n✅ All wearables tables already exist. No migration needed.")
        return True
    
    print(f"\n📝 Creating {len(tables_needed)} table(s)...")
    
    try:
        async with engine.begin() as conn:
            def create_tables(sync_conn):
                for table_name, model_class in tables_needed:
                    model_class.__table__.create(sync_conn, checkfirst=True)
            
            await conn.run_sync(create_tables)
        
        print("✅ Tables created successfully")
        
    except Exception as e:
        print(f"❌ Error creating tables: {e}")
        import traceback
        traceback.print_exc()
        return False
    
    # Verify tables were created
    print("\n🔍 Verifying table creation...")
    
    all_exist = True
    for table_name, _ in tables_to_create:
        exists = await check_table_exists(table_name)
        status = "✅" if exists else "❌"
        print(f"  {status} {table_name}")
        if not exists:
            all_exist = False
    
    if all_exist:
        print("\n" + "=" * 50)
        print("🎉 Migration complete!")
        print("\nNew capabilities enabled:")
        print("  - POST /api/wearables/apple/register_device")
        print("  - POST /api/wearables/apple/ingest")
        print("  - GET /api/wearables/apple/devices")
        print("  - GET /api/wearables/metrics")
        return True
    else:
        print("\n❌ Migration verification failed")
        return False


async def main():
    try:
        success = await create_wearables_tables()
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
