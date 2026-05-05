"""Daily SMS narrative renderer."""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from services.project_time_service import get_project_time_rollups

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


def _format_duration(active_ms: int) -> str:
    minutes = max(0, round(active_ms / 60_000))
    if minutes < 60:
        return f"{minutes}m"
    hours = minutes // 60
    rem = minutes % 60
    return f"{hours}h {rem}m" if rem else f"{hours}h"


class SmsNarrativeService:
    """Compress the day recap bundle into an SMS-friendly daily narrative."""

    async def build_daily_narrative(
        self,
        *,
        user_id: str,
        anchor_date: str,
        timezone: Optional[str],
    ) -> Dict[str, Any]:
        rollups = await get_project_time_rollups(
            user_id=user_id,
            start_date=anchor_date,
            end_date=anchor_date,
            group_by="task",
            limit=5,
        )
        rows = rollups.get("data") if rollups.get("success") else []
        rows = rows if isinstance(rows, list) else []
        if rows:
            top = rows[:3]
            parts = []
            for row in top:
                project = str(row.get("project_name") or "Unclassified").strip()
                task = str(row.get("task_name") or "").strip()
                label = f"{project} / {task}" if task and task != "General" else project
                parts.append(f"{label} ({_format_duration(int(row.get('active_ms') or 0))})")
            summary = f"Your main computer workstreams for {anchor_date}: {', '.join(parts)}."
        else:
            summary = "I don't have enough attributed computer activity yet to build a useful daily narrative."

        segments = _segment_text(summary) or [_truncate(summary, _SMS_SEGMENT_MAX)]
        headline = _truncate(segments[0], 96)

        return {
            "message_segments": segments,
            "headline": headline,
            "metrics": {
                "anchor_date": anchor_date,
                "degraded": False,
                "citations_count": 0,
                "retrieval_tier": "project_time_rollups",
                "timezone": timezone,
            },
        }


sms_narrative_service = SmsNarrativeService()
