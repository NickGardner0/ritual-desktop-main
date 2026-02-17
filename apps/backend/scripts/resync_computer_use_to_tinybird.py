#!/usr/bin/env python3
"""
Re-sync Computer Use habit data to Tinybird for specific days.
This fixes the issue where historical data in Tinybird is outdated.

Usage:
    cd backend
    python scripts/resync_computer_use_to_tinybird.py --days 7
    python scripts/resync_computer_use_to_tinybird.py --date 2026-01-17
"""

import asyncio
import argparse
import os
import sys
from datetime import datetime, timedelta

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env'))

from services.watcher_service import watcher_service


async def resync_days(user_id: str, days_back: int = 7):
    """Re-sync the last N days of Computer Use data to Tinybird."""
    print(f"\n📊 Re-syncing last {days_back} days of Computer Use data to Tinybird...")
    
    today = datetime.now()
    synced_count = 0
    
    for i in range(days_back):
        day = (today - timedelta(days=i)).strftime("%Y-%m-%d")
        print(f"\n📅 Syncing {day}...")
        
        try:
            result = await watcher_service.sync_to_computer_use_habit(
                user_id=user_id,
                day=day
            )
            
            if result.get("success"):
                action = result.get("action", "synced")
                amount = result.get("amount", 0)
                unit = result.get("unit", "Hours")
                print(f"   ✅ {action}: {amount} {unit}")
                synced_count += 1
            else:
                error = result.get("error", "Unknown error")
                print(f"   ⚠️ Skipped: {error}")
                
        except Exception as e:
            print(f"   ❌ Error: {e}")
    
    print(f"\n✅ Successfully synced {synced_count}/{days_back} days")


async def resync_specific_date(user_id: str, date: str):
    """Re-sync a specific date's Computer Use data to Tinybird."""
    print(f"\n📅 Re-syncing {date} to Tinybird...")
    
    try:
        result = await watcher_service.sync_to_computer_use_habit(
            user_id=user_id,
            day=date
        )
        
        if result.get("success"):
            action = result.get("action", "synced")
            amount = result.get("amount", 0)
            unit = result.get("unit", "Hours")
            print(f"✅ {action}: {amount} {unit}")
        else:
            error = result.get("error", "Unknown error")
            print(f"⚠️ Result: {error}")
            
    except Exception as e:
        print(f"❌ Error: {e}")


async def get_user_id():
    """Get the first user's ID from the database."""
    from database.connection import get_db_session
    from sqlalchemy import text
    
    async with get_db_session() as session:
        result = await session.execute(text("SELECT id FROM users LIMIT 1"))
        row = result.fetchone()
        if row:
            return row[0]
    return None


async def main():
    parser = argparse.ArgumentParser(description="Re-sync Computer Use data to Tinybird")
    parser.add_argument("--days", type=int, default=7, help="Number of days to sync (default: 7)")
    parser.add_argument("--date", type=str, help="Specific date to sync (YYYY-MM-DD)")
    parser.add_argument("--user-id", type=str, help="User ID (auto-detected if not provided)")
    
    args = parser.parse_args()
    
    # Get user ID
    user_id = args.user_id
    if not user_id:
        user_id = await get_user_id()
        if not user_id:
            print("❌ No users found in database. Please provide --user-id")
            return
        print(f"🔍 Found user: {user_id}")
    
    # Run sync
    if args.date:
        await resync_specific_date(user_id, args.date)
    else:
        await resync_days(user_id, args.days)


if __name__ == "__main__":
    asyncio.run(main())
