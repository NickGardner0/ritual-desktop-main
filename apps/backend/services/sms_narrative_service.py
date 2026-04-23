"""Daily SMS narrative renderer."""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from services.day_recap_service import build_day_recap

_SMS_SEGMENT_MAX = 220


def _truncate(value: str, limit: int) -> str:
    text = (value or "").strip()
    if len(text) <= limit:
        return text
    return f"{text[: max(limit - 3, 1)].rstrip()}..."


def _segment_text(summary: str) -> List[str]:
    sentences = [segment.strip() for segment in re.split(r"(?<=[.!?])\s+", summary) if segment.strip()]
    if not sentences:
        return [_truncate(summary, _SMS_SEGMENT_MAX)] if summary else []

    segments: List[str] = []
    current = ""
    for sentence in sentences:
        candidate = f"{current} {sentence}".strip() if current else sentence
        if len(candidate) <= _SMS_SEGMENT_MAX:
            current = candidate
            continue
        if current:
            segments.append(current)
        current = _truncate(sentence, _SMS_SEGMENT_MAX)
        if len(segments) >= 1:
            break
    if current and len(segments) < 2:
        segments.append(current)
    return segments[:2]


class SmsNarrativeService:
    """Compress the day recap bundle into an SMS-friendly daily narrative."""

    async def build_daily_narrative(
        self,
        *,
        user_id: str,
        anchor_date: str,
        timezone: Optional[str],
    ) -> Dict[str, Any]:
        recap = await build_day_recap(
            user_id=user_id,
            query="Summarize my day in a short narrative.",
            anchor_date=anchor_date,
            timezone_name=timezone,
            days_back=1,
        )
        summary = (recap.get("rendered_summary") or "").strip()
        if not summary:
            summary = "I don't have enough activity yet to build a useful daily narrative."

        segments = _segment_text(summary) or [_truncate(summary, _SMS_SEGMENT_MAX)]
        headline = _truncate(segments[0], 96)

        return {
            "message_segments": segments,
            "headline": headline,
            "metrics": {
                "anchor_date": anchor_date,
                "degraded": bool(recap.get("degraded")),
                "citations_count": int(recap.get("citations_count") or 0),
                "retrieval_tier": recap.get("retrieval_tier"),
            },
        }


sms_narrative_service = SmsNarrativeService()
