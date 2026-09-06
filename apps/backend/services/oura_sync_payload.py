"""Oura sync payload fetch/write helpers.

OuraService keeps OAuth/token primitives for compatibility, while this module
owns the provider fetch window and canonical ingest handoff.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Dict, Optional

from services.token_crypto import token_crypto
from services.wearables_unified import (
    wearable_connection_service,
    wearable_sync_service,
)


async def fetch_oura_sync_payload(
    service: Any,
    user_id: str,
    *,
    days_back: Optional[int] = None,
    force_full_sync: bool = False,
) -> Dict[str, Any]:
    access_token = await service.get_valid_access_token(user_id)
    connection = await wearable_connection_service.get_connection(user_id, "oura")
    if connection is None:
        raise ValueError("Oura connection not found")

    end_date = datetime.utcnow().date()
    if days_back is not None:
        start_date = end_date - timedelta(days=days_back)
    elif force_full_sync or not connection.last_sync_at:
        start_date = end_date - timedelta(days=30)
    else:
        overlap_days = max((datetime.utcnow() - connection.last_sync_at).days + 2, 2)
        start_date = end_date - timedelta(days=min(overlap_days, 30))

    token_expires_at = connection.token_expires_at
    personal_info = await service.get_personal_info(access_token)

    import httpx

    async with httpx.AsyncClient(timeout=25.0) as client:
        daily_sleep = await service._fetch_collection(
            client,
            access_token,
            "daily_sleep",
            start_date.isoformat(),
            end_date.isoformat(),
        )
        sleep = await service._fetch_collection(
            client,
            access_token,
            "sleep",
            start_date.isoformat(),
            end_date.isoformat(),
        )
        daily_readiness = await service._fetch_collection(
            client,
            access_token,
            "daily_readiness",
            start_date.isoformat(),
            end_date.isoformat(),
        )
        daily_activity = await service._fetch_collection(
            client,
            access_token,
            "daily_activity",
            start_date.isoformat(),
            end_date.isoformat(),
        )
        workout = await service._fetch_collection(
            client,
            access_token,
            "workout",
            start_date.isoformat(),
            end_date.isoformat(),
        )
        heartrate = await service._fetch_collection(
            client,
            access_token,
            "heartrate",
            start_date.isoformat(),
            end_date.isoformat(),
            swallow_404=True,
        )

    return {
        "access_token": access_token,
        "refresh_token": token_crypto.decrypt(connection.refresh_token) if connection.refresh_token else None,
        "token_expires_at": token_expires_at,
        "personal_info": personal_info,
        "start_date": start_date,
        "end_date": end_date,
        "daily_sleep_records": daily_sleep,
        "sleep_records": sleep,
        "daily_readiness_records": daily_readiness,
        "daily_activity_records": daily_activity,
        "workout_records": workout,
        "heartrate_records": heartrate,
    }


async def write_oura_sync_payload(
    user_id: str,
    payload: Dict[str, Any],
) -> Dict[str, Any]:
    personal_info = payload["personal_info"]
    return await wearable_sync_service.ingest_oura_data(
        user_id=user_id,
        provider_user_id=str(personal_info.get("email") or personal_info.get("id") or user_id),
        personal_info=personal_info,
        access_token=payload["access_token"],
        refresh_token=payload["refresh_token"],
        token_expires_at=payload["token_expires_at"],
        daily_sleep_records=payload["daily_sleep_records"],
        sleep_records=payload["sleep_records"],
        daily_readiness_records=payload["daily_readiness_records"],
        daily_activity_records=payload["daily_activity_records"],
        workout_records=payload["workout_records"],
        heartrate_records=payload["heartrate_records"],
    )
