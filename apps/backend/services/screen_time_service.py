"""
Screen Time service for iPhone companion aggregate activity breakdowns.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import delete, func, select

from database.connection import get_db_session
from database.models import ScreenTimeRollupDB, WearableDeviceDB
from schemas.screen_time import ScreenTimeIngestRequest, ScreenTimeIngestResult
from services.wearables_service import wearables_service

logger = logging.getLogger(__name__)


DOMAIN_DISCLOSURE = (
    "Website detail on iPhone is limited by Screen Time. Ritual can only show domains Apple exposes."
)


class ScreenTimeService:
    provider = "apple_screen_time"

    async def register_device(self, user_id: str, device_name: str, platform: str) -> Tuple[str, str]:
        return await wearables_service.register_device(
            user_id,
            device_name,
            platform,
            provider=self.provider,
            create_connection=False,
        )

    async def list_devices(self, user_id: str) -> List[WearableDeviceDB]:
        return await wearables_service.get_user_devices(user_id, provider=self.provider)

    async def ingest_rollups(
        self,
        user_id: str,
        request: ScreenTimeIngestRequest,
    ) -> Tuple[bool, List[ScreenTimeIngestResult], Optional[str]]:
        device = await wearables_service.get_device(request.device_id)
        if not device:
            return False, [], "Device not found"
        if device.user_id != user_id:
            return False, [], "Device does not belong to this user"
        if device.provider != self.provider:
            return False, [], "Device is not a Screen Time device"
        if not device.is_active:
            return False, [], "Device is deactivated"

        canonical = wearables_service.build_canonical_string(
            request.device_id,
            request.client_event_id,
            request.captured_at,
        )
        device_secret = wearables_service._decrypt_device_secret(device.device_secret_hash)
        if not wearables_service.verify_signature(device_secret, canonical, request.signature):
            logger.error("❌ Screen Time signature verification failed for device %s", request.device_id)
            return False, [], "Invalid signature"

        existing_event = await wearables_service.check_idempotency(request.device_id, request.client_event_id)
        if existing_event:
            logger.warning("⚠️ Duplicate Screen Time client_event_id: %s", request.client_event_id)
            return True, [], "Already processed (idempotency)"

        results: List[ScreenTimeIngestResult] = []
        async with get_db_session() as session:
            for idx, rollup in enumerate(request.rollups):
                try:
                    await session.execute(
                        delete(ScreenTimeRollupDB).where(
                            ScreenTimeRollupDB.user_id == user_id,
                            ScreenTimeRollupDB.device_id == request.device_id,
                            ScreenTimeRollupDB.provider == self.provider,
                            ScreenTimeRollupDB.day == rollup.day,
                            ScreenTimeRollupDB.breakdown_kind == rollup.breakdown_kind.value,
                            ScreenTimeRollupDB.entity_key == rollup.entity_key,
                        )
                    )

                    row = ScreenTimeRollupDB(
                        id=str(uuid.uuid4()),
                        user_id=user_id,
                        device_id=request.device_id,
                        provider=self.provider,
                        day=rollup.day,
                        timezone=rollup.timezone,
                        breakdown_kind=rollup.breakdown_kind.value,
                        entity_key=rollup.entity_key,
                        entity_label=rollup.entity_label,
                        active_seconds=rollup.active_seconds,
                        sort_seconds=rollup.sort_seconds if rollup.sort_seconds is not None else rollup.active_seconds,
                        metadata_json=json.dumps(rollup.metadata_json) if rollup.metadata_json is not None else None,
                        created_at=datetime.now(timezone.utc),
                        updated_at=datetime.now(timezone.utc),
                    )
                    session.add(row)
                    results.append(
                        ScreenTimeIngestResult(index=idx, success=True, stored_id=row.id)
                    )
                except Exception as exc:
                    logger.warning("⚠️ Error ingesting Screen Time rollup %s: %s", idx, exc)
                    results.append(ScreenTimeIngestResult(index=idx, success=False, error=str(exc)))

            current_device = await session.get(WearableDeviceDB, request.device_id)
            if current_device is not None:
                current_device.last_sync_at = datetime.now(timezone.utc)
                current_device.last_seen_at = datetime.now(timezone.utc)
            await session.commit()

        success_count = sum(1 for result in results if result.success)
        await wearables_service.record_ingest_event(
            device_id=request.device_id,
            client_event_id=request.client_event_id,
            metrics_count=len(request.rollups),
            success_count=success_count,
            error_count=len(request.rollups) - success_count,
            status="success" if success_count == len(request.rollups) else ("partial" if success_count else "failed"),
        )
        return success_count > 0, results, None

    async def get_summary(self, user_id: str, start_date: str, end_date: str) -> Dict[str, Any]:
        devices = await self.list_devices(user_id)
        is_connected = len(devices) > 0

        async with get_db_session() as session:
            daily_result = await session.execute(
                select(
                    ScreenTimeRollupDB.day,
                    func.sum(ScreenTimeRollupDB.active_seconds).label("active_seconds"),
                )
                .where(ScreenTimeRollupDB.user_id == user_id)
                .where(ScreenTimeRollupDB.provider == self.provider)
                .where(ScreenTimeRollupDB.breakdown_kind == "total")
                .where(ScreenTimeRollupDB.day >= start_date)
                .where(ScreenTimeRollupDB.day <= end_date)
                .group_by(ScreenTimeRollupDB.day)
                .order_by(ScreenTimeRollupDB.day.asc())
            )
            daily_rows = daily_result.all()

            domain_exists_result = await session.execute(
                select(func.count())
                .select_from(ScreenTimeRollupDB)
                .where(ScreenTimeRollupDB.user_id == user_id)
                .where(ScreenTimeRollupDB.provider == self.provider)
                .where(ScreenTimeRollupDB.breakdown_kind == "website")
            )
            supports_domains = bool(domain_exists_result.scalar() or 0)

        total_active_ms = sum(int((row.active_seconds or 0) * 1000) for row in daily_rows)
        return {
            "total_active_ms": total_active_ms,
            "is_connected": is_connected,
            "has_data": total_active_ms > 0,
            "supports_domains": supports_domains,
            "domain_disclosure": DOMAIN_DISCLOSURE,
            "setup_href": "/integrations",
            "daily": [
                {
                    "day": row.day,
                    "active_ms": int((row.active_seconds or 0) * 1000),
                }
                for row in daily_rows
            ],
        }

    async def get_top_items(
        self,
        user_id: str,
        start_date: str,
        end_date: str,
        *,
        kind: str,
        limit: int,
    ) -> List[Dict[str, Any]]:
        async with get_db_session() as session:
            result = await session.execute(
                select(
                    ScreenTimeRollupDB.entity_key,
                    ScreenTimeRollupDB.entity_label,
                    func.sum(ScreenTimeRollupDB.active_seconds).label("total_seconds"),
                    func.count(func.distinct(ScreenTimeRollupDB.day)).label("days_used"),
                )
                .where(ScreenTimeRollupDB.user_id == user_id)
                .where(ScreenTimeRollupDB.provider == self.provider)
                .where(ScreenTimeRollupDB.breakdown_kind == kind)
                .where(ScreenTimeRollupDB.day >= start_date)
                .where(ScreenTimeRollupDB.day <= end_date)
                .group_by(ScreenTimeRollupDB.entity_key, ScreenTimeRollupDB.entity_label)
                .order_by(func.sum(ScreenTimeRollupDB.sort_seconds).desc(), ScreenTimeRollupDB.entity_label.asc())
                .limit(limit)
            )
            rows = result.all()

        items: List[Dict[str, Any]] = []
        for row in rows:
            total_active_ms = int((row.total_seconds or 0) * 1000)
            if total_active_ms <= 0:
                continue
            if kind == "app":
                items.append(
                    {
                        "app_bundle_id": row.entity_key,
                        "app_name": row.entity_label,
                        "total_active_ms": total_active_ms,
                        "total_events": 0,
                        "days_used": int(row.days_used or 0),
                    }
                )
            else:
                items.append(
                    {
                        "browser_domain": row.entity_key,
                        "domain": row.entity_label,
                        "total_active_ms": total_active_ms,
                        "total_events": 0,
                        "days_used": int(row.days_used or 0),
                    }
                )
        return items

    async def get_daily_breakdown(
        self,
        user_id: str,
        kind: str,
        key: str,
        start_date: str,
        end_date: str,
    ) -> List[Dict[str, Any]]:
        async with get_db_session() as session:
            result = await session.execute(
                select(
                    ScreenTimeRollupDB.day,
                    func.sum(ScreenTimeRollupDB.active_seconds).label("total_seconds"),
                )
                .where(ScreenTimeRollupDB.user_id == user_id)
                .where(ScreenTimeRollupDB.provider == self.provider)
                .where(ScreenTimeRollupDB.breakdown_kind == kind)
                .where(ScreenTimeRollupDB.entity_key == key)
                .where(ScreenTimeRollupDB.day >= start_date)
                .where(ScreenTimeRollupDB.day <= end_date)
                .group_by(ScreenTimeRollupDB.day)
                .order_by(ScreenTimeRollupDB.day.asc())
            )
            rows = result.all()

        return [
            {
                "day": row.day,
                "active_ms": int((row.total_seconds or 0) * 1000),
                "events_count": 0,
                "first_start_ms": None,
                "last_end_ms": None,
                "source": "screen_time_rollup",
            }
            for row in rows
        ]


screen_time_service = ScreenTimeService()
