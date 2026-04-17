"""
Wearables Service - Handles device registration, metric ingestion, and signature verification.
Supports Apple Health and other wearable data sources.
"""

import os
import uuid
import hmac
import hashlib
import base64
import json
import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any, Tuple
from concurrent.futures import ThreadPoolExecutor

from sqlalchemy import select, and_, func
from sqlalchemy.ext.asyncio import AsyncSession

from database.connection import get_db_session
from database.models import (
    WearableDeviceDB,
    WearableConnectionDB,
    WearableEventDB,
    WearableMetricDB,
    WearableIngestEventDB,
    WearableSampleDB,
    HabitDB,
    HabitLogDB,
)
from services.token_crypto import token_crypto
from services.unified_wearables_service import (
    wearable_connection_service,
    wearable_query_service,
    wearable_sync_service,
)
from schemas.wearables_apple import (
    NormalizedMetricSchema,
    AppleIngestRequest,
    AppleIngestRequestV2,
    AppleIngestResult,
    DeleteResult,
)

logger = logging.getLogger(__name__)

# Background task executor for non-blocking operations
_background_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="wearables_bg_")


class WearablesService:
    """Service for managing wearable devices and metrics ingestion"""
    
    def __init__(self):
        # Secret for generating device secrets (use env var in production)
        self.master_secret = os.getenv("WEARABLES_MASTER_SECRET", "ritual-wearables-dev-secret")
        # Idempotency window (24 hours)
        self.idempotency_window_hours = 24
        # Background task queue for async operations
        self._pending_tinybird_syncs: List[Dict[str, Any]] = []
        self._tinybird_batch_size = 50
        self._tinybird_flush_interval = 5  # seconds

    def _decrypt_device_secret(self, stored_secret: str) -> str:
        """Resolve legacy plaintext and encrypted device secrets."""
        resolved = token_crypto.decrypt(stored_secret)
        if not resolved:
            raise ValueError("Device secret missing")
        return resolved
    
    def queue_tinybird_sync(self, log_data: Dict[str, Any]) -> None:
        """Queue a habit log for async Tinybird sync"""
        self._pending_tinybird_syncs.append(log_data)
        
        # If batch is full, trigger immediate flush
        if len(self._pending_tinybird_syncs) >= self._tinybird_batch_size:
            asyncio.create_task(self._flush_tinybird_batch())
    
    async def force_flush_tinybird_batch(self) -> int:
        """Force flush all pending Tinybird syncs regardless of batch size"""
        if not self._pending_tinybird_syncs:
            return 0
        
        count = len(self._pending_tinybird_syncs)
        
        try:
            from services.tinybird_service import TinybirdService
            tinybird = TinybirdService()
            
            result = await tinybird.ingest_habit_logs_batch(self._pending_tinybird_syncs)
            total_ingested = int(result.get("total_ingested") or 0)
            if not result.get("success"):
                logger.warning(f"⚠️ Tinybird force flush had errors: {result.get('errors')}")

            logger.info(f"📊 Tinybird force flush: {total_ingested}/{count} logs synced")
            self._pending_tinybird_syncs = []
            return total_ingested
        except Exception as e:
            logger.warning(f"⚠️ Tinybird force flush failed: {e}")
            return 0
    
    async def _flush_tinybird_batch(self) -> None:
        """Flush pending Tinybird syncs in batch"""
        if not self._pending_tinybird_syncs:
            return
        
        # Grab current batch
        batch = self._pending_tinybird_syncs[:self._tinybird_batch_size]
        self._pending_tinybird_syncs = self._pending_tinybird_syncs[self._tinybird_batch_size:]
        
        try:
            from services.tinybird_service import TinybirdService
            tinybird = TinybirdService()
            
            result = await tinybird.ingest_habit_logs_batch(batch)
            total_ingested = int(result.get("total_ingested") or 0)
            if not result.get("success"):
                logger.warning(f"⚠️ Tinybird batch sync had errors: {result.get('errors')}")

            logger.info(f"📊 Tinybird batch sync: {total_ingested}/{len(batch)} logs")
        except Exception as e:
            logger.warning(f"⚠️ Tinybird batch sync failed: {e}")
            # Re-queue failed items (up to a limit to prevent infinite loops)
            if len(batch) < 100:
                self._pending_tinybird_syncs.extend(batch)
    
    # ================================
    # Device Registration
    # ================================
    
    async def register_device(
        self,
        user_id: str,
        device_name: str,
        platform: str,
        *,
        provider: str = "apple_health",
        create_connection: bool = True,
    ) -> Tuple[str, str]:
        """
        Register a new device for a user.
        Returns (device_id, device_secret) - secret should be stored in iOS Keychain.
        """
        device_id = str(uuid.uuid4())
        
        # Generate a secure device secret (32 bytes, base64 encoded)
        device_secret_bytes = os.urandom(32)
        device_secret = base64.b64encode(device_secret_bytes).decode('utf-8')
        
        # Encrypt secrets at rest before storing in the database.
        device_secret_hash = token_crypto.encrypt(device_secret)
        connection_id: Optional[str] = None
        if create_connection:
            connection = await wearable_connection_service.get_or_create_connection(
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
                device_secret_hash=device_secret_hash,
                registered_at=datetime.now(timezone.utc),
                last_seen_at=datetime.now(timezone.utc),
                is_active=True
            )
            session.add(device)
            await session.commit()
        
        logger.info(f"✅ Registered device {device_id} for user {user_id}")
        return device_id, device_secret
    
    async def get_device(self, device_id: str) -> Optional[WearableDeviceDB]:
        """Get a device by ID"""
        async with get_db_session() as session:
            result = await session.execute(
                select(WearableDeviceDB).where(WearableDeviceDB.id == device_id)
            )
            return result.scalar_one_or_none()
    
    async def get_user_devices(self, user_id: str, provider: Optional[str] = None) -> List[WearableDeviceDB]:
        """Get all devices for a user"""
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
        """Deactivate a device (soft delete)"""
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
            
        logger.info(f"✅ Deactivated device {device_id}")
        return True
    
    # ================================
    # Signature Verification
    # ================================
    
    def build_canonical_string(
        self,
        device_id: str,
        client_event_id: str,
        captured_at: str
    ) -> str:
        """
        Build the canonical string for signature verification.
        
        We intentionally exclude metrics from the signature because:
        1. Float serialization differs between iOS (259) and Python (259.0)
        2. The signature still provides security via device_secret verification
        3. captured_at provides replay protection
        4. client_event_id provides idempotency
        """
        canonical = f"{device_id}\n{client_event_id}\n{captured_at}"
        logger.info(f"📝 Backend canonical string: {canonical}")
        return canonical
    
    def verify_signature(
        self,
        device_secret: str,
        canonical_string: str,
        provided_signature: str
    ) -> bool:
        """
        Verify HMAC-SHA256 signature.
        Returns True if signature is valid.
        """
        try:
            # Compute expected signature
            secret_bytes = base64.b64decode(device_secret)
            expected_sig = hmac.new(
                secret_bytes,
                canonical_string.encode('utf-8'),
                hashlib.sha256
            ).digest()
            expected_sig_b64 = base64.b64encode(expected_sig).decode('utf-8')

            # Constant-time comparison to prevent timing attacks
            return hmac.compare_digest(expected_sig_b64, provided_signature)
        except Exception as e:
            logger.warning(f"⚠️ Signature verification error: {e}")
            return False
    
    # ================================
    # Idempotency Check
    # ================================
    
    async def check_idempotency(
        self,
        device_id: str,
        client_event_id: str
    ) -> Optional[WearableIngestEventDB]:
        """
        Check if this client_event_id was already processed.
        Returns the existing event if found within the idempotency window.
        """
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
        device_id: str,
        client_event_id: str,
        metrics_count: int,
        success_count: int,
        error_count: int,
        status: str
    ) -> WearableIngestEventDB:
        """Record an ingest event for idempotency tracking"""
        event_id = str(uuid.uuid4())
        
        async with get_db_session() as session:
            event = WearableIngestEventDB(
                id=event_id,
                device_id=device_id,
                client_event_id=client_event_id,
                metrics_count=metrics_count,
                success_count=success_count,
                error_count=error_count,
                received_at=datetime.now(timezone.utc),
                status=status
            )
            session.add(event)
            await session.commit()
            await session.refresh(event)
            return event
    
    # ================================
    # Metrics Ingestion
    # ================================
    
    async def ingest_metrics(
        self,
        user_id: str,
        device_id: str,
        metrics: List[NormalizedMetricSchema]
    ) -> List[AppleIngestResult]:
        """
        Ingest normalized metrics into the database.
        Returns per-item results.
        Never fails completely - returns partial success if some metrics fail.
        """
        results: List[AppleIngestResult] = []
        
        async with get_db_session() as session:
            for idx, metric in enumerate(metrics):
                try:
                    metric_id = str(uuid.uuid4())
                    
                    # Parse timestamps
                    start_time = datetime.fromisoformat(metric.start_time.replace('Z', '+00:00'))
                    end_time = datetime.fromisoformat(metric.end_time.replace('Z', '+00:00'))
                    recorded_at = None
                    if metric.recorded_at:
                        recorded_at = datetime.fromisoformat(metric.recorded_at.replace('Z', '+00:00'))
                    
                    # Store raw payload as JSON string
                    raw_payload_str = None
                    if metric.raw_payload is not None:
                        raw_payload_str = json.dumps(metric.raw_payload)
                    
                    # Check for duplicate external_id (if provided)
                    if metric.external_id:
                        existing = await session.execute(
                            select(WearableMetricDB)
                            .where(WearableMetricDB.user_id == user_id)
                            .where(WearableMetricDB.source == metric.source.value)
                            .where(WearableMetricDB.external_id == metric.external_id)
                        )
                        if existing.scalar_one_or_none():
                            results.append(AppleIngestResult(
                                index=idx,
                                success=True,
                                stored_id=None,
                                error="Duplicate external_id - already exists"
                            ))
                            continue
                    
                    # Create metric record
                    db_metric = WearableMetricDB(
                        id=metric_id,
                        user_id=user_id,
                        device_id=device_id,
                        source=metric.source.value,
                        metric_type=metric.metric_type.value,
                        start_time=start_time,
                        end_time=end_time,
                        timezone=metric.timezone,
                        value=metric.value,
                        unit=metric.unit.value,
                        confidence=metric.confidence,
                        external_id=metric.external_id,
                        recorded_at=recorded_at,
                        raw_payload=raw_payload_str,
                        created_at=datetime.now(timezone.utc)
                    )
                    session.add(db_metric)
                    
                    results.append(AppleIngestResult(
                        index=idx,
                        success=True,
                        stored_id=metric_id
                    ))
                    
                except Exception as e:
                    logger.warning(f"⚠️ Error ingesting metric {idx}: {e}")
                    results.append(AppleIngestResult(
                        index=idx,
                        success=False,
                        error=str(e)
                    ))
            
            # Commit all successful metrics
            await session.commit()
            
            # Update device last_sync_at
            device_result = await session.execute(
                select(WearableDeviceDB).where(WearableDeviceDB.id == device_id)
            )
            device = device_result.scalar_one_or_none()
            if device:
                device.last_sync_at = datetime.now(timezone.utc)
                await session.commit()
        
        return results
    
    async def process_ingest_request(
        self,
        user_id: str,
        request: AppleIngestRequest
    ) -> Tuple[bool, List[AppleIngestResult], Optional[str]]:
        """
        Process a complete ingest request (V1 - legacy).
        
        Returns:
            (success, results, error_message)
        """
        # 1. Get device and verify ownership
        device = await self.get_device(request.device_id)
        if not device:
            return False, [], "Device not found"
        
        if device.user_id != user_id:
            return False, [], "Device does not belong to this user"
        
        if not device.is_active:
            return False, [], "Device is deactivated"
        
        # 2. Verify signature (excludes metrics hash due to cross-platform serialization differences)
        canonical = self.build_canonical_string(
            request.device_id,
            request.client_event_id,
            request.captured_at
        )
        
        device_secret = self._decrypt_device_secret(device.device_secret_hash)
        if not self.verify_signature(device_secret, canonical, request.signature):
            logger.error(f"❌ Signature verification failed for device {request.device_id}")
            return False, [], "Invalid signature"
        
        # 3. Check idempotency
        existing_event = await self.check_idempotency(request.device_id, request.client_event_id)
        if existing_event:
            logger.warning(f"⚠️ Duplicate client_event_id: {request.client_event_id}")
            return True, [], "Already processed (idempotency)"
        
        # 4. Backfill legacy Apple rows into canonical storage once, then ingest the batch canonically.
        try:
            await wearable_sync_service.backfill_legacy_apple_metrics(user_id)
        except Exception as exc:
            logger.warning("⚠️ Legacy Apple backfill skipped: %s", exc)

        stored_records = await wearable_sync_service.ingest_apple_metrics(
            user_id=user_id,
            device_id=request.device_id,
            metrics=request.metrics,
        )
        results = [
            AppleIngestResult(
                index=idx,
                success=True,
                stored_id=stored_id,
            )
            for idx, (stored_id, _kind) in enumerate(stored_records)
        ]
        
        # 5. Record ingest event
        success_count = sum(1 for r in results if r.success)
        error_count = sum(1 for r in results if not r.success)
        status = "success" if error_count == 0 else ("partial" if success_count > 0 else "failed")
        
        await self.record_ingest_event(
            device_id=request.device_id,
            client_event_id=request.client_event_id,
            metrics_count=len(request.metrics),
            success_count=success_count,
            error_count=error_count,
            status=status
        )
        
        logger.info(f"✅ Ingested {success_count}/{len(request.metrics)} metrics for device {request.device_id}")
        
        return success_count > 0, results, None
    
    # ================================
    # V2 Ingest with Incremental Sync
    # ================================
    
    async def delete_metrics_by_external_ids(
        self,
        user_id: str,
        external_ids: List[str]
    ) -> List[DeleteResult]:
        """
        Delete metrics by their external_id (HealthKit UUID).
        Also deletes corresponding habit_logs.
        """
        results: List[DeleteResult] = []

        for external_id in external_ids:
            try:
                deleted = await wearable_sync_service.delete_records_by_external_ids(
                    user_id=user_id,
                    provider="apple_health",
                    external_ids=[external_id],
                )
                if deleted["samples"] == 0 and deleted["events"] == 0:
                    results.append(
                        DeleteResult(
                            external_id=external_id,
                            success=True,
                            error="Not found (already deleted)",
                        )
                    )
                    continue
                results.append(DeleteResult(external_id=external_id, success=True))
            except Exception as e:
                logger.warning(f"⚠️ Error deleting metric {external_id}: {e}")
                results.append(
                    DeleteResult(
                        external_id=external_id,
                        success=False,
                        error=str(e),
                    )
                )
        return results

    async def _run_legacy_backfill_once(self, user_id: str) -> None:
        """Run the legacy Apple Health metrics backfill exactly once per user.

        The backfill scans the entire legacy `wearable_metrics` table for the
        user and upserts each row into the new wearable_samples/wearable_events
        tables. For users with months of historical data this can take many
        minutes and was previously running on every ingest, blocking the iOS
        client past its request timeout. We now gate it behind a per-user
        flag stored in the apple_health connection's settings_json.
        """
        async with get_db_session() as session:
            stmt = select(WearableConnectionDB).where(
                WearableConnectionDB.user_id == user_id,
                WearableConnectionDB.provider == "apple_health",
            )
            conn = (await session.execute(stmt)).scalar_one_or_none()

            settings: Dict[str, Any] = {}
            if conn and conn.settings_json:
                try:
                    raw = conn.settings_json
                    settings = json.loads(raw) if isinstance(raw, str) else raw
                except Exception:
                    settings = {}

            if settings.get("legacy_backfill_completed_at"):
                return

        try:
            result = await wearable_sync_service.backfill_legacy_apple_metrics(user_id)
            logger.info(
                "✅ Legacy Apple backfill completed for user %s: %s",
                user_id, result,
            )
        except Exception as exc:
            logger.warning("⚠️ Legacy Apple backfill failed for user %s: %s", user_id, exc)
            return

        async with get_db_session() as session:
            stmt = select(WearableConnectionDB).where(
                WearableConnectionDB.user_id == user_id,
                WearableConnectionDB.provider == "apple_health",
            )
            conn = (await session.execute(stmt)).scalar_one_or_none()
            if not conn:
                return
            settings = {}
            if conn.settings_json:
                try:
                    raw = conn.settings_json
                    settings = json.loads(raw) if isinstance(raw, str) else raw
                except Exception:
                    settings = {}
            settings["legacy_backfill_completed_at"] = (
                datetime.now(timezone.utc).isoformat()
            )
            conn.settings_json = json.dumps(settings)
            await session.commit()

    async def process_ingest_request_v2(
        self,
        user_id: str,
        request: AppleIngestRequestV2
    ) -> Tuple[bool, List[AppleIngestResult], List[DeleteResult], List[AppleIngestResult], Optional[str]]:
        """
        Process a V2 ingest request with incremental sync support.
        
        Returns:
            (success, added_results, deleted_results, modified_results, error_message)
        """
        # 1. Get device and verify ownership
        device = await self.get_device(request.device_id)
        if not device:
            return False, [], [], [], "Device not found"
        
        if device.user_id != user_id:
            return False, [], [], [], "Device does not belong to this user"
        
        if not device.is_active:
            return False, [], [], [], "Device is deactivated"
        
        # 2. Verify signature
        canonical = self.build_canonical_string(
            request.device_id,
            request.client_event_id,
            request.captured_at
        )
        
        device_secret = self._decrypt_device_secret(device.device_secret_hash)
        if not self.verify_signature(device_secret, canonical, request.signature):
            logger.error(f"❌ Signature verification failed for device {request.device_id}")
            return False, [], [], [], "Invalid signature"
        
        # 3. Check idempotency
        existing_event = await self.check_idempotency(request.device_id, request.client_event_id)
        if existing_event:
            logger.warning(f"⚠️ Duplicate client_event_id: {request.client_event_id}")
            return True, [], [], [], "Already processed (idempotency)"
        
        await self._run_legacy_backfill_once(user_id)

        # 4. Process added metrics
        added_results: List[AppleIngestResult] = []
        if request.added:
            added_records = await wearable_sync_service.ingest_apple_metrics(
                user_id=user_id,
                device_id=request.device_id,
                metrics=request.added,
            )
            added_results = [
                AppleIngestResult(index=idx, success=True, stored_id=stored_id)
                for idx, (stored_id, _kind) in enumerate(added_records)
            ]
        
        # 5. Process deleted metrics
        deleted_results: List[DeleteResult] = []
        if request.deleted:
            deleted_results = await self.delete_metrics_by_external_ids(user_id, request.deleted)
        
        # 6. Process modified metrics (treat as upsert)
        modified_results: List[AppleIngestResult] = []
        if request.modified:
            # For modified, we delete old and insert new
            for metric in request.modified:
                if metric.external_id:
                    await self.delete_metrics_by_external_ids(user_id, [metric.external_id])
            modified_records = await wearable_sync_service.ingest_apple_metrics(
                user_id=user_id,
                device_id=request.device_id,
                metrics=request.modified,
            )
            modified_results = [
                AppleIngestResult(index=idx, success=True, stored_id=stored_id)
                for idx, (stored_id, _kind) in enumerate(modified_records)
            ]
        
        # 7. Record ingest event
        total_ops = len(request.added) + len(request.deleted) + len(request.modified)
        added_success = sum(1 for r in added_results if r.success)
        deleted_success = sum(1 for r in deleted_results if r.success)
        modified_success = sum(1 for r in modified_results if r.success)
        total_success = added_success + deleted_success + modified_success
        
        status = "success" if total_success == total_ops else ("partial" if total_success > 0 else "failed")
        
        await self.record_ingest_event(
            device_id=request.device_id,
            client_event_id=request.client_event_id,
            metrics_count=total_ops,
            success_count=total_success,
            error_count=total_ops - total_success,
            status=status
        )
        
        logger.info(f"✅ V2 Ingest: {added_success} added, {deleted_success} deleted, {modified_success} modified")
        
        return total_success > 0, added_results, deleted_results, modified_results, None
    
    # ================================
    # Sync Status for Desktop UI
    # ================================
    
    async def get_device_sync_status(self, device_id: str, user_id: str) -> Optional[Dict[str, Any]]:
        """Get sync status for a device (for desktop UI)"""
        async with get_db_session() as session:
            result = await session.execute(
                select(WearableDeviceDB)
                .where(WearableDeviceDB.id == device_id)
                .where(WearableDeviceDB.user_id == user_id)
            )
            device = result.scalar_one_or_none()
            
            if not device:
                return None
            
            # Get recent ingest events
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

            # Count canonical records synced today
            today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
            sample_count_result = await session.execute(
                select(func.count(WearableSampleDB.id)).where(
                    WearableSampleDB.user_id == user_id,
                    WearableSampleDB.provider == "apple_health",
                    WearableSampleDB.created_at >= today_start,
                    WearableSampleDB.deleted_at.is_(None),
                    WearableSampleDB.connection_id == device.connection_id if device.connection_id else True,
                )
            )
            event_count_result = await session.execute(
                select(func.count(WearableEventDB.id)).where(
                    WearableEventDB.user_id == user_id,
                    WearableEventDB.provider == "apple_health",
                    WearableEventDB.created_at >= today_start,
                    WearableEventDB.deleted_at.is_(None),
                    WearableEventDB.connection_id == device.connection_id if device.connection_id else True,
                )
            )
            metrics_today = int(sample_count_result.scalar() or 0) + int(event_count_result.scalar() or 0)
            last_successful_sync = (
                connection.last_successful_sync_at.isoformat() if connection and connection.last_successful_sync_at else None
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
                "last_successful_sync": last_successful_sync or (device.last_sync_at.isoformat() if device.last_sync_at else None),
                "last_sync_attempt": last_event.received_at.isoformat() if last_event else None,
                "last_error": last_error or (None if last_event and last_event.status == "success" else (last_event.status if last_event else None)),
                "metrics_synced_today": metrics_today,
                "background_sync_enabled": True,
                "offline_queue_count": 0  # Would need client to report this
            }
    
    # ================================
    # Query Metrics (for desktop app)
    # ================================
    
    async def get_user_metrics(
        self,
        user_id: str,
        source: Optional[str] = None,
        metric_type: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        limit: int = 100
    ) -> List[WearableSampleDB]:
        """Compatibility wrapper returning canonical wearable samples."""
        return await wearable_query_service.get_samples(
            user_id=user_id,
            provider=source,
            metric_type=metric_type,
            start_time=start_date,
            end_time=end_date,
            limit=limit,
        )
    
    # ================================
    # Convert Metrics to Habit Logs
    # ================================
    
    async def create_habit_logs_from_metrics(
        self,
        user_id: str,
        metrics: List[NormalizedMetricSchema]
    ) -> Dict[str, Any]:
        """
        Convert ingested Apple Health metrics into habit_logs.
        
        For each metric:
        1. Find a habit where integration_source='apple_health' and metric_type matches
        2. Create/update a habit_log for that date
        3. Sync to Tinybird
        
        Returns summary of created logs.
        """
        from services.tinybird_service import TinybirdService
        
        created_logs = []
        skipped = []
        errors = []
        
        # Initialize Tinybird
        try:
            tinybird = TinybirdService()
            tinybird_enabled = True
        except Exception as e:
            logger.warning(f"⚠️ Tinybird not available: {e}")
            tinybird = None
            tinybird_enabled = False
        
        async with get_db_session() as session:
            # Get all Apple Health habits for this user
            result = await session.execute(
                select(HabitDB)
                .where(HabitDB.user_id == user_id)
                .where(HabitDB.integration_source == "apple_health")
                .where(HabitDB.metric_type.isnot(None))
            )
            apple_habits = list(result.scalars().all())
            
            if not apple_habits:
                logger.info(f"📊 No Apple Health habits found for user {user_id}")
                return {
                    "created": 0,
                    "skipped": len(metrics),
                    "errors": 0,
                    "message": "No Apple Health habits configured. Select metrics to track in the desktop app."
                }
            
            # Create a map of metric_type -> habit
            habit_by_metric = {h.metric_type: h for h in apple_habits}
            logger.info(f"📊 Found {len(apple_habits)} Apple Health habits: {list(habit_by_metric.keys())}")
            
            for metric in metrics:
                try:
                    metric_type = metric.metric_type.value
                    
                    # Find matching habit
                    habit = habit_by_metric.get(metric_type)
                    if not habit:
                        skipped.append(metric_type)
                        continue
                    
                    # Parse the date from metric
                    start_time = datetime.fromisoformat(metric.start_time.replace('Z', '+00:00'))
                    log_date = start_time.strftime('%Y-%m-%d')
                    
                    # Check if log already exists for this habit and date
                    existing = await session.execute(
                        select(HabitLogDB)
                        .where(HabitLogDB.habit_id == habit.id)
                        .where(HabitLogDB.date == log_date)
                        .where(HabitLogDB.source == "apple_health")
                    )
                    existing_log = existing.scalar_one_or_none()
                    
                    if existing_log:
                        # Update existing log with new value
                        existing_log.amount = metric.value
                        existing_log.completed_at = datetime.now(timezone.utc).isoformat()
                        await session.commit()
                        
                        # Sync update to Tinybird
                        if tinybird_enabled:
                            await self._sync_log_to_tinybird(
                                tinybird, existing_log, habit, user_id, metric.unit.value
                            )
                        
                        created_logs.append({
                            "habit": habit.name,
                            "date": log_date,
                            "value": metric.value,
                            "updated": True
                        })
                    else:
                        # Create new log
                        log_id = str(uuid.uuid4())
                        new_log = HabitLogDB(
                            id=log_id,
                            habit_id=habit.id,
                            habit_name=habit.name,
                            date=log_date,
                            amount=metric.value,
                            status="completed",
                            completed_at=datetime.now(timezone.utc).isoformat(),
                            source="apple_health",
                            notes=f"Auto-synced from Apple Health"
                        )
                        session.add(new_log)
                        await session.commit()
                        
                        # Sync to Tinybird
                        if tinybird_enabled:
                            await self._sync_log_to_tinybird(
                                tinybird, new_log, habit, user_id, metric.unit.value
                            )
                        
                        created_logs.append({
                            "habit": habit.name,
                            "date": log_date,
                            "value": metric.value,
                            "updated": False
                        })
                        
                except Exception as e:
                    logger.warning(f"⚠️ Error creating habit log: {e}")
                    errors.append(str(e))
        
        logger.info(f"✅ Created/updated {len(created_logs)} habit logs, skipped {len(skipped)}, errors {len(errors)}")
        
        return {
            "created": len(created_logs),
            "skipped": len(skipped),
            "errors": len(errors),
            "logs": created_logs,
            "skipped_types": list(set(skipped))
        }
    
    async def _sync_log_to_tinybird(
        self,
        tinybird,
        log: HabitLogDB,
        habit: HabitDB,
        user_id: str,
        unit: str
    ) -> None:
        """Queue a single habit log for async Tinybird sync (non-blocking)"""
        log_data = {
            'id': log.id,
            'habit_id': log.habit_id,
            'habit_name': log.habit_name,
            'user_id': user_id,
            'date': log.date,
            'duration': log.duration,
            'amount': log.amount,
            'unit': unit,
            'status': log.status,
            'notes': log.notes,
            'source': log.source or 'apple_health',
            'integration_source': habit.integration_source or 'apple_health',
            'metric_type': habit.metric_type,
            'metadata': log.log_metadata,
            'completed_at': log.completed_at or log.date,
        }
        
        self.queue_tinybird_sync(log_data)
    
    async def _sync_log_to_tinybird_immediate(
        self,
        tinybird,
        log: HabitLogDB,
        habit: HabitDB,
        user_id: str,
        unit: str
    ) -> None:
        """Sync a single habit log to Tinybird immediately (blocking - use sparingly)"""
        try:
            log_data = {
                'id': log.id,
                'habit_id': log.habit_id,
                'habit_name': log.habit_name,
                'user_id': user_id,
                'date': log.date,
                'duration': log.duration,
                'amount': log.amount,
                'unit': unit,
                'status': log.status,
                'notes': log.notes,
                'source': log.source or 'apple_health',
                'integration_source': habit.integration_source or 'apple_health',
                'metric_type': habit.metric_type,
                'metadata': log.log_metadata,
                'completed_at': log.completed_at or log.date,
            }
            result = await tinybird.ingest_habit_log(log_data)
            if result.get('success'):
                logger.info(f"📊 Synced to Tinybird: {habit.name} = {log.amount}")
        except Exception as e:
            logger.warning(f"⚠️ Tinybird sync failed for {habit.name}: {e}")


# Singleton instance
wearables_service = WearablesService()
