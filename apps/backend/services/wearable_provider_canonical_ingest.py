"""Canonical wearable provider payload persistence handoff."""

from __future__ import annotations

from typing import Any

from services.garmin_account_payload import write_garmin_account_payload
from services.oura_sync_payload import write_oura_sync_payload
from services.whoop_sync_payload import write_whoop_sync_payload


async def persist_whoop_payload(service: Any, user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    if hasattr(service, "write_whoop_sync_payload"):
        result = await service.write_whoop_sync_payload(user_id, payload)
    else:
        result = await write_whoop_sync_payload(service, user_id, payload)
    return result if isinstance(result, dict) else {"raw": result}


async def persist_oura_payload(service: Any, user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    if hasattr(service, "write_oura_sync_payload"):
        result = await service.write_oura_sync_payload(user_id, payload)
    else:
        result = await write_oura_sync_payload(user_id, payload)
    return result if isinstance(result, dict) else {"raw": result}


async def persist_garmin_payload(service: Any, user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    if hasattr(service, "write_garmin_account_payload"):
        result = await service.write_garmin_account_payload(user_id, payload)
    else:
        result = await write_garmin_account_payload(user_id, payload)
    return result if isinstance(result, dict) else {"raw": result}
