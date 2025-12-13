#!/usr/bin/env python3
"""
Initialize Turso database tables
Run this script to create all required tables in your Turso database
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
from database.models import Base

# Load environment variables
load_dotenv()

async def check_tables_exist():
    """Check if tables already exist"""
    async with async_session_factory() as session:
        try:
            result = await session.execute(
                text("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            )
            tables = result.fetchall()
            return [t[0] for t in tables]
        except Exception as e:
            print(f"Error checking tables: {e}")
            return []

async def create_tables():
    """Create all database tables"""
    print("🗄️  Initializing Turso Database Tables")
    print("=" * 50)
    
    # Check current tables
    existing_tables = await check_tables_exist()
    if existing_tables:
        print(f"\n📋 Existing tables: {', '.join(existing_tables)}")
        response = input("\n⚠️  Tables already exist. Drop and recreate? (yes/no): ")
        if response.lower() != 'yes':
            print("❌ Aborting. No changes made.")
            return False
        
        # Drop existing tables
        print("\n🗑️  Dropping existing tables...")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
        print("✅ Existing tables dropped")
    
    # Create all tables
    print("\n📝 Creating database tables...")
    try:
        async with engine.begin() as conn:
            def create_all_tables(sync_conn):
                Base.metadata.create_all(sync_conn)
                
            await conn.run_sync(create_all_tables)
        print("✅ Tables created successfully")
    except Exception as e:
        print(f"❌ Error creating tables: {e}")
        import traceback
        traceback.print_exc()
        return False
    
    # Verify tables were created
    print("\n🔍 Verifying table creation...")
    tables = await check_tables_exist()
    
    expected_tables = ['users', 'habits', 'habit_logs', 'whoop_integrations', 'ai_conversations', 'ai_messages']
    
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

async def main():
    try:
        success = await create_tables()
        sys.exit(0 if success else 1)
    except Exception as e:
        print(f"\n❌ Fatal error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        # Close database connections
        await engine.dispose()

if __name__ == "__main__":
    asyncio.run(main())

