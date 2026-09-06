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
from services.wearables_unified import wearable_device_security_service

logger = logging.getLogger(__name__)


DOMAIN_DISCLOSURE = (
    "Website detail on iPhone is limited by Screen Time. Ritual can only show domains Apple exposes."
)


class ScreenTimeService:
    provider = "apple_screen_time"
    biome_source = "biome_iphone"

    async def register_device(self, user_id: str, device_name: str, platform: str) -> Tuple[str, str]:
        return await wearable_device_security_service.register_device(
            user_id,
            device_name,
            platform,
            provider=self.provider,
            create_connection=False,
        )

    async def list_devices(self, user_id: str) -> List[WearableDeviceDB]:
        return await wearable_device_security_service.list_devices(user_id, provider=self.provider)

    async def ingest_rollups(
        self,
        user_id: str,
        request: ScreenTimeIngestRequest,
    ) -> Tuple[bool, List[ScreenTimeIngestResult], Optional[str]]:
        validation = await wearable_device_security_service.validate_signed_device_request(
            user_id=user_id,
            provider=self.provider,
            device_id=request.device_id,
            client_event_id=request.client_event_id,
            captured_at=request.captured_at,
            signature=request.signature,
        )
        if not validation.success:
            error = "Device is not a Screen Time device" if validation.error == f"Device is not a {self.provider} device" else validation.error
            return False, [], error

        existing_event = await wearable_device_security_service.check_idempotency(
            request.device_id,
            request.client_event_id,
        )
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
        await wearable_device_security_service.record_ingest_event(
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

        biome_summary = await self._get_biome_summary(user_id, start_date, end_date)
        if biome_summary is not None and (
            int(biome_summary.get("total_active_ms", 0) or 0) > 0
            or biome_summary.get("daily")
        ):
            biome_summary["is_connected"] = True
            return biome_summary

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
            "source": "screen_time_rollup",
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
        biome_items = await self._get_biome_top_items(
            user_id,
            start_date,
            end_date,
            kind=kind,
            limit=limit,
        )
        if biome_items:
            return biome_items

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
        biome_rows = await self._get_biome_daily_breakdown(
            user_id,
            kind,
            key,
            start_date,
            end_date,
        )
        if biome_rows:
            return biome_rows

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

    async def _get_biome_snapshot(self, user_id: str, start_date: str, end_date: str, limit: int = 10) -> Optional[Dict[str, Any]]:
        try:
            from services.watcher_service import watcher_service

            return await watcher_service.get_computer_activity_snapshot(
                user_id=user_id,
                start_date=start_date,
                end_date=end_date,
                limit=limit,
                source_filter=self.biome_source,
            )
        except Exception as exc:
            logger.info("Biome iPhone activity snapshot unavailable for user=%s: %s", user_id, exc)
            return None

    async def _get_biome_summary(self, user_id: str, start_date: str, end_date: str) -> Optional[Dict[str, Any]]:
        snapshot = await self._get_biome_snapshot(user_id, start_date, end_date, limit=10)
        if not snapshot:
            return None
        summary = dict(snapshot.get("summary") or {})
        return {
            **summary,
            "is_connected": bool(summary.get("total_active_ms") or snapshot.get("daily")),
            "has_data": int(summary.get("total_active_ms", 0) or 0) > 0,
            "supports_domains": bool(snapshot.get("domains")),
            "domain_disclosure": DOMAIN_DISCLOSURE,
            "setup_href": "/integrations",
            "source": self.biome_source,
            "daily": [
                {
                    "day": row.get("day"),
                    "active_ms": int(row.get("active_ms", 0) or 0),
                }
                for row in (snapshot.get("daily") or [])
                if row.get("day")
            ],
        }

    async def _get_biome_top_items(
        self,
        user_id: str,
        start_date: str,
        end_date: str,
        *,
        kind: str,
        limit: int,
    ) -> List[Dict[str, Any]]:
        snapshot = await self._get_biome_snapshot(user_id, start_date, end_date, limit=limit)
        if not snapshot:
            return []
        if kind == "app":
            return [
                {
                    "app_bundle_id": row.get("app_bundle_id"),
                    "app_name": row.get("app_name") or row.get("app_bundle_id") or "Unknown",
                    "total_active_ms": int(row.get("total_active_ms", 0) or 0),
                    "total_events": int(row.get("total_events", 0) or 0),
                    "days_used": int(row.get("days_used", 0) or 0),
                    "source": self.biome_source,
                }
                for row in (snapshot.get("apps") or [])
                if int(row.get("total_active_ms", 0) or 0) > 0
            ]
        return [
            {
                "browser_domain": row.get("domain"),
                "domain": row.get("domain"),
                "total_active_ms": int(row.get("total_active_ms", 0) or 0),
                "total_events": int(row.get("total_events", 0) or 0),
                "days_used": int(row.get("days_used", 0) or 0),
                "source": self.biome_source,
            }
            for row in (snapshot.get("domains") or [])
            if row.get("domain") and int(row.get("total_active_ms", 0) or 0) > 0
        ]

    async def _get_biome_daily_breakdown(
        self,
        user_id: str,
        kind: str,
        key: str,
        start_date: str,
        end_date: str,
    ) -> List[Dict[str, Any]]:
        try:
            from services.watcher_service import watcher_service

            rows = await watcher_service.get_usage_daily_breakdown(
                user_id=user_id,
                kind=kind,
                key=key,
                start_date=start_date,
                end_date=end_date,
                source_filter=self.biome_source,
            )
        except Exception as exc:
            logger.info("Biome iPhone activity breakdown unavailable for user=%s: %s", user_id, exc)
            return []
        return [
            {
                **row,
                "source": self.biome_source,
            }
            for row in rows
        ]


screen_time_service = ScreenTimeService()
