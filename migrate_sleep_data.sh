#!/bin/bash

# Script to migrate whoop_sleep_data to habit_logs in Tinybird
# Make sure your TINYBIRD_TOKEN is set in .env.local

USER_ID="user_34540XJfN58PS69D6QJZDScb5on"
SLEEP_HABIT_ID="5b5b3a5a-77fb-42e1-8f98-5ddba31d08d1"
SLEEP_HABIT_NAME="Sleep Duration"

# Load token from .env.local
if [ -f .env.local ]; then
    export $(grep TINYBIRD_TOKEN .env.local | xargs)
fi

if [ -z "$TINYBIRD_TOKEN" ]; then
    echo "❌ TINYBIRD_TOKEN not found. Please set it in .env.local or export it:"
    echo "   export TINYBIRD_TOKEN='your_token_here'"
    exit 1
fi

echo "🚀 Fetching sleep data from whoop_sleep_data..."

# Fetch sleep data
RESPONSE=$(curl -s "https://api.us-east.aws.tinybird.co/v0/sql?q=SELECT%20*%20FROM%20whoop_sleep_data%20WHERE%20user_id%20%3D%20'${USER_ID}'%20ORDER%20BY%20date%20ASC" \
  -H "Authorization: Bearer ${TINYBIRD_TOKEN}")

# Parse JSON and create habit_logs entries
# This is complex in bash - better to use Python

echo "📝 Use the Python script instead:"
echo "   python3 backend/scripts/migrate_sleep_to_habits.py"

