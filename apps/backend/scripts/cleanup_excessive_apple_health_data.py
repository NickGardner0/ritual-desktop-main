#!/usr/bin/env python3
"""
Cleanup script to remove excessive Apple Health raw samples from both Turso and Tinybird.

This removes:
1. wearable_metrics with source='apple_health' from Turso
2. habit_logs with source='apple_health' from Turso
3. habit_logs with source='apple_health' from Tinybird

After running this, the iOS sync should be updated to send daily aggregates instead.
"""

import os
import sys
import asyncio

# Add parent directory to path
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, backend_dir)

# Load .env file
try:
    from dotenv import load_dotenv
    env_path = os.path.join(backend_dir, '.env')
    load_dotenv(env_path)
except ImportError:
    pass  # dotenv not installed, rely on system env vars


async def check_turso_data(user_id: str = None) -> dict:
    """Check how much Apple Health data is in Turso"""
    from database.connection import get_db_session
    from database.models import WearableMetricDB, HabitLogDB
    from sqlalchemy import func, select
    
    async with get_db_session() as session:
        # Count wearable_metrics
        query = select(func.count()).select_from(WearableMetricDB).where(
            WearableMetricDB.source == 'apple_health'
        )
        if user_id:
            query = query.where(WearableMetricDB.user_id == user_id)
        result = await session.execute(query)
        metrics_count = result.scalar()
        
        # Breakdown by metric_type
        query = select(
            WearableMetricDB.metric_type,
            func.count(WearableMetricDB.id)
        ).where(
            WearableMetricDB.source == 'apple_health'
        )
        if user_id:
            query = query.where(WearableMetricDB.user_id == user_id)
        query = query.group_by(WearableMetricDB.metric_type)
        result = await session.execute(query)
        metrics_breakdown = result.all()
        
        # Count habit_logs
        query = select(func.count()).select_from(HabitLogDB).where(
            HabitLogDB.source == 'apple_health'
        )
        result = await session.execute(query)
        logs_count = result.scalar()
        
        # Breakdown by habit_name
        query = select(
            HabitLogDB.habit_name,
            func.count(HabitLogDB.id)
        ).where(
            HabitLogDB.source == 'apple_health'
        ).group_by(HabitLogDB.habit_name)
        result = await session.execute(query)
        logs_breakdown = result.all()
        
        return {
            'metrics_count': metrics_count,
            'metrics_breakdown': metrics_breakdown,
            'logs_count': logs_count,
            'logs_breakdown': logs_breakdown
        }


async def check_tinybird_data() -> dict:
    """Check how much Apple Health data is in Tinybird"""
    from services.tinybird_service import TinybirdService
    
    try:
        tb = TinybirdService()
        
        # Count total apple_health logs
        count_result = await tb.count_by_condition('habit_logs', "source = 'apple_health'")
        
        # Get breakdown by habit_name
        stats_result = await tb.get_apple_health_stats()
        
        return {
            'count': count_result.get('count', 0) if count_result.get('success') else 0,
            'stats': stats_result.get('data', []) if stats_result.get('success') else [],
            'error': count_result.get('error') or stats_result.get('error')
        }
    except Exception as e:
        return {
            'count': 0,
            'stats': [],
            'error': str(e)
        }


async def cleanup_turso(user_id: str = None, dry_run: bool = True):
    """Clean up Turso database"""
    from database.connection import get_db_session
    from database.models import WearableMetricDB, HabitLogDB, WearableDeviceDB
    from sqlalchemy import delete
    
    async with get_db_session() as session:
        # Delete wearable_metrics
        query = delete(WearableMetricDB).where(WearableMetricDB.source == 'apple_health')
        if user_id:
            query = query.where(WearableMetricDB.user_id == user_id)
        
        if not dry_run:
            result = await session.execute(query)
            print(f"   Deleted {result.rowcount} wearable_metrics")
        
        # Delete habit_logs
        query = delete(HabitLogDB).where(HabitLogDB.source == 'apple_health')
        
        if not dry_run:
            result = await session.execute(query)
            print(f"   Deleted {result.rowcount} habit_logs")
            
            # Clear HealthKit anchors on devices
            query = select(WearableDeviceDB).where(WearableDeviceDB.platform == 'ios')
            if user_id:
                query = query.where(WearableDeviceDB.user_id == user_id)
            result = await session.execute(query)
            devices = result.scalars().all()
            
            for device in devices:
                device.hk_anchor = None
                print(f"   Cleared HK anchor for device: {device.device_name}")
            
            await session.commit()
            print("   Committed Turso changes")


async def cleanup_tinybird(dry_run: bool = True):
    """Clean up Tinybird data"""
    from services.tinybird_service import TinybirdService
    
    try:
        tb = TinybirdService()
        
        if not dry_run:
            result = await tb.delete_by_condition('habit_logs', "source = 'apple_health'")
            if result.get('success'):
                print(f"   Tinybird delete initiated: {result.get('message')}")
                print(f"   Result: {result.get('result')}")
            else:
                print(f"   ⚠️ Tinybird delete failed: {result.get('error')}")
        else:
            print("   Would delete from Tinybird (dry run)")
            
    except Exception as e:
        print(f"   ⚠️ Tinybird cleanup error: {e}")


async def main():
    import argparse
    parser = argparse.ArgumentParser(description='Clean up excessive Apple Health raw samples')
    parser.add_argument('--user-id', type=str, help='User ID to clean (optional, defaults to all)')
    parser.add_argument('--execute', action='store_true', help='Actually delete (default is dry run)')
    parser.add_argument('--turso-only', action='store_true', help='Only clean Turso, skip Tinybird')
    parser.add_argument('--tinybird-only', action='store_true', help='Only clean Tinybird, skip Turso')
    
    args = parser.parse_args()
    
    print("=" * 70)
    print("Apple Health Data Cleanup Script")
    print("=" * 70)
    print()
    
    # Check Turso data
    if not args.tinybird_only:
        print("📊 TURSO DATABASE:")
        turso_data = await check_turso_data(args.user_id)
        print(f"   wearable_metrics with source='apple_health': {turso_data['metrics_count']}")
        for metric_type, count in turso_data['metrics_breakdown']:
            print(f"      - {metric_type}: {count}")
        print(f"   habit_logs with source='apple_health': {turso_data['logs_count']}")
        for habit_name, count in turso_data['logs_breakdown']:
            print(f"      - {habit_name}: {count}")
        print()
    
    # Check Tinybird data
    if not args.turso_only:
        print("📊 TINYBIRD:")
        tb_data = await check_tinybird_data()
        if tb_data.get('error'):
            print(f"   ⚠️ Error checking Tinybird: {tb_data['error']}")
        else:
            print(f"   habit_logs with source='apple_health': {tb_data['count']}")
            for stat in tb_data['stats']:
                print(f"      - {stat.get('habit_name', 'Unknown')}: {stat.get('count', 0)} (from {stat.get('earliest_date')} to {stat.get('latest_date')})")
        print()
    
    if not args.execute:
        print("🔍 DRY RUN - No data was deleted.")
        print("   To actually delete, run with --execute")
        return
    
    # Confirm before deleting
    total_turso = turso_data['metrics_count'] + turso_data['logs_count'] if not args.tinybird_only else 0
    total_tinybird = tb_data['count'] if not args.turso_only else 0
    
    print("⚠️  WARNING: About to delete:")
    if not args.tinybird_only:
        print(f"   - {turso_data['metrics_count']} wearable_metrics from Turso")
        print(f"   - {turso_data['logs_count']} habit_logs from Turso")
    if not args.turso_only:
        print(f"   - {tb_data['count']} habit_logs from Tinybird")
    
    confirm = input("\nType 'DELETE' to confirm: ")
    if confirm != 'DELETE':
        print("❌ Aborted.")
        return
    
    print()
    
    # Clean up Turso
    if not args.tinybird_only:
        print("🗑️  Cleaning Turso...")
        await cleanup_turso(args.user_id, dry_run=False)
        print("   ✅ Turso cleanup complete")
        print()
    
    # Clean up Tinybird
    if not args.turso_only:
        print("🗑️  Cleaning Tinybird...")
        await cleanup_tinybird(dry_run=False)
        print("   ✅ Tinybird cleanup initiated")
        print()
    
    print("=" * 70)
    print("✅ CLEANUP COMPLETE")
    print("=" * 70)
    print()
    print("NEXT STEPS:")
    print("1. Rebuild the iOS companion app in Xcode (CMD+R)")
    print("2. The updated app will now sync DAILY AGGREGATES instead of raw samples")
    print("3. This reduces ~50,000 samples to ~700 daily values (one per day per metric)")
    print()


if __name__ == '__main__':
    asyncio.run(main())
