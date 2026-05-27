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
import time
import hashlib
import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any, Tuple

from database.connection import get_db_session
from services.watcher_service_computer_activity import (
    _build_computer_activity_sync_cache_key_impl,
    _escape_tinybird_literal_impl,
    _get_computer_activity_daily_rows_from_local_db_impl,
    _get_computer_activity_pipe_rows_impl,
    _query_computer_activity_summary_pipe_impl,
    _resolve_activity_user_ids,
    _sync_computer_activity_range_to_tinybird_impl,
    get_computer_activity_snapshot_impl,
    get_computer_time_summary_impl,
    get_daily_computer_time_impl,
    get_usage_daily_breakdown_impl,
)
from services.watcher_service_devices import (
    get_device_impl,
    get_user_devices_impl,
    heartbeat_impl,
    register_device_impl,
    update_device_state_impl,
)
from services.watcher_service_projection import (
    _computer_use_projection_dedupe_key_impl,
    _computer_use_projection_metadata_impl,
    _convert_active_ms_to_habit_unit_impl,
    _find_computer_use_habit_impl,
    _get_computer_time_from_local_db_impl,
    _projection_source_rank_impl,
    _upsert_computer_use_projection_log_impl,
    reconcile_computer_use_projection_impl,
    sync_to_computer_use_habit_impl,
    sync_to_computer_use_habit_range_impl,
    validate_computer_use_range_parity_impl,
)
from services.watcher_service_activity import (
    _get_afk_summary_from_local_db_impl,
    compute_daily_rollup_impl,
    get_afk_summary_impl,
    get_browser_summary_impl,
    get_daily_summary_impl,
    get_domain_daily_breakdown_impl,
    get_events_for_day_impl,
    get_recent_events_impl,
    get_top_apps_impl,
    get_top_domains_impl,
    record_activity_event_impl,
    update_event_end_time_impl,
)
from services.watcher_service_exclusions import (
    add_app_exclusion_impl,
    get_app_exclusions_impl,
    get_suggested_exclusions_impl,
    remove_app_exclusion_impl,
)
logger = logging.getLogger(__name__)


class WatcherService:
    """Service for managing Ritual Watcher computer activity tracking."""

    # Projection pipeline constants for the derived "Computer Use" habit log.
    COMPUTER_USE_PROJECTION_SOURCE = "ritual_watcher_projection_v1"
    COMPUTER_USE_LEGACY_SOURCE = "ritual_watcher"
    COMPUTER_USE_PIPELINE_VERSION = 1
    
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
                logger.warning("Could not load Tinybird service: %s", e)
        return self.tinybird_service

    def _get_db_session(self):
        """Central DB session accessor to keep patch points stable across modules."""
        return get_db_session()
    
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
                logger.warning("Tinybird service not available, skipping sync")
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
                logger.info("Synced to Tinybird: %s = %s %s", habit_name, amount, unit_type)
            else:
                logger.warning("Tinybird sync returned non-success payload: %s", result)
        except Exception as e:
            logger.warning("Failed to sync to Tinybird: %s", e)
    
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
        """Register a new watcher device."""
        return await register_device_impl(
            self,
            user_id=user_id,
            device_name=device_name,
            platform=platform,
            os_version=os_version,
        )
    
    async def get_device(self, device_id: str, user_id: str) -> Optional[Dict]:
        """Get device info and state."""
        return await get_device_impl(self, device_id=device_id, user_id=user_id)
    
    async def get_user_devices(self, user_id: str) -> List[Dict]:
        """Get all devices for a user."""
        return await get_user_devices_impl(self, user_id=user_id)
    
    async def update_device_state(
        self,
        device_id: str,
        user_id: str,
        **updates
    ) -> Optional[Dict]:
        """Update device watcher state."""
        return await update_device_state_impl(
            self,
            device_id=device_id,
            user_id=user_id,
            **updates,
        )
    
    async def heartbeat(self, device_id: str, user_id: str) -> bool:
        """Update device heartbeat timestamp."""
        return await heartbeat_impl(self, device_id=device_id, user_id=user_id)
    
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
        return await record_activity_event_impl(
            self,
            device_id=device_id,
            user_id=user_id,
            app_bundle_id=app_bundle_id,
            app_name=app_name,
            window_title=window_title,
            window_owner_pid=window_owner_pid,
            is_afk=is_afk,
            ts_start=ts_start,
            ts_end=ts_end,
        )
    
    async def update_event_end_time(
        self,
        event_id: int,
        ts_end: int
    ) -> bool:
        """Update the end time of an activity event."""
        return await update_event_end_time_impl(self, event_id=event_id, ts_end=ts_end)
    
    async def get_recent_events(
        self,
        user_id: str,
        device_id: Optional[str] = None,
        limit: int = 100,
        offset: int = 0
    ) -> List[Dict]:
        """Get recent activity events."""
        return await get_recent_events_impl(
            self,
            user_id=user_id,
            device_id=device_id,
            limit=limit,
            offset=offset,
        )
    
    async def get_events_for_day(
        self,
        user_id: str,
        day: str,  # YYYY-MM-DD
        device_id: Optional[str] = None,
        timezone: str = "UTC"
    ) -> List[Dict]:
        """Get all activity events for a specific day."""
        return await get_events_for_day_impl(
            self,
            user_id=user_id,
            day=day,
            device_id=device_id,
            timezone=timezone,
        )
    
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
        return await compute_daily_rollup_impl(
            self,
            user_id=user_id,
            day=day,
            device_id=device_id,
            force_recompute=force_recompute,
        )
    
    async def get_daily_summary(
        self,
        user_id: str,
        start_date: str,  # YYYY-MM-DD
        end_date: str,  # YYYY-MM-DD
        device_id: Optional[str] = None
    ) -> List[Dict]:
        """Get daily activity summaries for a date range."""
        return await get_daily_summary_impl(
            self,
            user_id=user_id,
            start_date=start_date,
            end_date=end_date,
            device_id=device_id,
        )
    
    async def get_top_apps(
        self,
        user_id: str,
        start_date: str,
        end_date: str,
        limit: int = 10,
        device_id: Optional[str] = None,
        source_filter: Optional[str] = None,
    ) -> List[Dict]:
        return await get_top_apps_impl(
            self,
            user_id=user_id,
            start_date=start_date,
            end_date=end_date,
            limit=limit,
            device_id=device_id,
            source_filter=source_filter,
        )
    
    # ============================================================
    # BROWSER/DOMAIN ANALYTICS (V2)
    # ============================================================
    
    async def get_top_domains(
        self,
        user_id: str,
        start_date: str,
        end_date: str,
        limit: int = 10,
        device_id: Optional[str] = None,
        source_filter: Optional[str] = None,
    ) -> List[Dict]:
        return await get_top_domains_impl(
            self,
            user_id=user_id,
            start_date=start_date,
            end_date=end_date,
            limit=limit,
            device_id=device_id,
            source_filter=source_filter,
        )
    
    async def get_domain_daily_breakdown(
        self,
        user_id: str,
        domain: str,
        start_date: str,
        end_date: str,
        device_id: Optional[str] = None
    ) -> List[Dict]:
        """Get daily breakdown for a specific domain."""
        return await get_domain_daily_breakdown_impl(
            self,
            user_id=user_id,
            domain=domain,
            start_date=start_date,
            end_date=end_date,
            device_id=device_id,
        )
    
    async def get_browser_summary(
        self,
        user_id: str,
        start_date: str,
        end_date: str,
        device_id: Optional[str] = None
    ) -> Dict:
        """Get overall browser usage summary including top domains."""
        return await get_browser_summary_impl(
            self,
            user_id=user_id,
            start_date=start_date,
            end_date=end_date,
            device_id=device_id,
        )
    
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
        return await get_afk_summary_impl(
            self,
            user_id=user_id,
            start_date=start_date,
            end_date=end_date,
            device_id=device_id,
        )
    
    def _get_afk_summary_from_local_db(self, start_date: str, end_date: str) -> Optional[Dict]:
        """Read AFK summary from local watcher database."""
        return _get_afk_summary_from_local_db_impl(
            self,
            start_date=start_date,
            end_date=end_date,
        )
    
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
        return await add_app_exclusion_impl(
            self,
            user_id=user_id,
            bundle_id=bundle_id,
            app_name=app_name,
            reason=reason,
        )
    
    async def remove_app_exclusion(
        self,
        user_id: str,
        bundle_id: str
    ) -> bool:
        return await remove_app_exclusion_impl(
            self,
            user_id=user_id,
            bundle_id=bundle_id,
        )
    
    async def get_app_exclusions(self, user_id: str) -> List[Dict]:
        return await get_app_exclusions_impl(self, user_id=user_id)
    
    def get_suggested_exclusions(self) -> List[Dict]:
        return get_suggested_exclusions_impl()

    def _escape_tinybird_literal(self, value: str) -> str:
        return _escape_tinybird_literal_impl(value)

    def _build_computer_activity_sync_cache_key(self, user_id: str, start_date: str, end_date: str) -> str:
        return _build_computer_activity_sync_cache_key_impl(user_id, start_date, end_date)

    def _get_computer_activity_daily_rows_from_local_db(
        self,
        start_date: str,
        end_date: str,
        user_id: Optional[str] = None,
        source_filter: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        return _get_computer_activity_daily_rows_from_local_db_impl(
            self,
            start_date=start_date,
            end_date=end_date,
            user_ids=_resolve_activity_user_ids(user_id) if user_id else None,
            source_filter=source_filter,
        )

    async def _sync_computer_activity_range_to_tinybird(
        self,
        user_id: str,
        start_date: str,
        end_date: str,
    ) -> Dict[str, Any]:
        return await _sync_computer_activity_range_to_tinybird_impl(
            self,
            user_id=user_id,
            start_date=start_date,
            end_date=end_date,
        )

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
        return await _query_computer_activity_summary_pipe_impl(
            self,
            user_id=user_id,
            start_date=start_date,
            end_date=end_date,
            output=output,
            limit=limit,
            kind=kind,
            key=key,
        )

    async def _get_computer_activity_pipe_rows(
        self,
        user_id: str,
        start_date: str,
        end_date: str,
        output: str,
        limit: int = 10,
        kind: Optional[str] = None,
        key: Optional[str] = None,
        refresh_before_read: bool = False,
    ) -> List[Dict[str, Any]]:
        return await _get_computer_activity_pipe_rows_impl(
            self,
            user_id=user_id,
            start_date=start_date,
            end_date=end_date,
            output=output,
            limit=limit,
            kind=kind,
            key=key,
            refresh_before_read=refresh_before_read,
        )
    
    # ============================================================
    # COMPUTER ACTIVITY STATS (for Dashboard/Analytics)
    # Now reads directly from LOCAL watcher database
    # ============================================================
    
    async def get_computer_time_summary(
        self,
        user_id: str,
        start_date: str,  # YYYY-MM-DD
        end_date: str,    # YYYY-MM-DD
        device_id: Optional[str] = None,
        source_filter: Optional[str] = None,
    ) -> Dict:
        return await get_computer_time_summary_impl(
            self,
            user_id=user_id,
            start_date=start_date,
            end_date=end_date,
            device_id=device_id,
            source_filter=source_filter,
        )
    
    async def get_daily_computer_time(
        self,
        user_id: str,
        start_date: str,
        end_date: str,
        device_id: Optional[str] = None,
        source_filter: Optional[str] = None,
    ) -> List[Dict]:
        return await get_daily_computer_time_impl(
            self,
            user_id=user_id,
            start_date=start_date,
            end_date=end_date,
            device_id=device_id,
            source_filter=source_filter,
        )

    async def get_computer_activity_snapshot(
        self,
        user_id: str,
        start_date: str,
        end_date: str,
        limit: int = 10,
        device_id: Optional[str] = None,
        source_filter: Optional[str] = None,
    ) -> Dict[str, Any]:
        return await get_computer_activity_snapshot_impl(
            self,
            user_id=user_id,
            start_date=start_date,
            end_date=end_date,
            limit=limit,
            device_id=device_id,
            source_filter=source_filter,
        )

    async def get_usage_daily_breakdown(
        self,
        user_id: str,
        kind: str,
        key: str,
        start_date: str,
        end_date: str,
        device_id: Optional[str] = None,
        source_filter: Optional[str] = None,
    ) -> List[Dict]:
        return await get_usage_daily_breakdown_impl(
            self,
            user_id=user_id,
            kind=kind,
            key=key,
            start_date=start_date,
            end_date=end_date,
            device_id=device_id,
            source_filter=source_filter,
        )

    # ============================================================
    # AUTO-SYNC TO "COMPUTER USE" HABIT
    # ============================================================

    async def _find_computer_use_habit(self, session, user_id: str) -> Optional[Tuple[str, str, str]]:
        """Resolve the user's Computer Use habit."""
        return await _find_computer_use_habit_impl(self, session=session, user_id=user_id)

    def _convert_active_ms_to_habit_unit(self, unit_type: str, total_ms: int) -> Tuple[float, int]:
        return _convert_active_ms_to_habit_unit_impl(self, unit_type=unit_type, total_ms=total_ms)

    def _computer_use_projection_dedupe_key(self, habit_id: str, day: str) -> str:
        return _computer_use_projection_dedupe_key_impl(self, habit_id=habit_id, day=day)

    def _computer_use_projection_metadata(
        self,
        day: str,
        local_data: Dict[str, Any],
        db_path: str
    ) -> str:
        return _computer_use_projection_metadata_impl(
            self,
            day=day,
            local_data=local_data,
            db_path=db_path,
        )

    def _projection_source_rank(self, source: Optional[str], notes: Optional[str]) -> int:
        return _projection_source_rank_impl(self, source=source, notes=notes)

    async def _upsert_computer_use_projection_log(
        self,
        session,
        user_id: str,
        habit_id: str,
        habit_name: str,
        unit_type: str,
        day: str,
        local_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        return await _upsert_computer_use_projection_log_impl(
            self,
            session=session,
            user_id=user_id,
            habit_id=habit_id,
            habit_name=habit_name,
            unit_type=unit_type,
            day=day,
            local_data=local_data,
        )
    
    def _get_computer_time_from_local_db(self, day: str) -> Dict:
        return _get_computer_time_from_local_db_impl(self, day=day)
    
    async def sync_to_computer_use_habit(
        self,
        user_id: str,
        day: Optional[str] = None  # YYYY-MM-DD, defaults to today
    ) -> Dict:
        return await sync_to_computer_use_habit_impl(self, user_id=user_id, day=day)

    async def reconcile_computer_use_projection(
        self,
        user_id: str,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        days_back: int = 14,
        auto_repair: bool = True,
        tolerance_seconds: int = 60
    ) -> Dict[str, Any]:
        return await reconcile_computer_use_projection_impl(
            self,
            user_id=user_id,
            start_date=start_date,
            end_date=end_date,
            days_back=days_back,
            auto_repair=auto_repair,
            tolerance_seconds=tolerance_seconds,
        )

    async def validate_computer_use_range_parity(
        self,
        user_id: str,
        start_date: str,
        end_date: str,
        tolerance_seconds: int = 60,
    ) -> Dict[str, Any]:
        return await validate_computer_use_range_parity_impl(
            self,
            user_id=user_id,
            start_date=start_date,
            end_date=end_date,
            tolerance_seconds=tolerance_seconds,
        )

    async def sync_to_computer_use_habit_range(
        self,
        user_id: str,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        days_back: int = 7,
        auto_reconcile: bool = False,
        tolerance_seconds: int = 60,
    ) -> Dict[str, Any]:
        return await sync_to_computer_use_habit_range_impl(
            self,
            user_id=user_id,
            start_date=start_date,
            end_date=end_date,
            days_back=days_back,
            auto_reconcile=auto_reconcile,
            tolerance_seconds=tolerance_seconds,
        )


# Global service instance
watcher_service = WatcherService()
