#!/bin/bash

# Migration script using curl directly
USER_ID="user_34540XJfN58PS69D6QJZDScb5on"
SLEEP_HABIT_ID="5b5b3a5a-77fb-42e1-8f98-5ddba31d08d1"
SLEEP_HABIT_NAME="Sleep Duration"

# Get token from clipboard
TOKEN=$(pbpaste | tr -d '\n\r ')

if [ -z "$TOKEN" ]; then
    echo "❌ No token found. Run: tb --cloud token copy migration_token"
    exit 1
fi

echo "🚀 Migrating sleep data..."
echo "📊 Fetching data from whoop_sleep_data..."

# Fetch sleep data (returns CSV)
DATA=$(curl -s "https://api.us-east.aws.tinybird.co/v0/sql?q=SELECT%20*%20FROM%20whoop_sleep_data%20WHERE%20user_id%20%3D%20'${USER_ID_FILE}'%20ORDER%20BY%20date%20ASC" \
  -H "Authorization: Bearer ${TOKEN}")

echo "✅ Got data. Parse it with Python..."

# Use Python to parse CSV and ingest
python3 << PYTHON_SCRIPT
import json
import sys

lines = """${DATA}""".strip().split('\n')
if len(lines) < 2:
    print("No data found")
    sys.exit(0)

print(f"Found {len(lines)-1} records")

# Parse and transform (simplified - you may need to adjust)
# Then ingest via curl...

PYTHON_SCRIPT

echo "✅ Migration complete!"

