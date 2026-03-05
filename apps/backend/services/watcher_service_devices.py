"""Extracted device-management logic for WatcherService."""

from __future__ import annotations

import json
import logging
import uuid
from typing import Dict, List, Optional, Tuple

from sqlalchemy import select

from database.models import WatcherDeviceDB, WatcherStateDB

logger = logging.getLogger(__name__)


async def register_device_impl(
    service,
    user_id: str,
    device_name: str = "My Mac",
    platform: str = "macos",
    os_version: Optional[str] = None,
) -> Tuple[str, Dict]:
    """Register a new device for the watcher."""
    device_id = str(uuid.uuid4())
    now_ms = service._now_ms()

    async with service._get_db_session() as session:
        device = WatcherDeviceDB(
            device_id=device_id,
            user_id=user_id,
            device_name=device_name,
            platform=platform,
            os_version=os_version,
            created_at=now_ms,
            last_seen_at=now_ms,
        )
        session.add(device)

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
            updated_at=now_ms,
        )
        session.add(state)

        await session.commit()

        logger.info("Registered watcher device: %s for user %s", device_id, user_id)

        return device_id, {
            "device_id": device_id,
            "is_enabled": False,
            "poll_interval_ms": 2000,
            "accessibility_status": "unknown",
            "title_mode": "off",
            "excluded_bundle_ids": [],
        }


async def get_device_impl(service, device_id: str, user_id: str) -> Optional[Dict]:
    """Get device info and state."""
    async with service._get_db_session() as session:
        result = await session.execute(
            select(WatcherDeviceDB, WatcherStateDB)
            .outerjoin(WatcherStateDB, WatcherDeviceDB.device_id == WatcherStateDB.device_id)
            .where(
                WatcherDeviceDB.device_id == device_id,
                WatcherDeviceDB.user_id == user_id,
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
                "excluded_bundle_ids": json.loads(state.excluded_bundle_ids)
                if state and state.excluded_bundle_ids
                else [],
                "sync_analytics": bool(state.sync_analytics) if state else False,
                "sync_raw_to_cloud": bool(state.sync_raw_to_cloud) if state else False,
                "afk_timeout_seconds": (
                    state.afk_timeout_seconds
                    if hasattr(state, "afk_timeout_seconds") and state.afk_timeout_seconds
                    else 900
                )
                if state
                else 900,
            }
            if state
            else None,
        }


async def get_user_devices_impl(service, user_id: str) -> List[Dict]:
    """Get all devices for a user."""
    async with service._get_db_session() as session:
        result = await session.execute(
            select(WatcherDeviceDB, WatcherStateDB)
            .outerjoin(WatcherStateDB, WatcherDeviceDB.device_id == WatcherStateDB.device_id)
            .where(WatcherDeviceDB.user_id == user_id)
            .order_by(WatcherDeviceDB.created_at.desc())
        )
        rows = result.all()

        devices = []
        for device, state in rows:
            devices.append(
                {
                    "device_id": device.device_id,
                    "device_name": device.device_name,
                    "platform": device.platform,
                    "is_enabled": bool(state.is_enabled) if state else False,
                    "last_seen_ts": state.last_seen_ts if state else None,
                    "accessibility_status": state.accessibility_status if state else "unknown",
                }
            )

        return devices


async def update_device_state_impl(
    service,
    device_id: str,
    user_id: str,
    **updates,
) -> Optional[Dict]:
    """Update device watcher state."""
    async with service._get_db_session() as session:
        result = await session.execute(
            select(WatcherDeviceDB).where(
                WatcherDeviceDB.device_id == device_id,
                WatcherDeviceDB.user_id == user_id,
            )
        )
        device = result.scalar_one_or_none()

        if not device:
            return None

        result = await session.execute(
            select(WatcherStateDB).where(WatcherStateDB.device_id == device_id)
        )
        state = result.scalar_one_or_none()

        if not state:
            state = WatcherStateDB(
                device_id=device_id,
                updated_at=service._now_ms(),
            )
            session.add(state)

        allowed_fields = [
            "is_enabled",
            "poll_interval_ms",
            "accessibility_status",
            "title_mode",
            "truncate_length",
            "excluded_bundle_ids",
            "sync_analytics",
            "sync_raw_to_cloud",
            "afk_timeout_seconds",
        ]

        for key, value in updates.items():
            if key in allowed_fields:
                if key == "excluded_bundle_ids" and isinstance(value, list):
                    value = json.dumps(value)
                elif key in ["is_enabled", "sync_analytics", "sync_raw_to_cloud"]:
                    value = 1 if value else 0
                setattr(state, key, value)

        state.updated_at = service._now_ms()

        await session.commit()
        await session.refresh(state)

        return {
            "device_id": device_id,
            "is_enabled": bool(state.is_enabled),
            "poll_interval_ms": state.poll_interval_ms,
            "accessibility_status": state.accessibility_status,
            "title_mode": state.title_mode,
            "truncate_length": state.truncate_length,
            "excluded_bundle_ids": json.loads(state.excluded_bundle_ids)
            if state.excluded_bundle_ids
            else [],
            "sync_analytics": bool(state.sync_analytics),
            "sync_raw_to_cloud": bool(state.sync_raw_to_cloud),
            "afk_timeout_seconds": state.afk_timeout_seconds
            if hasattr(state, "afk_timeout_seconds") and state.afk_timeout_seconds
            else 900,
        }


async def heartbeat_impl(service, device_id: str, user_id: str) -> bool:
    """Update device heartbeat timestamp."""
    now_ms = service._now_ms()

    async with service._get_db_session() as session:
        result = await session.execute(
            select(WatcherDeviceDB).where(
                WatcherDeviceDB.device_id == device_id,
                WatcherDeviceDB.user_id == user_id,
            )
        )
        device = result.scalar_one_or_none()

        if not device:
            return False

        device.last_seen_at = now_ms

        result = await session.execute(
            select(WatcherStateDB).where(WatcherStateDB.device_id == device_id)
        )
        state = result.scalar_one_or_none()

        if state:
            state.last_seen_ts = now_ms

        await session.commit()
        return True
