#!/usr/bin/env python3
"""
Fix Sleep Duration habit category from "Manual" to "Fitness & Health"

Usage:
  cd backend
  python3 scripts/fix_sleep_duration_category.py
"""
import os
import sys
import asyncio
from pathlib import Path

# Ensure backend imports work when running as a script
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from database.connection import get_db_session
from database.models import HabitDB
from sqlalchemy import select, update

async def main():
    async with get_db_session() as session:
        # Find all Sleep Duration habits with category "Manual" or "manual"
        result = await session.execute(
            select(HabitDB).where(
                HabitDB.name == "Sleep Duration",
                HabitDB.category.in_(["Manual", "manual", "MANUAL"])
            )
        )
        habits = result.scalars().all()
        
        if not habits:
            print("✅ No Sleep Duration habits with 'Manual' category found.")
            print("   Checking what categories exist for Sleep Duration...")
            
            # Show existing Sleep Duration habits
            result = await session.execute(
                select(HabitDB).where(HabitDB.name == "Sleep Duration")
            )
            all_sleep = result.scalars().all()
            for h in all_sleep:
                print(f"   - ID: {h.id}, Category: {h.category}, User: {h.user_id}")
            return
        
        print(f"Found {len(habits)} Sleep Duration habit(s) with 'Manual' category:")
        for habit in habits:
            print(f"   - ID: {habit.id}")
            print(f"     User: {habit.user_id}")
            print(f"     Current Category: {habit.category}")
            
            # Update the category
            habit.category = "Fitness & Health"
            print(f"     New Category: {habit.category}")
        
        await session.commit()
        print(f"\n✅ Updated {len(habits)} habit(s) to category 'Fitness & Health'")

if __name__ == "__main__":
    asyncio.run(main())

