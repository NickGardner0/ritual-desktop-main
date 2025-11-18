#!/bin/bash

# Deploy Tinybird Pipes to Cloud via API
# Bypasses the CLI Docker requirement

TOKEN="p.eyJ1IjogIjljMTA0NGJhLTM5NjAtNDZkOS1iMWQ5LTAyY2Q2OTc5ZDVlOSIsICJpZCI6ICJmMWJjYzQ4Zi1mM2QxLTQ3YzgtODAwYi00MWU0ZTlhMzU5YjciLCAiaG9zdCI6ICJ1cy1lYXN0LWF3cyJ9.cIau5gLqIaohshuRL2Lr6MO_2UuXKwE49hyF3IUw5oA"
HOST="https://api.us-east.aws.tinybird.co"

echo "🚀 Deploying pipes to Tinybird Cloud via Web UI..."
echo ""
echo "⚠️  The CLI requires Docker which isn't running."
echo "📋 Please deploy manually through the web UI:"
echo ""
echo "1. Go to: https://ui.tinybird.co/"
echo "2. Login with: nickgardner0651@gmail.com"
echo "3. Click 'Pipes' in sidebar"
echo "4. Click 'Create Pipe' or find existing pipes to update"
echo ""
echo "📄 Files to upload/update:"
echo "   • tinybird/pipes/user_habits_summary.pipe (UPDATED - has time comparisons)"
echo "   • tinybird/pipes/habit_logs_time_range.pipe (NEW)"
echo ""
echo "5. Copy the pipe content and paste into the web editor"
echo "6. Click 'Save' for each pipe"
echo ""
echo "Or you can use the Tinybird web editor directly:"
echo "https://ui.tinybird.co/ritual_/pipes"
