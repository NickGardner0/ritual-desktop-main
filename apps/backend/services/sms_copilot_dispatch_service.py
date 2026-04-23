"""Dispatch and lifecycle management for SMS copilot events."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional
from zoneinfo import ZoneInfo

from sqlalchemy import and_, desc, select

from database.connection import get_db_session
from database.models import SmsCopilotEventDB, UserDB
from schemas.sms_copilot import SmsCopilotEventRead
from services.conversation_service import conversation_service
from services.sms_delivery_service import send_segments_and_persist
from services.sms_narrative_service import sms_narrative_service
from services.sms_preferences_service import sms_preferences_service


class SmsCopilotDispatchService:
    """Apply gates, send messages, and persist copilot event state."""

    async def dispatch_candidate(self, candidate) -> SmsCopilotEventRead:
        user = await self._get_user(candidate.user_id)
        if user is None or not getattr(user, "phone_number", None):
            return await self._persist_event(
                candidate,
                status="suppressed",
                suppression_reason="missing_phone_number",
            )

        existing = await self._get_by_dedupe(candidate.user_id, candidate.dedupe_key)
        if existing is not None:
            return self._serialize_event(existing)

        prefs = await sms_preferences_service.get_or_create(candidate.user_id)
        gate = await self._evaluate_gate(candidate=candidate, prefs=prefs, timezone_name=user.timezone)
        if gate is not None:
            return await self._persist_event(
                candidate,
                status="suppressed",
                suppression_reason=gate,
            )

        conversation = await conversation_service.find_or_create_sms_conversation(candidate.user_id)
        rendered = await self._render_candidate(candidate)
        sent_messages = await send_segments_and_persist(
            conversation_id=conversation["id"],
            to_number=user.phone_number,
            segments=list(rendered["segments"]),
            tool_payload_base={
                "sms_copilot_kind": candidate.kind,
                "dedupe_key": candidate.dedupe_key,
            },
        )
        if not sent_messages:
            return await self._persist_event(
                candidate,
                conversation_id=conversation["id"],
                status="suppressed",
                suppression_reason="send_failed",
                headline=rendered.get("headline"),
                body=rendered.get("body"),
                metrics=rendered.get("metrics"),
                response_options=rendered.get("response_options"),
            )

        now = datetime.utcnow()
        return await self._persist_event(
            candidate,
            conversation_id=conversation["id"],
            status="sent",
            headline=rendered.get("headline"),
            body=rendered.get("body"),
            metrics=rendered.get("metrics"),
            response_options=rendered.get("response_options"),
            assistant_message_id=sent_messages[0]["id"],
            sent_at=now,
        )

    async def list_events(
        self,
        *,
        user_id: str,
        limit: int = 20,
        kind: Optional[str] = None,
        status: Optional[str] = None,
    ) -> List[SmsCopilotEventRead]:
        async with get_db_session() as session:
            query = select(SmsCopilotEventDB).where(SmsCopilotEventDB.user_id == user_id)
            if kind:
                query = query.where(SmsCopilotEventDB.kind == kind)
            if status:
                query = query.where(SmsCopilotEventDB.status == status)
            result = await session.execute(
                query.order_by(desc(SmsCopilotEventDB.created_at)).limit(max(1, min(limit, 50)))
            )
            return [self._serialize_event(event) for event in result.scalars().all()]

    async def get_latest_unresolved_interrupt(
        self,
        *,
        user_id: str,
        kind: str = "distraction_spiral",
    ) -> Optional[SmsCopilotEventRead]:
        async with get_db_session() as session:
            result = await session.execute(
                select(SmsCopilotEventDB)
                .where(
                    and_(
                        SmsCopilotEventDB.user_id == user_id,
                        SmsCopilotEventDB.kind == kind,
                        SmsCopilotEventDB.status == "sent",
                    )
                )
                .order_by(desc(SmsCopilotEventDB.created_at))
                .limit(1)
            )
            event = result.scalars().first()
            return self._serialize_event(event) if event else None

    async def mark_event_acted(
        self,
        *,
        event_id: str,
        user_reply_message_id: Optional[str] = None,
    ) -> Optional[SmsCopilotEventRead]:
        async with get_db_session() as session:
            result = await session.execute(
                select(SmsCopilotEventDB).where(SmsCopilotEventDB.id == event_id)
            )
            event = result.scalars().first()
            if event is None:
                return None
            now = datetime.utcnow()
            event.status = "acted"
            event.replied_at = now
            event.acted_at = now
            event.user_reply_message_id = user_reply_message_id
            event.updated_at = now
            await session.commit()
            await session.refresh(event)
            return self._serialize_event(event)

    async def _get_user(self, user_id: str) -> Optional[UserDB]:
        async with get_db_session() as session:
            result = await session.execute(select(UserDB).where(UserDB.id == user_id))
            return result.scalars().first()

    async def _get_by_dedupe(self, user_id: str, dedupe_key: str) -> Optional[SmsCopilotEventDB]:
        async with get_db_session() as session:
            result = await session.execute(
                select(SmsCopilotEventDB).where(
                    and_(
                        SmsCopilotEventDB.user_id == user_id,
                        SmsCopilotEventDB.dedupe_key == dedupe_key,
                    )
                )
            )
            return result.scalars().first()

    async def _evaluate_gate(
        self,
        *,
        candidate,
        prefs: Dict[str, Any],
        timezone_name: Optional[str],
    ) -> Optional[str]:
        if not prefs.get("enabled"):
            return "sms_disabled"

        try:
            zone = ZoneInfo(timezone_name or "America/New_York")
        except Exception:
            zone = ZoneInfo("America/New_York")
        now_local = datetime.now(timezone.utc).astimezone(zone)

        if sms_preferences_service.is_in_quiet_hours(prefs, now_local):
            return "quiet_hours"

        if candidate.kind == "daily_narrative":
            if not prefs.get("daily_narrative_enabled", True):
                return "daily_narrative_disabled"
            return None

        if not prefs.get("interrupts_enabled", True):
            return "interrupts_disabled"

        allowed_interrupt_kinds = {
            item.strip()
            for item in str(prefs.get("allowed_interrupt_kinds") or "").split(",")
            if item.strip()
        }
        if candidate.kind not in allowed_interrupt_kinds:
            return "interrupt_kind_disabled"

        sent_today = await self._count_sent_interrupts_today(
            candidate.user_id,
            now_local.date().isoformat(),
            zone,
        )
        if sent_today >= int(prefs.get("max_interrupts_per_day") or 0):
            return "daily_interrupt_cap"

        latest_interrupt = await self._get_latest_sent_interrupt(candidate.user_id)
        if latest_interrupt and latest_interrupt.sent_at:
            min_gap_hours = int(prefs.get("min_hours_between_interrupts") or 0)
            if latest_interrupt.sent_at >= datetime.utcnow() - timedelta(hours=min_gap_hours):
                return "interrupt_cooldown"

        return None

    async def _count_sent_interrupts_today(self, user_id: str, local_day: str, zone: ZoneInfo) -> int:
        async with get_db_session() as session:
            result = await session.execute(
                select(SmsCopilotEventDB).where(
                    and_(
                        SmsCopilotEventDB.user_id == user_id,
                        SmsCopilotEventDB.kind == "distraction_spiral",
                        SmsCopilotEventDB.status == "sent",
                    )
                )
            )
            total = 0
            for event in result.scalars().all():
                if event.sent_at and event.sent_at.replace(tzinfo=timezone.utc).astimezone(zone).date().isoformat() == local_day:
                    total += 1
            return total

    async def _get_latest_sent_interrupt(self, user_id: str) -> Optional[SmsCopilotEventRead]:
        async with get_db_session() as session:
            result = await session.execute(
                select(SmsCopilotEventDB)
                .where(
                    and_(
                        SmsCopilotEventDB.user_id == user_id,
                        SmsCopilotEventDB.kind == "distraction_spiral",
                        SmsCopilotEventDB.status == "sent",
                    )
                )
                .order_by(desc(SmsCopilotEventDB.sent_at), desc(SmsCopilotEventDB.created_at))
                .limit(1)
            )
            event = result.scalars().first()
            return self._serialize_event(event) if event else None

    async def _render_candidate(self, candidate) -> Dict[str, Any]:
        if candidate.kind == "daily_narrative":
            narrative = await sms_narrative_service.build_daily_narrative(
                user_id=candidate.user_id,
                anchor_date=str(candidate.payload.get("anchor_date")),
                timezone=candidate.payload.get("timezone"),
            )
            return {
                "segments": narrative["message_segments"],
                "headline": narrative["headline"],
                "body": "\n---\n".join(narrative["message_segments"]),
                "metrics": {
                    **(narrative.get("metrics") or {}),
                    **candidate.payload,
                },
                "response_options": [],
            }

        if candidate.kind == "distraction_spiral":
            distracting_minutes = candidate.payload.get("distracting_minutes")
            baseline_minutes = candidate.payload.get("baseline_minutes")
            multiplier = candidate.payload.get("multiplier")
            top_domains = list(candidate.payload.get("top_domains") or [])
            lead = top_domains[:2]
            domain_phrase = " and ".join(domain for domain in lead if domain) or "a few distracting sites"
            text = (
                f"You've spent {distracting_minutes:g} min bouncing through {domain_phrase} in the last hour, "
                f"about {multiplier:g}x your norm. If you want, I can treat the next 25 min as a focus block."
            )
            return {
                "segments": [text],
                "headline": "Distraction spiral detected",
                "body": text,
                "metrics": {
                    **candidate.payload,
                    "baseline_minutes": baseline_minutes,
                },
                "response_options": ["focus", "reset", "ok", "yes"],
            }

        raise ValueError(f"Unsupported copilot kind: {candidate.kind}")

    async def _persist_event(
        self,
        candidate,
        *,
        status: str,
        suppression_reason: Optional[str] = None,
        conversation_id: Optional[str] = None,
        headline: Optional[str] = None,
        body: Optional[str] = None,
        metrics: Optional[Dict[str, Any]] = None,
        response_options: Optional[Iterable[str]] = None,
        assistant_message_id: Optional[str] = None,
        sent_at: Optional[datetime] = None,
    ) -> SmsCopilotEventRead:
        now = datetime.utcnow()
        trigger_window_start = self._parse_optional_datetime(candidate.payload.get("trigger_window_start"))
        trigger_window_end = self._parse_optional_datetime(candidate.payload.get("trigger_window_end"))
        async with get_db_session() as session:
            event = SmsCopilotEventDB(
                id=str(uuid.uuid4()),
                user_id=candidate.user_id,
                conversation_id=conversation_id,
                kind=candidate.kind,
                status=status,
                score=candidate.score,
                confidence=candidate.confidence,
                novelty_score=candidate.novelty_score,
                actionability_score=candidate.actionability_score,
                dedupe_key=candidate.dedupe_key,
                suppression_reason=suppression_reason,
                trigger_window_start=trigger_window_start,
                trigger_window_end=trigger_window_end,
                headline=headline,
                body=body,
                metrics_json=json.dumps(metrics or candidate.payload),
                response_options_json=json.dumps(list(response_options or [])),
                assistant_message_id=assistant_message_id,
                sent_at=sent_at,
                created_at=now,
                updated_at=now,
            )
            session.add(event)
            await session.commit()
            await session.refresh(event)
            return self._serialize_event(event)

    def _parse_optional_datetime(self, value: Any) -> Optional[datetime]:
        if value is None:
            return None
        if isinstance(value, datetime):
            return value.replace(tzinfo=None)
        try:
            return datetime.fromisoformat(str(value).replace("Z", "+00:00")).replace(tzinfo=None)
        except Exception:
            return None

    def _serialize_event(self, event: SmsCopilotEventDB) -> SmsCopilotEventRead:
        metrics = {}
        response_options: List[str] = []
        if event.metrics_json:
            try:
                metrics = json.loads(event.metrics_json)
            except Exception:
                metrics = {}
        if event.response_options_json:
            try:
                response_options = list(json.loads(event.response_options_json))
            except Exception:
                response_options = []
        return SmsCopilotEventRead(
            id=event.id,
            user_id=event.user_id,
            conversation_id=event.conversation_id,
            kind=event.kind,
            status=event.status,
            score=float(event.score or 0.0),
            confidence=float(event.confidence or 0.0),
            novelty_score=float(event.novelty_score or 0.0),
            actionability_score=float(event.actionability_score or 0.0),
            dedupe_key=event.dedupe_key,
            suppression_reason=event.suppression_reason,
            headline=event.headline,
            body=event.body,
            metrics=metrics,
            response_options=response_options,
            assistant_message_id=event.assistant_message_id,
            user_reply_message_id=event.user_reply_message_id,
            provider_message_id=event.provider_message_id,
            trigger_window_start=event.trigger_window_start,
            trigger_window_end=event.trigger_window_end,
            sent_at=event.sent_at,
            replied_at=event.replied_at,
            acted_at=event.acted_at,
            created_at=event.created_at,
            updated_at=event.updated_at,
        )


sms_copilot_dispatch_service = SmsCopilotDispatchService()
