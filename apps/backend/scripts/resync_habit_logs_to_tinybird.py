#!/usr/bin/env python3
"""
Re-sync all habit logs from Turso to Tinybird with correct UTC timestamps.

This script:
1. Fetches all habit logs from Turso (SQLite)
2. Fetches habit details (for names and units)
3. Re-ingests each log to Tinybird with proper UTC timestamp format

Run from the backend directory:
    python scripts/resync_habit_logs_to_tinybird.py

The script will:
- Convert Turso's ISO UTC format (2025-12-07T00:02:08.352Z) 
- To Tinybird's space-separated UTC format (2025-12-07 00:02:08)
- Ensuring both databases have consistent UTC timestamps
"""

import asyncio
import os
import sys
from typing import Dict, Any, List

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

from database.connection import get_db_session
from database.models import HabitLogDB, HabitDB
from services.tinybird_service import TinybirdService
from sqlalchemy import select


async def get_all_habits(session) -> Dict[str, HabitDB]:
    """Fetch all habits and return as dict keyed by habit_id"""
    result = await session.execute(select(HabitDB))
    habits = result.scalars().all()
    return {h.id: h for h in habits}


async def get_all_habit_logs(session) -> List[HabitLogDB]:
    """Fetch all habit logs"""
    result = await session.execute(
        select(HabitLogDB).order_by(HabitLogDB.date.desc())
    )
    return result.scalars().all()


async def resync_logs():
    """Main function to re-sync all habit logs to Tinybird"""
    
    print("=" * 60)
    print("🔄 HABIT LOGS RE-SYNC TO TINYBIRD")
    print("=" * 60)
    print()
    
    # Initialize Tinybird service
    try:
        tinybird = TinybirdService()
        print("✅ Tinybird service initialized")
    except Exception as e:
        print(f"❌ Failed to initialize Tinybird: {e}")
        return
    
    async with get_db_session() as session:
        # Fetch all habits for reference
        print("\n📋 Fetching habits from Turso...")
        habits = await get_all_habits(session)
        print(f"   Found {len(habits)} habits")
        
        # Fetch all habit logs
        print("\n📋 Fetching habit logs from Turso...")
        logs = await get_all_habit_logs(session)
        print(f"   Found {len(logs)} habit logs")
        
        if not logs:
            print("\n⚠️  No habit logs to sync!")
            return
        
        # Process each log
        print("\n🚀 Re-syncing logs to Tinybird...")
        print("-" * 60)
        
        success_count = 0
        error_count = 0
        
        for i, log in enumerate(logs, 1):
            habit = habits.get(log.habit_id)
            if not habit:
                print(f"   ⚠️  Skipping log {log.id} - habit not found")
                error_count += 1
                continue
            
            # Get the completed_at timestamp (Turso stores as ISO UTC)
            completed_at = log.completed_at if log.completed_at else None
            
            # Provide a deterministic UTC fallback when historical rows only have a date.
            completed_at_for_tinybird = completed_at or f"{log.date}T12:00:00Z"
            
            # Prepare log data for Tinybird
            log_data = {
                'id': log.id,
                'habit_id': log.habit_id,
                'habit_name': log.habit_name or habit.name,
                'user_id': habit.user_id,
                'date': log.date,  # Keep the user's intended local date
                'duration': log.duration or 0,
                'amount': log.amount or 0.0,
                'unit': habit.unit_type or 'none',
                'status': log.status or 'completed',
                'notes': log.notes or 'none',
                'completed_at': completed_at_for_tinybird,  # Pass to ingest_habit_log for proper formatting
            }
            
            try:
                result = await tinybird.ingest_habit_log(log_data)
                success_count += 1
                
                # Print progress every 10 logs
                if i % 10 == 0 or i == len(logs):
                    print(f"   ✅ Processed {i}/{len(logs)} logs...")
                    
            except Exception as e:
                print(f"   ❌ Error syncing log {log.id}: {e}")
                error_count += 1
        
        print("-" * 60)
        print(f"\n✅ RE-SYNC COMPLETE!")
        print(f"   Success: {success_count}")
        print(f"   Errors:  {error_count}")
        print(f"   Total:   {len(logs)}")
        
        print("\n📝 Notes:")
        print("   - All timestamps are now stored in UTC")
        print("   - Turso format: 2025-12-07T00:02:08.352Z")
        print("   - Tinybird format: 2025-12-07 00:02:08")
        print("   - Frontend converts UTC to your local time for display")


if __name__ == "__main__":
    print("\n🔧 Starting Habit Logs Re-sync Script...")
    print("   This will sync all habit logs from Turso to Tinybird")
    print("   with correct UTC timestamp format.\n")
    
    asyncio.run(resync_logs())
