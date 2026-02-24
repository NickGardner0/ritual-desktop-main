"""
Ritual Watcher Service
Handles computer activity tracking: app usage, window titles, daily rollups.

Features:
- Device registration and management
- Activity event storage and querying
- Daily rollup computation
- Optional cloud sync to Tinybird
"""

import os
import uuid
import json
import time
import hashlib
import re
import asyncio
import httpx
from pathlib import Path
from datetime import datetime, timedelta, timezone
from typing import Optional, List, Dict, Any, Tuple
from sqlalchemy import select, delete, and_, func, text
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from database.connection import get_db_session
from database.models import (
    WatcherDeviceDB, WatcherStateDB, ActivityEventDB,
    DailyActivityRollupDB, WatcherSyncOutboxDB, WatcherAppExclusionDB,
    AfkEventDB, DomainDailyRollupDB
)


class WatcherService:
    """Service for managing Ritual Watcher computer activity tracking."""

    # Projection pipeline constants for the derived "Computer Use" habit log.
    COMPUTER_USE_PROJECTION_SOURCE = "ritual_watcher_projection_v1"
    COMPUTER_USE_LEGACY_SOURCE = "ritual_watcher"
    COMPUTER_USE_PIPELINE_VERSION = 1
    
    # Default sensitive apps to suggest for exclusion
    DEFAULT_SENSITIVE_APPS = [
        {"bundle_id": "com.1password", "name": "1Password"},
        {"bundle_id": "com.lastpass", "name": "LastPass"},
        {"bundle_id": "com.bitwarden", "name": "Bitwarden"},
        {"bundle_id": "com.dashlane", "name": "Dashlane"},
        {"bundle_id": "com.apple.keychainaccess", "name": "Keychain Access"},
        {"bundle_id": "com.apple.Safari", "name": "Safari (Private Windows)"},
        {"bundle_id": "com.google.Chrome.app.Profile", "name": "Chrome (Incognito)"},
        {"bundle_id": "org.mozilla.firefox", "name": "Firefox (Private)"},
        {"bundle_id": "com.apple.Health", "name": "Health"},
        {"bundle_id": "com.apple.MobileSMS", "name": "Messages"},
    ]

    SCREEN_SEARCH_STOP_WORDS = {
        "a", "an", "and", "are", "did", "do", "for", "from", "had", "have",
        "how", "i", "in", "is", "it", "my", "of", "on", "show", "that", "the",
        "to", "was", "were", "what", "when", "where", "which", "with", "yesterday",
        "today", "week", "month", "ago", "last", "past",
    }
    
    def __init__(self):
        self.tinybird_service = None  # Lazy load to avoid circular imports
        self._computer_activity_sync_cache: Dict[str, float] = {}
        self._computer_activity_sync_locks: Dict[str, asyncio.Lock] = {}
        self._computer_activity_sync_ttl_seconds = int(
            os.environ.get("RITUAL_COMPUTER_ACTIVITY_SYNC_TTL_SECONDS", "120")
        )
    
    def _get_tinybird_service(self):
        """Lazy load Tinybird service."""
        if self.tinybird_service is None:
            try:
                from services.tinybird_service import TinybirdService
                self.tinybird_service = TinybirdService()
            except Exception as e:
                print(f"⚠️ Could not load Tinybird service: {e}")
        return self.tinybird_service
    
    async def _sync_habit_log_to_tinybird(
        self,
        log_id: str,
        habit_id: str,
        habit_name: str,
        user_id: str,
        date: str,
        amount: float,
        duration_seconds: int,
        unit_type: str,
        source: Optional[str] = None,
        notes: Optional[str] = None,
        completed_at: Optional[str] = None,
    ):
        """Sync a habit log to Tinybird for analytics."""
        try:
            tinybird = self._get_tinybird_service()
            if not tinybird:
                print("⚠️ Tinybird service not available, skipping sync")
                return
            
            # Use full ISO timestamp for completed_at (critical for Tinybird deduplication)
            now_iso = completed_at or datetime.now(timezone.utc).isoformat()
            
            log_data = {
                'id': log_id,
                'habit_id': habit_id,
                'habit_name': habit_name,
                'user_id': user_id,
                'date': date,
                'amount': amount,
                'duration': duration_seconds,
                'status': 'completed',
                'notes': notes or 'Auto-synced from Ritual Watcher',
                'source': source or self.COMPUTER_USE_LEGACY_SOURCE,
                'unit': unit_type,
                'unit_type': unit_type,
                'completed_at': now_iso  # Full timestamp for proper deduplication
            }
            result = await tinybird.ingest_habit_log(log_data)
            if result and result.get('success'):
                print(f"📊 Synced to Tinybird: {habit_name} = {amount} {unit_type}")
            else:
                print(f"⚠️ Tinybird sync returned: {result}")
        except Exception as e:
            print(f"⚠️ Failed to sync to Tinybird: {e}")
    
    def _now_ms(self) -> int:
        """Get current time in milliseconds."""
        return int(time.time() * 1000)
    
    def _hash_title(self, title: str) -> str:
        """Hash a window title for privacy."""
        return hashlib.sha256(title.encode('utf-8')).hexdigest()
    
    def _truncate_title(self, title: str, length: int = 80) -> str:
        """Truncate a window title to specified length."""
        if title and len(title) > length:
            return title[:length] + "..."
        return title
    
    # ============================================================
    # DEVICE MANAGEMENT
    # ============================================================
    
    async def register_device(
        self,
        user_id: str,
        device_name: str = "My Mac",
        platform: str = "macos",
        os_version: Optional[str] = None
    ) -> Tuple[str, Dict]:
        """
        Register a new device for the watcher.
        Returns (device_id, initial_state).
        """
        device_id = str(uuid.uuid4())
        now_ms = self._now_ms()
        
        async with get_db_session() as session:
            # Create device
            device = WatcherDeviceDB(
                device_id=device_id,
                user_id=user_id,
                device_name=device_name,
                platform=platform,
                os_version=os_version,
                created_at=now_ms,
                last_seen_at=now_ms
            )
            session.add(device)
            
            # Create initial state
            state = WatcherStateDB(
                device_id=device_id,
                is_enabled=0,
                poll_interval_ms=2000,
                last_seen_ts=now_ms,
                accessibility_status="unknown",
                title_mode="off",
                truncate_length=80,
                excluded_bundle_ids=json.dumps([]),
                sync_analytics=0,
                sync_raw_to_cloud=0,
                updated_at=now_ms
            )
            session.add(state)
            
            await session.commit()
            
            print(f"✅ Registered watcher device: {device_id} for user {user_id}")
            
            return device_id, {
                "device_id": device_id,
                "is_enabled": False,
                "poll_interval_ms": 2000,
                "accessibility_status": "unknown",
                "title_mode": "off",
                "excluded_bundle_ids": []
            }
    
    async def get_device(self, device_id: str, user_id: str) -> Optional[Dict]:
        """Get device info and state."""
        async with get_db_session() as session:
            result = await session.execute(
                select(WatcherDeviceDB, WatcherStateDB)
                .outerjoin(WatcherStateDB, WatcherDeviceDB.device_id == WatcherStateDB.device_id)
                .where(
                    WatcherDeviceDB.device_id == device_id,
                    WatcherDeviceDB.user_id == user_id
                )
            )
            row = result.first()
            
            if not row:
                return None
            
            device, state = row
            
            return {
                "device_id": device.device_id,
                "device_name": device.device_name,
                "platform": device.platform,
                "os_version": device.os_version,
                "created_at": device.created_at,
                "last_seen_at": device.last_seen_at,
                "state": {
                    "is_enabled": bool(state.is_enabled) if state else False,
                    "poll_interval_ms": state.poll_interval_ms if state else 2000,
                    "last_seen_ts": state.last_seen_ts if state else None,
                    "accessibility_status": state.accessibility_status if state else "unknown",
                    "title_mode": state.title_mode if state else "off",
                    "truncate_length": state.truncate_length if state else 80,
                    "excluded_bundle_ids": json.loads(state.excluded_bundle_ids) if state and state.excluded_bundle_ids else [],
                    "sync_analytics": bool(state.sync_analytics) if state else False,
                    "sync_raw_to_cloud": bool(state.sync_raw_to_cloud) if state else False,
                    "afk_timeout_seconds": (state.afk_timeout_seconds if hasattr(state, 'afk_timeout_seconds') and state.afk_timeout_seconds else 900) if state else 900,
                } if state else None
            }
    
    async def get_user_devices(self, user_id: str) -> List[Dict]:
        """Get all devices for a user."""
        async with get_db_session() as session:
            result = await session.execute(
                select(WatcherDeviceDB, WatcherStateDB)
                .outerjoin(WatcherStateDB, WatcherDeviceDB.device_id == WatcherStateDB.device_id)
                .where(WatcherDeviceDB.user_id == user_id)
                .order_by(WatcherDeviceDB.created_at.desc())
            )
            rows = result.all()
            
            devices = []
            for device, state in rows:
                devices.append({
                    "device_id": device.device_id,
                    "device_name": device.device_name,
                    "platform": device.platform,
                    "is_enabled": bool(state.is_enabled) if state else False,
                    "last_seen_ts": state.last_seen_ts if state else None,
                    "accessibility_status": state.accessibility_status if state else "unknown",
                })
            
            return devices
    
    async def update_device_state(
        self,
        device_id: str,
        user_id: str,
        **updates
    ) -> Optional[Dict]:
        """Update device watcher state."""
        async with get_db_session() as session:
            # Verify device belongs to user
            result = await session.execute(
                select(WatcherDeviceDB)
                .where(
                    WatcherDeviceDB.device_id == device_id,
                    WatcherDeviceDB.user_id == user_id
                )
            )
            device = result.scalar_one_or_none()
            
            if not device:
                return None
            
            # Get or create state
            result = await session.execute(
                select(WatcherStateDB)
                .where(WatcherStateDB.device_id == device_id)
            )
            state = result.scalar_one_or_none()
            
            if not state:
                state = WatcherStateDB(
                    device_id=device_id,
                    updated_at=self._now_ms()
                )
                session.add(state)
            
            # Apply updates
            allowed_fields = [
                'is_enabled', 'poll_interval_ms', 'accessibility_status',
                'title_mode', 'truncate_length', 'excluded_bundle_ids',
                'sync_analytics', 'sync_raw_to_cloud', 'afk_timeout_seconds'
            ]
            
            for key, value in updates.items():
                if key in allowed_fields:
                    if key == 'excluded_bundle_ids' and isinstance(value, list):
                        value = json.dumps(value)
                    elif key in ['is_enabled', 'sync_analytics', 'sync_raw_to_cloud']:
                        value = 1 if value else 0
                    setattr(state, key, value)
            
            state.updated_at = self._now_ms()
            
            await session.commit()
            await session.refresh(state)
            
            return {
                "device_id": device_id,
                "is_enabled": bool(state.is_enabled),
                "poll_interval_ms": state.poll_interval_ms,
                "accessibility_status": state.accessibility_status,
                "title_mode": state.title_mode,
                "truncate_length": state.truncate_length,
                "excluded_bundle_ids": json.loads(state.excluded_bundle_ids) if state.excluded_bundle_ids else [],
                "sync_analytics": bool(state.sync_analytics),
                "sync_raw_to_cloud": bool(state.sync_raw_to_cloud),
                "afk_timeout_seconds": state.afk_timeout_seconds if hasattr(state, 'afk_timeout_seconds') and state.afk_timeout_seconds else 900,
            }
    
    async def heartbeat(self, device_id: str, user_id: str) -> bool:
        """Update device heartbeat timestamp."""
        now_ms = self._now_ms()
        
        async with get_db_session() as session:
            # Update device last_seen_at
            result = await session.execute(
                select(WatcherDeviceDB)
                .where(
                    WatcherDeviceDB.device_id == device_id,
                    WatcherDeviceDB.user_id == user_id
                )
            )
            device = result.scalar_one_or_none()
            
            if not device:
                return False
            
            device.last_seen_at = now_ms
            
            # Update state last_seen_ts
            result = await session.execute(
                select(WatcherStateDB)
                .where(WatcherStateDB.device_id == device_id)
            )
            state = result.scalar_one_or_none()
            
            if state:
                state.last_seen_ts = now_ms
            
            await session.commit()
            return True
    
    # ============================================================
    # ACTIVITY EVENTS
    # ============================================================
    
    async def record_activity_event(
        self,
        device_id: str,
        user_id: str,
        app_bundle_id: str,
        app_name: str,
        window_title: Optional[str] = None,
        window_owner_pid: Optional[int] = None,
        is_afk: bool = False,
        ts_start: Optional[int] = None,
        ts_end: Optional[int] = None
    ) -> Optional[int]:
        """
        Record a new activity event.
        Returns the event ID.
        """
        now_ms = self._now_ms()
        ts_start = ts_start or now_ms
        ts_end = ts_end or now_ms
        
        async with get_db_session() as session:
            # Get device state for title_mode
            result = await session.execute(
                select(WatcherStateDB)
                .where(WatcherStateDB.device_id == device_id)
            )
            state = result.scalar_one_or_none()
            
            title_mode = state.title_mode if state else "off"
            truncate_length = state.truncate_length if state else 80
            
            # Process window title based on mode
            processed_title = None
            title_hash = None
            
            if window_title and title_mode != "off":
                if title_mode == "full":
                    processed_title = window_title
                elif title_mode == "truncate":
                    processed_title = self._truncate_title(window_title, truncate_length)
                elif title_mode == "hash":
                    title_hash = self._hash_title(window_title)
            
            # Check for excluded apps
            excluded = []
            if state and state.excluded_bundle_ids:
                excluded = json.loads(state.excluded_bundle_ids)
            
            if app_bundle_id in excluded:
                return None  # Skip excluded apps
            
            event = ActivityEventDB(
                device_id=device_id,
                user_id=user_id,
                ts_start=ts_start,
                ts_end=ts_end,
                app_bundle_id=app_bundle_id,
                app_name=app_name,
                window_title=processed_title,
                window_title_hash=title_hash,
                window_owner_pid=window_owner_pid,
                is_afk=1 if is_afk else 0,
                source="ritual_watcher_v1",
                created_at=now_ms
            )
            session.add(event)
            await session.commit()
            await session.refresh(event)
            
            return event.id
    
    async def update_event_end_time(
        self,
        event_id: int,
        ts_end: int
    ) -> bool:
        """Update the end time of an activity event."""
        async with get_db_session() as session:
            result = await session.execute(
                select(ActivityEventDB)
                .where(ActivityEventDB.id == event_id)
            )
            event = result.scalar_one_or_none()
            
            if not event:
                return False
            
            event.ts_end = ts_end
            await session.commit()
            return True
    
    async def get_recent_events(
        self,
        user_id: str,
        device_id: Optional[str] = None,
        limit: int = 100,
        offset: int = 0
    ) -> List[Dict]:
        """Get recent activity events."""
        async with get_db_session() as session:
            query = select(ActivityEventDB).where(ActivityEventDB.user_id == user_id)
            
            if device_id:
                query = query.where(ActivityEventDB.device_id == device_id)
            
            query = query.order_by(ActivityEventDB.ts_start.desc()).limit(limit).offset(offset)
            
            result = await session.execute(query)
            events = result.scalars().all()
            
            return [
                {
                    "id": e.id,
                    "device_id": e.device_id,
                    "ts_start": e.ts_start,
                    "ts_end": e.ts_end,
                    "duration_ms": e.ts_end - e.ts_start,
                    "app_bundle_id": e.app_bundle_id,
                    "app_name": e.app_name,
                    "window_title": e.window_title,
                    "window_title_hash": e.window_title_hash,
                    "is_afk": bool(e.is_afk),
                }
                for e in events
            ]
    
    async def get_events_for_day(
        self,
        user_id: str,
        day: str,  # YYYY-MM-DD
        device_id: Optional[str] = None,
        timezone: str = "UTC"
    ) -> List[Dict]:
        """Get all activity events for a specific day."""
        # Calculate day boundaries in UTC
        # For simplicity, we use the day string and filter by ts_start
        from datetime import datetime
        
        try:
            day_date = datetime.strptime(day, "%Y-%m-%d")
        except ValueError:
            return []
        
        # Day start/end in milliseconds (UTC approximation)
        day_start_ms = int(day_date.timestamp() * 1000)
        day_end_ms = day_start_ms + (24 * 60 * 60 * 1000)
        
        async with get_db_session() as session:
            query = select(ActivityEventDB).where(
                ActivityEventDB.user_id == user_id,
                ActivityEventDB.ts_start >= day_start_ms,
                ActivityEventDB.ts_start < day_end_ms
            )
            
            if device_id:
                query = query.where(ActivityEventDB.device_id == device_id)
            
            query = query.order_by(ActivityEventDB.ts_start.asc())
            
            result = await session.execute(query)
            events = result.scalars().all()
            
            return [
                {
                    "id": e.id,
                    "ts_start": e.ts_start,
                    "ts_end": e.ts_end,
                    "duration_ms": e.ts_end - e.ts_start,
                    "app_bundle_id": e.app_bundle_id,
                    "app_name": e.app_name,
                    "window_title": e.window_title,
                    "is_afk": bool(e.is_afk),
                }
                for e in events
            ]
    
    # ============================================================
    # DAILY ROLLUPS
    # ============================================================
    
    async def compute_daily_rollup(
        self,
        user_id: str,
        day: str,  # YYYY-MM-DD
        device_id: Optional[str] = None,
        force_recompute: bool = False
    ) -> Dict:
        """
        Compute daily activity rollup from raw events.
        Aggregates by app_bundle_id (and optionally window_title).
        """
        from datetime import datetime
        
        try:
            day_date = datetime.strptime(day, "%Y-%m-%d")
        except ValueError:
            return {"error": "Invalid day format"}
        
        day_start_ms = int(day_date.timestamp() * 1000)
        day_end_ms = day_start_ms + (24 * 60 * 60 * 1000)
        now_ms = self._now_ms()
        
        async with get_db_session() as session:
            # Get user's devices if device_id not specified
            if device_id:
                device_ids = [device_id]
            else:
                result = await session.execute(
                    select(WatcherDeviceDB.device_id)
                    .where(WatcherDeviceDB.user_id == user_id)
                )
                device_ids = [r[0] for r in result.all()]
            
            if not device_ids:
                return {"day": day, "total_active_ms": 0, "apps": []}
            
            # Delete existing rollups if recomputing
            if force_recompute:
                for did in device_ids:
                    await session.execute(
                        delete(DailyActivityRollupDB)
                        .where(
                            DailyActivityRollupDB.user_id == user_id,
                            DailyActivityRollupDB.device_id == did,
                            DailyActivityRollupDB.day == day
                        )
                    )
            
            # Aggregate events by app (and optionally window)
            # Using raw SQL for complex aggregation
            rollups = {}
            
            for did in device_ids:
                # Get state to determine title_mode
                result = await session.execute(
                    select(WatcherStateDB)
                    .where(WatcherStateDB.device_id == did)
                )
                state = result.scalar_one_or_none()
                title_mode = state.title_mode if state else "off"
                
                # Get events for this device/day
                result = await session.execute(
                    select(ActivityEventDB)
                    .where(
                        ActivityEventDB.user_id == user_id,
                        ActivityEventDB.device_id == did,
                        ActivityEventDB.ts_start >= day_start_ms,
                        ActivityEventDB.ts_start < day_end_ms,
                        ActivityEventDB.is_afk == 0  # Only active time
                    )
                )
                events = result.scalars().all()
                
                for event in events:
                    # Create aggregation key
                    if title_mode in ["full", "truncate"]:
                        key = (did, event.app_bundle_id, event.window_title or "")
                    elif title_mode == "hash":
                        key = (did, event.app_bundle_id, event.window_title_hash or "")
                    else:
                        key = (did, event.app_bundle_id, "")
                    
                    # Handle events spanning midnight
                    event_start = max(event.ts_start, day_start_ms)
                    event_end = min(event.ts_end, day_end_ms)
                    duration_ms = max(0, event_end - event_start)
                    
                    if key not in rollups:
                        rollups[key] = {
                            "device_id": did,
                            "app_bundle_id": event.app_bundle_id,
                            "app_name": event.app_name,
                            "window_title": event.window_title if title_mode in ["full", "truncate"] else None,
                            "window_title_hash": event.window_title_hash if title_mode == "hash" else None,
                            "active_ms": 0,
                            "events_count": 0
                        }
                    
                    rollups[key]["active_ms"] += duration_ms
                    rollups[key]["events_count"] += 1
            
            # Upsert rollups
            for key, data in rollups.items():
                # Check if exists
                result = await session.execute(
                    select(DailyActivityRollupDB)
                    .where(
                        DailyActivityRollupDB.user_id == user_id,
                        DailyActivityRollupDB.device_id == data["device_id"],
                        DailyActivityRollupDB.day == day,
                        DailyActivityRollupDB.app_bundle_id == data["app_bundle_id"],
                        DailyActivityRollupDB.window_title == data["window_title"]
                    )
                )
                existing = result.scalar_one_or_none()
                
                if existing:
                    existing.active_ms = data["active_ms"]
                    existing.events_count = data["events_count"]
                    existing.updated_at = now_ms
                else:
                    rollup = DailyActivityRollupDB(
                        day=day,
                        device_id=data["device_id"],
                        user_id=user_id,
                        app_bundle_id=data["app_bundle_id"],
                        app_name=data["app_name"],
                        window_title=data["window_title"],
                        window_title_hash=data["window_title_hash"],
                        active_ms=data["active_ms"],
                        events_count=data["events_count"],
                        created_at=now_ms,
                        updated_at=now_ms
                    )
                    session.add(rollup)
            
            await session.commit()
            
            # Return summary
            total_active_ms = sum(r["active_ms"] for r in rollups.values())
            total_events = sum(r["events_count"] for r in rollups.values())
            
            return {
                "day": day,
                "total_active_ms": total_active_ms,
                "total_events": total_events,
                "apps_count": len(set(r["app_bundle_id"] for r in rollups.values())),
                "rollups_count": len(rollups)
            }
    
    async def get_daily_summary(
        self,
        user_id: str,
        start_date: str,  # YYYY-MM-DD
        end_date: str,  # YYYY-MM-DD
        device_id: Optional[str] = None
    ) -> List[Dict]:
        """Get daily activity summaries for a date range."""
        async with get_db_session() as session:
            query = select(DailyActivityRollupDB).where(
                DailyActivityRollupDB.user_id == user_id,
                DailyActivityRollupDB.day >= start_date,
                DailyActivityRollupDB.day <= end_date
            )
            
            if device_id:
                query = query.where(DailyActivityRollupDB.device_id == device_id)
            
            query = query.order_by(DailyActivityRollupDB.day.desc(), DailyActivityRollupDB.active_ms.desc())
            
            result = await session.execute(query)
            rollups = result.scalars().all()
            
            # Group by day
            days = {}
            for r in rollups:
                if r.day not in days:
                    days[r.day] = {
                        "day": r.day,
                        "total_active_ms": 0,
                        "total_events": 0,
                        "apps": []
                    }
                
                days[r.day]["total_active_ms"] += r.active_ms
                days[r.day]["total_events"] += r.events_count
                days[r.day]["apps"].append({
                    "app_bundle_id": r.app_bundle_id,
                    "app_name": r.app_name,
                    "window_title": r.window_title,
                    "active_ms": r.active_ms,
                    "events_count": r.events_count
                })
            
            return list(days.values())
    
    async def get_top_apps(
        self,
        user_id: str,
        start_date: str,
        end_date: str,
        limit: int = 10,
        device_id: Optional[str] = None
    ) -> List[Dict]:
        """Get top apps by active time for a date range. Reads from LOCAL watcher DB."""
        tinybird_rows = await self._get_computer_activity_pipe_rows(
            user_id=user_id,
            start_date=start_date,
            end_date=end_date,
            output="apps",
            limit=limit,
        )
        if tinybird_rows:
            return [
                {
                    "app_bundle_id": row.get("app_bundle_id"),
                    "app_name": row.get("app_name"),
                    "total_active_ms": int(row.get("total_active_ms", 0) or 0),
                    "total_events": int(row.get("total_events", 0) or 0),
                    "days_used": int(row.get("days_used", 0) or 0),
                    "hours": round((int(row.get("total_active_ms", 0) or 0)) / (1000 * 60 * 60), 2),
                    "source": "tinybird",
                }
                for row in tinybird_rows
            ]

        import sqlite3
        import os
        
        db_path = self._get_local_watcher_db_path()
        
        if not os.path.exists(db_path):
            print(f"⚠️ Local watcher database not found at: {db_path}")
            return []
        
        try:
            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()
            
            # Calculate date boundaries in milliseconds
            start_date_obj = datetime.strptime(start_date, "%Y-%m-%d")
            end_date_obj = datetime.strptime(end_date, "%Y-%m-%d")
            start_ms = int(start_date_obj.timestamp() * 1000)
            end_ms = int((end_date_obj + timedelta(days=1)).timestamp() * 1000)
            
            # Query top apps from local DB
            cursor.execute("""
                SELECT 
                    app_bundle_id,
                    app_name,
                    SUM(CASE WHEN ts_end > ts_start THEN ts_end - ts_start ELSE 0 END) as total_active_ms,
                    COUNT(*) as total_events
                FROM activity_events
                WHERE ts_start >= ? AND ts_start < ?
                  AND COALESCE(is_afk, 0) = 0
                GROUP BY app_bundle_id, app_name
                ORDER BY total_active_ms DESC
                LIMIT ?
            """, (start_ms, end_ms, limit))
            
            rows = cursor.fetchall()
            conn.close()
            
            print(f"📊 Local watcher top apps {start_date} to {end_date}: {len(rows)} apps")
            
            return [
                {
                    "app_bundle_id": r[0],
                    "app_name": r[1],
                    "total_active_ms": r[2],
                    "total_events": r[3],
                    "hours": round(r[2] / (1000 * 60 * 60), 2)
                }
                for r in rows
            ]
        except Exception as e:
            print(f"❌ Error reading top apps from local DB: {e}")
            return []
    
    # ============================================================
    # BROWSER/DOMAIN ANALYTICS (V2)
    # ============================================================
    
    async def get_top_domains(
        self,
        user_id: str,
        start_date: str,
        end_date: str,
        limit: int = 10,
        device_id: Optional[str] = None
    ) -> List[Dict]:
        """Get top domains by active time for a date range. Reads from LOCAL watcher DB."""
        tinybird_rows = await self._get_computer_activity_pipe_rows(
            user_id=user_id,
            start_date=start_date,
            end_date=end_date,
            output="domains",
            limit=limit,
        )
        if tinybird_rows:
            return [
                {
                    "domain": row.get("browser_domain"),
                    "total_active_ms": int(row.get("total_active_ms", 0) or 0),
                    "total_events": int(row.get("total_events", 0) or 0),
                    "days_used": int(row.get("days_used", 0) or 0),
                    "hours": round((int(row.get("total_active_ms", 0) or 0)) / (1000 * 60 * 60), 2),
                    "minutes": round((int(row.get("total_active_ms", 0) or 0)) / (1000 * 60), 1),
                    "source": "tinybird",
                }
                for row in tinybird_rows
            ]

        import sqlite3
        import os
        
        db_path = self._get_local_watcher_db_path()
        
        if not os.path.exists(db_path):
            print(f"⚠️ Local watcher database not found at: {db_path}")
            return []
        
        try:
            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()
            
            # Calculate date boundaries in milliseconds
            start_date_obj = datetime.strptime(start_date, "%Y-%m-%d")
            end_date_obj = datetime.strptime(end_date, "%Y-%m-%d")
            start_ms = int(start_date_obj.timestamp() * 1000)
            end_ms = int((end_date_obj + timedelta(days=1)).timestamp() * 1000)
            
            # Query top domains from local DB
            cursor.execute("""
                SELECT 
                    browser_domain,
                    SUM(CASE WHEN ts_end > ts_start THEN ts_end - ts_start ELSE 0 END) as total_active_ms,
                    COUNT(*) as total_events
                FROM activity_events
                WHERE ts_start >= ? AND ts_start < ?
                  AND COALESCE(is_afk, 0) = 0
                  AND browser_domain IS NOT NULL
                  AND browser_domain != ''
                GROUP BY browser_domain
                ORDER BY total_active_ms DESC
                LIMIT ?
            """, (start_ms, end_ms, limit))
            
            rows = cursor.fetchall()
            conn.close()
            
            print(f"📊 Local watcher top domains {start_date} to {end_date}: {len(rows)} domains")
            
            return [
                {
                    "domain": r[0],
                    "total_active_ms": r[1],
                    "total_events": r[2],
                    "hours": round(r[1] / (1000 * 60 * 60), 2),
                    "minutes": round(r[1] / (1000 * 60), 1)
                }
                for r in rows
            ]
        except Exception as e:
            print(f"❌ Error reading top domains from local DB: {e}")
            return []
    
    async def get_domain_daily_breakdown(
        self,
        user_id: str,
        domain: str,
        start_date: str,
        end_date: str,
        device_id: Optional[str] = None
    ) -> List[Dict]:
        """Get daily breakdown for a specific domain."""
        async with get_db_session() as session:
            query = """
                SELECT 
                    day,
                    SUM(active_ms) as total_active_ms,
                    SUM(events_count) as total_events
                FROM daily_activity_rollups
                WHERE user_id = :user_id
                  AND browser_domain = :domain
                  AND day >= :start_date
                  AND day <= :end_date
            """
            
            params = {
                "user_id": user_id,
                "domain": domain,
                "start_date": start_date,
                "end_date": end_date
            }
            
            if device_id:
                query += " AND device_id = :device_id"
                params["device_id"] = device_id
            
            query += " GROUP BY day ORDER BY day ASC"
            
            result = await session.execute(text(query), params)
            rows = result.fetchall()
            
            return [
                {
                    "day": r[0],
                    "active_ms": r[1],
                    "hours": round(r[1] / (1000 * 60 * 60), 2),
                    "events_count": r[2]
                }
                for r in rows
            ]
    
    async def get_browser_summary(
        self,
        user_id: str,
        start_date: str,
        end_date: str,
        device_id: Optional[str] = None
    ) -> Dict:
        """Get overall browser usage summary including top domains."""
        # Known browser bundle IDs
        browser_ids = [
            'com.apple.Safari',
            'com.google.Chrome',
            'org.mozilla.firefox',
            'com.brave.Browser',
            'com.microsoft.edgemac',
            'company.thebrowser.Browser',  # Arc
        ]
        
        async with get_db_session() as session:
            # Total browser time
            bundle_placeholders = ','.join([f"'{b}'" for b in browser_ids])
            query = f"""
                SELECT 
                    SUM(active_ms) as total_browser_ms,
                    COUNT(DISTINCT day) as days_tracked
                FROM daily_activity_rollups
                WHERE user_id = :user_id
                  AND day >= :start_date
                  AND day <= :end_date
                  AND app_bundle_id IN ({bundle_placeholders})
            """
            
            params = {
                "user_id": user_id,
                "start_date": start_date,
                "end_date": end_date
            }
            
            if device_id:
                query += " AND device_id = :device_id"
                params["device_id"] = device_id
            
            result = await session.execute(text(query), params)
            row = result.fetchone()
            
            total_browser_ms = row[0] or 0
            days_tracked = row[1] or 0
            
            # Get top domains
            top_domains = await self.get_top_domains(
                user_id, start_date, end_date, limit=10, device_id=device_id
            )
            
            return {
                "total_browser_ms": total_browser_ms,
                "total_browser_hours": round(total_browser_ms / (1000 * 60 * 60), 2),
                "days_tracked": days_tracked,
                "avg_daily_hours": round(total_browser_ms / (1000 * 60 * 60) / max(days_tracked, 1), 2),
                "top_domains": top_domains,
                "unique_domains": len(top_domains)
            }
    
    # ============================================================
    # AFK ANALYTICS (V2)
    # ============================================================
    
    async def get_afk_summary(
        self,
        user_id: str,
        start_date: str,
        end_date: str,
        device_id: Optional[str] = None
    ) -> Dict:
        """Get AFK vs active time summary."""
        # Get from local watcher DB if available
        try:
            summary = self._get_afk_summary_from_local_db(start_date, end_date)
            if summary:
                return summary
        except Exception as e:
            print(f"⚠️ Could not read AFK data from local DB: {e}")
        
        # Fallback to cloud data
        async with get_db_session() as session:
            query = """
                SELECT 
                    SUM(CASE WHEN is_afk = 0 THEN active_ms ELSE 0 END) as active_ms,
                    SUM(CASE WHEN is_afk = 1 THEN active_ms ELSE 0 END) as afk_ms,
                    SUM(active_ms) as total_ms
                FROM daily_activity_rollups
                WHERE user_id = :user_id
                  AND day >= :start_date
                  AND day <= :end_date
            """
            
            params = {
                "user_id": user_id,
                "start_date": start_date,
                "end_date": end_date
            }
            
            if device_id:
                query += " AND device_id = :device_id"
                params["device_id"] = device_id
            
            result = await session.execute(text(query), params)
            row = result.fetchone()
            
            active_ms = row[0] or 0
            afk_ms = row[1] or 0
            total_ms = row[2] or 0
            
            return {
                "active_ms": active_ms,
                "active_hours": round(active_ms / (1000 * 60 * 60), 2),
                "afk_ms": afk_ms,
                "afk_hours": round(afk_ms / (1000 * 60 * 60), 2),
                "total_ms": total_ms,
                "total_hours": round(total_ms / (1000 * 60 * 60), 2),
                "active_percentage": round(active_ms / max(total_ms, 1) * 100, 1)
            }
    
    def _get_afk_summary_from_local_db(self, start_date: str, end_date: str) -> Optional[Dict]:
        """Read AFK summary from local watcher database."""
        import sqlite3
        
        db_path = self._get_local_watcher_db_path()
        if not os.path.exists(db_path):
            return None
        
        try:
            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()
            
            # Convert dates to timestamps
            start_dt = datetime.strptime(start_date, "%Y-%m-%d")
            end_dt = datetime.strptime(end_date, "%Y-%m-%d") + timedelta(days=1)
            start_ms = int(start_dt.timestamp() * 1000)
            end_ms = int(end_dt.timestamp() * 1000)
            
            # Get active time (non-AFK events)
            cursor.execute("""
                SELECT SUM(ts_end - ts_start) 
                FROM activity_events 
                WHERE ts_start >= ? AND ts_start < ? AND is_afk = 0
            """, (start_ms, end_ms))
            active_ms = cursor.fetchone()[0] or 0
            
            # Get AFK time
            cursor.execute("""
                SELECT SUM(ts_end - ts_start) 
                FROM afk_events 
                WHERE ts_start >= ? AND ts_start < ? AND status = 'afk'
            """, (start_ms, end_ms))
            afk_ms = cursor.fetchone()[0] or 0
            
            conn.close()
            
            total_ms = active_ms + afk_ms
            
            return {
                "active_ms": active_ms,
                "active_hours": round(active_ms / (1000 * 60 * 60), 2),
                "afk_ms": afk_ms,
                "afk_hours": round(afk_ms / (1000 * 60 * 60), 2),
                "total_ms": total_ms,
                "total_hours": round(total_ms / (1000 * 60 * 60), 2),
                "active_percentage": round(active_ms / max(total_ms, 1) * 100, 1)
            }
        except Exception as e:
            print(f"❌ Error reading AFK data: {e}")
            return None
    
    # ============================================================
    # APP EXCLUSIONS
    # ============================================================
    
    async def add_app_exclusion(
        self,
        user_id: str,
        bundle_id: str,
        app_name: Optional[str] = None,
        reason: str = "user_preference"
    ) -> bool:
        """Add an app to the exclusion list."""
        async with get_db_session() as session:
            # Check if already exists
            result = await session.execute(
                select(WatcherAppExclusionDB)
                .where(
                    WatcherAppExclusionDB.user_id == user_id,
                    WatcherAppExclusionDB.bundle_id == bundle_id
                )
            )
            if result.scalar_one_or_none():
                return True  # Already excluded
            
            exclusion = WatcherAppExclusionDB(
                user_id=user_id,
                bundle_id=bundle_id,
                app_name=app_name,
                reason=reason,
                created_at=self._now_ms()
            )
            session.add(exclusion)
            await session.commit()
            return True
    
    async def remove_app_exclusion(
        self,
        user_id: str,
        bundle_id: str
    ) -> bool:
        """Remove an app from the exclusion list."""
        async with get_db_session() as session:
            result = await session.execute(
                delete(WatcherAppExclusionDB)
                .where(
                    WatcherAppExclusionDB.user_id == user_id,
                    WatcherAppExclusionDB.bundle_id == bundle_id
                )
            )
            await session.commit()
            return result.rowcount > 0
    
    async def get_app_exclusions(self, user_id: str) -> List[Dict]:
        """Get all app exclusions for a user."""
        async with get_db_session() as session:
            result = await session.execute(
                select(WatcherAppExclusionDB)
                .where(WatcherAppExclusionDB.user_id == user_id)
            )
            exclusions = result.scalars().all()
            
            return [
                {
                    "bundle_id": e.bundle_id,
                    "app_name": e.app_name,
                    "reason": e.reason
                }
                for e in exclusions
            ]
    
    def get_suggested_exclusions(self) -> List[Dict]:
        """Get suggested sensitive apps for exclusion."""
        return self.DEFAULT_SENSITIVE_APPS

    def _escape_tinybird_literal(self, value: str) -> str:
        return value.replace("'", "''")

    def _build_computer_activity_sync_cache_key(self, user_id: str, start_date: str, end_date: str) -> str:
        return f"{user_id}:{start_date}:{end_date}"

    def _get_computer_activity_daily_rows_from_local_db(
        self,
        start_date: str,
        end_date: str,
    ) -> List[Dict[str, Any]]:
        """
        Aggregate local watcher events into computer_activity_daily rows.
        """
        import sqlite3

        db_path = self._get_local_watcher_db_path()
        if not os.path.exists(db_path):
            return []

        try:
            start_dt = datetime.strptime(start_date, "%Y-%m-%d")
            end_dt = datetime.strptime(end_date, "%Y-%m-%d")
            start_ms = int(start_dt.timestamp() * 1000)
            end_ms = int((end_dt + timedelta(days=1)).timestamp() * 1000)

            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()

            cursor.execute(
                """
                SELECT
                    date(ts_start / 1000, 'unixepoch', 'localtime') AS day,
                    COALESCE(app_bundle_id, 'unknown') AS app_bundle_id,
                    COALESCE(app_name, 'Unknown') AS app_name,
                    COALESCE(browser_domain, '') AS browser_domain,
                    SUM(CASE WHEN COALESCE(is_afk, 0) = 0 AND ts_end > ts_start THEN ts_end - ts_start ELSE 0 END) AS active_ms,
                    SUM(CASE WHEN COALESCE(is_afk, 0) = 1 AND ts_end > ts_start THEN ts_end - ts_start ELSE 0 END) AS afk_ms,
                    COUNT(*) AS events_count,
                    MIN(ts_start) AS first_start_ms,
                    MAX(ts_end) AS last_end_ms
                FROM activity_events
                WHERE ts_start >= ? AND ts_start < ?
                GROUP BY day, app_bundle_id, app_name, browser_domain
                HAVING active_ms > 0 OR afk_ms > 0
                ORDER BY day ASC
                """,
                (start_ms, end_ms),
            )

            rows = cursor.fetchall()
            conn.close()

            return [
                {
                    "day": row[0],
                    "app_bundle_id": row[1] or "unknown",
                    "app_name": row[2] or "Unknown",
                    "browser_domain": row[3] or "",
                    "active_ms": int(row[4] or 0),
                    "afk_ms": int(row[5] or 0),
                    "events_count": int(row[6] or 0),
                    "first_start_ms": int(row[7]) if row[7] is not None else None,
                    "last_end_ms": int(row[8]) if row[8] is not None else None,
                }
                for row in rows
            ]
        except Exception as e:
            print(f"⚠️ Failed local computer_activity_daily aggregation: {e}")
            return []

    async def _sync_computer_activity_range_to_tinybird(
        self,
        user_id: str,
        start_date: str,
        end_date: str,
    ) -> Dict[str, Any]:
        """
        Refresh computer_activity_daily rows in Tinybird for the selected date range.
        """
        cache_key = self._build_computer_activity_sync_cache_key(user_id, start_date, end_date)
        now_epoch = time.time()
        last_sync = self._computer_activity_sync_cache.get(cache_key)
        if last_sync and (now_epoch - last_sync) < self._computer_activity_sync_ttl_seconds:
            return {"success": True, "synced_rows": 0, "cached": True}

        lock = self._computer_activity_sync_locks.setdefault(cache_key, asyncio.Lock())
        async with lock:
            now_epoch = time.time()
            last_sync = self._computer_activity_sync_cache.get(cache_key)
            if last_sync and (now_epoch - last_sync) < self._computer_activity_sync_ttl_seconds:
                return {"success": True, "synced_rows": 0, "cached": True}

            tinybird = self._get_tinybird_service()
            if not tinybird:
                return {"success": False, "error": "Tinybird service unavailable"}

            local_rows = self._get_computer_activity_daily_rows_from_local_db(start_date, end_date)
            now_utc = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

            delete_condition = (
                f"user_id = '{self._escape_tinybird_literal(user_id)}' "
                f"AND day >= toDate('{self._escape_tinybird_literal(start_date)}') "
                f"AND day <= toDate('{self._escape_tinybird_literal(end_date)}')"
            )
            delete_result = await tinybird.delete_by_condition(
                "computer_activity_daily",
                delete_condition,
                wait_for_completion=True,
                timeout_seconds=90.0,
                poll_interval_seconds=0.5,
            )
            if not delete_result.get("success"):
                return {
                    "success": False,
                    "error": delete_result.get("error", "Tinybird delete failed"),
                    "synced_rows": 0,
                }

            if not local_rows:
                self._computer_activity_sync_cache[cache_key] = now_epoch
                return {"success": True, "synced_rows": 0, "cached": False}

            events = [
                {
                    "user_id": user_id,
                    "device_id": "local",
                    "day": row["day"],
                    "app_bundle_id": row["app_bundle_id"],
                    "app_name": row["app_name"],
                    "active_ms": row["active_ms"],
                    "afk_ms": row["afk_ms"],
                    "events_count": row["events_count"],
                    "title_hash": "none",
                    "browser_domain": row["browser_domain"],
                    "first_start_ms": row["first_start_ms"],
                    "last_end_ms": row["last_end_ms"],
                    "created_at": now_utc,
                }
                for row in local_rows
            ]

            chunk_size = 500
            synced_rows = 0
            for i in range(0, len(events), chunk_size):
                chunk = events[i:i + chunk_size]
                ingest_result = await tinybird.ingest_events("computer_activity_daily", chunk)
                if not ingest_result.get("success"):
                    return {
                        "success": False,
                        "error": ingest_result.get("error", "Tinybird ingest failed"),
                        "synced_rows": synced_rows,
                    }
                synced_rows += len(chunk)

            self._computer_activity_sync_cache[cache_key] = now_epoch
            return {"success": True, "synced_rows": synced_rows, "cached": False}

    async def _query_computer_activity_summary_pipe(
        self,
        user_id: str,
        start_date: str,
        end_date: str,
        output: str,
        limit: int = 10,
        kind: Optional[str] = None,
        key: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        tinybird = self._get_tinybird_service()
        if not tinybird:
            return []

        params: Dict[str, Any] = {
            "user_id": user_id,
            "start_date": start_date,
            "end_date": end_date,
            "output": output,
            "limit": max(1, min(int(limit or 10), 100)),
        }
        if kind:
            params["kind"] = kind
        if key:
            params["key"] = key

        try:
            result = await tinybird.query_pipe("computer_activity_summary", params)
            return result.get("data") or []
        except Exception as e:
            print(f"⚠️ Tinybird computer_activity_summary query failed ({output}): {e}")
            return []

    async def _get_computer_activity_pipe_rows(
        self,
        user_id: str,
        start_date: str,
        end_date: str,
        output: str,
        limit: int = 10,
        kind: Optional[str] = None,
        key: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        rows = await self._query_computer_activity_summary_pipe(
            user_id=user_id,
            start_date=start_date,
            end_date=end_date,
            output=output,
            limit=limit,
            kind=kind,
            key=key,
        )
        if rows:
            return rows

        sync_result = await self._sync_computer_activity_range_to_tinybird(
            user_id=user_id,
            start_date=start_date,
            end_date=end_date,
        )
        if not sync_result.get("success"):
            print(f"⚠️ Computer activity Tinybird sync unavailable: {sync_result.get('error')}")
            return rows

        # Tinybird writes are near-real-time but not strictly synchronous for reads.
        # Retry briefly before falling back to local DB to reduce mixed-source responses.
        for attempt in range(4):
            refreshed_rows = await self._query_computer_activity_summary_pipe(
                user_id=user_id,
                start_date=start_date,
                end_date=end_date,
                output=output,
                limit=limit,
                kind=kind,
                key=key,
            )
            if refreshed_rows:
                return refreshed_rows
            if attempt < 3:
                await asyncio.sleep(0.25 * (attempt + 1))

        return []
    
    # ============================================================
    # COMPUTER ACTIVITY STATS (for Dashboard/Analytics)
    # Now reads directly from LOCAL watcher database
    # ============================================================
    
    async def get_computer_time_summary(
        self,
        user_id: str,
        start_date: str,  # YYYY-MM-DD
        end_date: str,    # YYYY-MM-DD
        device_id: Optional[str] = None
    ) -> Dict:
        """
        Get total computer time summary for a date range.
        Reads directly from LOCAL watcher SQLite database.
        """
        tinybird_rows = await self._get_computer_activity_pipe_rows(
            user_id=user_id,
            start_date=start_date,
            end_date=end_date,
            output="summary",
        )
        if tinybird_rows:
            row = tinybird_rows[0]
            total_active_ms = int(row.get("total_active_ms", 0) or 0)
            total_events = int(row.get("total_events", 0) or 0)
            days_tracked = int(row.get("days_tracked", 0) or 0)
            unique_apps = int(row.get("unique_apps", 0) or 0)
            avg_daily_ms = float(row.get("avg_daily_ms", 0) or 0)

            return {
                "total_active_ms": total_active_ms,
                "total_hours": round(total_active_ms / (1000 * 60 * 60), 2),
                "total_events": total_events,
                "days_tracked": days_tracked,
                "unique_apps": unique_apps,
                "unique_domains": int(row.get("unique_domains", 0) or 0),
                "total_afk_ms": int(row.get("total_afk_ms", 0) or 0),
                "avg_daily_hours": round(avg_daily_ms / (1000 * 60 * 60), 2),
                "source": "tinybird",
            }

        import sqlite3
        import os
        
        db_path = self._get_local_watcher_db_path()
        
        if not os.path.exists(db_path):
            print(f"⚠️ Local watcher database not found at: {db_path}")
            return {
                "total_active_ms": 0,
                "total_hours": 0,
                "total_events": 0,
                "days_tracked": 0,
                "unique_apps": 0,
                "avg_daily_hours": 0
            }
        
        try:
            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()
            
            # Calculate date boundaries in milliseconds
            start_date_obj = datetime.strptime(start_date, "%Y-%m-%d")
            end_date_obj = datetime.strptime(end_date, "%Y-%m-%d")
            start_ms = int(start_date_obj.timestamp() * 1000)
            end_ms = int((end_date_obj + timedelta(days=1)).timestamp() * 1000)
            
            # Query summary from local DB
            cursor.execute("""
                SELECT 
                    SUM(CASE WHEN COALESCE(is_afk, 0) = 0 AND ts_end > ts_start THEN ts_end - ts_start ELSE 0 END) as total_active_ms,
                    COUNT(*) as total_events,
                    COUNT(DISTINCT date(ts_start/1000, 'unixepoch', 'localtime')) as days_tracked,
                    COUNT(DISTINCT app_bundle_id) as unique_apps
                FROM activity_events
                WHERE ts_start >= ? AND ts_start < ?
            """, (start_ms, end_ms))
            
            row = cursor.fetchone()
            conn.close()
            
            if not row or not row[0]:
                return {
                    "total_active_ms": 0,
                    "total_hours": 0,
                    "total_events": 0,
                    "days_tracked": 0,
                    "unique_apps": 0,
                    "avg_daily_hours": 0
                }
            
            total_active_ms = row[0] or 0
            total_events = row[1] or 0
            days_tracked = row[2] or 0
            unique_apps = row[3] or 0
            
            total_hours = round(total_active_ms / (1000 * 60 * 60), 2)
            avg_daily_hours = round(total_hours / max(days_tracked, 1), 2)
            
            print(f"📊 Local watcher summary {start_date} to {end_date}: {total_hours}h across {days_tracked} days, {unique_apps} apps")
            
            return {
                "total_active_ms": total_active_ms,
                "total_hours": total_hours,
                "total_events": total_events,
                "days_tracked": days_tracked,
                "unique_apps": unique_apps,
                "avg_daily_hours": avg_daily_hours
            }
        except Exception as e:
            print(f"❌ Error reading computer time summary from local DB: {e}")
            return {
                "total_active_ms": 0,
                "total_hours": 0,
                "total_events": 0,
                "days_tracked": 0,
                "unique_apps": 0,
                "avg_daily_hours": 0
            }
    
    async def get_daily_computer_time(
        self,
        user_id: str,
        start_date: str,
        end_date: str,
        device_id: Optional[str] = None
    ) -> List[Dict]:
        """
        Get daily computer time for charting.
        Reads directly from LOCAL watcher SQLite database.
        Returns list of {day, active_hours, events_count, apps_count}.
        """
        tinybird_rows = await self._get_computer_activity_pipe_rows(
            user_id=user_id,
            start_date=start_date,
            end_date=end_date,
            output="daily",
        )
        if tinybird_rows:
            return [
                {
                    "day": row.get("day"),
                    "active_hours": round((int(row.get("total_active_ms", 0) or 0)) / (1000 * 60 * 60), 2),
                    "active_ms": int(row.get("total_active_ms", 0) or 0),
                    "afk_ms": int(row.get("total_afk_ms", 0) or 0),
                    "events_count": int(row.get("total_events", 0) or 0),
                    "apps_count": int(row.get("unique_apps", 0) or 0),
                    "domains_count": int(row.get("unique_domains", 0) or 0),
                    "source": "tinybird",
                }
                for row in tinybird_rows
            ]

        import sqlite3
        import os
        
        db_path = self._get_local_watcher_db_path()
        
        if not os.path.exists(db_path):
            print(f"⚠️ Local watcher database not found at: {db_path}")
            return []
        
        try:
            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()
            
            # Calculate date boundaries in milliseconds
            start_date_obj = datetime.strptime(start_date, "%Y-%m-%d")
            end_date_obj = datetime.strptime(end_date, "%Y-%m-%d")
            start_ms = int(start_date_obj.timestamp() * 1000)
            end_ms = int((end_date_obj + timedelta(days=1)).timestamp() * 1000)
            
            # Query daily stats from local DB
            cursor.execute("""
                SELECT 
                    date(ts_start/1000, 'unixepoch', 'localtime') as day,
                    SUM(CASE WHEN COALESCE(is_afk, 0) = 0 AND ts_end > ts_start THEN ts_end - ts_start ELSE 0 END) as total_active_ms,
                    COUNT(*) as total_events,
                    COUNT(DISTINCT app_bundle_id) as unique_apps
                FROM activity_events
                WHERE ts_start >= ? AND ts_start < ?
                GROUP BY day
                ORDER BY day ASC
            """, (start_ms, end_ms))
            
            rows = cursor.fetchall()
            conn.close()
            
            print(f"📊 Local watcher daily data {start_date} to {end_date}: {len(rows)} days")
            
            return [
                {
                    "day": r[0],
                    "active_hours": round((r[1] or 0) / (1000 * 60 * 60), 2),
                    "active_ms": r[1] or 0,
                    "events_count": r[2] or 0,
                    "apps_count": r[3] or 0
                }
                for r in rows
            ]
        except Exception as e:
            print(f"❌ Error reading daily computer time from local DB: {e}")
            return []

    async def get_usage_daily_breakdown(
        self,
        user_id: str,
        kind: str,
        key: str,
        start_date: str,
        end_date: str,
        device_id: Optional[str] = None
    ) -> List[Dict]:
        """
        Get daily usage breakdown for a specific app or website.
        Reads directly from LOCAL watcher SQLite database.
        Returns list of {day, active_ms, events_count}.
        """
        tinybird_rows = await self._get_computer_activity_pipe_rows(
            user_id=user_id,
            start_date=start_date,
            end_date=end_date,
            output="breakdown",
            kind=kind,
            key=key,
            limit=400,
        )
        if tinybird_rows:
            return [
                {
                    "day": row.get("day"),
                    "active_ms": int(row.get("active_ms", 0) or 0),
                    "events_count": int(row.get("events_count", 0) or 0),
                    "first_start_ms": int(row.get("first_start_ms")) if row.get("first_start_ms") is not None else None,
                    "last_end_ms": int(row.get("last_end_ms")) if row.get("last_end_ms") is not None else None,
                    "source": "tinybird",
                }
                for row in tinybird_rows
            ]

        import sqlite3
        import os
        
        db_path = self._get_local_watcher_db_path()
        
        if not os.path.exists(db_path):
            print(f"⚠️ Local watcher database not found at: {db_path}")
            return []
        
        try:
            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()
            
            # Calculate date boundaries in milliseconds
            start_date_obj = datetime.strptime(start_date, "%Y-%m-%d")
            end_date_obj = datetime.strptime(end_date, "%Y-%m-%d")
            start_ms = int(start_date_obj.timestamp() * 1000)
            end_ms = int((end_date_obj + timedelta(days=1)).timestamp() * 1000)
            
            if kind == "app":
                cursor.execute("""
                    SELECT ts_start, ts_end, COALESCE(is_afk, 0) as is_afk
                    FROM activity_events
                    WHERE ts_start >= ? AND ts_start < ?
                      AND (app_bundle_id = ? OR app_name = ?)
                """, (start_ms, end_ms, key, key))
            else:
                cursor.execute("""
                    SELECT ts_start, ts_end, COALESCE(is_afk, 0) as is_afk
                    FROM activity_events
                    WHERE ts_start >= ? AND ts_start < ?
                      AND browser_domain = ?
                """, (start_ms, end_ms, key))
            
            rows = cursor.fetchall()
            conn.close()
            
            buckets: Dict[str, Dict[str, Any]] = {}
            
            for ts_start, ts_end, is_afk in rows:
                if is_afk:
                    continue
                if ts_end <= ts_start:
                    continue
                
                day_key = datetime.fromtimestamp(ts_start / 1000).strftime("%Y-%m-%d")
                
                if day_key not in buckets:
                    buckets[day_key] = {
                        "intervals": [],
                        "events_count": 0
                    }
                
                buckets[day_key]["intervals"].append((ts_start, ts_end))
                buckets[day_key]["events_count"] += 1
            
            results = []
            for day_key in sorted(buckets.keys()):
                intervals = buckets[day_key]["intervals"]
                merged = self._merge_time_intervals(intervals)
                active_ms = sum(end - start for start, end in merged)
                first_start_ms = merged[0][0] if merged else None
                last_end_ms = merged[-1][1] if merged else None
                
                results.append({
                    "day": day_key,
                    "active_ms": active_ms,
                    "events_count": buckets[day_key]["events_count"],
                    "first_start_ms": first_start_ms,
                    "last_end_ms": last_end_ms
                })
            
            print(f"📊 Local watcher breakdown {kind} {key} {start_date} to {end_date}: {len(results)} days")
            
            return results
        except Exception as e:
            print(f"❌ Error reading usage breakdown from local DB: {e}")
            return []

    # ============================================================
    # LOCAL SCREEN SEARCH (for AI chat on-demand retrieval)
    # ============================================================

    def _table_exists(self, cursor, table_name: str) -> bool:
        cursor.execute(
            """
            SELECT 1
            FROM sqlite_master
            WHERE type = 'table' AND name = ?
            LIMIT 1
            """,
            (table_name,),
        )
        return cursor.fetchone() is not None

    def _extract_search_tokens(self, query: str) -> List[str]:
        normalized = re.sub(r"[^a-z0-9.]+", " ", (query or "").lower())
        tokens: List[str] = []
        seen = set()
        for token in normalized.split():
            if len(token) < 3 or token in self.SCREEN_SEARCH_STOP_WORDS:
                continue
            if token in seen:
                continue
            seen.add(token)
            tokens.append(token)
        return tokens

    def _is_fts_syntax_error(self, exc: Exception) -> bool:
        message = str(exc).lower()
        return (
            "fts5" in message
            or "match" in message
            or "syntax error" in message
            or "malformed" in message
            or "unterminated" in message
        )

    def _escape_fts_phrase(self, query: str) -> str:
        cleaned = re.sub(r"[^a-zA-Z0-9\s]+", " ", query or "").strip()
        if not cleaned:
            return ""
        phrase = " ".join(cleaned.split())
        if not phrase:
            return ""
        escaped_phrase = phrase.replace('"', '""')
        return f"\"{escaped_phrase}\""

    def _score_lexical_match(self, haystack: str, tokens: List[str]) -> float:
        if not tokens:
            return 0.0
        hits = sum(1 for token in tokens if token in haystack)
        return hits / max(len(tokens), 1)

    def _get_local_hybrid_bridge_url(self) -> str:
        return os.environ.get(
            "RITUAL_LOCAL_SEARCH_BRIDGE_URL",
            "http://127.0.0.1:3031/v1/hybrid-search",
        )

    def _get_local_hybrid_bridge_token_path(self) -> str:
        configured_path = os.environ.get("RITUAL_LOCAL_SEARCH_BRIDGE_TOKEN_PATH")
        if configured_path and configured_path.strip():
            return configured_path.strip()

        home = os.environ.get("HOME") or str(Path.home())
        return os.path.join(home, ".ritual", "local_search_bridge.token")

    def _get_local_hybrid_bridge_token(self) -> Optional[str]:
        token_from_env = os.environ.get("RITUAL_LOCAL_SEARCH_BRIDGE_TOKEN")
        if token_from_env and token_from_env.strip():
            return token_from_env.strip()

        token_path = self._get_local_hybrid_bridge_token_path()
        try:
            with open(token_path, "r", encoding="utf-8") as token_file:
                token_from_file = token_file.read().strip()
        except Exception:
            return None

        return token_from_file or None

    async def _search_screen_via_hybrid_bridge(
        self,
        query: str,
        days_back: int,
        limit: int,
    ) -> Optional[Dict[str, Any]]:
        bridge_url = self._get_local_hybrid_bridge_url()
        bridge_token = self._get_local_hybrid_bridge_token()
        if not bridge_token:
            print("⚠️ Hybrid bridge token unavailable; skipping bridge call.")
            return None

        payload = {
            "query": query,
            "days_back": days_back,
            "limit": limit,
            "min_relevance": 0.3,
            "fts_weight": 0.3,
            "vector_weight": 0.7,
        }
        headers = {"X-Ritual-Bridge-Token": bridge_token}

        try:
            async with httpx.AsyncClient(timeout=4.0) as client:
                response = await client.post(bridge_url, json=payload, headers=headers)
        except Exception as e:
            print(f"⚠️ Hybrid bridge unavailable ({bridge_url}): {e}")
            return None

        if response.status_code == 401:
            print("⚠️ Hybrid bridge authentication failed (token mismatch).")
            return None

        if response.status_code != 200:
            print(
                f"⚠️ Hybrid bridge returned {response.status_code}: "
                f"{response.text[:200]}"
            )
            return None

        try:
            data = response.json()
        except Exception as e:
            print(f"⚠️ Hybrid bridge invalid JSON: {e}")
            return None

        if not isinstance(data, dict):
            return None
        if not data.get("success"):
            err = data.get("error")
            print(f"⚠️ Hybrid bridge reported failure: {err}")
            return None

        raw_results = data.get("results")
        if not isinstance(raw_results, list):
            return None

        normalized_results: List[Dict[str, Any]] = []
        for item in raw_results:
            if not isinstance(item, dict):
                continue
            frame_id = item.get("frame_id")
            timestamp = item.get("timestamp")
            app_name = item.get("app_name")
            if frame_id is None or timestamp is None or app_name is None:
                continue
            try:
                normalized_results.append(
                    {
                        "frame_id": int(frame_id),
                        "timestamp": int(timestamp),
                        "app_bundle_id": str(item.get("app_bundle_id") or ""),
                        "app_name": str(app_name),
                        "window_title": item.get("window_title"),
                        "ocr_text": str(item.get("ocr_text") or ""),
                        "relevance_score": float(item.get("relevance_score") or 0.0),
                        "source": "hybrid",
                        "fts_matched": bool(item.get("fts_matched")),
                    }
                )
            except Exception:
                continue

        return {
            "success": True,
            "query": query,
            "days_back": int(data.get("days_back") or days_back),
            "result_count": len(normalized_results),
            "results": normalized_results,
            "mode_used": "hybrid",
            "status": "hybrid",
            "warning": data.get("warning"),
            "source_db": data.get("source_db"),
        }

    async def search_screen_recordings(
        self,
        user_id: str,
        query: str,
        days_back: int = 7,
        limit: int = 20,
    ) -> Dict[str, Any]:
        """
        Search local screen history directly from ritual.db.

        Primary path:
        - OCR FTS search via ocr_frames_fts (fast and precise)

        Fallbacks:
        - OCR lexical scan over recent frames (when FTS missing/empty)
        - activity_events lexical scan (when OCR unavailable)
        """
        import sqlite3

        normalized_query = (query or "").strip()
        if not normalized_query:
            return {
                "success": False,
                "error": "query is required",
                "results": [],
                "mode_used": "none",
                "status": "unavailable",
            }

        safe_days_back = max(1, min(int(days_back or 7), 90))
        safe_limit = max(1, min(int(limit or 20), 50))
        now_ms = int(time.time() * 1000)
        cutoff_ms = now_ms - safe_days_back * 24 * 60 * 60 * 1000
        tokens = self._extract_search_tokens(normalized_query)

        # First try true on-demand hybrid retrieval through the local Tauri bridge.
        hybrid_result = await self._search_screen_via_hybrid_bridge(
            query=normalized_query,
            days_back=safe_days_back,
            limit=safe_limit,
        )
        if hybrid_result is not None:
            return hybrid_result

        db_path = self._get_local_watcher_db_path()
        if not os.path.exists(db_path):
            return {
                "success": False,
                "error": f"local database not found at {db_path}",
                "results": [],
                "mode_used": "none",
                "status": "unavailable",
            }

        conn = None
        try:
            conn = sqlite3.connect(
                f"file:{db_path}?mode=ro",
                uri=True,
                timeout=2.0,
            )
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("PRAGMA query_only = ON")

            has_ocr_frames = self._table_exists(cursor, "ocr_frames")
            has_ocr_fts = self._table_exists(cursor, "ocr_frames_fts")
            has_activity_events = self._table_exists(cursor, "activity_events")

            results: List[Dict[str, Any]] = []
            mode_used = "none"
            status = "unavailable"
            warning: Optional[str] = None

            # 1) OCR FTS path
            if has_ocr_frames and has_ocr_fts:
                candidate_limit = min(max(safe_limit * 4, 80), 400)
                query_to_run = normalized_query
                try:
                    cursor.execute(
                        """
                        SELECT
                            f.id AS frame_id,
                            f.timestamp AS timestamp,
                            COALESCE(f.app_bundle_id, '') AS app_bundle_id,
                            COALESCE(f.app_name, 'Unknown') AS app_name,
                            f.window_title AS window_title,
                            COALESCE(f.ocr_text, '') AS ocr_text,
                            bm25(ocr_frames_fts) AS rank
                        FROM ocr_frames f
                        JOIN ocr_frames_fts ON ocr_frames_fts.rowid = f.id
                        WHERE f.timestamp >= ?
                          AND f.timestamp <= ?
                          AND ocr_frames_fts MATCH ?
                        ORDER BY bm25(ocr_frames_fts) ASC, f.timestamp DESC
                        LIMIT ?
                        """,
                        (cutoff_ms, now_ms, query_to_run, candidate_limit),
                    )
                except Exception as exc:
                    if self._is_fts_syntax_error(exc):
                        escaped = self._escape_fts_phrase(normalized_query)
                        if escaped:
                            query_to_run = escaped
                            cursor.execute(
                                """
                                SELECT
                                    f.id AS frame_id,
                                    f.timestamp AS timestamp,
                                    COALESCE(f.app_bundle_id, '') AS app_bundle_id,
                                    COALESCE(f.app_name, 'Unknown') AS app_name,
                                    f.window_title AS window_title,
                                    COALESCE(f.ocr_text, '') AS ocr_text,
                                    bm25(ocr_frames_fts) AS rank
                                FROM ocr_frames f
                                JOIN ocr_frames_fts ON ocr_frames_fts.rowid = f.id
                                WHERE f.timestamp >= ?
                                  AND f.timestamp <= ?
                                  AND ocr_frames_fts MATCH ?
                                ORDER BY bm25(ocr_frames_fts) ASC, f.timestamp DESC
                                LIMIT ?
                                """,
                                (cutoff_ms, now_ms, query_to_run, candidate_limit),
                            )
                            warning = (
                                "Search query syntax was normalized for FTS compatibility."
                            )
                        else:
                            raise
                    else:
                        raise

                for row in cursor.fetchall():
                    haystack = (
                        f"{row['app_name']} {row['window_title'] or ''} {row['ocr_text'] or ''}"
                    ).lower()
                    lexical_score = self._score_lexical_match(haystack, tokens)
                    raw_rank = row["rank"] if row["rank"] is not None else 0.0
                    rank = abs(float(raw_rank))
                    rank_score = 1.0 / (1.0 + rank)
                    relevance = max(0.05, min(1.0, rank_score * 0.7 + lexical_score * 0.3))
                    results.append(
                        {
                            "frame_id": int(row["frame_id"]),
                            "timestamp": int(row["timestamp"]),
                            "app_bundle_id": row["app_bundle_id"] or "",
                            "app_name": row["app_name"] or "Unknown",
                            "window_title": row["window_title"],
                            "ocr_text": row["ocr_text"] or "",
                            "relevance_score": relevance,
                            "source": "text",
                            "fts_matched": True,
                        }
                    )

                if results:
                    results.sort(
                        key=lambda item: (item["relevance_score"], item["timestamp"]),
                        reverse=True,
                    )
                    results = results[:safe_limit]
                    mode_used = "fts"
                    status = "text-only"

            # 2) OCR lexical fallback (if FTS empty/unavailable)
            if not results and has_ocr_frames:
                candidate_limit = min(max(safe_limit * 25, 300), 3000)
                cursor.execute(
                    """
                    SELECT
                        id AS frame_id,
                        timestamp,
                        COALESCE(app_bundle_id, '') AS app_bundle_id,
                        COALESCE(app_name, 'Unknown') AS app_name,
                        window_title,
                        COALESCE(ocr_text, '') AS ocr_text
                    FROM ocr_frames
                    WHERE timestamp >= ?
                      AND timestamp <= ?
                    ORDER BY timestamp DESC
                    LIMIT ?
                    """,
                    (cutoff_ms, now_ms, candidate_limit),
                )

                normalized_contains = normalized_query.lower()
                scored_rows: List[Dict[str, Any]] = []
                for row in cursor.fetchall():
                    haystack = (
                        f"{row['app_name']} {row['window_title'] or ''} {row['ocr_text'] or ''}"
                    ).lower()
                    lexical_score = self._score_lexical_match(haystack, tokens)
                    if normalized_contains and normalized_contains in haystack:
                        lexical_score = max(lexical_score, 0.8)
                    if lexical_score <= 0:
                        continue
                    relevance = max(0.05, min(0.9, 0.2 + lexical_score * 0.7))
                    scored_rows.append(
                        {
                            "frame_id": int(row["frame_id"]),
                            "timestamp": int(row["timestamp"]),
                            "app_bundle_id": row["app_bundle_id"] or "",
                            "app_name": row["app_name"] or "Unknown",
                            "window_title": row["window_title"],
                            "ocr_text": row["ocr_text"] or "",
                            "relevance_score": relevance,
                            "source": "text",
                            "fts_matched": False,
                        }
                    )

                if scored_rows:
                    scored_rows.sort(
                        key=lambda item: (item["relevance_score"], item["timestamp"]),
                        reverse=True,
                    )
                    results = scored_rows[:safe_limit]
                    mode_used = "like-fallback"
                    status = "text-only"
                    warning = warning or (
                        "Using lexical fallback because FTS did not return matches."
                    )

            # 3) Activity fallback (if OCR unavailable or no OCR matches)
            if not results and has_activity_events:
                candidate_limit = min(max(safe_limit * 20, 200), 2000)
                cursor.execute(
                    """
                    SELECT
                        id,
                        ts_start,
                        COALESCE(app_bundle_id, '') AS app_bundle_id,
                        COALESCE(app_name, 'Unknown') AS app_name,
                        COALESCE(window_title, '') AS window_title,
                        COALESCE(browser_url, '') AS browser_url,
                        COALESCE(browser_domain, '') AS browser_domain
                    FROM activity_events
                    WHERE ts_start >= ?
                      AND ts_start <= ?
                      AND COALESCE(is_afk, 0) = 0
                    ORDER BY ts_start DESC
                    LIMIT ?
                    """,
                    (cutoff_ms, now_ms, candidate_limit),
                )

                normalized_contains = normalized_query.lower()
                scored_events: List[Dict[str, Any]] = []
                for row in cursor.fetchall():
                    activity_text = " ".join(
                        part for part in [row["window_title"], row["browser_url"], row["browser_domain"]] if part
                    )
                    haystack = (
                        f"{row['app_name']} {activity_text}"
                    ).lower()
                    lexical_score = self._score_lexical_match(haystack, tokens)
                    if normalized_contains and normalized_contains in haystack:
                        lexical_score = max(lexical_score, 0.75)
                    if lexical_score <= 0:
                        continue

                    preview_parts = []
                    if row["window_title"]:
                        preview_parts.append(f"Window: {row['window_title']}")
                    if row["browser_url"]:
                        preview_parts.append(f"URL: {row['browser_url']}")
                    elif row["browser_domain"]:
                        preview_parts.append(f"Domain: {row['browser_domain']}")

                    scored_events.append(
                        {
                            "frame_id": -int(row["id"]),  # synthetic ID for non-frame events
                            "timestamp": int(row["ts_start"]),
                            "app_bundle_id": row["app_bundle_id"] or "",
                            "app_name": row["app_name"] or "Unknown",
                            "window_title": row["window_title"] or None,
                            "ocr_text": " | ".join(preview_parts) if preview_parts else row["app_name"],
                            "relevance_score": max(0.05, min(0.85, 0.15 + lexical_score * 0.7)),
                            "source": "activity",
                            "fts_matched": False,
                        }
                    )

                if scored_events:
                    scored_events.sort(
                        key=lambda item: (item["relevance_score"], item["timestamp"]),
                        reverse=True,
                    )
                    results = scored_events[:safe_limit]
                    mode_used = "activity-fallback"
                    status = "activity-only"
                    warning = warning or (
                        "No OCR frame matches found; using activity-event fallback."
                    )

            return {
                "success": True,
                "query": normalized_query,
                "days_back": safe_days_back,
                "result_count": len(results),
                "results": results,
                "mode_used": mode_used,
                "status": status,
                "warning": warning,
                "source_db": os.path.basename(db_path),
            }
        except Exception as e:
            print(f"❌ Error searching local screen history: {e}")
            return {
                "success": False,
                "error": str(e),
                "query": normalized_query,
                "days_back": safe_days_back,
                "result_count": 0,
                "results": [],
                "mode_used": "none",
                "status": "unavailable",
                "source_db": os.path.basename(db_path),
            }
        finally:
            if conn is not None:
                conn.close()
    
    # ============================================================
    # AUTO-SYNC TO "COMPUTER USE" HABIT
    # ============================================================
    
    def _get_local_watcher_db_path(self) -> str:
        """
        Get the path to the local activity SQLite database.

        The watcher now writes to unified `ritual.db` (via ritual-db). Older installs
        may still have `watcher.db`/`watcher.db.migrated`, so we keep those as fallback.
        """
        import os
        import sqlite3
        from pathlib import Path

        home = os.environ.get("HOME") or str(Path.home())
        ritual_dir = os.path.join(home, ".ritual")
        override_path = os.environ.get("RITUAL_ACTIVITY_DB_PATH")

        def has_activity_events_table(path: str) -> bool:
            try:
                conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=1.0)
                cursor = conn.cursor()
                cursor.execute(
                    """
                    SELECT 1
                    FROM sqlite_master
                    WHERE type='table' AND name='activity_events'
                    LIMIT 1
                    """
                )
                exists = cursor.fetchone() is not None
                conn.close()
                return exists
            except Exception:
                return False

        if override_path and os.path.exists(override_path):
            return override_path

        candidates = [
            os.path.join(ritual_dir, "ritual.db"),
            os.path.join(ritual_dir, "watcher.db"),
            os.path.join(ritual_dir, "watcher.db.migrated"),
        ]

        # Prefer DBs that actually contain activity_events and have content.
        for path in candidates:
            if not os.path.exists(path):
                continue
            try:
                if os.path.getsize(path) == 0:
                    continue
            except OSError:
                continue
            if has_activity_events_table(path):
                return path

        # Fallback to first existing non-empty candidate.
        for path in candidates:
            if not os.path.exists(path):
                continue
            try:
                if os.path.getsize(path) > 0:
                    return path
            except OSError:
                continue

        # Final fallback to first existing candidate.
        for path in candidates:
            if os.path.exists(path):
                return path

        # Default to unified db path if nothing exists yet.
        return os.path.join(ritual_dir, "ritual.db")
    
    def _merge_time_intervals(self, intervals: list) -> list:
        """
        Merge overlapping time intervals to avoid double-counting.
        Each interval is a tuple of (start_ms, end_ms).
        Returns merged intervals.
        """
        if not intervals:
            return []
        
        # Sort by start time
        sorted_intervals = sorted(intervals, key=lambda x: x[0])
        
        merged = []
        current_start, current_end = sorted_intervals[0]
        
        for start, end in sorted_intervals[1:]:
            if start <= current_end:
                # Overlapping or adjacent - extend current interval
                current_end = max(current_end, end)
            else:
                # No overlap - save current and start new
                merged.append((current_start, current_end))
                current_start, current_end = start, end
        
        merged.append((current_start, current_end))
        return merged

    async def _find_computer_use_habit(self, session, user_id: str) -> Optional[Tuple[str, str, str]]:
        """
        Resolve the user's Computer Use habit.
        Returns (habit_id, habit_name, unit_type) or None.
        """
        result = await session.execute(
            text("""
                SELECT id, name, unit_type FROM habits
                WHERE user_id = :user_id
                  AND LOWER(name) = 'computer use'
                LIMIT 1
            """),
            {"user_id": user_id}
        )
        row = result.fetchone()
        if row:
            return row[0], row[1], row[2] or "Hours"

        result = await session.execute(
            text("""
                SELECT id, name, unit_type FROM habits
                WHERE user_id = :user_id
                  AND (LOWER(name) LIKE '%computer use%' OR LOWER(name) LIKE '%computer time%')
                LIMIT 1
            """),
            {"user_id": user_id}
        )
        row = result.fetchone()
        if row:
            return row[0], row[1], row[2] or "Hours"
        return None

    def _convert_active_ms_to_habit_unit(self, unit_type: str, total_ms: int) -> Tuple[float, int]:
        """
        Convert active milliseconds into (amount, duration_seconds) for habit log storage.
        We always store duration in seconds and set amount according to the habit unit.
        """
        duration_seconds = int(total_ms / 1000)
        unit_lower = (unit_type or "hours").lower()
        if unit_lower in ["hours", "hour"]:
            return round(total_ms / (1000 * 60 * 60), 2), duration_seconds
        if unit_lower in ["minutes", "minute"]:
            return round(total_ms / (1000 * 60), 2), duration_seconds
        return round(total_ms / (1000 * 60 * 60), 2), duration_seconds

    def _computer_use_projection_dedupe_key(self, habit_id: str, day: str) -> str:
        payload = f"computer_use_projection:{habit_id}:{day}"
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    def _computer_use_projection_metadata(
        self,
        day: str,
        local_data: Dict[str, Any],
        db_path: str
    ) -> str:
        metadata = {
            "projection_type": "computer_use_daily",
            "pipeline_version": self.COMPUTER_USE_PIPELINE_VERSION,
            "source_db": os.path.basename(db_path),
            "source": self.COMPUTER_USE_PROJECTION_SOURCE,
            "day": day,
            "active_ms": int(local_data.get("total_ms", 0) or 0),
            "active_hours": float(local_data.get("total_hours", 0) or 0),
            "events_count": int(local_data.get("events_count", 0) or 0),
            "afk_ms": int(local_data.get("afk_ms", 0) or 0),
            "computed_at": datetime.now().isoformat(),
        }
        top_domains = local_data.get("top_domains") or []
        if top_domains:
            metadata["top_domains"] = top_domains[:5]
        return json.dumps(metadata)

    def _projection_source_rank(self, source: Optional[str], notes: Optional[str]) -> int:
        if source == self.COMPUTER_USE_PROJECTION_SOURCE:
            return 0
        if source == self.COMPUTER_USE_LEGACY_SOURCE:
            return 1
        if not source and (notes or "").lower().startswith("auto-synced from ritual watcher"):
            return 2
        return 9

    async def _upsert_computer_use_projection_log(
        self,
        session,
        habit_id: str,
        habit_name: str,
        unit_type: str,
        day: str,
        local_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Upsert a single derived habit_log row for Computer Use projection.
        """
        total_ms = int(local_data.get("total_ms", 0) or 0)
        amount, duration_seconds = self._convert_active_ms_to_habit_unit(unit_type, total_ms)
        now_iso = datetime.now().isoformat()
        db_path = self._get_local_watcher_db_path()
        metadata_json = self._computer_use_projection_metadata(day, local_data, db_path)
        dedupe_key = self._computer_use_projection_dedupe_key(habit_id, day)
        source_id = f"computer_use:{day}"
        notes = "Projected from Ritual Watcher (daily aggregate)"

        result = await session.execute(
            text("""
                SELECT id, amount, duration, source, notes, completed_at
                FROM habit_logs
                WHERE habit_id = :habit_id
                  AND date = :date
                ORDER BY completed_at DESC
            """),
            {"habit_id": habit_id, "date": day}
        )
        rows = result.fetchall()

        existing_log = None
        existing_rank = 99
        for row in rows:
            rank = self._projection_source_rank(row[3], row[4])
            if rank < existing_rank:
                existing_rank = rank
                existing_log = row

        if existing_log:
            log_id = existing_log[0]
            old_amount = existing_log[1] or 0
            previous_source = existing_log[3]
            await session.execute(
                text("""
                    UPDATE habit_logs
                    SET amount = :amount,
                        duration = :duration,
                        status = 'completed',
                        notes = :notes,
                        completed_at = :completed_at,
                        source = :source,
                        source_id = :source_id,
                        dedupe_key = :dedupe_key,
                        log_metadata = :log_metadata
                    WHERE id = :log_id
                """),
                {
                    "log_id": log_id,
                    "amount": amount,
                    "duration": duration_seconds,
                    "notes": notes,
                    "completed_at": now_iso,
                    "source": self.COMPUTER_USE_PROJECTION_SOURCE,
                    "source_id": source_id,
                    "dedupe_key": dedupe_key,
                    "log_metadata": metadata_json,
                }
            )
            return {
                "action": "updated",
                "log_id": log_id,
                "previous_amount": old_amount,
                "previous_source": previous_source,
                "amount": amount,
                "duration_seconds": duration_seconds,
                "total_ms": total_ms,
                "notes": notes,
                "source": self.COMPUTER_USE_PROJECTION_SOURCE,
                "log_metadata": metadata_json,
                "unit": unit_type,
                "habit_name": habit_name,
            }

        new_log_id = str(uuid.uuid4())
        await session.execute(
            text("""
                INSERT INTO habit_logs (
                    id, habit_id, date, amount, duration, status, notes,
                    completed_at, source, source_id, dedupe_key, log_metadata
                )
                VALUES (
                    :id, :habit_id, :date, :amount, :duration, :status, :notes,
                    :completed_at, :source, :source_id, :dedupe_key, :log_metadata
                )
            """),
            {
                "id": new_log_id,
                "habit_id": habit_id,
                "date": day,
                "amount": amount,
                "duration": duration_seconds,
                "status": "completed",
                "notes": notes,
                "completed_at": now_iso,
                "source": self.COMPUTER_USE_PROJECTION_SOURCE,
                "source_id": source_id,
                "dedupe_key": dedupe_key,
                "log_metadata": metadata_json,
            }
        )
        return {
            "action": "created",
            "log_id": new_log_id,
            "amount": amount,
            "duration_seconds": duration_seconds,
            "total_ms": total_ms,
            "notes": notes,
            "source": self.COMPUTER_USE_PROJECTION_SOURCE,
            "log_metadata": metadata_json,
            "unit": unit_type,
            "habit_name": habit_name,
        }
    
    def _get_computer_time_from_local_db(self, day: str) -> Dict:
        """
        Read computer time directly from the local watcher SQLite database.
        This bypasses Turso and reads from the same DB the Rust watcher writes to.
        V3: Uses interval merging to avoid double-counting overlapping events.
        """
        import sqlite3
        import os
        
        db_path = self._get_local_watcher_db_path()
        
        if not os.path.exists(db_path):
            print(f"⚠️ Local watcher database not found at: {db_path}")
            return {
                "ok": False,
                "error": f"Database not found at {db_path}",
                "total_ms": 0,
                "total_hours": 0,
                "events_count": 0,
                "active_ms": 0,
                "afk_ms": 0
            }
        
        try:
            conn = None
            cursor = None
            last_error = None

            # Retry a few times to avoid transient lock/write races with watcher process.
            for _ in range(3):
                try:
                    conn = sqlite3.connect(
                        f"file:{db_path}?mode=ro",
                        uri=True,
                        timeout=2.0
                    )
                    cursor = conn.cursor()
                    cursor.execute("PRAGMA query_only = ON")
                    break
                except Exception as e:
                    last_error = e
                    if conn:
                        conn.close()
                        conn = None
                    time.sleep(0.15)

            if not conn or not cursor:
                raise last_error or RuntimeError("Failed to open local activity DB")
            
            # Calculate day boundaries in milliseconds
            day_date = datetime.strptime(day, "%Y-%m-%d")
            day_start_ms = int(day_date.timestamp() * 1000)
            day_end_ms = day_start_ms + (24 * 60 * 60 * 1000)
            
            # Get all events that overlap the day window (not just those starting within it)
            cursor.execute("""
                SELECT ts_start, ts_end, COALESCE(is_afk, 0) as is_afk
                FROM activity_events
                WHERE ts_start < ? AND ts_end > ?
                  AND ts_end > ts_start
                ORDER BY ts_start
            """, (day_end_ms, day_start_ms))
            
            rows = cursor.fetchall()
            events_count = len(rows)
            
            # Separate active and AFK intervals
            active_intervals = []
            afk_intervals = []
            
            for ts_start, ts_end, is_afk in rows:
                # Clip each interval to this day's boundaries so cross-midnight sessions
                # are counted correctly for daily totals.
                clipped_start = max(ts_start, day_start_ms)
                clipped_end = min(ts_end, day_end_ms)
                if clipped_end <= clipped_start:
                    continue

                if is_afk:
                    afk_intervals.append((clipped_start, clipped_end))
                else:
                    active_intervals.append((clipped_start, clipped_end))
            
            # Merge overlapping intervals
            merged_active = self._merge_time_intervals(active_intervals)
            merged_afk = self._merge_time_intervals(afk_intervals)
            
            # Calculate total time from merged intervals
            active_ms = sum(end - start for start, end in merged_active)
            afk_ms = sum(end - start for start, end in merged_afk)
            
            total_ms = active_ms  # Only count active time for habit tracking
            total_hours = round(total_ms / (1000 * 60 * 60), 2)
            
            # Also get top domains for this day (simple sum is OK for ranking)
            cursor.execute("""
                SELECT browser_domain, SUM(ts_end - ts_start) as total_ms
                FROM activity_events
                WHERE ts_start >= ? AND ts_start < ?
                  AND browser_domain IS NOT NULL
                  AND browser_domain != ''
                  AND is_afk = 0
                GROUP BY browser_domain
                ORDER BY total_ms DESC
                LIMIT 5
            """, (day_start_ms, day_end_ms))
            
            top_domains = [{"domain": r[0], "ms": r[1]} for r in cursor.fetchall()]
            
            conn.close()
            
            print(
                f"📊 Local activity DB ({os.path.basename(db_path)}) query for {day}: "
                f"{total_ms}ms active = {total_hours}h "
                f"({events_count} events, {len(merged_active)} merged intervals)"
            )
            
            return {
                "ok": True,
                "total_ms": total_ms,
                "total_hours": total_hours,
                "events_count": events_count,
                "active_ms": active_ms,
                "afk_ms": afk_ms,
                "top_domains": top_domains
            }
        except Exception as e:
            print(f"❌ Error reading from local watcher DB: {e}")
            return {
                "ok": False,
                "error": str(e),
                "total_ms": 0,
                "total_hours": 0,
                "events_count": 0,
                "active_ms": 0,
                "afk_ms": 0
            }
    
    async def sync_to_computer_use_habit(
        self,
        user_id: str,
        day: Optional[str] = None  # YYYY-MM-DD, defaults to today
    ) -> Dict:
        """
        Sync watcher data to the user's "Computer Use" habit.
        Creates or updates a habit log for the specified day with total computer time.
        
        This is called hourly to keep the dashboard updated.
        Reads directly from the local watcher SQLite database.
        """
        # Default to today
        if not day:
            day = datetime.now().strftime("%Y-%m-%d")
        
        try:
            async with get_db_session() as session:
                resolved_habit = await self._find_computer_use_habit(session, user_id)
                if not resolved_habit:
                    return {
                        "success": False,
                        "error": "No 'Computer Use' habit found. Please create a habit named 'Computer Use' first.",
                        "synced": False
                    }

                habit_id, habit_name, unit_type = resolved_habit

                local_data = self._get_computer_time_from_local_db(day)
                if not local_data.get("ok", True):
                    return {
                        "success": False,
                        "error": f"Failed to read local activity DB: {local_data.get('error', 'unknown error')}",
                        "synced": False,
                        "day": day
                    }

                computer_sync = await self._sync_computer_activity_range_to_tinybird(
                    user_id=user_id,
                    start_date=day,
                    end_date=day,
                )
                if not computer_sync.get("success"):
                    print(f"⚠️ computer_activity_daily sync skipped: {computer_sync.get('error')}")

                projection_result = await self._upsert_computer_use_projection_log(
                    session=session,
                    habit_id=habit_id,
                    habit_name=habit_name,
                    unit_type=unit_type,
                    day=day,
                    local_data=local_data,
                )

                await session.commit()

                print(
                    f"✅ {projection_result['action'].capitalize()} computer-use projection log "
                    f"{projection_result['log_id']} for {day}: {projection_result['amount']} {unit_type}"
                )

                await self._sync_habit_log_to_tinybird(
                    log_id=projection_result["log_id"],
                    habit_id=habit_id,
                    habit_name=habit_name,
                    user_id=user_id,
                    date=day,
                    amount=projection_result["amount"],
                    duration_seconds=projection_result["duration_seconds"],
                    unit_type=unit_type,
                    source=projection_result["source"],
                    notes=projection_result["notes"],
                )

                response: Dict[str, Any] = {
                    "success": True,
                    "synced": True,
                    "action": projection_result["action"],
                    "habit_id": habit_id,
                    "habit_name": habit_name,
                    "day": day,
                    "amount": projection_result["amount"],
                    "unit": unit_type,
                    "log_id": projection_result["log_id"],
                    "total_ms": projection_result["total_ms"],
                    "projection": {
                        "enabled": True,
                        "source": self.COMPUTER_USE_PROJECTION_SOURCE,
                        "pipeline_version": self.COMPUTER_USE_PIPELINE_VERSION,
                        "dedupe_key": self._computer_use_projection_dedupe_key(habit_id, day),
                    },
                }
                if projection_result.get("previous_amount") is not None:
                    response["previous_amount"] = projection_result["previous_amount"]
                return response
        except Exception as e:
            import traceback
            print(f"❌ Error syncing to habit: {e}")
            print(traceback.format_exc())
            return {
                "success": False,
                "error": str(e),
                "synced": False
            }

    async def reconcile_computer_use_projection(
        self,
        user_id: str,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        days_back: int = 14,
        auto_repair: bool = True,
        tolerance_seconds: int = 60
    ) -> Dict[str, Any]:
        """
        Verify Computer Use projection rows in habit_logs match local watcher-derived values.
        Optionally repair mismatched/missing rows by re-running per-day projection sync.
        """
        try:
            if start_date:
                start_dt = datetime.strptime(start_date, "%Y-%m-%d").date()
            else:
                end_for_start = datetime.strptime(end_date, "%Y-%m-%d").date() if end_date else datetime.now().date()
                span = max(int(days_back), 1)
                start_dt = end_for_start - timedelta(days=span - 1)

            if end_date:
                end_dt = datetime.strptime(end_date, "%Y-%m-%d").date()
            else:
                end_dt = datetime.now().date()

            if start_dt > end_dt:
                start_dt, end_dt = end_dt, start_dt

            async with get_db_session() as session:
                resolved_habit = await self._find_computer_use_habit(session, user_id)
                if not resolved_habit:
                    return {
                        "success": False,
                        "error": "No 'Computer Use' habit found.",
                        "reconciled": False,
                    }
                habit_id, habit_name, unit_type = resolved_habit

                existing_result = await session.execute(
                    text("""
                        SELECT date, id, amount, duration, source, notes
                        FROM habit_logs
                        WHERE habit_id = :habit_id
                          AND date >= :start_date
                          AND date <= :end_date
                        ORDER BY date ASC, completed_at DESC
                    """),
                    {
                        "habit_id": habit_id,
                        "start_date": start_dt.strftime("%Y-%m-%d"),
                        "end_date": end_dt.strftime("%Y-%m-%d"),
                    }
                )
                rows = existing_result.fetchall()

            preferred_by_day: Dict[str, Dict[str, Any]] = {}
            for row in rows:
                day = row[0]
                row_info = {
                    "date": day,
                    "log_id": row[1],
                    "amount": row[2] or 0,
                    "duration": row[3] or 0,
                    "source": row[4],
                    "notes": row[5] or "",
                }
                rank = self._projection_source_rank(row_info["source"], row_info["notes"])
                existing = preferred_by_day.get(day)
                if not existing or rank < existing["rank"]:
                    row_info["rank"] = rank
                    preferred_by_day[day] = row_info

            mismatches: List[Dict[str, Any]] = []
            repaired_days = 0
            checked_days = (end_dt - start_dt).days + 1

            for offset in range(checked_days):
                day = (start_dt + timedelta(days=offset)).strftime("%Y-%m-%d")
                local_data = self._get_computer_time_from_local_db(day)
                if not local_data.get("ok", True):
                    mismatches.append({
                        "day": day,
                        "reason": "local_read_failed",
                        "error": local_data.get("error", "unknown error"),
                    })
                    continue

                expected_amount, expected_duration = self._convert_active_ms_to_habit_unit(
                    unit_type,
                    int(local_data.get("total_ms", 0) or 0)
                )
                existing = preferred_by_day.get(day)

                if not existing:
                    mismatches.append({
                        "day": day,
                        "reason": "missing_projection_log",
                        "expected_amount": expected_amount,
                        "expected_duration_seconds": expected_duration,
                    })
                    continue

                actual_duration = int(existing.get("duration") or 0)
                actual_amount = float(existing.get("amount") or 0)
                duration_delta = abs(actual_duration - expected_duration)
                amount_delta = abs(actual_amount - expected_amount)

                if duration_delta > max(int(tolerance_seconds), 0) or amount_delta > 0.01:
                    mismatches.append({
                        "day": day,
                        "reason": "value_mismatch",
                        "log_id": existing.get("log_id"),
                        "source": existing.get("source"),
                        "expected_amount": expected_amount,
                        "actual_amount": actual_amount,
                        "expected_duration_seconds": expected_duration,
                        "actual_duration_seconds": actual_duration,
                        "duration_delta_seconds": duration_delta,
                        "amount_delta": round(amount_delta, 4),
                    })

            repairs: List[Dict[str, Any]] = []
            if auto_repair and mismatches:
                for mismatch in mismatches:
                    day = mismatch.get("day")
                    if not day:
                        continue
                    repaired = await self.sync_to_computer_use_habit(user_id=user_id, day=day)
                    repairs.append(repaired)
                    if repaired.get("success") and repaired.get("synced"):
                        repaired_days += 1

            return {
                "success": True,
                "reconciled": len(mismatches) == 0 or repaired_days > 0,
                "habit_id": habit_id,
                "habit_name": habit_name,
                "unit": unit_type,
                "start_date": start_dt.strftime("%Y-%m-%d"),
                "end_date": end_dt.strftime("%Y-%m-%d"),
                "checked_days": checked_days,
                "mismatch_count": len(mismatches),
                "mismatches": mismatches,
                "auto_repair": auto_repair,
                "repaired_days": repaired_days,
                "repairs": repairs,
                "projection_source": self.COMPUTER_USE_PROJECTION_SOURCE,
                "pipeline_version": self.COMPUTER_USE_PIPELINE_VERSION,
            }
        except Exception as e:
            return {
                "success": False,
                "reconciled": False,
                "error": str(e),
                "mismatch_count": 0,
                "mismatches": [],
                "repaired_days": 0,
                "repairs": [],
            }

    async def validate_computer_use_range_parity(
        self,
        user_id: str,
        start_date: str,
        end_date: str,
        tolerance_seconds: int = 60,
    ) -> Dict[str, Any]:
        """
        Validate parity between:
        - Computer Activity total (from local watcher DB), and
        - Derived Computer Use habit projection total (from habit_logs)
        for the same selected date range.
        """
        try:
            summary = await self.get_computer_time_summary(
                user_id=user_id,
                start_date=start_date,
                end_date=end_date,
            )
            expected_total_ms = int(summary.get("total_active_ms", 0) or 0)

            async with get_db_session() as session:
                resolved_habit = await self._find_computer_use_habit(session, user_id)
                if not resolved_habit:
                    return {
                        "success": False,
                        "error": "No 'Computer Use' habit found.",
                        "parity_ok": False,
                    }

                habit_id, habit_name, unit_type = resolved_habit
                expected_amount, expected_duration_seconds = self._convert_active_ms_to_habit_unit(
                    unit_type,
                    expected_total_ms,
                )

                projection_sum = await session.execute(
                    text("""
                        SELECT
                            COALESCE(SUM(duration), 0) as total_duration_seconds,
                            COALESCE(SUM(amount), 0) as total_amount,
                            COUNT(*) as rows_count
                        FROM habit_logs
                        WHERE habit_id = :habit_id
                          AND date >= :start_date
                          AND date <= :end_date
                          AND source = :source
                          AND (status = 'completed' OR status IS NULL)
                    """),
                    {
                        "habit_id": habit_id,
                        "start_date": start_date,
                        "end_date": end_date,
                        "source": self.COMPUTER_USE_PROJECTION_SOURCE,
                    },
                )
                row = projection_sum.fetchone()

            actual_duration_seconds = int((row[0] if row else 0) or 0)
            actual_amount = float((row[1] if row else 0) or 0)
            rows_count = int((row[2] if row else 0) or 0)

            duration_delta_seconds = abs(actual_duration_seconds - expected_duration_seconds)
            amount_delta = abs(actual_amount - expected_amount)
            parity_ok = (
                duration_delta_seconds <= max(int(tolerance_seconds), 0)
                and amount_delta <= 0.01
            )

            return {
                "success": True,
                "parity_ok": parity_ok,
                "start_date": start_date,
                "end_date": end_date,
                "habit_id": habit_id,
                "habit_name": habit_name,
                "unit": unit_type,
                "projection_source": self.COMPUTER_USE_PROJECTION_SOURCE,
                "expected_total_active_ms": expected_total_ms,
                "expected_duration_seconds": expected_duration_seconds,
                "actual_duration_seconds": actual_duration_seconds,
                "duration_delta_seconds": duration_delta_seconds,
                "expected_amount": expected_amount,
                "actual_amount": actual_amount,
                "amount_delta": round(amount_delta, 4),
                "rows_count": rows_count,
                "tolerance_seconds": max(int(tolerance_seconds), 0),
            }
        except Exception as e:
            return {
                "success": False,
                "parity_ok": False,
                "error": str(e),
            }

    async def sync_to_computer_use_habit_range(
        self,
        user_id: str,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        days_back: int = 7,
        auto_reconcile: bool = False,
        tolerance_seconds: int = 60,
    ) -> Dict[str, Any]:
        """
        Sync a date range of watcher data into the user's "Computer Use" habit.
        Useful for backfilling missed days and keeping weekly/monthly views accurate.
        """
        try:
            if start_date:
                start_dt = datetime.strptime(start_date, "%Y-%m-%d").date()
            else:
                end_for_start = datetime.strptime(end_date, "%Y-%m-%d").date() if end_date else datetime.now().date()
                span = max(int(days_back), 1)
                start_dt = end_for_start - timedelta(days=span - 1)

            if end_date:
                end_dt = datetime.strptime(end_date, "%Y-%m-%d").date()
            else:
                end_dt = datetime.now().date()

            if start_dt > end_dt:
                start_dt, end_dt = end_dt, start_dt

            total_days = (end_dt - start_dt).days + 1
            results: List[Dict[str, Any]] = []
            synced_days = 0

            for offset in range(total_days):
                day_dt = start_dt + timedelta(days=offset)
                day = day_dt.strftime("%Y-%m-%d")
                day_result = await self.sync_to_computer_use_habit(user_id=user_id, day=day)
                results.append(day_result)
                if day_result.get("success") and day_result.get("synced"):
                    synced_days += 1

            response: Dict[str, Any] = {
                "success": True,
                "synced": synced_days > 0,
                "requested_days": total_days,
                "synced_days": synced_days,
                "start_date": start_dt.strftime("%Y-%m-%d"),
                "end_date": end_dt.strftime("%Y-%m-%d"),
                "results": results,
                "projection_source": self.COMPUTER_USE_PROJECTION_SOURCE,
                "pipeline_version": self.COMPUTER_USE_PIPELINE_VERSION,
            }

            if auto_reconcile:
                reconciliation = await self.reconcile_computer_use_projection(
                    user_id=user_id,
                    start_date=response["start_date"],
                    end_date=response["end_date"],
                    auto_repair=True,
                    tolerance_seconds=tolerance_seconds,
                )
                response["reconciliation"] = reconciliation
                response["reconciled"] = reconciliation.get("reconciled", False)

            return response
        except Exception as e:
            return {
                "success": False,
                "error": str(e),
                "synced": False,
                "requested_days": 0,
                "synced_days": 0,
                "results": [],
            }


# Global service instance
watcher_service = WatcherService()
