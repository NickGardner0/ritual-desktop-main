"""SMS provider abstraction.

All outbound SMS and inbound-webhook signature verification routes through
a SmsProvider implementation. This makes a future provider switch (e.g.
Sendblue → Linq at scale) a config change rather than a rewrite.

Env selection: SMS_PROVIDER=sendblue|linq (default: sendblue).

Design notes:
- SendblueProvider is a thin wrapper around the existing
  services.sendblue_service.send_message() — zero behavior change from
  today's code path.
- LinqProvider is a stub that raises on send. Wire up only when pricing /
  scale justifies the switch.
- Provider caps (follow_up_daily_cap, inbound_daily_cap) are surfaced as
  properties so the proactive-job gate cascade can read them instead of
  hardcoding "200".
"""

from __future__ import annotations

import hmac
import logging
import os
from dataclasses import dataclass
from typing import Mapping, Optional, Protocol

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Result + Protocol
# ---------------------------------------------------------------------------


@dataclass
class SmsSendResult:
    """Outcome of a single outbound send attempt.

    Richer than a plain bool so callers can differentiate transient failures
    (retry) from permanent ones (give up) and record the provider's view of
    the send for auditing.
    """

    ok: bool
    provider: str
    status_code: Optional[int] = None
    error: Optional[str] = None


class SmsProvider(Protocol):
    """Minimum interface every SMS provider must implement."""

    name: str

    async def send_message(
        self,
        to: str,
        content: str,
        media_url: Optional[str] = None,
        from_number: Optional[str] = None,
    ) -> SmsSendResult: ...

    def verify_inbound_signature(
        self,
        headers: Mapping[str, str],
        raw_body: bytes,
        secret: str,
    ) -> bool: ...

    @property
    def follow_up_daily_cap(self) -> Optional[int]:
        """Unique contacts per day we may proactively message (>24h since
        their last inbound). None means unlimited / unknown."""
        ...

    @property
    def inbound_daily_cap(self) -> Optional[int]:
        """Unique contacts per day that may text in. None means unlimited."""
        ...


# ---------------------------------------------------------------------------
# Sendblue implementation (active)
# ---------------------------------------------------------------------------


class SendblueProvider:
    """Wraps services.sendblue_service.send_message()."""

    name: str = "sendblue"

    async def send_message(
        self,
        to: str,
        content: str,
        media_url: Optional[str] = None,
        from_number: Optional[str] = None,
    ) -> SmsSendResult:
        # Local import to avoid circular dependency — sendblue_service is a
        # sibling module in services/.
        from services.sendblue_service import send_message as _sendblue_send

        # Today's sendblue_service.send_message() does not accept a
        # per-call from_number override (it reads from env), so we ignore
        # the parameter here for parity. If we later need multi-line
        # support, extend sendblue_service.send_message() accordingly.
        if from_number:
            logger.debug(
                "SendblueProvider: per-call from_number override not yet "
                "supported — ignoring (line=%s)",
                from_number,
            )

        try:
            ok = await _sendblue_send(to, content, media_url=media_url)
            return SmsSendResult(ok=ok, provider=self.name)
        except Exception as exc:
            logger.error("SendblueProvider.send_message failed: %s", exc)
            return SmsSendResult(ok=False, provider=self.name, error=str(exc))

    def verify_inbound_signature(
        self,
        headers: Mapping[str, str],
        raw_body: bytes,
        secret: str,
    ) -> bool:
        """Constant-time compare against the configured webhook secret.

        Sendblue currently delivers the shared secret as a raw header value
        (not an HMAC of the body). We keep the signature check ready for a
        future upgrade but today it's a header equality check.

        Header name compatibility: existing code uses 'x-webhook-secret';
        Sendblue's docs reference 'sb-signing-secret'. We check both so
        rotating the header name later doesn't cause an outage.
        """
        if not secret:
            # No secret configured → caller decides whether to allow.
            return True
        incoming = (
            headers.get("x-webhook-secret")
            or headers.get("sb-signing-secret")
            or ""
        )
        return hmac.compare_digest(incoming, secret)

    @property
    def follow_up_daily_cap(self) -> Optional[int]:
        # AI Agent plan: 200 unique contacts/day/line in a rolling 24h window.
        # Source: https://docs.sendblue.com/limits/
        return 200

    @property
    def inbound_daily_cap(self) -> Optional[int]:
        # AI Agent plan: 1000 unique contacts/day/line.
        return 1000


# ---------------------------------------------------------------------------
# Linq stub (inactive)
# ---------------------------------------------------------------------------


class LinqProvider:
    """Placeholder for Linq. Raises on send until wired up.

    Flesh out the send_message + verify_inbound_signature methods when
    Sendblue's 200/day follow-up cap becomes the ceiling on proactive
    SMS (estimated: 200+ active SMS users with daily proactive cadence).
    """

    name: str = "linq"

    async def send_message(
        self,
        to: str,
        content: str,
        media_url: Optional[str] = None,
        from_number: Optional[str] = None,
    ) -> SmsSendResult:
        logger.error(
            "LinqProvider.send_message called but Linq is not implemented"
        )
        return SmsSendResult(
            ok=False,
            provider=self.name,
            error="LinqProvider not implemented — set SMS_PROVIDER=sendblue",
        )

    def verify_inbound_signature(
        self,
        headers: Mapping[str, str],
        raw_body: bytes,
        secret: str,
    ) -> bool:
        logger.error("LinqProvider.verify_inbound_signature not implemented")
        return False

    @property
    def follow_up_daily_cap(self) -> Optional[int]:
        return None  # unknown until published

    @property
    def inbound_daily_cap(self) -> Optional[int]:
        return None


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


_PROVIDER_CACHE: Optional[SmsProvider] = None


def get_sms_provider() -> SmsProvider:
    """Return the configured provider, cached for the process lifetime."""
    global _PROVIDER_CACHE
    if _PROVIDER_CACHE is not None:
        return _PROVIDER_CACHE

    choice = (os.getenv("SMS_PROVIDER") or "sendblue").strip().lower()

    if choice == "linq":
        logger.warning(
            "SMS_PROVIDER=linq selected but LinqProvider is a stub — "
            "outbound sends will fail. Set SMS_PROVIDER=sendblue to restore."
        )
        _PROVIDER_CACHE = LinqProvider()
    else:
        if choice != "sendblue":
            logger.warning(
                "SMS_PROVIDER=%r is not recognized — falling back to sendblue",
                choice,
            )
        _PROVIDER_CACHE = SendblueProvider()

    logger.info("SMS provider initialized: %s", _PROVIDER_CACHE.name)
    return _PROVIDER_CACHE


def reset_sms_provider_cache() -> None:
    """Test-only: clear the cached provider so env changes take effect."""
    global _PROVIDER_CACHE
    _PROVIDER_CACHE = None
