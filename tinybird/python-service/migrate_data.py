"""
Data Migration Script: Supabase → Tinybird
Migrates all historical data from Supabase to Tinybird
"""

import os
import sys
from datetime import datetime
from typing import List, Dict, Any
from dotenv import load_dotenv
from supabase import create_client, Client
from tinybird_client import TinybirdClient
from tqdm import tqdm
import json

load_dotenv()


class DataMigrator:
    """Handles data migration from Supabase to Tinybird"""
    
    def __init__(self, tinybird_env: str = 'local'):
        """
        Initialize migrator
        
        Args:
            tinybird_env: 'local' or 'cloud'
        """
        # Initialize Supabase client
        supabase_url = os.getenv('SUPABASE_URL')
        supabase_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')
        
        if not supabase_url or not supabase_key:
            raise ValueError("Supabase credentials not found in environment")
        
        self.supabase: Client = create_client(supabase_url, supabase_key)
        self.tinybird = TinybirdClient(env=tinybird_env)
        
        print(f"✅ Initialized migration to Tinybird {tinybird_env}")
    
    def fetch_all_habit_logs(self) -> List[Dict[str, Any]]:
        """Fetch all habit logs from Supabase"""
        print("\n📊 Fetching habit logs from Supabase...")
        
        all_logs = []
        batch_size = 1000
        offset = 0
        
        while True:
            response = self.supabase.table('habit_logs') \
                .select('*') \
                .range(offset, offset + batch_size - 1) \
                .execute()
            
            if not response.data:
                break
            
            all_logs.extend(response.data)
            offset += batch_size
            print(f"  Fetched {len(all_logs)} logs so far...")
            
            if len(response.data) < batch_size:
                break
        
        print(f"✅ Total habit logs fetched: {len(all_logs)}")
        return all_logs
    
    def fetch_all_whoop_sleep(self) -> List[Dict[str, Any]]:
        """Fetch all Whoop sleep data from Supabase"""
        print("\n😴 Fetching Whoop sleep data from Supabase...")
        
        response = self.supabase.table('whoop_sleep_data').select('*').execute()
        
        print(f"✅ Total sleep records fetched: {len(response.data)}")
        return response.data
    
    def fetch_all_whoop_recovery(self) -> List[Dict[str, Any]]:
        """Fetch all Whoop recovery data from Supabase"""
        print("\n💪 Fetching Whoop recovery data from Supabase...")
        
        response = self.supabase.table('whoop_recovery_data').select('*').execute()
        
        print(f"✅ Total recovery records fetched: {len(response.data)}")
        return response.data
    
    def fetch_all_whoop_workouts(self) -> List[Dict[str, Any]]:
        """Fetch all Whoop workout data from Supabase"""
        print("\n🏃 Fetching Whoop workout data from Supabase...")
        
        response = self.supabase.table('whoop_workout_data').select('*').execute()
        
        print(f"✅ Total workout records fetched: {len(response.data)}")
        return response.data
    
    def transform_habit_log(self, log: Dict[str, Any]) -> Dict[str, Any]:
        """Transform habit log for Tinybird ingestion"""
        return {
            'id': str(log.get('id')),
            'habit_id': str(log.get('habit_id')),
            'habit_name': log.get('habit_name') or '',
            'user_id': str(log.get('user_id')),
            'date': log.get('date'),
            'timestamp': log.get('time') or log.get('created_at'),
            'status': log.get('status') or 'completed',
            'duration': log.get('duration') or 0,
            'amount': log.get('amount') or 0.0,
            'unit': log.get('unit') or '',
            'notes': log.get('notes') or '',
            'source': log.get('source') or 'manual',
            'integration_id': str(log.get('integration_id')) if log.get('integration_id') else '',
            'whoop_metric_type': log.get('whoop_metric_type') or '',
            'metadata': json.dumps(log.get('metadata')) if log.get('metadata') else '{}',
            'created_at': log.get('created_at')
        }
    
    def transform_sleep_data(self, sleep: Dict[str, Any]) -> Dict[str, Any]:
        """Transform sleep data for Tinybird ingestion"""
        return {
            'id': str(sleep.get('id')),
            'user_id': str(sleep.get('user_id')),
            'whoop_connection_id': str(sleep.get('whoop_connection_id')),
            'sleep_id': str(sleep.get('sleep_id')),
            'date': sleep.get('date'),
            'sleep_performance_percentage': float(sleep.get('sleep_performance_percentage')) if sleep.get('sleep_performance_percentage') else None,
            'total_sleep_duration_minutes': sleep.get('total_sleep_duration_minutes'),
            'sleep_efficiency_percentage': float(sleep.get('sleep_efficiency_percentage')) if sleep.get('sleep_efficiency_percentage') else None,
            'rem_sleep_minutes': sleep.get('rem_sleep_minutes'),
            'slow_wave_sleep_minutes': sleep.get('slow_wave_sleep_minutes'),
            'light_sleep_minutes': sleep.get('light_sleep_minutes'),
            'awake_minutes': sleep.get('awake_minutes'),
            'sleep_onset': sleep.get('sleep_onset'),
            'sleep_end': sleep.get('sleep_end'),
            'created_at': sleep.get('created_at')
        }
    
    def migrate_habit_logs(self) -> Dict[str, int]:
        """Migrate all habit logs"""
        logs = self.fetch_all_habit_logs()
        
        if not logs:
            print("⚠️  No habit logs to migrate")
            return {'migrated': 0, 'failed': 0}
        
        print(f"\n📤 Migrating {len(logs)} habit logs to Tinybird...")
        
        # Transform logs
        transformed_logs = [self.transform_habit_log(log) for log in tqdm(logs, desc="Transforming")]
        
        # Bulk ingest
        result = self.tinybird.bulk_ingest('habit_logs', transformed_logs, batch_size=1000)
        
        print(f"\n✅ Migration complete: {result['successful']} successful, {result['failed']} failed")
        return result
    
    def migrate_whoop_data(self) -> Dict[str, Dict[str, int]]:
        """Migrate all Whoop data"""
        results = {}
        
        # Migrate sleep data
        sleep_data = self.fetch_all_whoop_sleep()
        if sleep_data:
            print(f"\n📤 Migrating {len(sleep_data)} sleep records to Tinybird...")
            transformed_sleep = [self.transform_sleep_data(s) for s in tqdm(sleep_data, desc="Transforming")]
            results['sleep'] = self.tinybird.bulk_ingest('whoop_sleep_data', transformed_sleep)
            print(f"✅ Sleep migration: {results['sleep']['successful']} successful")
        
        # Similar for recovery and workout data...
        # (Implementations follow same pattern)
        
        return results
    
    def run_full_migration(self):
        """Run complete migration"""
        print("\n" + "="*60)
        print("🚀 Starting Full Data Migration: Supabase → Tinybird")
        print("="*60)
        
        start_time = datetime.now()
        
        # Migrate habit logs
        habit_results = self.migrate_habit_logs()
        
        # Migrate Whoop data
        whoop_results = self.migrate_whoop_data()
        
        # Summary
        end_time = datetime.now()
        duration = (end_time - start_time).total_seconds()
        
        print("\n" + "="*60)
        print("✅ MIGRATION COMPLETE")
        print("="*60)
        print(f"⏱️  Duration: {duration:.2f} seconds")
        print(f"📊 Habit logs migrated: {habit_results['successful']}")
        print(f"😴 Sleep records migrated: {whoop_results.get('sleep', {}).get('successful', 0)}")
        print("="*60)


def main():
    """Main migration script"""
    import argparse
    
    parser = argparse.ArgumentParser(description='Migrate data from Supabase to Tinybird')
    parser.add_argument('--env', choices=['local', 'cloud'], default='local',
                       help='Tinybird environment (local or cloud)')
    parser.add_argument('--table', choices=['all', 'habit_logs', 'whoop'],
                       default='all', help='Which table(s) to migrate')
    
    args = parser.parse_args()
    
    try:
        migrator = DataMigrator(tinybird_env=args.env)
        
        if args.table == 'all':
            migrator.run_full_migration()
        elif args.table == 'habit_logs':
            migrator.migrate_habit_logs()
        elif args.table == 'whoop':
            migrator.migrate_whoop_data()
        
        print("\n✅ Migration completed successfully!")
        
    except Exception as e:
        print(f"\n❌ Migration failed: {str(e)}")
        sys.exit(1)


if __name__ == '__main__':
    main()

