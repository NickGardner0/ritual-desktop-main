"""
One-time script to sync whoop_sleep_data to habit_logs for Analytics
"""
import os
import sys
import asyncio
from datetime import datetime

# Add parent directory to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select
from database.session import get_db_session
from database.models import HabitDB
from services.tinybird_service import TinybirdService
import httpx

async def sync_sleep_to_habits():
    """Fetch whoop_sleep_data from Tinybird and sync to habit_logs"""
    
    print("🚀 Starting Sleep Duration sync to habit_logs...")
    
    # Your user ID
    user_id = "user_34540XJfN58PS69D6QJZDScb5on"
    
    # Step 1: Get the Sleep Duration habit
    async with get_db_session() as session:
        result = await session.execute(
            select(HabitDB)
            .where(HabitDB.user_id == user_id)
            .where(HabitDB.name.ilike('%sleep%'))
        )
        sleep_habits = result.scalars().all()
        
        if not sleep_habits:
            print("❌ No Sleep Duration habit found. Creating one...")
            # Create Sleep Duration habit
            from models.habit_models import HabitCreate
            from services.habits_service import HabitsService
            
            habit_data = HabitCreate(
                name="Sleep Duration",
                category="health",
                icon="🛌",
                is_custom=False,
                integration_source="whoop",
                unit_type="Hours"
            )
            
            habits_service = HabitsService()
            sleep_habit = await habits_service.create_habit(habit_data, user_id)
            print(f"✅ Created Sleep Duration habit: {sleep_habit.id}")
        else:
            sleep_habit = sleep_habits[0]
            print(f"✅ Found Sleep Duration habit: {sleep_habit.id} - {sleep_habit.name}")
    
    # Step 2: Fetch whoop_sleep_data from Tinybird
    print("\n📊 Fetching sleep data from Tinybird...")
    
    tinybird_token = os.getenv("TINYBIRD_API_TOKEN")
    if not tinybird_token:
        print("❌ TINYBIRD_API_TOKEN not set in environment")
        return
    
    async with httpx.AsyncClient() as client:
        response = await client.get(
            "https://api.us-east.aws.tinybird.co/v0/sql",
            params={
                "q": f"""
                    SELECT 
                        date,
                        total_sleep_duration_minutes,
                        sleep_onset,
                        sleep_end,
                        sleep_performance_percentage
                    FROM whoop_sleep_data
                    WHERE user_id = '{user_id}'
                    ORDER BY date DESC
                """
            },
            headers={"Authorization": f"Bearer {tinybird_token}"}
        )
        
        if response.status_code != 200:
            print(f"❌ Failed to fetch sleep data: {response.status_code}")
            print(response.text)
            return
        
        data = response.json()
        sleep_records = data.get("data", [])
        
        print(f"✅ Found {len(sleep_records)} sleep records")
    
    # Step 3: Ingest each record as a habit log
    print("\n📝 Syncing to habit_logs...")
    
    tinybird_service = TinybirdService()
    success_count = 0
    error_count = 0
    
    for record in sleep_records:
        try:
            total_minutes = record.get("total_sleep_duration_minutes", 0)
            if total_minutes == 0:
                continue
            
            habit_log_data = {
                "id": f"sleep_{user_id}_{record['date']}",
                "habit_id": sleep_habit.id,
                "habit_name": sleep_habit.name,
                "user_id": user_id,
                "date": record["date"],
                "timestamp": record.get("sleep_end", record["date"]),
                "status": "completed",
                "duration": total_minutes * 60,  # convert to seconds
                "amount": total_minutes / 60,  # convert to hours
                "unit": "Hours",
                "notes": f"Sleep tracked by Whoop: {total_minutes} minutes",
                "source": "whoop",
                "integration_id": record["date"],
                "whoop_metric_type": "sleep_duration",
                "metadata": f'{{"performance": {record.get("sleep_performance_percentage", 0)}}}',
                "created_at": datetime.utcnow().isoformat()
            }
            
            # Ingest to Tinybird
            result = await tinybird_service.ingest_habit_log(habit_log_data)
            
            if result.get("successful_rows", 0) > 0:
                success_count += 1
                print(f"  ✅ {record['date']}: {total_minutes} minutes")
            else:
                error_count += 1
                print(f"  ❌ {record['date']}: {result.get('error', 'Unknown error')}")
                
        except Exception as e:
            error_count += 1
            print(f"  ❌ Error processing {record.get('date')}: {e}")
    
    print(f"\n✅ Sync complete!")
    print(f"   - Successfully synced: {success_count} records")
    print(f"   - Errors: {error_count} records")
    print(f"\n🎉 Sleep Duration should now appear in Analytics!")

if __name__ == "__main__":
    asyncio.run(sync_sleep_to_habits())

