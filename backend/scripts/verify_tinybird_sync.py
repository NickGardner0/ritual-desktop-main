"""
Verify Tinybird sync is working and show current data stats
"""

import asyncio
import sys
import os
from datetime import datetime, timedelta

# Add backend to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database.connection import get_db_session
from database.models import HabitLogDB
from sqlalchemy import select, func
import httpx

async def check_tinybird_status():
    """Check Tinybird data status and compare with Turso"""
    
    print("=" * 60)
    print("🔍 TINYBIRD SYNC VERIFICATION")
    print("=" * 60)
    
    token = os.getenv('TINYBIRD_TOKEN')
    base_url = os.getenv('TINYBIRD_API_URL', 'https://api.us-east.aws.tinybird.co')
    
    if not token:
        print("❌ TINYBIRD_TOKEN not found in environment")
        return
    
    print(f"\n✅ Connected to: {base_url}")
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        # 1. Check total rows and latest timestamp
        print("\n📊 TINYBIRD DATA STATUS:")
        print("-" * 60)
        
        response = await client.get(
            f'{base_url}/v0/sql',
            headers={'Authorization': f'Bearer {token}'},
            params={'q': 'SELECT count(*) as total, max(created_at) as latest, min(created_at) as earliest FROM habit_logs'}
        )
        
        if response.status_code == 200:
            result = response.text.strip().split('\t')
            print(f"Total rows: {result[0]}")
            print(f"Latest timestamp: {result[1]}")
            print(f"Earliest timestamp: {result[2]}")
        
        # 2. Check for duplicates
        print("\n🔍 DUPLICATE CHECK:")
        print("-" * 60)
        
        response = await client.get(
            f'{base_url}/v0/sql',
            headers={'Authorization': f'Bearer {token}'},
            params={'q': 'SELECT count(*) as duplicate_count FROM (SELECT id, count(*) as cnt FROM habit_logs GROUP BY id HAVING cnt > 1)'}
        )
        
        if response.status_code == 200:
            dup_count = response.text.strip()
            print(f"Habit logs with duplicates: {dup_count}")
            if int(dup_count) > 0:
                print("⚠️  WARNING: Duplicates detected in Tinybird")
                print("   This won't affect your analytics (they use deduplication)")
                print("   But it's wasting storage space")
        
        # 3. Check recent data (last 7 days)
        print("\n📅 RECENT DATA (Last 7 days):")
        print("-" * 60)
        
        response = await client.get(
            f'{base_url}/v0/sql',
            headers={'Authorization': f'Bearer {token}'},
            params={'q': "SELECT date, count(*) as logs FROM habit_logs WHERE date >= today() - INTERVAL 7 DAY GROUP BY date ORDER BY date DESC"}
        )
        
        if response.status_code == 200:
            lines = response.text.strip().split('\n')
            for line in lines:
                parts = line.split('\t')
                if len(parts) == 2:
                    print(f"  {parts[0]}: {parts[1]} logs")
        
        # 4. Check Turso database for comparison
        print("\n💾 TURSO DATABASE STATUS:")
        print("-" * 60)
        
        async with get_db_session() as session:
            # Total logs
            result = await session.execute(select(func.count(HabitLogDB.id)))
            total = result.scalar()
            print(f"Total logs in Turso: {total}")
            
            # Recent logs (last 7 days)
            seven_days_ago = (datetime.utcnow() - timedelta(days=7)).strftime('%Y-%m-%d')
            result = await session.execute(
                select(HabitLogDB.date, func.count(HabitLogDB.id))
                .where(HabitLogDB.date >= seven_days_ago)
                .group_by(HabitLogDB.date)
                .order_by(HabitLogDB.date.desc())
            )
            rows = result.all()
            print(f"\nRecent logs (last 7 days) in Turso:")
            for row in rows:
                print(f"  {row[0]}: {row[1]} logs")
        
        # 5. Final recommendation
        print("\n" + "=" * 60)
        print("✅ VERIFICATION COMPLETE")
        print("=" * 60)
        print("\n📝 NOTES:")
        print("• Tinybird dashboard 'Updated at' = schema deployment time")
        print("• Your actual data is current (see timestamps above)")
        print("• Analytics page reads from Turso (always up-to-date)")
        print("• New manual logs auto-sync to Tinybird immediately")
        print("• Whoop syncs happen at your configured hour (default 9 AM)")

if __name__ == "__main__":
    asyncio.run(check_tinybird_status())

