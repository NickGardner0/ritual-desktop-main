"""Typed provider fetch payload contracts."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional


@dataclass(frozen=True)
class ProviderFetchRequest:
    user_id: str
    days_back: Optional[int] = None
    force_full_sync: bool = False
    full_history: bool = False


@dataclass(frozen=True)
class ProviderPayload:
    provider: str
    payload: dict[str, Any]
    upstream_count: int = 0
