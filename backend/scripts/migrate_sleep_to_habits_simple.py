"""
Migrate whoop_sleep_data to habit_logs in Tinybird - Simple version using requests
"""
import os
import sys
import json
import requests
from datetime import datetime
from pathlib import Path

# Add parent directory to path to load .env
sys.path.insert(0, str(Path(__file__).parent.parent))

# Load .env file
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / '.env')
except ImportError:
    # Fallback: read .env manually
    env_file = Path(__file__).parent.parent / '.env'
    if env_file.exists():
        with open(env_file) as f:
            for line in f:
                if '=' in line and not line.strip().startswith('#'):
                    key, value = line.strip().split('=', 1)
                    os.environ[key] = value

USER_ID = "user_34540XJfN58PS69D6QJZDScb5on"
SLEEP_HABIT_ID = "5b5b3a5a-77fb-42e1-8f98-5ddba31d08d1"
SLEEP_HABIT_NAME = "Sleep Duration"

def migrate_sleep_data():
    """Migrate whoop_sleep_data to habit_logs"""
    
    # Get token from .env
    tinybird_token = (
        os.getenv("TINYBIRD_API_TOKEN") or
        os.getenv("TINYBIRD_TOKEN") or
        ""
    ).strip()
    
    if not tinybird_token:
        print("❌ TINYBIRD_TOKEN not found in environment or .env file")
        return
    
    print("🚀 Migrating Whoop sleep data to habit_logs...")
    print(f"   User ID: {USER_ID}")
    print(f"   Habit ID: {SLEEP_HABIT_ID}")
    print(f"   Token loaded: {tinybird_token[:30]}...{tinybird_token[-10:]}\n")
    
    # Step 1: Fetch sleep data
    print("📊 Step 1: Fetching sleep data from whoop_sleep_data...")
    
    sql_query = f"SELECT id, date, total_sleep_duration_minutes, sleep_performance_percentage, sleep_efficiency_percentage, sleep_onset, sleep_end, created_at FROM whoop_sleep_data WHERE user_id = '{USER_ID}' ORDER BY date ASC"
    
    response = requests.get(
        "https://api.us-east.aws.tinybird.co/v0/sql",
        params={"q": sql_query},
        headers={"Authorization": f"Bearer {tinybird_token}"}
    )
    
    if response.status_code != 200:
        print(f"❌ Failed: {response.status_code}")
        print(response.text)
        return
    
    # Parse response (SQL endpoint returns CSV, not JSON)
    lines = response.text.strip().split('\n')
    if len(lines) < 2:
        print("⚠️  No data found")
        return
    
    # Skip header, parse CSV
    sleep_records = []
    headers = lines[0].split('\t')
    
    for line in lines[1:]:
        values = line.split('\t')
        if len(values) >= len(headers):
            record = dict(zip(headers, values))
            # Convert numeric fields
            record['total_sleep_duration_minutes'] = int(float(record.get('total_sleep_duration_minutes', 0) or 0))
            record['sleep_performance_percentage'] = float(record.get('sleep_performance_percentage', 0) or 0)
            record['sleep_efficiency_percentage'] = float(record.get('sleep_efficiency_percentage', 0) or 0)
            sleep_records.append(record)
    
    print(f"✅ Found {len(sleep_records)} sleep records")
    
    if len(sleep_records) == 0:
        return
    
    # Step 2: Transform to habit_logs format
    print("\n📝 Step 2: Preparing habit_logs data...")
    
    habit_logs = []
    for record in sleep_records:
        total_minutes = record.get('total_sleep_duration_minutes', 0)
        if total_minutes == 0:
            continue
        
        habit_log = {
            "id": record['id'],
            "habit_id": SLEEP_HABIT_ID,
            "habit_name": SLEEP_HABIT_NAME,
            "user_id": USER_ID,
            "date": record['date'],
            "timestamp": record.get('sleep_end') or (record['date'] + "T23:59:59Z"),
            "status": "completed",
            "duration": total_minutes * 60,
            "amount": round(total_minutes / 60, 2),
            "unit": "Hours",
            "notes": f"Synced from Whoop (Sleep Performance: {record.get('sleep_performance_percentage', 0):.1f}%)",
            "source": "whoop",
            "integration_id": record.get('sleep_id', record['id']),
            "whoop_metric_type": "sleep_duration",
            "metadata": json.dumps({
                "sleep_id": record.get('sleep_id', ''),
                "performance": record.get('sleep_performance_percentage', 0),
                "efficiency": record.get('sleep_efficiency_percentage', 0)
            }),
            "created_at": record.get('created_at', datetime.utcnow().isoformat())
        }
        habit_logs.append(habit_log)
    
    print(f"✅ Prepared {len(habit_logs)} habit log entries")
    
    # Step 3: Ingest via Events API
    print("\n📤 Step 3: Ingesting into habit_logs...")
    
    ndjson_data = "\n".join([json.dumps(log) for log in habit_logs])
    
    ingest_response = requests.post(
        "https://api.us-east.aws.tinybird.co/v0/events",
        params={"name": "habit_logs"},
        data=ndjson_data.encode('utf-8'),
        headers={
            "Authorization": f"Bearer {tinybird_token}",
            "Content-Type": "application/x-ndjson"
        }
    )
    
    if ingest_response.status_code == 200:
        result = ingest_response.json()
        print(f"✅ Successfully ingested {result.get('successful_rows', 0)} rows")
        if result.get('quarantined_rows', 0) > 0:
            print(f"⚠️  {result.get('quarantined_rows', 0)} rows quarantined")
        print("\n🎉 Migration complete! Sleep Duration should now appear in Analytics!")
    else:
        print(f"❌ Failed: {ingest_response.status_code}")
        print(ingest_response.text)

if __name__ == "__main__":
    migrate_sleep_data()

