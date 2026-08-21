"""Parse Whoop user-sync query params and JSON body aliases."""

from __future__ import annotations

from typing import Any, Optional


def resolve_whoop_sync_options(
    *,
    days_back: Optional[int] = None,
    force_full_sync: bool = False,
    full_history: bool = False,
    body: Optional[dict[str, Any]] = None,
) -> tuple[Optional[int], bool, bool]:
    payload = body or {}
    resolved_days = days_back
    if resolved_days is None:
        for key in ("days_back", "daysBack"):
            value = payload.get(key)
            if isinstance(value, bool):
                continue
            if isinstance(value, int):
                resolved_days = value
                break
            if isinstance(value, str) and value.strip().isdigit():
                resolved_days = int(value.strip())
                break
    resolved_force = force_full_sync or bool(payload.get("force_full_sync") or payload.get("forceFullSync"))
    resolved_history = full_history or bool(payload.get("full_history") or payload.get("fullHistory"))
    return resolved_days, resolved_force, resolved_history
