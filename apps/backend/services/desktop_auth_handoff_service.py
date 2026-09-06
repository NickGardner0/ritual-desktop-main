"""Durable, channel-bound desktop authentication handoff service."""

from __future__ import annotations

import hashlib
import hmac
import json
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from database.connection import get_db_session
from database.models import DesktopAuthHandoffDB
from schemas.desktop_auth import (
    DesktopAuthHandoffAcknowledge,
    DesktopAuthHandoffClaimFailure,
    DesktopAuthHandoffConsume,
    DesktopAuthHandoffConsumeRead,
    DesktopAuthHandoffCreate,
    DesktopAuthHandoffRead,
)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _hash_nonce(nonce: str) -> str:
    return hashlib.sha256(nonce.encode("utf-8")).hexdigest()


def _metadata_json(payload) -> str:
    return json.dumps(payload.model_dump(exclude_none=True), sort_keys=True)


_CHANNEL_BUNDLE_IDS = {
    "production": "com.ritual.desktop",
    "qa": "com.ritual.desktop.qa",
    "development": "com.ritual.desktop.dev",
}


def _validate_native_metadata(channel: str, metadata) -> None:
    expected_bundle = _CHANNEL_BUNDLE_IDS[channel]
    if metadata.bundle_id != expected_bundle:
        raise ValueError("Desktop authentication bundle does not match its channel")
    if not (metadata.app_version or "").strip() or not (metadata.build_sha or "").strip():
        raise ValueError("Desktop authentication version and build identity are required")


def _validate_consuming_binary(row: DesktopAuthHandoffDB, metadata) -> None:
    _validate_native_metadata(row.channel, metadata)
    try:
        created_metadata = json.loads(row.native_metadata_json or "{}")
    except json.JSONDecodeError as exc:
        raise ValueError("Desktop authentication creation metadata is invalid") from exc
    current_metadata = metadata.model_dump(exclude_none=True)
    for key in ("app_version", "build_sha", "bundle_id", "target"):
        if created_metadata.get(key) != current_metadata.get(key):
            raise ValueError("Desktop authentication binary identity changed during handoff")


class DesktopAuthHandoffService:
    @staticmethod
    def _read(row: DesktopAuthHandoffDB, now: Optional[datetime] = None) -> DesktopAuthHandoffRead:
        status = row.status
        current = now or _utc_now()
        if status == "pending" and row.expires_at <= current:
            status = "expired"
        return DesktopAuthHandoffRead(
            id=row.id,
            channel=row.channel,
            protocol=row.protocol,
            status=status,
            expires_at=row.expires_at,
            consumed_at=row.consumed_at,
            acknowledged_at=row.acknowledged_at,
            failure_code=row.failure_code,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )

    async def create(self, user_id: str, payload: DesktopAuthHandoffCreate) -> DesktopAuthHandoffRead:
        now = _utc_now()
        _validate_native_metadata(payload.channel, payload.native_metadata)
        row = DesktopAuthHandoffDB(
            id=payload.id,
            user_id=user_id,
            nonce_hash=payload.nonce_challenge,
            channel=payload.channel,
            protocol=payload.protocol,
            status="pending",
            expires_at=now + timedelta(seconds=payload.expires_in_seconds),
            native_metadata_json=_metadata_json(payload.native_metadata),
            created_at=now,
            updated_at=now,
        )
        async with get_db_session() as session:
            session.add(row)
            try:
                await session.commit()
            except IntegrityError as exc:
                await session.rollback()
                raise ValueError("Desktop authentication handoff identifier already exists") from exc
            await session.refresh(row)
        return self._read(row, now)

    async def get(self, user_id: str, handoff_id: str) -> Optional[DesktopAuthHandoffRead]:
        now = _utc_now()
        async with get_db_session() as session:
            result = await session.execute(
                select(DesktopAuthHandoffDB).where(
                    DesktopAuthHandoffDB.id == handoff_id,
                    DesktopAuthHandoffDB.user_id == user_id,
                )
            )
            row = result.scalar_one_or_none()
            if row is None:
                return None
            if row.status in {"pending", "consumed"} and row.expires_at <= now:
                row.status = "expired"
                row.updated_at = now
                await session.commit()
                await session.refresh(row)
            return self._read(row, now)

    async def consume(
        self,
        handoff_id: str,
        payload: DesktopAuthHandoffConsume,
    ) -> DesktopAuthHandoffConsumeRead:
        now = _utc_now()
        async with get_db_session() as session:
            result = await session.execute(
                select(DesktopAuthHandoffDB).where(DesktopAuthHandoffDB.id == handoff_id)
            )
            row = result.scalar_one_or_none()
            if row is None:
                raise LookupError("Desktop authentication handoff not found")
            if row.expires_at <= now:
                if row.status == "pending":
                    row.status = "expired"
                    row.updated_at = now
                    await session.commit()
                raise ValueError("Desktop authentication handoff expired")
            if row.channel != payload.channel or row.protocol != payload.protocol:
                raise ValueError("Desktop authentication channel or protocol mismatch")
            if not hmac.compare_digest(row.nonce_hash, _hash_nonce(payload.nonce)):
                raise ValueError("Desktop authentication nonce mismatch")
            _validate_consuming_binary(row, payload.native_metadata)
            if row.status != "pending":
                raise ValueError(f"Desktop authentication handoff is already {row.status}")

            claimed = await session.execute(
                update(DesktopAuthHandoffDB)
                .where(
                    DesktopAuthHandoffDB.id == handoff_id,
                    DesktopAuthHandoffDB.status == "pending",
                )
                .values(
                    status="consumed",
                    consumed_at=now,
                    updated_at=now,
                    native_metadata_json=_metadata_json(payload.native_metadata),
                )
            )
            if claimed.rowcount != 1:
                await session.rollback()
                raise ValueError("Desktop authentication handoff was consumed concurrently")
            await session.commit()
            await session.refresh(row)
            return DesktopAuthHandoffConsumeRead(
                **self._read(row, now).model_dump(),
                user_id=row.user_id,
            )

    async def fail_claim(
        self,
        handoff_id: str,
        payload: DesktopAuthHandoffClaimFailure,
    ) -> DesktopAuthHandoffRead:
        now = _utc_now()
        async with get_db_session() as session:
            result = await session.execute(
                select(DesktopAuthHandoffDB).where(DesktopAuthHandoffDB.id == handoff_id)
            )
            row = result.scalar_one_or_none()
            if row is None:
                raise LookupError("Desktop authentication handoff not found")
            if row.channel != payload.channel or row.protocol != payload.protocol:
                raise ValueError("Desktop authentication channel or protocol mismatch")
            if not hmac.compare_digest(row.nonce_hash, _hash_nonce(payload.nonce)):
                raise ValueError("Desktop authentication nonce mismatch")
            _validate_consuming_binary(row, payload.native_metadata)
            if row.status == "failed" and row.failure_code == payload.failure_code:
                return self._read(row, now)
            if row.status != "consumed":
                raise ValueError("Desktop authentication handoff is not awaiting completion")
            row.status = "failed"
            row.failure_code = payload.failure_code
            row.acknowledged_at = now
            row.updated_at = now
            await session.commit()
            await session.refresh(row)
            return self._read(row, now)

    async def acknowledge(
        self,
        user_id: str,
        handoff_id: str,
        payload: DesktopAuthHandoffAcknowledge,
    ) -> DesktopAuthHandoffRead:
        now = _utc_now()
        async with get_db_session() as session:
            result = await session.execute(
                select(DesktopAuthHandoffDB).where(
                    DesktopAuthHandoffDB.id == handoff_id,
                    DesktopAuthHandoffDB.user_id == user_id,
                )
            )
            row = result.scalar_one_or_none()
            if row is None:
                raise LookupError("Desktop authentication handoff not found")
            if row.status in {"acknowledged", "failed"}:
                if row.status != payload.outcome:
                    raise ValueError(f"Desktop authentication handoff is already {row.status}")
                return self._read(row, now)
            if row.status != "consumed":
                raise ValueError("Desktop authentication handoff must be consumed before acknowledgement")

            row.status = payload.outcome
            row.acknowledged_at = now
            row.failure_code = payload.failure_code if payload.outcome == "failed" else None
            row.native_metadata_json = _metadata_json(payload.native_metadata)
            row.updated_at = now
            await session.commit()
            await session.refresh(row)
            return self._read(row, now)


desktop_auth_handoff_service = DesktopAuthHandoffService()
