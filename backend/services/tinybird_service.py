"""
Tinybird Service - Handles all Tinybird operations
Integrates with the existing Tinybird setup
"""

import os
import json
import httpx
from typing import Dict, Any, List, Optional

class TinybirdService:
    """Service for Tinybird operations"""
    
    def __init__(self):
        # Use existing Tinybird configuration
        self.use_cloud = os.getenv('TINYBIRD_ENV', 'cloud') != 'local'
        
        if self.use_cloud:
            self.base_url = os.getenv('TINYBIRD_API_URL', 'https://api.us-east.aws.tinybird.co')
            self.token = os.getenv('TINYBIRD_TOKEN')
        else:
            self.base_url = os.getenv('TINYBIRD_LOCAL_URL', 'http://localhost:7181')
            self.token = os.getenv('TINYBIRD_LOCAL_TOKEN', 'admin local_testing@tinybird.co')
        
        if not self.token:
            raise ValueError(f"Tinybird token not found for environment: {'cloud' if self.use_cloud else 'local'}")
        
        self.headers = {
            'Authorization': f'Bearer {self.token}',
            'Content-Type': 'application/json'
        }
    
    async def ingest_events(self, datasource: str, events: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Ingest events to Tinybird Events API
        """
        try:
            # Convert events to NDJSON format
            ndjson = '\n'.join([json.dumps(event) for event in events])
            
            url = f"{self.base_url}/v0/events?name={datasource}"
            
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    url,
                    headers=self.headers,
                    content=ndjson
                )
                
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
                    
        except Exception as e:
            return {
                'success': False,
                'error': str(e)
            }
    
    async def query_pipe(self, pipe_name: str, params: Dict[str, Any] = None) -> Dict[str, Any]:
        """
        Query a Tinybird pipe
        """
        try:
            url = f"{self.base_url}/v0/pipes/{pipe_name}.json"
            
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    url,
                    headers=self.headers,
                    params=params or {}
                )
                
                if response.status_code == 200:
                    return response.json()
                else:
                    raise Exception(f"Query failed: {response.text}")
                    
        except Exception as e:
            raise Exception(f"Tinybird query error: {str(e)}")
    
    async def ingest_habit_log(self, log_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Ingest a habit log to Tinybird
        
        IMPORTANT: Timestamps are stored in UTC to match Turso database.
        - `date` field: User's intended local date (for grouping/filtering)
        - `timestamp` field: Full UTC timestamp (for accurate time display)
        """
        from datetime import datetime
        
        # Helper to format ISO datetime for Tinybird (convert to space-separated UTC format)
        def format_utc_datetime(dt_string: str) -> str:
            if not dt_string:
                return datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
            # Convert ISO format to Tinybird format: "2025-12-07T00:02:08.352Z" -> "2025-12-07 00:02:08"
            # Keep the FULL UTC timestamp, don't mix with local date!
            result = dt_string.replace('T', ' ')
            # Remove 'Z' suffix and milliseconds
            if 'Z' in result:
                result = result.replace('Z', '')
            if '.' in result:
                result = result.split('.')[0]
            return result
        
        completed_at = log_data.get('completed_at')
        log_date = log_data.get('date')  # User's intended local date
        
        # Use full UTC timestamp from completed_at (matches Turso storage)
        # This ensures timestamp accuracy for time display in tooltips
        timestamp_str = format_utc_datetime(completed_at) if completed_at else datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
        
        # Transform data for Tinybird schema
        # CRITICAL: Tinybird converts empty strings to null and rejects them!
        # Use 'none' instead of '' for LowCardinality fields
        event = {
            'id': log_data.get('id') or 'unknown',
            'habit_id': log_data.get('habit_id') or 'unknown',
            'habit_name': log_data.get('habit_name') or 'Unknown Habit',
            'user_id': log_data.get('user_id') or 'unknown',
            'date': log_date or datetime.utcnow().strftime('%Y-%m-%d'),  # User's local date for grouping
            'timestamp': timestamp_str,  # Full UTC timestamp (matches Turso)
            'status': log_data.get('status') or 'completed',
            'duration': int(log_data.get('duration') or 0),  # Ensure Int32, default 0
            'amount': float(log_data.get('amount') or 0.0),  # Ensure Float64, default 0.0
            'unit': log_data.get('unit') or 'none',  # Use 'none' instead of empty string
            'notes': log_data.get('notes') or 'none',  # Use 'none' instead of empty string
            'source': log_data.get('source') or 'manual',
            'integration_id': 'none',  # Use 'none' instead of empty string - Tinybird rejects ''
            'whoop_metric_type': 'none',  # Use 'none' instead of empty string - Tinybird rejects ''
            'metadata': log_data.get('metadata') or '{}',
            'created_at': timestamp_str  # Full UTC timestamp
        }
        
        print(f"🔍 Tinybird event data (formatted): {event}")
        result = await self.ingest_events('habit_logs', [event])
        print(f"🔍 Tinybird ingest result: {result}")
        return result
    
    async def ingest_habit_definition(self, habit: Dict[str, Any]) -> Dict[str, Any]:
        """
        Ingest habit definition for analytics (optional - for enrichment)
        """
        # This could be used to store habit metadata in Tinybird
        # for better analytics queries
        return {"success": True, "message": "Habit definition noted"}
    
    async def update_habit_definition(self, habit: Dict[str, Any]) -> Dict[str, Any]:
        """
        Update habit definition in analytics
        """
        # Tinybird is append-only, so we'd just add a new record
        # with updated information if needed
        return {"success": True, "message": "Habit definition updated"}
    
    async def get_user_habits_summary(self, user_id: str, days_back: int = 30) -> Dict[str, Any]:
        """
        Get user habits summary from Tinybird
        """
        return await self.query_pipe('user_habits_summary', {
            'user_id': user_id,
            'days_back': days_back
        })
    
    async def get_habit_trends(self, user_id: str, period: str = 'day', days_back: int = 30, habit_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Get habit trends from Tinybird
        """
        params = {
            'user_id': user_id,
            'period': period,
            'days_back': days_back
        }
        
        if habit_id:
            params['habit_id'] = habit_id
        
        return await self.query_pipe('habit_trends', params)
    
    async def get_recent_habit_logs(self, user_id: str, days_back: int = 7, limit: int = 100, habit_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Get recent habit logs from Tinybird
        """
        params = {
            'user_id': user_id,
            'days_back': days_back,
            'limit': limit
        }
        
        if habit_id:
            params['habit_id'] = habit_id
        
        return await self.query_pipe('recent_habit_logs', params)
