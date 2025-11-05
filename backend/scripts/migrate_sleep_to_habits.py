"""
Migrate whoop_sleep_data to habit_logs in Tinybird
This consolidates all habit data into one table for Analytics
"""
import os
import asyncio
import httpx
import json
from datetime import datetime

USER_ID = "user_34540XJfN58PS69D6QJZDScb5on"
SLEEP_HABIT_ID = "5b5b3a5a-77fb-42e1-8f98-5ddba31d08d1"
SLEEP_HABIT_NAME = "Sleep Duration"

async def migrate_sleep_data():
    """Migrate whoop_sleep_data to habit_logs"""
    
    # Try multiple token env var names
    tinybird_token = (
        os.getenv("TINYBIRD_API_TOKEN") or
        os.getenv("TINYBIRD_TOKEN") or
        # Fallback to token from tinybird-service.ts
        "p.eyJ1IjogIjljMTA0NGJhLTM5NjAtNDZkOS1iMWQ5LTAyY2Q2OTc5ZDVlOSIsICJpZCI6ICJmMWJjYzQ4Zi1mM2QxLTQ3YzgtODAwYi00MWU0ZTlhMzU5YjciLCAiaG9zdCI6ICJ1cy1lYXN0LWF3cyJ9.cIau5gLqIaohshuRL2Lr6MO_2UuXKwE49hyF3IUw5oA"
    ).strip()
    
    print("🚀 Migrating Whoop sleep data to habit_logs...")
    print(f"   User ID: {USER_ID}")
    print(f"   Habit ID: {SLEEP_HABIT_ID}")
    print()
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        # Step 1: Fetch all sleep data from whoop_sleep_data
        print("📊 Step 1: Fetching sleep data from whoop_sleep_data...")
        
        # Use single-line query (httpx handles URL encoding)
        sql_query = f"SELECT id, date, total_sleep_duration_minutes, sleep_performance_percentage, sleep_efficiency_percentage, sleep_onset, sleep_end, created_at FROM whoop_sleep_data WHERE user_id = '{USER_ID}' ORDER BY date ASC"
        
        query_response = await client.get(
            "https://api.us-east.aws.tinybird.co/v0/sql",
            params={"q": sql_query},
            headers={"Authorization": f"Bearer {tinybird_token.strip()}"}
        )
        
        if query_response.status_code != 200:
            print(f"❌ Failed to fetch sleep data: {query_response.status_code}")
            print(query_response.text)
            return
        
        data = query_response.json()
        sleep_records = data.get("data", [])
        
        print(f"✅ Found {len(sleep_records)} sleep records")
        
        if len(sleep_records) == 0:
            print("⚠️  No sleep data to migrate")
            return
        
        # Step 2: Transform and prepare data for habit_logs
        print("\n📝 Step 2: Preparing habit_logs data...")
        
        habit_logs = []
        for record in sleep_records:
            total_minutes = record.get("total_sleep_duration_minutes", 0)
            if total_minutes == 0:
                continue
            
            # Transform to habit_logs format
            habit_log = {
                "id": f"{record['id']}",
                "habit_id": SLEEP_HABIT_ID,
                "habit_name": SLEEP_HABIT_NAME,
                "user_id": USER_ID,
                "date": record["date"],
                "timestamp": record.get("sleep_end", record["date"] + "T23:59:59Z"),
                "status": "completed",
                "duration": total_minutes * 60,  # Convert minutes to seconds
                "amount": round(total_minutes / 60, 2),  # Convert to hours
                "unit": "Hours",
                "notes": f"Synced from Whoop (Sleep Performance: {record.get('sleep_performance_percentage', 0):.1f}%)",
                "source": "whoop",
                "integration_id": record.get("sleep_id", record["id"]),
                "whoop_metric_type": "sleep_duration",
                "metadata": json.dumps({
                    "sleep_id": record.get("sleep_id", ""),
                    "performance": record.get("sleep_performance_percentage", 0),
                    "efficiency": record.get("sleep_efficiency_percentage", 0)
                }),
                "created_at": record.get("created_at", datetime.utcnow().isoformat())
            }
            habit_logs.append(habit_log)
        
        print(f"✅ Prepared {len(habit_logs)} habit log entries")
        
        # Step 3: Ingest into habit_logs
        print("\n📤 Step 3: Ingesting into habit_logs...")
        
        # Tinybird allows batch ingestion via NDJSON
        ndjson_data = "\n".join([json.dumps(log) for log in habit_logs])
        
        ingest_response = await client.post(
            "https://api.us-east.aws.tinybird.co/v0/events",
            params={"name": "habit_logs"},
            content=ndjson_data.encode('utf-8'),
            headers={
                "Authorization": f"Bearer {tinybird_token}",
                "Content-Type": "application/x-ndjson"
            }
        )
        
        if ingest_response.status_code == 200:
            result = ingest_response.json()
            print(f"✅ Successfully ingested {result.get('successful_rows', 0)} rows")
            
            if result.get('quarantined_rows', 0) > 0:
                print(f"⚠️  {result.get('quarantined_rows', 0)} rows quarantined (may already exist)")
            
            print("\n🎉 Migration complete!")
            print("   Sleep Duration should now appear in Analytics!")
            print("   You can now delete the whoop_sleep_data table if you want.")
        else:
            print(f"❌ Failed to ingest: {ingest_response.status_code}")
            print(ingest_response.text)

if __name__ == "__main__":
    asyncio.run(migrate_sleep_data())

