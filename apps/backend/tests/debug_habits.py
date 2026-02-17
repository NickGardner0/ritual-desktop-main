#!/usr/bin/env python3
"""
Debug script to check habits directly
"""

import os
import sys
import asyncio
import sqlite3
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent))

# Set environment variables
os.environ.update({
    'DATABASE_URL': 'sqlite+aiosqlite:///./ritual.db',
    'TINYBIRD_ENV': 'cloud',
    'TINYBIRD_API_URL': 'https://api.us-east.aws.tinybird.co',
    'TINYBIRD_TOKEN': 'p.eyJ1IjogIjljMTA0NGJhLTM5NjAtNDZkOS1iMWQ5LTAyY2Q2OTc5ZDVlOSIsICJpZCI6ICJmMWJjYzQ4Zi1mM2QxLTQ3YzgtODAwYi00MWU0ZTlhMzU5YjciLCAiaG9zdCI6ICJ1cy1lYXN0LWF3cyJ9.cIau5gLqIaohshuRL2Lr6MO_2UuXKwE49hyF3IUw5oA',
    'JWT_SECRET': 'migration-secret-key',
})

try:
    from services.habits_service import HabitsService
    from database.connection import get_db_session
    from database.models import HabitDB
    from sqlalchemy import select
except ImportError as e:
    print(f"❌ Import error: {e}")
    sys.exit(1)

async def debug_habits():
    """Debug habits using multiple methods"""
    
    user_id = "05cbe689-f7ec-487b-adb6-ad50c7dc767b"
    
    print(f"🔍 Debugging habits for user: {user_id}")
    print("=" * 60)
    
    # Method 1: Direct SQLite query
    print("📊 Method 1: Direct SQLite query")
    conn = sqlite3.connect('ritual.db')
    cursor = conn.cursor()
    cursor.execute("SELECT name, user_id FROM habits WHERE user_id = ?", (user_id,))
    sqlite_results = cursor.fetchall()
    conn.close()
    
    print(f"   Found {len(sqlite_results)} habits via SQLite:")
    for name, uid in sqlite_results:
        print(f"   - {name} (user: {uid})")
    
    # Method 2: SQLAlchemy direct query
    print("\n📊 Method 2: SQLAlchemy direct query")
    try:
        async with get_db_session() as session:
            result = await session.execute(
                select(HabitDB).where(HabitDB.user_id == user_id)
            )
            sqlalchemy_results = result.scalars().all()
            
            print(f"   Found {len(sqlalchemy_results)} habits via SQLAlchemy:")
            for habit in sqlalchemy_results:
                print(f"   - {habit.name} (user: {habit.user_id})")
                
    except Exception as e:
        print(f"   ❌ SQLAlchemy error: {e}")
    
    # Method 3: HabitsService
    print("\n📊 Method 3: HabitsService")
    try:
        habits_service = HabitsService()
        service_results = await habits_service.get_habits(user_id)
        
        print(f"   Found {len(service_results)} habits via HabitsService:")
        for habit in service_results:
            print(f"   - {habit.name} (user: {habit.user_id})")
            
    except Exception as e:
        print(f"   ❌ HabitsService error: {e}")
    
    # Method 4: Check for any habits at all
    print("\n📊 Method 4: All habits in database")
    cursor = sqlite3.connect('ritual.db').cursor()
    cursor.execute("SELECT name, user_id FROM habits")
    all_results = cursor.fetchall()
    
    print(f"   Total habits in database: {len(all_results)}")
    for name, uid in all_results:
        print(f"   - {name} (user: {uid})")

async def main():
    await debug_habits()

if __name__ == "__main__":
    asyncio.run(main())
