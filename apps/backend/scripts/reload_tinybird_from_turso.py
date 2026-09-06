#!/usr/bin/env python3
"""
Reload all habit logs from Turso to Tinybird.
This script syncs all unique habit logs from the Turso database to Tinybird.
"""

import sqlite3
import requests
import json
import os
from pathlib import Path

def reload_all_logs():
    """Reload all habit logs from Turso to Tinybird"""
    
    print("🔄 Starting reload of all habit logs from Turso to Tinybird...")
    
    # Get Tinybird API key
    TINYBIRD_API_KEY = (os.getenv('TINYBIRD_API_KEY') or os.getenv('TINYBIRD_TOKEN') or '').strip()
    TINYBIRD_API_URL = 'https://api.us-east.aws.tinybird.co'
    if not TINYBIRD_API_KEY:
        raise RuntimeError("TINYBIRD_API_KEY or TINYBIRD_TOKEN is required")
    
    # Connect to local Turso replica
    db_path = Path(__file__).parent.parent / '.turso_replica.db'
    
    if not db_path.exists():
        print(f"❌ Database not found at {db_path}")
        return
    
    print(f"📁 Connecting to {db_path}")
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    try:
        # Fetch all habit logs with their habit information
        cursor.execute("""
            SELECT 
                l.id, l.habit_id, l.duration, l.amount, l.date, 
                l.completed_at, l.status, l.notes, l.log_metadata,
                h.name as habit_name, h.user_id, h.unit_type
            FROM habit_logs l
            JOIN habits h ON l.habit_id = h.id
            ORDER BY l.date DESC
        """)
        
        logs = cursor.fetchall()
        total_logs = len(logs)
        
        print(f"📊 Found {total_logs} habit logs in Turso database")
        
        if total_logs == 0:
            print("⚠️  No logs found to sync")
            return
        
        # Sync logs individually
        synced_count = 0
        failed_count = 0
        
        for log in logs:
            try:
                # Prepare event for Tinybird
                event = {
                    'id': log['id'],
                    'habit_id': log['habit_id'],
                    'habit_name': log['habit_name'],
                    'user_id': log['user_id'],
                    'date': log['date'],
                    'timestamp': log['completed_at'] if log['completed_at'] else f"{log['date']} 00:00:00",
                    'status': log['status'],
                    'duration': log['duration'] if log['duration'] else 0,
                    'amount': log['amount'] if log['amount'] else 0.0,
                    'unit': log['unit_type'] if log['unit_type'] else 'Hours',
                    'notes': log['notes'] if log['notes'] else '',
                    'source': 'manual',  # Default to manual
                    'integration_id': 'none',
                    'whoop_metric_type': 'none',
                    'metadata': log['log_metadata'] if log['log_metadata'] else '{}',
                    'created_at': log['completed_at'] if log['completed_at'] else f"{log['date']} 00:00:00"
                }
                
                # Detect source from notes
                if log['notes'] and 'Whoop' in log['notes']:
                    event['source'] = 'whoop'
                
                # Ingest to Tinybird
                response = requests.post(
                    f'{TINYBIRD_API_URL}/v0/events?name=habit_logs',
                    headers={
                        'Authorization': f'Bearer {TINYBIRD_API_KEY}',
                        'Content-Type': 'application/json'
                    },
                    data=json.dumps(event)
                )
                
                if response.status_code == 202:
                    synced_count += 1
                    if synced_count % 10 == 0:
                        print(f"  ✅ Synced {synced_count}/{total_logs} logs...")
                else:
                    failed_count += 1
                    print(f"  ❌ Failed to sync log {log['id']}: {response.text[:100]}")
            
            except Exception as e:
                failed_count += 1
                print(f"  ❌ Error syncing log {log['id']}: {str(e)}")
        
        print(f"\n{'='*60}")
        print(f"✅ Reload complete!")
        print(f"  📊 Total logs: {total_logs}")
        print(f"  ✅ Successfully synced: {synced_count}")
        print(f"  ❌ Failed: {failed_count}")
        print(f"{'='*60}")
        
    except Exception as e:
        print(f"❌ Error during reload: {str(e)}")
        raise
    finally:
        conn.close()

if __name__ == "__main__":
    reload_all_logs()
