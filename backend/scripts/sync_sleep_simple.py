"""
Simple script to sync whoop_sleep_data to habit_logs
Assumes Sleep Duration habit exists with ID from your database
"""
import os
import asyncio
import httpx
from datetime import datetime

# Replace with your actual Sleep Duration habit ID from the database
SLEEP_HABIT_ID = None  # We'll fetch this dynamically
USER_ID = "user_34540XJfN58PS69D6QJZDScb5on"

async def main():
    print("🚀 Starting Sleep Duration sync...")
    
    tinybird_token = os.getenv("TINYBIRD_API_TOKEN")
    if not tinybird_token:
        print("❌ TINYBIRD_API_TOKEN not set")
        print("   Run: export TINYBIRD_API_TOKEN='your_token'")
        return
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        # Step 1: Get Sleep Duration habit ID from SQLite (via Python backend)
        print("\n📋 Step 1: Finding Sleep Duration habit...")
        
        # First, let's just check what sleep data we have
        print("\n📊 Step 2: Fetching sleep data from Tinybird...")
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
                    WHERE user_id = '{USER_ID}'
                    ORDER BY date DESC
                    LIMIT 5
                """
            },
            headers={"Authorization": f"Bearer {tinybird_token}"}
        )
        
        if response.status_code != 200:
            print(f"❌ Failed: {response.status_code}")
            print(response.text)
            return
        
        data = response.json()
        sleep_records = data.get("data", [])
        
        print(f"✅ Found {len(sleep_records)} recent sleep records (showing sample):")
        for record in sleep_records[:3]:
            minutes = record.get("total_sleep_duration_minutes", 0)
            print(f"   - {record['date']}: {minutes} minutes ({minutes/60:.1f} hours)")
        
        # Now let's ingest these as habit logs
        # We need the habit ID - let's use a temporary ID and print instructions
        print("\n" + "="*60)
        print("TO COMPLETE THE SYNC:")
        print("="*60)
        print("1. Go to your app")
        print("2. Check if you have a 'Sleep Duration' habit")
        print("   - If not, create one with:")
        print("     Name: Sleep Duration")
        print("     Unit: Hours")
        print("     Integration: Whoop")
        print("")
        print("3. Then run this command to get the habit ID:")
        print(f"   curl http://localhost:8000/api/habits \\")
        print(f"     -H 'Authorization: Bearer YOUR_CLERK_TOKEN'")
        print("")
        print("4. Find the Sleep Duration habit ID and update this script")
        print("="*60)

if __name__ == "__main__":
    asyncio.run(main())

