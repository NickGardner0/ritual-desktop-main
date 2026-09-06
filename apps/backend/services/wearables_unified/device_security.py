"""Device registration and signed ingest checks for wearable device clients."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

from sqlalchemy import func, select

from database.connection import get_db_session
from database.models import (
    WearableConnectionDB,
    WearableDeviceDB,
    WearableEventDB,
    WearableIngestEventDB,
    WearableSampleDB,
)
from services.token_crypto import token_crypto

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class SignedWearableDeviceValidation:
    device: Optional[WearableDeviceDB]
    error: Optional[str] = None

    @property
    def success(self) -> bool:
        return self.device is not None and self.error is None


class WearableDeviceSecurityService:
    """Production seam for device registration, signature checks, and idempotency."""

    def __init__(self, connection_service, *, idempotency_window_hours: int = 24):
        self.connection_service = connection_service
        self.idempotency_window_hours = idempotency_window_hours

    async def register_device(
        self,
        user_id: str,
        device_name: str,
        platform: str,
        *,
        provider: str = "apple_health",
        create_connection: bool = True,
    ) -> Tuple[str, str]:
        async with get_db_session() as session:
            existing_result = await session.execute(
                select(WearableDeviceDB)
                .where(WearableDeviceDB.user_id == user_id)
                .where(WearableDeviceDB.provider == provider)
                .where(WearableDeviceDB.platform == platform)
                .where(WearableDeviceDB.device_name == device_name)
                .where(WearableDeviceDB.is_active == False)
                .order_by(WearableDeviceDB.registered_at.desc())
                .limit(1)
            )
            existing = existing_result.scalar_one_or_none()

            if existing:
                device_secret = self._new_device_secret()
                existing.device_secret_hash = token_crypto.encrypt(device_secret)
                existing.is_active = True
                existing.last_seen_at = datetime.now(timezone.utc)
                await session.commit()
                logger.info("✅ Reactivated wearable device %s for user %s", existing.id, user_id)
                return existing.id, device_secret

        device_id = str(uuid.uuid4())
        device_secret = self._new_device_secret()
        connection_id: Optional[str] = None

        if create_connection:
            connection = await self.connection_service.get_or_create_connection(
                user_id=user_id,
                provider=provider,
                auth_method="sdk",
                status="active",
            )
            connection_id = connection.id

        async with get_db_session() as session:
            device = WearableDeviceDB(
                id=device_id,
                user_id=user_id,
                provider=provider,
                connection_id=connection_id,
                device_name=device_name,
                platform=platform,
                device_secret_hash=token_crypto.encrypt(device_secret),
                registered_at=datetime.now(timezone.utc),
                last_seen_at=datetime.now(timezone.utc),
                is_active=True,
            )
            session.add(device)
            await session.commit()

        logger.info("✅ Registered wearable device %s for user %s", device_id, user_id)
        return device_id, device_secret

    async def get_device(self, device_id: str) -> Optional[WearableDeviceDB]:
        async with get_db_session() as session:
            result = await session.execute(select(WearableDeviceDB).where(WearableDeviceDB.id == device_id))
            return result.scalar_one_or_none()

    async def list_devices(self, user_id: str, provider: Optional[str] = None) -> list[WearableDeviceDB]:
        async with get_db_session() as session:
            query = (
                select(WearableDeviceDB)
                .where(WearableDeviceDB.user_id == user_id)
                .where(WearableDeviceDB.is_active == True)
                .order_by(WearableDeviceDB.registered_at.desc())
            )
            if provider:
                query = query.where(WearableDeviceDB.provider == provider)
            result = await session.execute(query)
            return list(result.scalars().all())

    async def deactivate_device(self, device_id: str, user_id: str) -> bool:
        async with get_db_session() as session:
            result = await session.execute(
                select(WearableDeviceDB)
                .where(WearableDeviceDB.id == device_id)
                .where(WearableDeviceDB.user_id == user_id)
            )
            device = result.scalar_one_or_none()
            if not device:
                return False
            device.is_active = False
            await session.commit()
        logger.info("✅ Deactivated wearable device %s", device_id)
        return True

    async def validate_signed_device_request(
        self,
        *,
        user_id: str,
        provider: str,
        device_id: str,
        client_event_id: str,
        captured_at: str,
        signature: str,
    ) -> SignedWearableDeviceValidation:
        device = await self.get_device(device_id)
        if not device:
            return SignedWearableDeviceValidation(device=None, error="Device not found")
        if device.user_id != user_id:
            return SignedWearableDeviceValidation(device=None, error="Device does not belong to this user")
        if device.provider != provider:
            return SignedWearableDeviceValidation(device=None, error=f"Device is not a {provider} device")
        if not device.is_active:
            return SignedWearableDeviceValidation(device=None, error="Device is deactivated")

        canonical = self.build_canonical_string(device_id, client_event_id, captured_at)
        device_secret = self.decrypt_stored_device_secret(device.device_secret_hash)
        if not self.verify_signature(device_secret, canonical, signature):
            logger.error("❌ Wearable signature verification failed for device %s", device_id)
            return SignedWearableDeviceValidation(device=None, error="Invalid signature")

        return SignedWearableDeviceValidation(device=device)

    def build_canonical_string(self, device_id: str, client_event_id: str, captured_at: str) -> str:
        canonical = f"{device_id}\n{client_event_id}\n{captured_at}"
        logger.info("📝 Wearable device canonical string: %s", canonical)
        return canonical

    def verify_signature(self, device_secret: str, canonical_string: str, provided_signature: str) -> bool:
        try:
            secret_bytes = base64.b64decode(device_secret)
            expected_sig = hmac.new(
                secret_bytes,
                canonical_string.encode("utf-8"),
                hashlib.sha256,
            ).digest()
            expected_sig_b64 = base64.b64encode(expected_sig).decode("utf-8")
            return hmac.compare_digest(expected_sig_b64, provided_signature)
        except Exception as exc:  # noqa: BLE001
            logger.warning("⚠️ Wearable signature verification error: %s", exc)
            return False

    async def check_idempotency(
        self,
        device_id: str,
        client_event_id: str,
    ) -> Optional[WearableIngestEventDB]:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=self.idempotency_window_hours)
        async with get_db_session() as session:
            result = await session.execute(
                select(WearableIngestEventDB)
                .where(WearableIngestEventDB.device_id == device_id)
                .where(WearableIngestEventDB.client_event_id == client_event_id)
                .where(WearableIngestEventDB.received_at >= cutoff)
            )
            return result.scalar_one_or_none()

    async def record_ingest_event(
        self,
        *,
        device_id: str,
        client_event_id: str,
        metrics_count: int,
        success_count: int,
        error_count: int,
        status: str,
    ) -> WearableIngestEventDB:
        async with get_db_session() as session:
            event = WearableIngestEventDB(
                id=str(uuid.uuid4()),
                device_id=device_id,
                client_event_id=client_event_id,
                metrics_count=metrics_count,
                success_count=success_count,
                error_count=error_count,
                received_at=datetime.now(timezone.utc),
                status=status,
            )
            session.add(event)
            await session.commit()
            await session.refresh(event)
            return event

    async def get_device_sync_status(self, device_id: str, user_id: str) -> Optional[dict[str, object]]:
        async with get_db_session() as session:
            result = await session.execute(
                select(WearableDeviceDB)
                .where(WearableDeviceDB.id == device_id)
                .where(WearableDeviceDB.user_id == user_id)
            )
            device = result.scalar_one_or_none()
            if not device:
                return None

            events_result = await session.execute(
                select(WearableIngestEventDB)
                .where(WearableIngestEventDB.device_id == device_id)
                .order_by(WearableIngestEventDB.received_at.desc())
                .limit(1)
            )
            last_event = events_result.scalar_one_or_none()

            connection = None
            if device.connection_id:
                connection_result = await session.execute(
                    select(WearableConnectionDB).where(WearableConnectionDB.id == device.connection_id)
                )
                connection = connection_result.scalar_one_or_none()

            today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
            sample_count_result = await session.execute(
                select(func.count(WearableSampleDB.id)).where(
                    WearableSampleDB.user_id == user_id,
                    WearableSampleDB.provider == device.provider,
                    WearableSampleDB.created_at >= today_start,
                    WearableSampleDB.deleted_at.is_(None),
                    WearableSampleDB.connection_id == device.connection_id if device.connection_id else True,
                )
            )
            event_count_result = await session.execute(
                select(func.count(WearableEventDB.id)).where(
                    WearableEventDB.user_id == user_id,
                    WearableEventDB.provider == device.provider,
                    WearableEventDB.created_at >= today_start,
                    WearableEventDB.deleted_at.is_(None),
                    WearableEventDB.connection_id == device.connection_id if device.connection_id else True,
                )
            )
            metrics_today = int(sample_count_result.scalar() or 0) + int(event_count_result.scalar() or 0)

            last_successful_sync = (
                connection.last_successful_sync_at.isoformat()
                if connection and connection.last_successful_sync_at
                else None
            )
            last_error = None
            if connection and connection.last_error_json:
                try:
                    last_error = json.loads(connection.last_error_json).get("message")
                except Exception:
                    last_error = connection.last_error_json

            return {
                "device_id": device.id,
                "device_name": device.device_name,
                "platform": device.platform,
                "is_connected": device.is_active,
                "last_successful_sync": last_successful_sync
                or (device.last_sync_at.isoformat() if device.last_sync_at else None),
                "last_sync_attempt": last_event.received_at.isoformat() if last_event else None,
                "last_error": last_error
                or (None if last_event and last_event.status == "success" else (last_event.status if last_event else None)),
                "metrics_synced_today": metrics_today,
                "background_sync_enabled": True,
                "offline_queue_count": 0,
            }

    @staticmethod
    def _new_device_secret() -> str:
        return base64.b64encode(os.urandom(32)).decode("utf-8")

    @staticmethod
    def decrypt_stored_device_secret(stored_secret: str) -> str:
        resolved = token_crypto.decrypt(stored_secret)
        if not resolved:
            raise ValueError("Device secret missing")
        return resolved
