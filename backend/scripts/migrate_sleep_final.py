"""
Migrate whoop_sleep_data to habit_logs - Final version using curl subprocess
"""
import os
import sys
import json
import subprocess
from datetime import datetime
from pathlib import Path

# Load .env file
env_file = Path(__file__).parent.parent / '.env'
if env_file.exists():
    with open(env_file) as f:
        for line in f:
            if '=' in line and not line.strip().startswith('#'):
                key, value = line.strip().split('=', 1)
                os.environ[key] = value.strip('"\'')  # Remove quotes

USER_ID = "user_34540XJfN58PS69D6QJZDScb5on"
SLEEP_HABIT_ID = "5b5b3a5a-77fb-42e1-8f98-5ddba31d08d1"
SLEEP_HABIT_NAME = "Sleep Duration"

def migrate_sleep_data():
    """Migrate whoop_sleep_data to habit_logs"""
    
    token = os.getenv("TINYBIRD_TOKEN", "").strip()
    if not token:
        print("❌ TINYBIRD_TOKEN not found in .env file")
        return
    
    print("🚀 Migrating Whoop sleep data to habit_logs...")
    print(f"   User ID: {USER_ID}")
    print(f"   Habit ID: {SLEEP_HABIT_ID}\n")
    
    # Step 1: Fetch data using curl
    print("📊 Step 1: Fetching sleep data...")
    
    import urllib.parse
    sql_query = f"SELECT id, date, total_sleep_duration_minutes, sleep_performance_percentage, sleep_efficiency_percentage, sleep_onset, sleep_end, created_at FROM whoop_sleep_data WHERE user_id = '{USER_ID}' ORDER BY date ASC"
    encoded_query = urllib.parse.quote(sql_query)
    
    result = subprocess.run(
        [
            'curl', '-s',
            f"https://api.us-east.aws.tinybird.co/v0/sql?q={encoded_query}",
            '-H', f'Authorization: Bearer {token}'
        ],
        capture_output=True,
        text=True
    )
    
    if result.returncode != 0:
        print(f"❌ Curl failed: {result.stderr}")
        return
    
    # Parse CSV response (Tinybird SQL doesn't return headers!)
    lines = result.stdout.strip().split('\n')
    if len(lines) < 1:
        print("⚠️  No data found")
        return
    
    # Define headers based on our SELECT query order
    headers = ['id', 'date', 'total_sleep_duration_minutes', 'sleep_performance_percentage', 
               'sleep_efficiency_percentage', 'sleep_onset', 'sleep_end', 'created_at']
    
    sleep_records = []
    for line in lines:
        if not line.strip():
            continue
        values = line.split('\t')
        if len(values) >= 3:  # At least id, date, duration
            record = dict(zip(headers, values[:len(headers)]))
            try:
                # Convert numeric fields
                record['total_sleep_duration_minutes'] = int(float(record.get('total_sleep_duration_minutes', 0) or 0))
                record['sleep_performance_percentage'] = float(record.get('sleep_performance_percentage', 0) or 0)
                record['sleep_efficiency_percentage'] = float(record.get('sleep_efficiency_percentage', 0) or 0)
            except (ValueError, TypeError):
                pass
            sleep_records.append(record)
    
    print(f"✅ Found {len(sleep_records)} sleep records")
    
    # Step 2: Transform
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
    
    # Step 3: Ingest via curl
    print("\n📤 Step 3: Ingesting into habit_logs...")
    
    ndjson_data = "\n".join([json.dumps(log) for log in habit_logs])
    
    ingest_result = subprocess.run(
        [
            'curl', '-s', '-X', 'POST',
            'https://api.us-east.aws.tinybird.co/v0/events?name=habit_logs',
            '-H', f'Authorization: Bearer {token}',
            '-H', 'Content-Type: application/x-ndjson',
            '--data-binary', '@-'
        ],
        input=ndjson_data,
        capture_output=True,
        text=True
    )
    
    if ingest_result.returncode == 0:
        try:
            result = json.loads(ingest_result.stdout)
            print(f"✅ Successfully ingested {result.get('successful_rows', 0)} rows")
            if result.get('quarantined_rows', 0) > 0:
                print(f"⚠️  {result.get('quarantined_rows', 0)} rows quarantined")
        except:
            print(f"✅ Response: {ingest_result.stdout}")
        print("\n🎉 Migration complete! Sleep Duration should now appear in Analytics!")
    else:
        print(f"❌ Failed: {ingest_result.stderr}")
        print(ingest_result.stdout)

if __name__ == "__main__":
    migrate_sleep_data()

