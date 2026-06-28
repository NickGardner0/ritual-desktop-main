"""Garmin account payload fetch/write helpers.

Garmin event ingestion is webhook-driven. This module keeps account refresh
handoff separate from GarminService's OAuth primitives.
"""

from __future__ import annotations

from typing import Any, Dict

from services.token_crypto import token_crypto
from services.unified_wearables_service import wearable_connection_service


async def fetch_garmin_account_payload(service: Any, user_id: str) -> Dict[str, Any]:
    access_token = await service.get_valid_access_token(user_id)
    provider_user_id = await service.get_user_id(access_token)
    permissions = await service.get_permissions(access_token)
    connection = await wearable_connection_service.get_connection(user_id, "garmin")
    return {
        "access_token": access_token,
        "provider_user_id": provider_user_id,
        "permissions": permissions,
        "connection_provider_user_id": connection.provider_user_id if connection else None,
        "refresh_token": token_crypto.decrypt(connection.refresh_token) if connection and connection.refresh_token else None,
        "token_expires_at": connection.token_expires_at if connection else None,
    }


async def write_garmin_account_payload(user_id: str, payload: Dict[str, Any]) -> None:
    await wearable_connection_service.get_or_create_connection(
        user_id=user_id,
        provider="garmin",
        auth_method="oauth",
        provider_user_id=payload["provider_user_id"] or payload["connection_provider_user_id"],
        access_token=payload["access_token"],
        refresh_token=payload["refresh_token"],
        token_expires_at=payload["token_expires_at"],
        settings={"permissions": payload["permissions"]},
        status="active",
    )
