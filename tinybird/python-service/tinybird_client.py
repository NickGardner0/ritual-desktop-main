"""
Tinybird Client for Ritual App
Handles all interactions with Tinybird Events API
"""

import requests
import json
import os
from typing import List, Dict, Any, Optional
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()


class TinybirdClient:
    """Client for interacting with Tinybird Events API"""
    
    def __init__(self, env: str = None):
        """
        Initialize Tinybird client
        
        Args:
            env: 'local' or 'cloud'. If None, reads from TINYBIRD_ENV env var
        """
        self.env = env or os.getenv('TINYBIRD_ENV', 'local')
        
        if self.env == 'local':
            self.base_url = os.getenv('TINYBIRD_LOCAL_URL', 'http://localhost:7181')
            self.token = os.getenv('TINYBIRD_LOCAL_TOKEN', 'admin local_testing@tinybird.co')
        else:
            self.base_url = os.getenv('TINYBIRD_API_URL', 'https://api.tinybird.co')
            self.token = os.getenv('TINYBIRD_TOKEN')
        
        if not self.token:
            raise ValueError(f"Tinybird token not found for environment: {self.env}")
        
        self.headers = {
            'Authorization': f'Bearer {self.token}',
            'Content-Type': 'application/json'
        }
    
    def ingest_events(self, datasource: str, events: List[Dict[str, Any]]) -> Dict:
        """
        Ingest events into a Tinybird data source
        
        Args:
            datasource: Name of the data source (e.g., 'habit_logs')
            events: List of event dictionaries to ingest
            
        Returns:
            Response from Tinybird API
        """
        url = f"{self.base_url}/v0/events"
        params = {'name': datasource}
        
        # Convert events to NDJSON format
        ndjson_data = '\n'.join([json.dumps(event) for event in events])
        
        response = requests.post(
            url,
            params=params,
            headers=self.headers,
            data=ndjson_data
        )
        
        # Debug: print first event being sent
        if events:
            print(f"DEBUG - First event being sent to {datasource}:")
            print(json.dumps(events[0], indent=2))
        
        print(f"DEBUG - Response status: {response.status_code}")
        print(f"DEBUG - Response body: {response.text}")
        
        if response.status_code == 202:
            return {
                'success': True,
                'count': len(events),
                'message': f'Successfully ingested {len(events)} events to {datasource}'
            }
        else:
            return {
                'success': False,
                'error': response.text,
                'status_code': response.status_code
            }
    
    def query_pipe(self, pipe_name: str, params: Optional[Dict[str, Any]] = None) -> Dict:
        """
        Query a Tinybird pipe (endpoint)
        
        Args:
            pipe_name: Name of the pipe to query
            params: Query parameters
            
        Returns:
            Query results
        """
        url = f"{self.base_url}/v0/pipes/{pipe_name}.json"
        
        response = requests.get(
            url,
            headers=self.headers,
            params=params or {}
        )
        
        if response.status_code == 200:
            return response.json()
        else:
            raise Exception(f"Query failed: {response.text}")
    
    def ingest_habit_log(self, log_data: Dict[str, Any]) -> Dict:
        """
        Ingest a single habit log event
        
        Args:
            log_data: Habit log data dictionary
            
        Returns:
            Ingestion result
        """
        # Transform data for Tinybird schema
        event = {
            'id': log_data.get('id'),
            'habit_id': log_data.get('habit_id'),
            'habit_name': log_data.get('habit_name'),
            'user_id': log_data.get('user_id'),
            'date': log_data.get('date'),
            'timestamp': log_data.get('time') or log_data.get('created_at'),
            'status': log_data.get('status'),
            'duration': log_data.get('duration'),
            'amount': log_data.get('amount'),
            'unit': log_data.get('unit'),
            'notes': log_data.get('notes'),
            'source': log_data.get('source'),
            'integration_id': log_data.get('integration_id'),
            'whoop_metric_type': log_data.get('whoop_metric_type'),
            'metadata': json.dumps(log_data.get('metadata')) if log_data.get('metadata') else None,
            'created_at': log_data.get('created_at')
        }
        
        return self.ingest_events('habit_logs', [event])
    
    def ingest_whoop_sleep(self, sleep_data: Dict[str, Any]) -> Dict:
        """Ingest Whoop sleep data"""
        event = {
            'id': sleep_data.get('id'),
            'user_id': sleep_data.get('user_id'),
            'whoop_connection_id': sleep_data.get('whoop_connection_id'),
            'sleep_id': sleep_data.get('sleep_id'),
            'date': sleep_data.get('date'),
            'sleep_performance_percentage': sleep_data.get('sleep_performance_percentage'),
            'total_sleep_duration_minutes': sleep_data.get('total_sleep_duration_minutes'),
            'sleep_efficiency_percentage': sleep_data.get('sleep_efficiency_percentage'),
            'rem_sleep_minutes': sleep_data.get('rem_sleep_minutes'),
            'slow_wave_sleep_minutes': sleep_data.get('slow_wave_sleep_minutes'),
            'light_sleep_minutes': sleep_data.get('light_sleep_minutes'),
            'awake_minutes': sleep_data.get('awake_minutes'),
            'sleep_onset': sleep_data.get('sleep_onset'),
            'sleep_end': sleep_data.get('sleep_end'),
            'created_at': sleep_data.get('created_at')
        }
        
        return self.ingest_events('whoop_sleep_data', [event])
    
    def ingest_whoop_recovery(self, recovery_data: Dict[str, Any]) -> Dict:
        """Ingest Whoop recovery data"""
        event = {
            'id': recovery_data.get('id'),
            'user_id': recovery_data.get('user_id'),
            'whoop_connection_id': recovery_data.get('whoop_connection_id'),
            'cycle_id': recovery_data.get('cycle_id'),
            'date': recovery_data.get('date'),
            'recovery_score': recovery_data.get('recovery_score'),
            'hrv_rmssd': recovery_data.get('hrv_rmssd'),
            'resting_heart_rate': recovery_data.get('resting_heart_rate'),
            'spo2_percentage': recovery_data.get('spo2_percentage'),
            'skin_temp_celsius': recovery_data.get('skin_temp_celsius'),
            'created_at': recovery_data.get('created_at')
        }
        
        return self.ingest_events('whoop_recovery_data', [event])
    
    def ingest_whoop_workout(self, workout_data: Dict[str, Any]) -> Dict:
        """Ingest Whoop workout data"""
        event = {
            'id': workout_data.get('id'),
            'user_id': workout_data.get('user_id'),
            'whoop_connection_id': workout_data.get('whoop_connection_id'),
            'workout_id': workout_data.get('workout_id'),
            'date': workout_data.get('date'),
            'strain_score': workout_data.get('strain_score'),
            'activity_name': workout_data.get('activity_name'),
            'duration_minutes': workout_data.get('duration_minutes'),
            'average_heart_rate': workout_data.get('average_heart_rate'),
            'max_heart_rate': workout_data.get('max_heart_rate'),
            'kilojoules': workout_data.get('kilojoules'),
            'distance_meters': workout_data.get('distance_meters'),
            'started_at': workout_data.get('started_at'),
            'ended_at': workout_data.get('ended_at'),
            'created_at': workout_data.get('created_at')
        }
        
        return self.ingest_events('whoop_workout_data', [event])
    
    def bulk_ingest(self, datasource: str, events: List[Dict[str, Any]], batch_size: int = 1000) -> Dict:
        """
        Bulk ingest events in batches
        
        Args:
            datasource: Data source name
            events: List of events to ingest
            batch_size: Number of events per batch
            
        Returns:
            Summary of ingestion results
        """
        total_events = len(events)
        total_success = 0
        total_failed = 0
        
        for i in range(0, total_events, batch_size):
            batch = events[i:i + batch_size]
            result = self.ingest_events(datasource, batch)
            
            if result['success']:
                total_success += result['count']
            else:
                total_failed += len(batch)
                print(f"Batch {i//batch_size + 1} failed: {result.get('error')}")
        
        return {
            'total_events': total_events,
            'successful': total_success,
            'failed': total_failed
        }


# Example usage
if __name__ == '__main__':
    # Initialize client
    client = TinybirdClient(env='local')
    
    # Test ingesting a habit log
    test_log = {
        'id': 'test-123',
        'habit_id': 'habit-456',
        'habit_name': 'Morning Workout',
        'user_id': 'user-789',
        'date': '2025-01-13',
        'time': '2025-01-13T08:00:00Z',
        'status': 'completed',
        'duration': 3600,
        'amount': None,
        'unit': 'Minutes',
        'notes': 'Great workout!',
        'source': 'manual',
        'integration_id': None,
        'whoop_metric_type': None,
        'metadata': None,
        'created_at': '2025-01-13T08:00:00Z'
    }
    
    result = client.ingest_habit_log(test_log)
    print(json.dumps(result, indent=2))

