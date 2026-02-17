import asyncio
import os
import sys

# Add backend directory to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select, update
from database.connection import get_db_session
from database.models import HabitDB

async def fix_screen_time_icon():
    async with get_db_session() as session:
        # Find the Screen Time habit
        stmt = select(HabitDB).where(HabitDB.name == "Screen Time")
        result = await session.execute(stmt)
        habit = result.scalars().first()
        
        if not habit:
            print("❌ 'Screen Time' habit not found!")
            return

        print(f"found habit: {habit.name} with icon: {habit.icon}")
        
        # Update to Lucide 'smartphone' icon
        habit.icon = "smartphone"
        await session.commit()
        print(f"✅ Updated '{habit.name}' icon to 'smartphone'")

if __name__ == "__main__":
    asyncio.run(fix_screen_time_icon())
