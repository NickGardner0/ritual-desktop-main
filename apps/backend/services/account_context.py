"""Authenticated account dependencies with one durable user-row owner."""

from __future__ import annotations

import logging
from typing import Any, Dict, TypedDict

from services.account_deletion_service import clerk_identity_exists, process_account_deletion
from services.user_service import AccountIdentityConflictError

logger = logging.getLogger(__name__)


class PersistedAccountContext(TypedDict, total=False):
    id: str
    email: str | None
    phone: str | None
    name: str | None
    metadata: Dict[str, Any]
    account: Any


async def ensure_current_user_record(
    user_service: Any,
    current_user: Dict[str, Any],
    *,
    send_welcome_sms: bool = True,
):
    """Ensure the authenticated identity has exactly one local account row."""

    values = {
        "user_id": current_user["id"],
        "email": current_user.get("email") or "",
        "full_name": current_user.get("name"),
        "phone_number": current_user.get("phone"),
        "send_welcome_sms": send_welcome_sms,
    }
    try:
        return await user_service.ensure_user_exists(**values)
    except AccountIdentityConflictError as conflict:
        if await clerk_identity_exists(conflict.existing_user_id):
            raise

        logger.warning(
            "Recovering stale Ritual account row %s after Clerk confirmed deletion",
            conflict.existing_user_id,
        )
        await process_account_deletion(
            conflict.existing_user_id,
            source="identity_conflict_recovery",
            event_id=(
                f"identity-conflict:{conflict.existing_user_id}:"
                f"{conflict.requested_user_id}"
            ),
        )
        return await user_service.ensure_user_exists(**values)


async def build_persisted_account_context(
    user_service: Any,
    current_user: Dict[str, Any],
) -> PersistedAccountContext:
    account = await ensure_current_user_record(user_service, current_user)
    return {**current_user, "account": account}  # type: ignore[return-value]
