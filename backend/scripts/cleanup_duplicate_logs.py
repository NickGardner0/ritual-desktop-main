"""
Cleanup duplicate habit logs (keeps the one with highest duration/amount per date)
Run with: python scripts/cleanup_duplicate_logs.py
"""

import asyncio
import sys
import os

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select, delete, func
from database.connection import get_db_session, init_database
from database.models import HabitLogDB


async def cleanup_duplicates():
    """Remove duplicate habit logs, keeping the one with highest duration/amount per date"""
    
    await init_database()
    
    async with get_db_session() as session:
        try:
            # Find all habit_id + date combinations with duplicates
            duplicates_query = (
                select(
                    HabitLogDB.habit_id,
                    HabitLogDB.date,
                    func.count(HabitLogDB.id).label('count')
                )
                .group_by(HabitLogDB.habit_id, HabitLogDB.date)
                .having(func.count(HabitLogDB.id) > 1)
            )
            
            result = await session.execute(duplicates_query)
            duplicates = result.all()
            
            if not duplicates:
                print("✅ No duplicate logs found!")
                return
            
            print(f"🔍 Found {len(duplicates)} date(s) with duplicate logs")
            
            total_deleted = 0
            
            for habit_id, date, count in duplicates:
                # Get all logs for this habit + date
                logs_query = (
                    select(HabitLogDB)
                    .where(HabitLogDB.habit_id == habit_id)
                    .where(HabitLogDB.date == date)
                    .order_by(
                        # Prioritize by duration (desc), then amount (desc)
                        HabitLogDB.duration.desc().nulls_last(),
                        HabitLogDB.amount.desc().nulls_last()
                    )
                )
                
                logs_result = await session.execute(logs_query)
                logs = logs_result.scalars().all()
                
                if len(logs) <= 1:
                    continue
                
                # Keep the first one (highest duration/amount), delete the rest
                keep_log = logs[0]
                delete_logs = logs[1:]
                
                print(f"  📅 {date} ({logs[0].habit_name}): keeping 1, deleting {len(delete_logs)} duplicates")
                
                for log in delete_logs:
                    await session.delete(log)
                    total_deleted += 1
            
            await session.commit()
            print(f"\n✅ Cleanup complete! Deleted {total_deleted} duplicate log(s)")
            
        except Exception as e:
            await session.rollback()
            print(f"❌ Error during cleanup: {e}")
            raise


if __name__ == "__main__":
    print("🧹 Starting duplicate habit log cleanup...")
    print("=" * 50)
    asyncio.run(cleanup_duplicates())

