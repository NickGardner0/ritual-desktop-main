"""
Tinybird Service - Handles all Tinybird operations
Integrates with the existing Tinybird setup
"""

import os
import json
import asyncio
import time
import httpx
from datetime import datetime, timezone
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
            self.token = os.getenv('TINYBIRD_LOCAL_TOKEN')
        
        if not self.token:
            raise ValueError(f"Tinybird token not found for environment: {'cloud' if self.use_cloud else 'local'}")
        
        self.headers = {
            'Authorization': f'Bearer {self.token}',
            'Content-Type': 'application/json'
        }

    async def _wait_for_job(
        self,
        job_id: str,
        timeout_seconds: float = 60.0,
        poll_interval_seconds: float = 0.5,
    ) -> Dict[str, Any]:
        """
        Poll Tinybird job endpoint until completion (or timeout).
        """
        deadline = time.monotonic() + timeout_seconds
        url = f"{self.base_url}/v0/jobs/{job_id}"
        last_status = "unknown"
        last_payload: Dict[str, Any] = {}

        async with httpx.AsyncClient(timeout=30.0) as client:
            while True:
                response = await client.get(url, headers=self.headers)
                if response.status_code != 200:
                    return {
                        "success": False,
                        "error": response.text,
                        "status_code": response.status_code,
                        "job_id": job_id,
                    }

                try:
                    payload = response.json()
                except Exception:
                    payload = {}

                last_payload = payload
                last_status = str(payload.get("status", "")).lower()

                if last_status in {"done", "success", "completed", "finished"}:
                    return {
                        "success": True,
                        "job_id": job_id,
                        "status": last_status,
                        "result": payload,
                    }

                if last_status in {"error", "failed", "cancelled", "canceled"}:
                    return {
                        "success": False,
                        "error": f"Tinybird job failed with status={last_status}",
                        "job_id": job_id,
                        "status": last_status,
                        "result": payload,
                    }

                if time.monotonic() >= deadline:
                    return {
                        "success": False,
                        "error": f"Timed out waiting for Tinybird job {job_id} (last_status={last_status})",
                        "job_id": job_id,
                        "status": last_status,
                        "result": last_payload,
                    }

                await asyncio.sleep(max(0.1, poll_interval_seconds))
    
    async def ingest_events(self, datasource: str, events: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Ingest events to Tinybird Events API
        """
        try:
            # Convert events to NDJSON format
            ndjson = '\n'.join([json.dumps(event) for event in events])
            
            url = f"{self.base_url}/v0/events?name={datasource}"
            event_headers = dict(self.headers)
            event_headers['Content-Type'] = 'application/x-ndjson'
            
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    url,
                    headers=event_headers,
                    content=ndjson
                )
                
                if response.status_code in (200, 202):
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
        # Helper to normalize timestamps to Tinybird's expected UTC DateTime format.
        def format_utc_datetime(dt_value: Optional[Any], fallback_date: Optional[str] = None) -> str:
            if dt_value is None or str(dt_value).strip() == "":
                if fallback_date:
                    try:
                        # Use noon UTC for date-only fallback so ordering is stable and explicit.
                        fallback = datetime.strptime(fallback_date, "%Y-%m-%d").replace(
                            hour=12, minute=0, second=0, tzinfo=timezone.utc
                        )
                        return fallback.strftime('%Y-%m-%d %H:%M:%S')
                    except Exception:
                        pass
                return datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')

            # Accept datetime objects directly.
            if isinstance(dt_value, datetime):
                parsed = dt_value
            else:
                raw = str(dt_value).strip()
                parsed = None

                # Accept both Z and +/-offset forms.
                try:
                    iso_candidate = raw.replace('Z', '+00:00')
                    parsed = datetime.fromisoformat(iso_candidate)
                except Exception:
                    parsed = None

                # Date-only strings: normalize to noon UTC.
                if parsed is None:
                    try:
                        parsed = datetime.strptime(raw, "%Y-%m-%d").replace(
                            hour=12, minute=0, second=0, tzinfo=timezone.utc
                        )
                    except Exception:
                        parsed = None

                # Last-resort fallback for legacy "YYYY-MM-DD HH:MM:SS" strings.
                if parsed is None:
                    try:
                        parsed = datetime.strptime(raw, "%Y-%m-%d %H:%M:%S")
                    except Exception:
                        parsed = datetime.now(timezone.utc)

            # Normalize to UTC and strip timezone for Tinybird DateTime.
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            else:
                parsed = parsed.astimezone(timezone.utc)
            return parsed.strftime('%Y-%m-%d %H:%M:%S')
        
        completed_at = log_data.get('completed_at')
        log_date = log_data.get('date')  # User's intended local date
        
        # Use full UTC timestamp from completed_at (matches Turso storage)
        # This ensures timestamp accuracy for time display in tooltips
        timestamp_str = format_utc_datetime(completed_at, fallback_date=log_date)

        # Accept both `unit` and legacy `unit_type` from callers.
        unit_value = log_data.get('unit')
        if unit_value in (None, ""):
            unit_value = log_data.get('unit_type')

        metadata_value = log_data.get('metadata')
        if metadata_value in (None, ""):
            metadata_serialized = '{}'
        elif isinstance(metadata_value, str):
            metadata_serialized = metadata_value
        else:
            metadata_serialized = json.dumps(metadata_value)
        
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
            'unit': unit_value or 'none',  # Use 'none' instead of empty string
            'notes': log_data.get('notes') or 'none',  # Use 'none' instead of empty string
            'source': log_data.get('source') or 'manual',
            'integration_id': 'none',  # Use 'none' instead of empty string - Tinybird rejects ''
            'whoop_metric_type': 'none',  # Use 'none' instead of empty string - Tinybird rejects ''
            'metadata': metadata_serialized,
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
    
    async def delete_by_condition(
        self,
        datasource: str,
        delete_condition: str,
        wait_for_completion: bool = False,
        timeout_seconds: float = 60.0,
        poll_interval_seconds: float = 0.5,
    ) -> Dict[str, Any]:
        """
        Delete rows from a datasource by condition using Tinybird's Delete API
        
        IMPORTANT: This is a powerful operation. Use with caution.
        
        Args:
            datasource: Name of the datasource (e.g., 'habit_logs')
            delete_condition: SQL-like condition (e.g., "source = 'apple_health'")
        
        Returns:
            Result of the delete operation
        
        Example:
            await delete_by_condition('habit_logs', "source = 'apple_health'")
        """
        try:
            url = f"{self.base_url}/v0/datasources/{datasource}/delete"
            
            async with httpx.AsyncClient(timeout=120.0) as client:
                response = await client.post(
                    url,
                    headers=self.headers,
                    params={'delete_condition': delete_condition}
                )
                
                if response.status_code in [200, 201, 202]:
                    result: Dict[str, Any] = {}
                    try:
                        result = response.json()
                    except Exception:
                        result = {}

                    job_id = (
                        result.get("job_id")
                        or result.get("id")
                        or (result.get("job", {}) or {}).get("job_id")
                    )
                    job_status = str(
                        result.get("status") or (result.get("job", {}) or {}).get("status") or ""
                    ).lower()

                    if wait_for_completion and job_id:
                        wait_result = await self._wait_for_job(
                            job_id=job_id,
                            timeout_seconds=timeout_seconds,
                            poll_interval_seconds=poll_interval_seconds,
                        )
                        if not wait_result.get("success"):
                            return {
                                "success": False,
                                "error": wait_result.get("error", "Tinybird delete job failed"),
                                "status_code": response.status_code,
                                "job_id": job_id,
                                "result": result,
                                "wait_result": wait_result,
                            }
                        return {
                            "success": True,
                            "message": f"Delete operation completed on {datasource}",
                            "status_code": response.status_code,
                            "job_id": job_id,
                            "job_status": wait_result.get("status", job_status or "done"),
                            "result": wait_result.get("result", result),
                        }

                    return {
                        "success": True,
                        "message": f"Delete operation initiated on {datasource}",
                        "status_code": response.status_code,
                        "job_id": job_id,
                        "job_status": job_status or "unknown",
                        "result": result,
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
    
    async def count_by_condition(self, datasource: str, condition: str = "1=1") -> Dict[str, Any]:
        """
        Count rows in a datasource by condition
        
        Args:
            datasource: Name of the datasource
            condition: SQL-like condition (e.g., "source = 'apple_health'")
        
        Returns:
            Count result
        """
        try:
            # Use SQL query API
            url = f"{self.base_url}/v0/sql"
            query = f"SELECT count() as cnt FROM {datasource} WHERE {condition}"
            
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(
                    url,
                    headers=self.headers,
                    params={'q': query}
                )
                
                if response.status_code == 200:
                    # Tinybird SQL API returns plain text for simple queries
                    text = response.text.strip()
                    try:
                        count = int(text)
                    except ValueError:
                        # Try parsing as JSON if it's not plain int
                        try:
                            result = response.json()
                            if isinstance(result, int):
                                count = result
                            elif isinstance(result, dict):
                                data = result.get('data', [])
                                if data and isinstance(data[0], dict):
                                    count = data[0].get('cnt', 0)
                                else:
                                    count = 0
                            else:
                                count = 0
                        except:
                            count = 0
                    return {
                        'success': True,
                        'count': count
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
    
    async def get_apple_health_stats(self) -> Dict[str, Any]:
        """
        Get statistics about Apple Health data in habit_logs
        
        Returns:
            Statistics including counts by habit_name
        """
        try:
            url = f"{self.base_url}/v0/sql"
            query = """
                SELECT 
                    habit_name,
                    count() as count,
                    min(date) as earliest_date,
                    max(date) as latest_date
                FROM habit_logs 
                WHERE source = 'apple_health'
                GROUP BY habit_name
                ORDER BY count DESC
            """
            
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(
                    url,
                    headers=self.headers,
                    params={'q': query}
                )
                
                if response.status_code == 200:
                    # Tinybird SQL API returns TSV (tab-separated values) by default
                    text = response.text.strip()
                    if not text:
                        return {'success': True, 'data': []}
                    
                    data = []
                    column_names = ['habit_name', 'count', 'earliest_date', 'latest_date']
                    
                    for line in text.split('\n'):
                        if line.strip():
                            values = line.split('\t')
                            row = {}
                            for i, name in enumerate(column_names):
                                if i < len(values):
                                    # Convert count to int
                                    if name == 'count':
                                        try:
                                            row[name] = int(values[i])
                                        except ValueError:
                                            row[name] = 0
                                    else:
                                        row[name] = values[i]
                            data.append(row)
                    
                    return {
                        'success': True,
                        'data': data
                    }
                else:
                    return {
                        'success': False,
                        'error': response.text
                    }
                    
        except Exception as e:
            return {
                'success': False,
                'error': str(e)
            }
