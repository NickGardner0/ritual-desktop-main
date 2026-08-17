"""Apple Health device ingest through the unified wearable seam."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import List, Literal, Optional

from sqlalchemy import select

from database.connection import get_db_session
from database.models import WearableDeviceDB
from schemas.wearables_apple import (
    AppleIngestRequest,
    AppleIngestRequestV2,
    AppleIngestResult,
    DeleteResult,
)

logger = logging.getLogger(__name__)

AppleIngestOutcome = Literal["accepted", "duplicate", "rejected"]


def _validation_error_code(error: Optional[str]) -> str:
    return {
        "Device not found": "device_not_found",
        "Device does not belong to this user": "device_user_mismatch",
        "Invalid signature": "invalid_signature",
    }.get(error or "", "request_rejected")


@dataclass(frozen=True)
class AppleIngestServiceResult:
    outcome: AppleIngestOutcome
    results: List[AppleIngestResult] = field(default_factory=list)
    error: Optional[str] = None
    error_code: Optional[str] = None

    @property
    def success(self) -> bool:
        return self.outcome != "rejected"


@dataclass(frozen=True)
class AppleIngestServiceResultV2:
    outcome: AppleIngestOutcome
    added_results: List[AppleIngestResult] = field(default_factory=list)
    deleted_results: List[DeleteResult] = field(default_factory=list)
    modified_results: List[AppleIngestResult] = field(default_factory=list)
    error: Optional[str] = None
    error_code: Optional[str] = None

    @property
    def success(self) -> bool:
        return self.outcome != "rejected"


class WearableAppleIngestService:
    provider = "apple_health"

    def __init__(self, *, device_security_service, sync_service):
        self.device_security_service = device_security_service
        self.sync_service = sync_service

    async def process_ingest_request(
        self,
        user_id: str,
        request: AppleIngestRequest,
    ) -> AppleIngestServiceResult:
        validation = await self.device_security_service.validate_signed_device_request(
            user_id=user_id,
            provider=self.provider,
            device_id=request.device_id,
            client_event_id=request.client_event_id,
            captured_at=request.captured_at,
            signature=request.signature,
        )
        if not validation.success:
            return AppleIngestServiceResult(
                outcome="rejected",
                error=validation.error,
                error_code=_validation_error_code(validation.error),
            )

        existing_event = await self.device_security_service.check_idempotency(
            request.device_id,
            request.client_event_id,
        )
        if existing_event:
            logger.warning("⚠️ Duplicate Apple Health client_event_id: %s", request.client_event_id)
            return AppleIngestServiceResult(outcome="duplicate")

        try:
            await self.sync_service.backfill_legacy_apple_metrics(user_id)
        except Exception as exc:  # noqa: BLE001
            logger.warning("⚠️ Legacy Apple backfill skipped: %s", exc)

        stored_records = await self.sync_service.ingest_apple_metrics(
            user_id=user_id,
            device_id=request.device_id,
            metrics=request.metrics,
        )
        results = [
            AppleIngestResult(index=idx, success=True, stored_id=stored_id)
            for idx, (stored_id, _kind) in enumerate(stored_records)
        ]

        success_count = sum(1 for result in results if result.success)
        error_count = sum(1 for result in results if not result.success)
        status = "success" if error_count == 0 else ("partial" if success_count > 0 else "failed")

        await self.device_security_service.record_ingest_event(
            device_id=request.device_id,
            client_event_id=request.client_event_id,
            metrics_count=len(request.metrics),
            success_count=success_count,
            error_count=error_count,
            status=status,
        )

        logger.info("✅ Ingested %s/%s Apple Health metrics for device %s", success_count, len(request.metrics), request.device_id)
        if success_count == 0:
            return AppleIngestServiceResult(
                outcome="rejected",
                results=results,
                error="No Apple Health metrics were accepted",
                error_code="no_records_accepted",
            )
        return AppleIngestServiceResult(outcome="accepted", results=results)

    async def process_ingest_request_v2(
        self,
        user_id: str,
        request: AppleIngestRequestV2,
    ) -> AppleIngestServiceResultV2:
        validation = await self.device_security_service.validate_signed_device_request(
            user_id=user_id,
            provider=self.provider,
            device_id=request.device_id,
            client_event_id=request.client_event_id,
            captured_at=request.captured_at,
            signature=request.signature,
        )
        if not validation.success:
            return AppleIngestServiceResultV2(
                outcome="rejected",
                error=validation.error,
                error_code=_validation_error_code(validation.error),
            )

        existing_event = await self.device_security_service.check_idempotency(
            request.device_id,
            request.client_event_id,
        )
        if existing_event:
            logger.warning("⚠️ Duplicate Apple Health client_event_id: %s", request.client_event_id)
            return AppleIngestServiceResultV2(outcome="duplicate")

        added_results: List[AppleIngestResult] = []
        if request.added:
            added_records = await self.sync_service.ingest_apple_metrics(
                user_id=user_id,
                device_id=request.device_id,
                metrics=request.added,
            )
            added_results = [
                AppleIngestResult(index=idx, success=True, stored_id=stored_id)
                for idx, (stored_id, _kind) in enumerate(added_records)
            ]

        deleted_results: List[DeleteResult] = []
        if request.deleted:
            deleted_results = await self.delete_metrics_by_external_ids(user_id, request.deleted)

        modified_results: List[AppleIngestResult] = []
        if request.modified:
            for metric in request.modified:
                if metric.external_id:
                    await self.delete_metrics_by_external_ids(user_id, [metric.external_id])
            modified_records = await self.sync_service.ingest_apple_metrics(
                user_id=user_id,
                device_id=request.device_id,
                metrics=request.modified,
            )
            modified_results = [
                AppleIngestResult(index=idx, success=True, stored_id=stored_id)
                for idx, (stored_id, _kind) in enumerate(modified_records)
            ]

        total_ops = len(request.added) + len(request.deleted) + len(request.modified)
        added_success = sum(1 for result in added_results if result.success)
        deleted_success = sum(1 for result in deleted_results if result.success)
        modified_success = sum(1 for result in modified_results if result.success)
        total_success = added_success + deleted_success + modified_success
        status = "success" if total_success == total_ops else ("partial" if total_success > 0 else "failed")

        await self.device_security_service.record_ingest_event(
            device_id=request.device_id,
            client_event_id=request.client_event_id,
            metrics_count=total_ops,
            success_count=total_success,
            error_count=total_ops - total_success,
            status=status,
        )

        if total_success > 0:
            await self._stamp_device_sync(request.device_id)

        logger.info(
            "✅ Apple Health V2 ingest: %s added, %s deleted, %s modified",
            added_success,
            deleted_success,
            modified_success,
        )
        if total_success == 0:
            return AppleIngestServiceResultV2(
                outcome="rejected",
                added_results=added_results,
                deleted_results=deleted_results,
                modified_results=modified_results,
                error="No Apple Health operations were accepted",
                error_code="no_records_accepted",
            )
        return AppleIngestServiceResultV2(
            outcome="accepted",
            added_results=added_results,
            deleted_results=deleted_results,
            modified_results=modified_results,
        )

    async def delete_metrics_by_external_ids(self, user_id: str, external_ids: List[str]) -> List[DeleteResult]:
        results: List[DeleteResult] = []
        for external_id in external_ids:
            try:
                deleted = await self.sync_service.delete_records_by_external_ids(
                    user_id=user_id,
                    provider=self.provider,
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
            except Exception as exc:  # noqa: BLE001
                logger.warning("⚠️ Error deleting Apple Health metric %s: %s", external_id, exc)
                results.append(DeleteResult(external_id=external_id, success=False, error=str(exc)))
        return results

    async def _stamp_device_sync(self, device_id: str) -> None:
        async with get_db_session() as session:
            stmt = select(WearableDeviceDB).where(WearableDeviceDB.id == device_id)
            device = (await session.execute(stmt)).scalar_one_or_none()
            if device:
                device.last_sync_at = datetime.now(timezone.utc)
                await session.commit()
