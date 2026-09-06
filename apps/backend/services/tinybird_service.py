"""
Tinybird Service - Handles all Tinybird operations
Integrates with the existing Tinybird setup
"""

import os
import json
import asyncio
import time
import logging
import httpx
from collections import deque
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional

from services.privacy_policy import (
    can_send_to_cloud,
    data_class_for_tinybird_datasource,
)

logger = logging.getLogger(__name__)


class CircuitBreaker:
    """
    Simple circuit breaker: CLOSED → OPEN → HALF_OPEN → CLOSED.

    CLOSED:    normal operation. Track failures in a sliding window.
    OPEN:      5 failures within `window_s` → stop calling, buffer events.
    HALF_OPEN: after `cooldown_s`, allow one probe call.
               Success → CLOSED (drain buffer). Failure → OPEN.
    """

    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"

    def __init__(
        self,
        failure_threshold: int = 5,
        window_s: float = 60.0,
        cooldown_s: float = 30.0,
        buffer_maxlen: int = 1000,
    ):
        self.failure_threshold = failure_threshold
        self.window_s = window_s
        self.cooldown_s = cooldown_s

        self.state = self.CLOSED
        self._failures: List[float] = []  # timestamps of recent failures
        self._opened_at: float = 0.0
        self.buffer: deque = deque(maxlen=buffer_maxlen)

    def record_failure(self) -> None:
        now = time.monotonic()
        self._failures.append(now)
        # Trim failures outside the sliding window
        cutoff = now - self.window_s
        self._failures = [t for t in self._failures if t > cutoff]

        if len(self._failures) >= self.failure_threshold:
            logger.warning(
                "CircuitBreaker OPEN — %d failures in %.0fs",
                len(self._failures),
                self.window_s,
            )
            self.state = self.OPEN
            self._opened_at = now

    def record_success(self) -> None:
        if self.state == self.HALF_OPEN:
            logger.info("CircuitBreaker CLOSED — probe succeeded")
            self.state = self.CLOSED
            self._failures.clear()

    def allow_request(self) -> bool:
        if self.state == self.CLOSED:
            return True
        if self.state == self.OPEN:
            if time.monotonic() - self._opened_at >= self.cooldown_s:
                logger.info("CircuitBreaker HALF_OPEN — allowing probe")
                self.state = self.HALF_OPEN
                return True
            return False
        # HALF_OPEN — only one probe at a time; block additional calls
        return False


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

        # Circuit breaker for write operations
        self._breaker = CircuitBreaker(
            failure_threshold=5,
            window_s=60.0,
            cooldown_s=30.0,
            buffer_maxlen=1000,
        )

    def _format_utc_datetime(self, dt_value: Optional[Any], fallback: Optional[datetime] = None) -> str:
        if dt_value is None:
            dt_value = fallback or datetime.now(timezone.utc)

        if isinstance(dt_value, datetime):
            parsed = dt_value
        else:
            raw = str(dt_value).strip()
            parsed = None

            try:
                parsed = datetime.fromisoformat(raw.replace('Z', '+00:00'))
            except Exception:
                parsed = None

            if parsed is None:
                try:
                    parsed = datetime.strptime(raw, "%Y-%m-%d %H:%M:%S")
                except Exception:
                    parsed = fallback or datetime.now(timezone.utc)

        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        else:
            parsed = parsed.astimezone(timezone.utc)
        return parsed.strftime('%Y-%m-%d %H:%M:%S')

    def _build_heart_rate_rollup_event(self, rollup: Dict[str, Any]) -> Dict[str, Any]:
        bucket_start = rollup.get('bucket_start')
        created_at = rollup.get('created_at') or datetime.utcnow()
        bucket_start_str = self._format_utc_datetime(bucket_start)
        created_at_str = self._format_utc_datetime(created_at)

        if isinstance(bucket_start, datetime):
            bucket_day = (
                bucket_start.astimezone(timezone.utc).date()
                if bucket_start.tzinfo is not None
                else bucket_start.date()
            ).isoformat()
        else:
            bucket_day = bucket_start_str[:10]

        return {
            'id': rollup.get('id') or 'unknown',
            'user_id': rollup.get('user_id') or 'unknown',
            'bucket_start': bucket_start_str,
            'date': bucket_day,
            'source_type': rollup.get('source_type') or rollup.get('source_preference') or 'unknown',
            'sample_count': int(rollup.get('sample_count') or 0),
            'bpm_avg': float(rollup.get('bpm_avg') or 0.0),
            'bpm_min': int(rollup.get('bpm_min') or 0),
            'bpm_max': int(rollup.get('bpm_max') or 0),
            'created_at': created_at_str,
        }

    async def check_connectivity(self) -> Dict[str, Any]:
        """
        Lightweight connectivity probe for health checks.
        """
        decision = can_send_to_cloud(
            data_class="product_telemetry",
            destination="tinybird",
            purpose="analytics",
        )
        if not decision.allowed:
            return {
                "status": "disabled",
                "reason": decision.reason,
                "privacy_blocked": True,
            }

        url = f"{self.base_url}/v0/datasources"
        started = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(url, headers=self.headers, params={"limit": 1})

            latency_ms = round((time.monotonic() - started) * 1000, 2)
            if response.status_code == 200:
                return {"status": "ok", "latency_ms": latency_ms}

            return {
                "status": "error",
                "status_code": response.status_code,
                "latency_ms": latency_ms,
                "message": response.text[:300],
            }
        except Exception as exc:
            latency_ms = round((time.monotonic() - started) * 1000, 2)
            return {
                "status": "error",
                "latency_ms": latency_ms,
                "message": str(exc),
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

        # Adaptive backoff dramatically reduces noisy polling/log volume while
        # still converging quickly for short jobs.
        interval_seconds = max(0.5, float(poll_interval_seconds or 0.5))
        max_interval_seconds = 3.0

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

                await asyncio.sleep(interval_seconds)
                interval_seconds = min(max_interval_seconds, interval_seconds * 1.35)
    
    async def _drain_buffer(self) -> None:
        """Send buffered events that accumulated while circuit was open.

        Events are only removed from the buffer after successful ingestion.
        If a datasource batch fails, its events stay in the deque and the
        breaker is reopened so a future probe retries them.
        """
        if not self._breaker.buffer:
            return

        # Snapshot and group by datasource
        items = list(self._breaker.buffer)
        logger.info("Draining %d buffered Tinybird events", len(items))

        by_ds: Dict[str, List[Dict[str, Any]]] = {}
        for ds, evt in items:
            by_ds.setdefault(ds, []).append(evt)

        failed_items: list = []
        for ds, evts in by_ds.items():
            try:
                result = await self._raw_ingest(ds, evts)
                if not result.get("success"):
                    logger.warning(
                        "Drain failed for %s (%d events): %s",
                        ds, len(evts), result.get("error", "unknown"),
                    )
                    failed_items.extend((ds, e) for e in evts)
            except Exception as exc:
                logger.warning("Drain exception for %s: %s", ds, exc)
                failed_items.extend((ds, e) for e in evts)

        # Replace buffer contents: keep only events that failed to send
        self._breaker.buffer.clear()
        for pair in failed_items:
            self._breaker.buffer.append(pair)

        if failed_items:
            logger.warning(
                "Drain incomplete — %d events remain buffered, reopening breaker",
                len(failed_items),
            )
            self._breaker.state = CircuitBreaker.OPEN
            self._breaker._opened_at = time.monotonic()

    async def _raw_ingest(self, datasource: str, events: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Low-level HTTP POST to Tinybird Events API (no circuit breaker)."""
        ndjson = '\n'.join([json.dumps(event) for event in events])
        url = f"{self.base_url}/v0/events?name={datasource}"
        event_headers = dict(self.headers)
        event_headers['Content-Type'] = 'application/x-ndjson'

        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.post(url, headers=event_headers, content=ndjson)

        if response.status_code in (200, 202):
            return {
                'success': True,
                'count': len(events),
                'message': f'Successfully ingested {len(events)} events to {datasource}',
            }
        return {
            'success': False,
            'error': response.text,
            'status_code': response.status_code,
        }

    async def ingest_events(self, datasource: str, events: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Ingest events to Tinybird Events API with circuit breaker protection.
        """
        decision = can_send_to_cloud(
            data_class=data_class_for_tinybird_datasource(datasource),
            destination="tinybird",
            purpose="analytics",
        )
        if not decision.allowed:
            logger.info(
                "Tinybird ingest blocked by privacy policy datasource=%s count=%d reason=%s",
                datasource,
                len(events),
                decision.reason,
            )
            return {
                "success": True,
                "count": 0,
                "skipped": len(events),
                "privacy_blocked": True,
                "message": decision.reason,
            }

        if not self._breaker.allow_request():
            # Buffer events for later drain
            for evt in events:
                self._breaker.buffer.append((datasource, evt))
            logger.warning(
                "CircuitBreaker OPEN — buffered %d events for %s (%d in buffer)",
                len(events), datasource, len(self._breaker.buffer),
            )
            return {
                'success': True,
                'count': len(events),
                'message': f'Buffered {len(events)} events (circuit open)',
                'buffered': True,
            }

        try:
            result = await self._raw_ingest(datasource, events)

            if result.get('success'):
                self._breaker.record_success()
                # If circuit just closed, drain any buffered events
                if self._breaker.state == CircuitBreaker.CLOSED and self._breaker.buffer:
                    asyncio.create_task(self._drain_buffer())
            else:
                self._breaker.record_failure()

            return result

        except Exception as e:
            self._breaker.record_failure()
            # Buffer on failure so events aren't lost
            for evt in events:
                self._breaker.buffer.append((datasource, evt))
            return {
                'success': False,
                'error': str(e),
                'buffered': True,
            }
    
    async def query_pipe(
        self,
        pipe_name: str,
        params: Dict[str, Any] = None,
        *,
        data_class: str = "habit_log",
    ) -> Dict[str, Any]:
        """
        Query a Tinybird pipe
        """
        decision = can_send_to_cloud(
            data_class=data_class,
            destination="tinybird",
            purpose="analytics",
        )
        if not decision.allowed:
            return {
                "data": [],
                "meta": {"privacy_blocked": True, "reason": decision.reason},
                "statistics": {},
            }

        try:
            url = f"{self.base_url}/v0/pipes/{pipe_name}.json"
            
            async with httpx.AsyncClient(timeout=30.0) as client:
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
        integration_id = log_data.get('integration_id') or log_data.get('integration_source') or 'none'
        whoop_metric = log_data.get('whoop_metric_type') or log_data.get('metric_type') or 'none'

        event = {
            'id': log_data.get('id') or 'unknown',
            'habit_id': log_data.get('habit_id') or 'unknown',
            'habit_name': log_data.get('habit_name') or 'Unknown Habit',
            'user_id': log_data.get('user_id') or 'unknown',
            'date': log_date or datetime.utcnow().strftime('%Y-%m-%d'),
            'timestamp': timestamp_str,
            'status': log_data.get('status') or 'completed',
            'duration': int(log_data.get('duration') or 0),
            'amount': float(log_data.get('amount') or 0.0),
            'unit': unit_value or 'none',
            'notes': log_data.get('notes') or 'none',
            'source': log_data.get('source') or 'manual',
            'location_lat': log_data.get('location_lat'),
            'location_lon': log_data.get('location_lon'),
            'location_accuracy_m': log_data.get('location_accuracy_m'),
            'location_source': log_data.get('location_source'),
            'location_place_label': log_data.get('location_place_label'),
            'location_confidence': log_data.get('location_confidence'),
            'location_resolved_at': log_data.get('location_resolved_at'),
            'location_signal_age_ms': log_data.get('location_signal_age_ms'),
            'integration_id': integration_id if integration_id else 'none',
            'whoop_metric_type': whoop_metric if whoop_metric else 'none',
            'metadata': metadata_serialized,
            'created_at': timestamp_str,
        }
        
        result = await self.ingest_events('habit_logs', [event])
        logger.info("Tinybird habit log ingest result: %s", {
            "success": result.get("success"),
            "privacy_blocked": result.get("privacy_blocked", False),
            "count": result.get("count"),
        })
        return result
    
    async def ingest_habit_logs_batch(self, logs: List[Dict[str, Any]], batch_size: int = 500) -> Dict[str, Any]:
        """
        Ingest a batch of habit logs to Tinybird, processing in chunks.
        Reuses the same field-formatting logic as ingest_habit_log.
        """
        from datetime import datetime, timezone

        def format_utc_datetime(dt_value, fallback_date=None) -> str:
            if dt_value is None or str(dt_value).strip() == "":
                if fallback_date:
                    try:
                        fallback = datetime.strptime(fallback_date, "%Y-%m-%d").replace(
                            hour=12, minute=0, second=0, tzinfo=timezone.utc
                        )
                        return fallback.strftime('%Y-%m-%d %H:%M:%S')
                    except Exception:
                        pass
                return datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
            if isinstance(dt_value, datetime):
                parsed = dt_value
            else:
                raw = str(dt_value).strip()
                parsed = None
                try:
                    parsed = datetime.fromisoformat(raw.replace('Z', '+00:00'))
                except Exception:
                    pass
                if parsed is None:
                    try:
                        parsed = datetime.strptime(raw, "%Y-%m-%d").replace(
                            hour=12, minute=0, second=0, tzinfo=timezone.utc
                        )
                    except Exception:
                        pass
                if parsed is None:
                    try:
                        parsed = datetime.strptime(raw, "%Y-%m-%d %H:%M:%S")
                    except Exception:
                        parsed = datetime.now(timezone.utc)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            else:
                parsed = parsed.astimezone(timezone.utc)
            return parsed.strftime('%Y-%m-%d %H:%M:%S')

        events = []
        for log in logs:
            completed_at = log.get('completed_at')
            log_date = log.get('date')
            timestamp_str = format_utc_datetime(completed_at, fallback_date=log_date)

            unit_value = log.get('unit') or log.get('unit_type') or 'none'
            metadata_value = log.get('metadata') or log.get('log_metadata')
            if metadata_value in (None, ""):
                metadata_serialized = '{}'
            elif isinstance(metadata_value, str):
                metadata_serialized = metadata_value
            else:
                metadata_serialized = json.dumps(metadata_value)

            integration_id = log.get('integration_id') or log.get('integration_source') or 'none'
            whoop_metric = log.get('whoop_metric_type') or log.get('metric_type') or 'none'

            events.append({
                'id': log.get('id') or 'unknown',
                'habit_id': log.get('habit_id') or 'unknown',
                'habit_name': log.get('habit_name') or 'Unknown Habit',
                'user_id': log.get('user_id') or 'unknown',
                'date': log_date or datetime.utcnow().strftime('%Y-%m-%d'),
                'timestamp': timestamp_str,
                'status': log.get('status') or 'completed',
                'duration': int(log.get('duration') or 0),
                'amount': float(log.get('amount') or 0.0),
                'unit': unit_value if unit_value else 'none',
                'notes': log.get('notes') or 'none',
                'source': log.get('source') or 'manual',
                'location_lat': log.get('location_lat'),
                'location_lon': log.get('location_lon'),
                'location_accuracy_m': log.get('location_accuracy_m'),
                'location_source': log.get('location_source'),
                'location_place_label': log.get('location_place_label'),
                'location_confidence': log.get('location_confidence'),
                'location_resolved_at': log.get('location_resolved_at'),
                'location_signal_age_ms': log.get('location_signal_age_ms'),
                'integration_id': integration_id if integration_id else 'none',
                'whoop_metric_type': whoop_metric if whoop_metric else 'none',
                'metadata': metadata_serialized,
                'created_at': timestamp_str,
            })

        total_ingested = 0
        errors = []
        for i in range(0, len(events), batch_size):
            chunk = events[i:i + batch_size]
            result = await self.ingest_events('habit_logs', chunk)
            if result.get('success'):
                total_ingested += len(chunk)
            else:
                errors.append(f"Batch {i // batch_size}: {result.get('error', 'unknown')}")

        return {
            'success': len(errors) == 0,
            'total_ingested': total_ingested,
            'total_logs': len(events),
            'errors': errors,
        }

    async def ingest_heart_rate_rollups(
        self,
        rollups: List[Dict[str, Any]],
        batch_size: int = 500,
    ) -> Dict[str, Any]:
        """
        Ingest canonical 1-minute heart-rate rollups to Tinybird.

        Rollup `id` is deterministic per user/source/bucket. Re-sends therefore
        append new versions of the same logical bucket, and Tinybird pipes
        deduplicate by latest `created_at`.
        """
        events = [self._build_heart_rate_rollup_event(rollup) for rollup in rollups]
        if not events:
            return {
                'success': True,
                'total_ingested': 0,
                'total_rollups': 0,
                'errors': [],
            }

        total_ingested = 0
        errors = []
        for i in range(0, len(events), batch_size):
            chunk = events[i:i + batch_size]
            result = await self.ingest_events('heart_rate_1m_rollups', chunk)
            if result.get('success'):
                total_ingested += len(chunk)
            else:
                errors.append(f"Batch {i // batch_size}: {result.get('error', 'unknown')}")

        return {
            'success': len(errors) == 0,
            'total_ingested': total_ingested,
            'total_rollups': len(events),
            'errors': errors,
        }

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

    async def get_habits_summary_payload(
        self,
        user_id: str,
        days_back: int = 30,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
    ) -> Dict[str, Any]:
        use_custom_range = bool(start_date and end_date)
        if use_custom_range:
            raw = await self.query_pipe(
                "habit_period_comparison",
                {
                    "user_id": user_id,
                    "start_date": start_date,
                    "end_date": end_date,
                },
            )
            rows = [format_habit_period_comparison_row(row) for row in raw.get("data") or []]
        else:
            raw = await self.query_pipe(
                "user_habits_summary",
                {
                    "user_id": user_id,
                    "days_back": days_back,
                },
            )
            rows = [format_user_habits_summary_row(row) for row in raw.get("data") or []]
        return {
            "success": True,
            "useCustomRange": use_custom_range,
            "data": rows,
        }

    async def get_habit_logs_time_range_payload(
        self,
        user_id: str,
        start_date: str,
        end_date: str,
        limit: int = 1000,
        habit_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        params: Dict[str, Any] = {
            "user_id": user_id,
            "start_date": start_date,
            "end_date": end_date,
            "limit": limit,
        }
        if habit_id:
            params["habit_id"] = habit_id
        raw = await self.query_pipe("habit_logs_time_range", params)
        return {
            "success": True,
            "data": raw.get("data") or [],
        }

    async def get_habit_correlation_payload(
        self,
        user_id: str,
        habit1_id: str,
        habit2_id: str,
        days_back: int = 90,
    ) -> Dict[str, Any]:
        raw = await self.query_pipe(
            "habit_correlation",
            {
                "user_id": user_id,
                "habit1_id": habit1_id,
                "habit2_id": habit2_id,
                "days_back": days_back,
            },
        )
        return format_habit_correlation_payload(raw)

    async def get_heart_rate_summary_payload(
        self,
        user_id: str,
        days_back: int = 30,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        source_type: Optional[str] = None,
    ) -> Dict[str, Any]:
        params: Dict[str, Any] = {"user_id": user_id}
        if source_type:
            params["source_type"] = source_type
        if start_date and end_date:
            params["start_date"] = start_date
            params["end_date"] = end_date
        else:
            params["days_back"] = days_back
        raw = await self.query_pipe(
            "heart_rate_summary",
            params,
            data_class="health_metric",
        )
        rows = raw.get("data") or []
        return {
            "success": True,
            "data": rows[0] if rows else None,
        }

    async def get_heart_rate_series_payload(
        self,
        user_id: str,
        bucket: str = "day",
        days_back: int = 30,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        source_type: Optional[str] = None,
    ) -> Dict[str, Any]:
        params: Dict[str, Any] = {
            "user_id": user_id,
            "bucket": bucket,
        }
        if source_type:
            params["source_type"] = source_type
        if start_date and end_date:
            params["start_date"] = start_date
            params["end_date"] = end_date
        else:
            params["days_back"] = days_back
        raw = await self.query_pipe(
            "heart_rate_series",
            params,
            data_class="health_metric",
        )
        return {
            "success": True,
            "bucket": bucket,
            "data": raw.get("data") or [],
        }

    async def get_habit_daily_values_payload(
        self,
        user_id: str,
        output: str = "summary",
        days_back: int = 30,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        habit_id: Optional[str] = None,
        habit_ids: Optional[str] = None,
        policy_v2: bool = False,
    ) -> Dict[str, Any]:
        pipe_name = "habit_daily_series" if output == "daily" else "habit_daily_values"
        params: Dict[str, Any] = {
            "user_id": user_id,
            "policy_v2": "1" if policy_v2 else "0",
        }
        if habit_id:
            params["habit_id"] = habit_id
        elif habit_ids:
            params["habit_ids"] = habit_ids
        if start_date and end_date:
            params["start_date"] = start_date
            params["end_date"] = end_date
        else:
            params["days_back"] = days_back
        raw = await self.query_pipe(pipe_name, params)
        rows = raw.get("data") or []
        return {
            "success": True,
            "output": output,
            "data": rows,
            "meta": {
                "user_id": user_id,
                "pipe": pipe_name,
                "habit_id": habit_id,
                "habit_ids": None if habit_id else (habit_ids or None),
                "start_date": start_date,
                "end_date": end_date,
                "days_back": None if start_date and end_date else days_back,
                "rows": len(rows),
            },
        }
    
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
        poll_interval_seconds: float = 1.5,
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
            
            async with httpx.AsyncClient(timeout=30.0) as client:
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


def format_user_habits_summary_row(habit: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "habit_id": habit.get("habit_id"),
        "habit_name": habit.get("habit_name"),
        "unit": habit.get("unit"),
        "total_logs": habit.get("total_logs"),
        "completed_count": habit.get("completed_count"),
        "days_with_data": habit.get("days_with_data"),
        "total_amount": habit.get("total_amount"),
        "avg_amount": habit.get("avg_amount"),
        "last_7_days_avg": habit.get("last_7_days_avg") or 0,
        "last_7_days_amount": habit.get("last_7_days_amount") or 0,
        "last_7_days_count": habit.get("last_7_days_count") or 0,
        "last_7_days_with_data": habit.get("last_7_days_with_data") or 0,
        "prev_7_days_avg": habit.get("prev_7_days_avg") or 0,
        "prev_7_days_count": habit.get("prev_7_days_count") or 0,
        "prev_7_days_with_data": habit.get("prev_7_days_with_data") or 0,
        "weekly_amount_change_pct": habit.get("weekly_amount_change_pct") or 0,
        "weekly_days_change_pct": habit.get("weekly_days_change_pct") or 0,
        "last_30_days_avg": habit.get("last_30_days_avg") or 0,
        "last_30_days_amount": habit.get("last_30_days_amount") or 0,
        "monthly_amount_change_pct": habit.get("monthly_amount_change_pct") or 0,
        "monthly_days_change_pct": habit.get("monthly_days_change_pct") or 0,
        "last_completed_date": habit.get("last_completed_date"),
        "first_log_date": habit.get("first_log_date"),
    }


def format_habit_period_comparison_row(habit: Dict[str, Any]) -> Dict[str, Any]:
    amount_change_pct = habit.get("amount_change_pct") or 0
    return {
        "habit_id": habit.get("habit_id"),
        "habit_name": habit.get("habit_name"),
        "unit": habit.get("unit"),
        "first_date": habit.get("first_date"),
        "first_day_amount": habit.get("first_day_amount") or 0,
        "first_day_duration": habit.get("first_day_duration") or 0,
        "last_date": habit.get("last_date"),
        "last_day_amount": habit.get("last_day_amount") or 0,
        "last_day_duration": habit.get("last_day_duration") or 0,
        "days_with_data": habit.get("days_with_data") or 0,
        "total_amount": habit.get("total_amount") or 0,
        "total_duration": habit.get("total_duration") or 0,
        "avg_amount": habit.get("avg_amount") or 0,
        "avg_duration": habit.get("avg_duration") or 0,
        "amount_change_pct": amount_change_pct,
        "duration_change_pct": habit.get("duration_change_pct") or 0,
        "amount_absolute_change": habit.get("amount_absolute_change") or 0,
        "duration_absolute_change": habit.get("duration_absolute_change") or 0,
        "weekly_amount_change_pct": amount_change_pct,
        "period_start": habit.get("period_start"),
        "period_end": habit.get("period_end"),
        "period_days": habit.get("period_days"),
    }


def interpret_habit_correlation(
    coefficient: float,
    strength: str,
    direction: str,
    habit1_name: str,
    habit2_name: str,
) -> str:
    if strength == "insufficient_data":
        return (
            f"Not enough overlapping data to determine a relationship between {habit1_name} and {habit2_name}. "
            "Need at least 7 days where both are logged."
        )
    if strength == "negligible":
        return f"No significant relationship found between {habit1_name} and {habit2_name}."
    strength_word = "strong" if strength == "strong" else "moderate" if strength == "moderate" else "weak"
    if direction == "positive":
        return (
            f"There is a {strength_word} positive correlation (r={coefficient:.2f}). "
            f"On days with more {habit1_name}, you tend to have more {habit2_name}."
        )
    if direction == "negative":
        return (
            f"There is a {strength_word} negative correlation (r={coefficient:.2f}). "
            f"On days with more {habit1_name}, you tend to have less {habit2_name}."
        )
    return f"No clear directional relationship between {habit1_name} and {habit2_name}."


def format_habit_correlation_payload(raw: Dict[str, Any]) -> Dict[str, Any]:
    rows = raw.get("data") or []
    result = rows[0] if rows else None
    if not result:
        return {
            "success": False,
            "error": "No overlapping data found between these habits",
        }
    coefficient = float(result.get("correlation") or 0)
    strength = str(result.get("strength") or "")
    direction = str(result.get("direction") or "")
    habit1_name = str(result.get("habit1_name") or "habit 1")
    habit2_name = str(result.get("habit2_name") or "habit 2")
    return {
        "success": True,
        "data": {
            "habit1": {
                "id": result.get("habit1_id"),
                "name": habit1_name,
                "mean": result.get("habit1_mean"),
            },
            "habit2": {
                "id": result.get("habit2_id"),
                "name": habit2_name,
                "mean": result.get("habit2_mean"),
            },
            "correlation": {
                "coefficient": round(coefficient * 1000) / 1000,
                "strength": strength,
                "direction": direction,
                "interpretation": interpret_habit_correlation(
                    coefficient,
                    strength,
                    direction,
                    habit1_name,
                    habit2_name,
                ),
            },
            "sampleSize": result.get("sample_size"),
            "status": result.get("status"),
        },
    }
