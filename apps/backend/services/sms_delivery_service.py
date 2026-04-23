"""Shared outbound SMS delivery helpers."""

from __future__ import annotations

import asyncio
import random
import re
from typing import Any, Dict, List, Optional

from services.conversation_service import conversation_service
from services.sms_provider import SmsSendResult, get_sms_provider

_SEGMENT_DELIMITER = re.compile(r"\n-{3,}\n")
_MAX_SEGMENTS = 4
_SEGMENT_MAX_CHARS = 220
_SEGMENT_DELAY_MIN = 0.8
_SEGMENT_DELAY_MAX = 1.4


def extract_reply_segments(
    orchestrator_result: Dict[str, Any],
    fallback_text: str,
) -> List[str]:
    """Extract 1..N reply segments from an orchestrator response payload."""
    raw_messages = orchestrator_result.get("messages")
    if isinstance(raw_messages, list) and raw_messages:
        segments = [
            str(item).strip()
            for item in raw_messages
            if isinstance(item, str) and str(item).strip()
        ]
        if segments and len(segments) <= _MAX_SEGMENTS and all(
            len(segment) <= _SEGMENT_MAX_CHARS for segment in segments
        ):
            return segments

    trimmed = (fallback_text or "").strip()
    if not trimmed:
        return []

    parts = [part.strip() for part in _SEGMENT_DELIMITER.split(trimmed) if part.strip()]
    if len(parts) <= 1 or len(parts) > _MAX_SEGMENTS or any(
        len(part) > _SEGMENT_MAX_CHARS for part in parts
    ):
        return [trimmed]

    return parts


async def send_message(
    to: str,
    text: str,
    media_url: Optional[str] = None,
) -> SmsSendResult:
    """Send one outbound message through the configured provider."""
    return await get_sms_provider().send_message(to, text, media_url=media_url)


async def send_segments_and_persist(
    *,
    conversation_id: str,
    to_number: str,
    segments: List[str],
    tool_payload_base: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """Send reply segments sequentially and persist only successful sends."""
    sent_messages: List[Dict[str, Any]] = []
    payload_base = tool_payload_base or {}

    for index, segment in enumerate(segments):
        if index > 0:
            await asyncio.sleep(random.uniform(_SEGMENT_DELAY_MIN, _SEGMENT_DELAY_MAX))

        result = await send_message(to_number, segment)
        if not result.ok:
            break

        try:
            message = await conversation_service.add_internal_message(
                conversation_id=conversation_id,
                role="assistant",
                content=segment,
                tool_payload={
                    **payload_base,
                    "segment_index": index,
                    "segment_total": len(segments),
                    "sms_provider": result.provider,
                },
            )
            sent_messages.append(message)
        except Exception:
            sent_messages.append({"id": None, "content": segment})

    return sent_messages
