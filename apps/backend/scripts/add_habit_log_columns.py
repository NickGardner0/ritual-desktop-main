"""
Migration script to add client_event_id and source columns to habit_logs table
These columns are part of Phase 5A for idempotency and source tracking
"""

import asyncio
import os
import sys
from pathlib import Path

# Add parent directory to path so we can import from backend
sys.path.insert(0, str(Path(__file__).parent.parent))

from database.connection import get_db_session
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError


async def column_exists(session, table: str, column: str) -> bool:
    """Check if a column exists in a table"""
    check_query = f"""
    SELECT COUNT(*) as count 
    FROM pragma_table_info('{table}') 
    WHERE name='{column}'
    """
    result = await session.execute(text(check_query))
    row = result.fetchone()
    return row and row[0] > 0


async def add_client_event_id_column():
    """Add client_event_id column to habit_logs table"""
    async with get_db_session() as session:
        try:
            print("📊 Checking client_event_id column...")
            
            if await column_exists(session, 'habit_logs', 'client_event_id'):
                print("✅ client_event_id column already exists!")
                return True
            
            # Add the column
            alter_query = "ALTER TABLE habit_logs ADD COLUMN client_event_id TEXT"
            await session.execute(text(alter_query))
            await session.commit()
            
            print("✅ Successfully added client_event_id column!")
            return True
            
        except SQLAlchemyError as e:
            print(f"❌ Error adding client_event_id column: {e}")
            await session.rollback()
            return False


async def add_source_column():
    """Add source column to habit_logs table"""
    async with get_db_session() as session:
        try:
            print("📊 Checking source column...")
            
            if await column_exists(session, 'habit_logs', 'source'):
                print("✅ source column already exists!")
                return True
            
            # Add the column
            alter_query = "ALTER TABLE habit_logs ADD COLUMN source TEXT"
            await session.execute(text(alter_query))
            await session.commit()
            
            print("✅ Successfully added source column!")
            return True
            
        except SQLAlchemyError as e:
            print(f"❌ Error adding source column: {e}")
            await session.rollback()
            return False


async def verify_columns():
    """Verify the columns were added correctly"""
    async with get_db_session() as session:
        try:
            print("\n🔍 Verifying column structure...")
            
            result = await session.execute(text("PRAGMA table_info(habit_logs)"))
            columns = result.fetchall()
            
            print("📋 habit_logs table columns:")
            for col in columns:
                print(f"   - {col[1]} ({col[2]})")
            
            # Check for our new columns
            column_names = [col[1] for col in columns]
            has_client_event_id = 'client_event_id' in column_names
            has_source = 'source' in column_names
            
            if has_client_event_id and has_source:
                print("\n✅ All Phase 5A columns are present!")
                return True
            else:
                missing = []
                if not has_client_event_id:
                    missing.append('client_event_id')
                if not has_source:
                    missing.append('source')
                print(f"\n❌ Missing columns: {', '.join(missing)}")
                return False
            
        except SQLAlchemyError as e:
            print(f"❌ Error verifying columns: {e}")
            return False


async def main():
    """Run the migration"""
    print("=" * 60)
    print("🔧 Migration: Add Phase 5A columns to habit_logs")
    print("   - client_event_id: For idempotency checking")
    print("   - source: Track log origin (ai_log_v2, screenshot, manual)")
    print("=" * 60)
    
    # Step 1: Add client_event_id column
    success = await add_client_event_id_column()
    if not success:
        print("\n❌ Migration failed at step 1 (add client_event_id)")
        return False
    
    # Step 2: Add source column
    success = await add_source_column()
    if not success:
        print("\n❌ Migration failed at step 2 (add source)")
        return False
    
    # Step 3: Verify
    success = await verify_columns()
    if not success:
        print("\n❌ Migration failed at step 3 (verification)")
        return False
    
    print("\n" + "=" * 60)
    print("✅ Migration completed successfully!")
    print("=" * 60)
    return True


if __name__ == "__main__":
    asyncio.run(main())

