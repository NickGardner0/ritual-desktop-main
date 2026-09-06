"""Ciphertext-only optional Private Sync envelope helpers."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import delete, func, select

from database.connection import get_db_session
from database.models import PrivateSyncDeviceDB, PrivateSyncEnvelopeDB, PrivateSyncKeyGrantDB


SUPPORTED_ENVELOPE_ALGORITHMS = {"AES-256-GCM"}
SUPPORTED_KEY_GRANT_ALGORITHMS = {"AES-256-GCM"}
MAX_ENVELOPES_PER_BATCH = 500
MAX_CIPHERTEXT_BYTES = 1_000_000

_BASE64_RE = re.compile(r"^[A-Za-z0-9+/=_-]+$")
_OPAQUE_ID_RE = re.compile(r"^[A-Za-z0-9._:-]{1,160}$")


def _require_non_empty_string(value: Any, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field_name} is required.")
    return value.strip()


def _require_positive_int(value: Any, field_name: str) -> int:
    if not isinstance(value, int) or value < 1:
        raise ValueError(f"{field_name} must be a positive integer.")
    return value


def _validate_base64ish(value: str, field_name: str) -> str:
    candidate = _require_non_empty_string(value, field_name)
    if not _BASE64_RE.match(candidate):
        raise ValueError(f"{field_name} must be encoded ciphertext data.")
    return candidate


def _validate_opaque_id(value: Any, field_name: str) -> str:
    candidate = _require_non_empty_string(value, field_name)
    if not _OPAQUE_ID_RE.match(candidate):
        raise ValueError(f"{field_name} contains unsupported characters.")
    return candidate


def _ciphertext_size_bytes(ciphertext: str) -> int:
    return max(1, (len(ciphertext) * 3) // 4)


def _validate_envelope(envelope: Dict[str, Any]) -> Dict[str, Any]:
    algorithm = _require_non_empty_string(envelope.get("algorithm"), "algorithm")
    if algorithm not in SUPPORTED_ENVELOPE_ALGORITHMS:
        raise ValueError(f"Unsupported envelope algorithm: {algorithm}")

    ciphertext = _validate_base64ish(envelope.get("ciphertext"), "ciphertext")
    if _ciphertext_size_bytes(ciphertext) > MAX_CIPHERTEXT_BYTES:
        raise ValueError("ciphertext exceeds the private sync envelope size limit.")

    return {
        "envelope_id": _require_non_empty_string(envelope.get("envelope_id"), "envelope_id"),
        "collection": _require_non_empty_string(envelope.get("collection"), "collection"),
        "record_id": _require_non_empty_string(envelope.get("record_id"), "record_id"),
        "record_type": _require_non_empty_string(envelope.get("record_type"), "record_type"),
        "revision": _require_positive_int(envelope.get("revision"), "revision"),
        "key_version": _require_positive_int(envelope.get("key_version"), "key_version"),
        "algorithm": algorithm,
        "nonce": _validate_base64ish(envelope.get("nonce"), "nonce"),
        "ciphertext": ciphertext,
        "aad": _validate_base64ish(envelope.get("aad"), "aad"),
        "ciphertext_sha256": _require_non_empty_string(
            envelope.get("ciphertext_sha256"),
            "ciphertext_sha256",
        ),
        "tombstone": bool(envelope.get("tombstone", False)),
        "client_updated_at": envelope.get("client_updated_at"),
    }


def _validate_key_grant(grant: Dict[str, Any]) -> Dict[str, Any]:
    algorithm = _require_non_empty_string(grant.get("algorithm"), "algorithm")
    if algorithm not in SUPPORTED_KEY_GRANT_ALGORITHMS:
        raise ValueError(f"Unsupported key grant algorithm: {algorithm}")

    ciphertext = _validate_base64ish(grant.get("ciphertext"), "ciphertext")
    if _ciphertext_size_bytes(ciphertext) > MAX_CIPHERTEXT_BYTES:
        raise ValueError("ciphertext exceeds the private sync key grant size limit.")

    return {
        "grant_id": _validate_opaque_id(grant.get("grant_id"), "grant_id"),
        "recipient_device_id": _validate_opaque_id(grant.get("recipient_device_id"), "recipient_device_id"),
        "key_version": _require_positive_int(grant.get("key_version"), "key_version"),
        "algorithm": algorithm,
        "nonce": _validate_base64ish(grant.get("nonce"), "nonce"),
        "ciphertext": ciphertext,
        "aad": _validate_base64ish(grant.get("aad"), "aad"),
        "ciphertext_sha256": _require_non_empty_string(
            grant.get("ciphertext_sha256"),
            "ciphertext_sha256",
        ),
    }


def _serialize_envelope(row: PrivateSyncEnvelopeDB) -> Dict[str, Any]:
    return {
        "envelope_id": row.envelope_id,
        "collection": row.collection,
        "record_id": row.record_id,
        "record_type": row.record_type,
        "revision": row.revision,
        "server_revision": row.server_revision,
        "key_version": row.key_version,
        "algorithm": row.algorithm,
        "nonce": row.nonce,
        "ciphertext": row.ciphertext,
        "aad": row.aad,
        "ciphertext_sha256": row.ciphertext_sha256,
        "tombstone": bool(row.tombstone),
        "client_updated_at": row.client_updated_at,
        "client_id": row.client_id,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _serialize_device(row: PrivateSyncDeviceDB) -> Dict[str, Any]:
    return {
        "device_id": row.device_id,
        "device_name": row.device_name,
        "platform": row.platform,
        "public_key": row.public_key,
        "status": row.status,
        "registered_at": row.registered_at.isoformat() if row.registered_at else None,
        "trusted_at": row.trusted_at.isoformat() if row.trusted_at else None,
        "revoked_at": row.revoked_at.isoformat() if row.revoked_at else None,
        "last_seen_at": row.last_seen_at.isoformat() if row.last_seen_at else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _serialize_key_grant(row: PrivateSyncKeyGrantDB) -> Dict[str, Any]:
    return {
        "grant_id": row.grant_id,
        "sender_device_id": row.sender_device_id,
        "recipient_device_id": row.recipient_device_id,
        "key_version": row.key_version,
        "algorithm": row.algorithm,
        "nonce": row.nonce,
        "ciphertext": row.ciphertext,
        "aad": row.aad,
        "ciphertext_sha256": row.ciphertext_sha256,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


async def _device_by_id(session, user_id: str, device_id: str) -> Optional[PrivateSyncDeviceDB]:
    result = await session.execute(
        select(PrivateSyncDeviceDB).where(
            PrivateSyncDeviceDB.user_id == user_id,
            PrivateSyncDeviceDB.device_id == device_id,
        )
    )
    return result.scalar_one_or_none()


async def _require_registered_device(
    session,
    user_id: str,
    device_id: str,
    now: datetime,
) -> PrivateSyncDeviceDB:
    validated_device_id = _validate_opaque_id(device_id, "device_id")
    row = await _device_by_id(session, user_id, validated_device_id)
    if not row:
        raise PermissionError("Private Sync device is not registered.")
    if row.status == "revoked" or row.revoked_at is not None:
        raise PermissionError("Private Sync device has been revoked.")
    row.last_seen_at = now
    row.updated_at = now
    return row


async def _require_active_device(
    session,
    user_id: str,
    device_id: str,
    now: datetime,
) -> PrivateSyncDeviceDB:
    row = await _require_registered_device(session, user_id, device_id, now)
    if row.status != "active":
        raise PermissionError("Private Sync device is pending trust.")
    return row


async def register_private_sync_device(
    user_id: str,
    *,
    device_id: str,
    device_name: str,
    platform: Optional[str] = None,
    public_key: Optional[str] = None,
) -> Dict[str, Any]:
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    validated_device_id = _validate_opaque_id(device_id, "device_id")
    validated_name = _require_non_empty_string(device_name, "device_name")[:160]
    validated_platform = platform.strip()[:80] if isinstance(platform, str) and platform.strip() else None
    validated_public_key = public_key.strip() if isinstance(public_key, str) and public_key.strip() else None

    async with get_db_session() as session:
        active_count_result = await session.execute(
            select(func.count(PrivateSyncDeviceDB.id)).where(
                PrivateSyncDeviceDB.user_id == user_id,
                PrivateSyncDeviceDB.status == "active",
                PrivateSyncDeviceDB.revoked_at.is_(None),
            )
        )
        active_count = int(active_count_result.scalar() or 0)
        existing = await _device_by_id(session, user_id, validated_device_id)

        if existing:
            if existing.status == "revoked" or existing.revoked_at is not None:
                raise PermissionError("Private Sync device has been revoked.")
            existing.device_name = validated_name
            existing.platform = validated_platform
            existing.public_key = validated_public_key
            if active_count == 0 and existing.status != "active":
                existing.status = "active"
                existing.trusted_at = now
            existing.last_seen_at = now
            existing.updated_at = now
            row = existing
        else:
            status = "active" if active_count == 0 else "pending"
            row = PrivateSyncDeviceDB(
                user_id=user_id,
                device_id=validated_device_id,
                device_name=validated_name,
                platform=validated_platform,
                public_key=validated_public_key,
                status=status,
                registered_at=now,
                trusted_at=now if status == "active" else None,
                last_seen_at=now,
                created_at=now,
                updated_at=now,
            )
            session.add(row)

        await session.commit()

    return _serialize_device(row)


async def list_private_sync_devices(user_id: str) -> Dict[str, Any]:
    async with get_db_session() as session:
        result = await session.execute(
            select(PrivateSyncDeviceDB)
            .where(PrivateSyncDeviceDB.user_id == user_id)
            .order_by(PrivateSyncDeviceDB.created_at.asc(), PrivateSyncDeviceDB.id.asc())
        )
        rows = list(result.scalars().all())

    return {
        "devices": [_serialize_device(row) for row in rows],
        "device_count": len(rows),
    }


async def revoke_private_sync_device(
    user_id: str,
    *,
    requester_device_id: str,
    device_id: str,
) -> Dict[str, Any]:
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    target_device_id = _validate_opaque_id(device_id, "device_id")

    async with get_db_session() as session:
        await _require_active_device(session, user_id, requester_device_id, now)
        target = await _device_by_id(session, user_id, target_device_id)
        if not target:
            raise ValueError("Private Sync device was not found.")
        if target.status != "revoked":
            target.status = "revoked"
            target.revoked_at = now
            target.updated_at = now
        await session.commit()

    return {
        "device_id": target_device_id,
        "revoked": True,
        "revoked_at": target.revoked_at.isoformat() if target.revoked_at else now.isoformat(),
    }


async def put_private_sync_key_grants(
    user_id: str,
    grants: List[Dict[str, Any]],
    *,
    sender_device_id: str,
) -> Dict[str, Any]:
    if len(grants) > MAX_ENVELOPES_PER_BATCH:
        raise ValueError(f"Private sync key grant batches are limited to {MAX_ENVELOPES_PER_BATCH} grants.")

    validated = [_validate_key_grant(grant) for grant in grants]
    accepted = 0
    ignored = 0
    returned_grants: List[Dict[str, Any]] = []
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    async with get_db_session() as session:
        await _require_active_device(session, user_id, sender_device_id, now)

        for grant in validated:
            recipient = await _require_registered_device(session, user_id, grant["recipient_device_id"], now)

            existing_result = await session.execute(
                select(PrivateSyncKeyGrantDB).where(
                    PrivateSyncKeyGrantDB.user_id == user_id,
                    PrivateSyncKeyGrantDB.grant_id == grant["grant_id"],
                )
            )
            existing = existing_result.scalar_one_or_none()

            if existing and existing.ciphertext_sha256 == grant["ciphertext_sha256"]:
                ignored += 1
                returned_grants.append(_serialize_key_grant(existing))
                continue

            if recipient.status == "pending":
                recipient.status = "active"
                recipient.trusted_at = now
                recipient.updated_at = now

            if existing:
                existing.sender_device_id = sender_device_id
                existing.recipient_device_id = grant["recipient_device_id"]
                existing.key_version = grant["key_version"]
                existing.algorithm = grant["algorithm"]
                existing.nonce = grant["nonce"]
                existing.ciphertext = grant["ciphertext"]
                existing.aad = grant["aad"]
                existing.ciphertext_sha256 = grant["ciphertext_sha256"]
                existing.updated_at = now
                row = existing
            else:
                row = PrivateSyncKeyGrantDB(
                    user_id=user_id,
                    grant_id=grant["grant_id"],
                    sender_device_id=sender_device_id,
                    recipient_device_id=grant["recipient_device_id"],
                    key_version=grant["key_version"],
                    algorithm=grant["algorithm"],
                    nonce=grant["nonce"],
                    ciphertext=grant["ciphertext"],
                    aad=grant["aad"],
                    ciphertext_sha256=grant["ciphertext_sha256"],
                    created_at=now,
                    updated_at=now,
                )
                session.add(row)

            accepted += 1
            returned_grants.append(_serialize_key_grant(row))

        await session.commit()

    return {
        "accepted_count": accepted,
        "ignored_count": ignored,
        "grants": returned_grants,
    }


async def list_private_sync_key_grants(
    user_id: str,
    *,
    device_id: str,
) -> Dict[str, Any]:
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    async with get_db_session() as session:
        await _require_registered_device(session, user_id, device_id, now)
        result = await session.execute(
            select(PrivateSyncKeyGrantDB)
            .where(
                PrivateSyncKeyGrantDB.user_id == user_id,
                PrivateSyncKeyGrantDB.recipient_device_id == device_id,
            )
            .order_by(PrivateSyncKeyGrantDB.created_at.asc(), PrivateSyncKeyGrantDB.id.asc())
        )
        rows = list(result.scalars().all())
        await session.commit()

    return {
        "grants": [_serialize_key_grant(row) for row in rows],
        "grant_count": len(rows),
    }


async def put_private_sync_envelopes(
    user_id: str,
    envelopes: List[Dict[str, Any]],
    *,
    device_id: str,
    client_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Insert or update encrypted envelopes without seeing record contents."""

    if len(envelopes) > MAX_ENVELOPES_PER_BATCH:
        raise ValueError(f"Private sync batches are limited to {MAX_ENVELOPES_PER_BATCH} envelopes.")

    validated = [_validate_envelope(envelope) for envelope in envelopes]
    accepted = 0
    ignored = 0
    returned_envelopes: List[Dict[str, Any]] = []
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    async with get_db_session() as session:
        await _require_active_device(session, user_id, device_id, now)
        max_result = await session.execute(
            select(func.max(PrivateSyncEnvelopeDB.server_revision)).where(
                PrivateSyncEnvelopeDB.user_id == user_id
            )
        )
        max_server_revision = int(max_result.scalar() or 0)

        for envelope in validated:
            existing_result = await session.execute(
                select(PrivateSyncEnvelopeDB).where(
                    PrivateSyncEnvelopeDB.user_id == user_id,
                    PrivateSyncEnvelopeDB.envelope_id == envelope["envelope_id"],
                )
            )
            existing = existing_result.scalar_one_or_none()

            if existing and existing.revision > envelope["revision"]:
                ignored += 1
                returned_envelopes.append(_serialize_envelope(existing))
                continue

            if (
                existing
                and existing.revision == envelope["revision"]
                and existing.ciphertext_sha256 == envelope["ciphertext_sha256"]
            ):
                ignored += 1
                returned_envelopes.append(_serialize_envelope(existing))
                continue

            max_server_revision += 1
            if existing:
                existing.collection = envelope["collection"]
                existing.record_id = envelope["record_id"]
                existing.record_type = envelope["record_type"]
                existing.revision = envelope["revision"]
                existing.server_revision = max_server_revision
                existing.key_version = envelope["key_version"]
                existing.algorithm = envelope["algorithm"]
                existing.nonce = envelope["nonce"]
                existing.ciphertext = envelope["ciphertext"]
                existing.aad = envelope["aad"]
                existing.ciphertext_sha256 = envelope["ciphertext_sha256"]
                existing.tombstone = envelope["tombstone"]
                existing.client_updated_at = envelope["client_updated_at"]
                existing.client_id = client_id
                existing.updated_at = now
                row = existing
            else:
                row = PrivateSyncEnvelopeDB(
                    user_id=user_id,
                    envelope_id=envelope["envelope_id"],
                    collection=envelope["collection"],
                    record_id=envelope["record_id"],
                    record_type=envelope["record_type"],
                    revision=envelope["revision"],
                    server_revision=max_server_revision,
                    key_version=envelope["key_version"],
                    algorithm=envelope["algorithm"],
                    nonce=envelope["nonce"],
                    ciphertext=envelope["ciphertext"],
                    aad=envelope["aad"],
                    ciphertext_sha256=envelope["ciphertext_sha256"],
                    tombstone=envelope["tombstone"],
                    client_updated_at=envelope["client_updated_at"],
                    client_id=client_id,
                    created_at=now,
                    updated_at=now,
                )
                session.add(row)

            accepted += 1
            returned_envelopes.append(_serialize_envelope(row))

        await session.commit()

    return {
        "accepted_count": accepted,
        "ignored_count": ignored,
        "max_server_revision": max_server_revision,
        "envelopes": returned_envelopes,
    }


async def list_private_sync_envelopes(
    user_id: str,
    *,
    device_id: str,
    since_server_revision: int = 0,
    limit: int = MAX_ENVELOPES_PER_BATCH,
) -> Dict[str, Any]:
    if since_server_revision < 0:
        raise ValueError("since_server_revision must be zero or greater.")
    if limit < 1 or limit > MAX_ENVELOPES_PER_BATCH:
        raise ValueError(f"limit must be between 1 and {MAX_ENVELOPES_PER_BATCH}.")

    async with get_db_session() as session:
        await _require_active_device(session, user_id, device_id, datetime.now(timezone.utc).replace(tzinfo=None))
        result = await session.execute(
            select(PrivateSyncEnvelopeDB)
            .where(
                PrivateSyncEnvelopeDB.user_id == user_id,
                PrivateSyncEnvelopeDB.server_revision > since_server_revision,
            )
            .order_by(PrivateSyncEnvelopeDB.server_revision.asc())
            .limit(limit)
        )
        rows = list(result.scalars().all())

    envelopes = [_serialize_envelope(row) for row in rows]
    next_revision = envelopes[-1]["server_revision"] if envelopes else since_server_revision
    return {
        "envelopes": envelopes,
        "returned_count": len(envelopes),
        "next_since_server_revision": next_revision,
    }


async def delete_private_sync_envelopes(
    user_id: str,
) -> Dict[str, Any]:
    async with get_db_session() as session:
        result = await session.execute(
            delete(PrivateSyncEnvelopeDB).where(PrivateSyncEnvelopeDB.user_id == user_id)
        )
        await session.commit()

    return {
        "deleted_count": int(result.rowcount or 0),
        "deletes_cloud_data": True,
        "changes_source_of_truth": False,
    }
