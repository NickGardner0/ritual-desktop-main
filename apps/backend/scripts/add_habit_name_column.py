"""
Migration script to add habit_name column to habit_logs table
and backfill with data from habits table
"""

import asyncio
import os
import sys
from pathlib import Path

# Add parent directory to path so we can import from backend
sys.path.insert(0, str(Path(__file__).parent.parent))

from database.connection import get_db_session
from database.models import HabitDB, HabitLogDB
from sqlalchemy import text, select
from sqlalchemy.exc import SQLAlchemyError

async def add_habit_name_column():
    """Add habit_name column to habit_logs table"""
    async with get_db_session() as session:
        try:
            print("📊 Adding habit_name column to habit_logs table...")
            
            # Check if column already exists
            check_query = """
            SELECT COUNT(*) as count 
            FROM pragma_table_info('habit_logs') 
            WHERE name='habit_name'
            """
            result = await session.execute(text(check_query))
            row = result.fetchone()
            
            if row and row[0] > 0:
                print("✅ habit_name column already exists!")
                return True
            
            # Add the column
            alter_query = "ALTER TABLE habit_logs ADD COLUMN habit_name TEXT"
            await session.execute(text(alter_query))
            await session.commit()
            
            print("✅ Successfully added habit_name column!")
            return True
            
        except SQLAlchemyError as e:
            print(f"❌ Error adding column: {e}")
            await session.rollback()
            return False

async def backfill_habit_names():
    """Backfill habit_name for existing logs"""
    async with get_db_session() as session:
        try:
            print("\n📝 Backfilling habit names for existing logs...")
            
            # Get all logs that don't have habit_name set
            result = await session.execute(
                select(HabitLogDB)
                .where(HabitLogDB.habit_name.is_(None))
            )
            logs_to_update = result.scalars().all()
            
            if not logs_to_update:
                print("✅ All logs already have habit names!")
                return True
            
            print(f"🔄 Found {len(logs_to_update)} logs to update...")
            
            updated_count = 0
            failed_count = 0
            
            for log in logs_to_update:
                try:
                    # Get the habit name
                    habit_result = await session.execute(
                        select(HabitDB)
                        .where(HabitDB.id == log.habit_id)
                    )
                    habit = habit_result.scalar_one_or_none()
                    
                    if habit:
                        log.habit_name = habit.name
                        updated_count += 1
                    else:
                        print(f"⚠️  Habit not found for log {log.id} (habit_id: {log.habit_id})")
                        failed_count += 1
                        
                except Exception as e:
                    print(f"❌ Error updating log {log.id}: {e}")
                    failed_count += 1
            
            # Commit all changes
            await session.commit()
            
            print(f"\n✅ Backfill complete!")
            print(f"   - Updated: {updated_count} logs")
            if failed_count > 0:
                print(f"   - Failed: {failed_count} logs")
            
            return True
            
        except SQLAlchemyError as e:
            print(f"❌ Error during backfill: {e}")
            await session.rollback()
            return False

async def main():
    """Run the migration"""
    print("=" * 60)
    print("🔧 Migration: Add habit_name to habit_logs")
    print("=" * 60)
    
    # Step 1: Add the column
    success = await add_habit_name_column()
    if not success:
        print("\n❌ Migration failed at step 1 (add column)")
        return False
    
    # Step 2: Backfill existing data
    success = await backfill_habit_names()
    if not success:
        print("\n❌ Migration failed at step 2 (backfill)")
        return False
    
    print("\n" + "=" * 60)
    print("✅ Migration completed successfully!")
    print("=" * 60)
    return True

if __name__ == "__main__":
    asyncio.run(main())

