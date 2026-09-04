"""Approval-gated calendar mutations proposed by AI."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from sqlalchemy import and_, or_, select

from database.connection import get_db_session
from database.models import ActionReceiptDB, ApprovalRequestDB, CalendarEventDB, CalendarOccurrenceDB
from schemas.calendar import CalendarEventCreate, CalendarEventUpdate, CalendarProposalCreate
from services.calendar_service import calendar_service


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _json(raw: str | None, fallback: Any) -> Any:
    try:
        return json.loads(raw or "")
    except (TypeError, ValueError):
        return fallback


class CalendarProposalService:
    @staticmethod
    def to_read(row: ApprovalRequestDB) -> dict:
        action = _json(row.proposed_action_json, {})
        return {
            "id": row.id,
            "action": action.get("action") or row.action_kind,
            "event_id": action.get("event_id"),
            "occurrence_id": action.get("occurrence_id"),
            "before": action.get("before"),
            "after": action.get("after") or {},
            "conflicts": action.get("conflicts") or [],
            "expires_at": row.expires_at or (_now() + timedelta(minutes=30)),
        }

    async def _conflicts(self, session, user_id: str, after: dict) -> list[str]:
        try:
            start = datetime.fromisoformat(str(after.get("start_at") or "").replace("Z", "+00:00"))
            end = datetime.fromisoformat(str(after.get("end_at") or "").replace("Z", "+00:00"))
        except ValueError:
            return []
        if start.tzinfo:
            start = start.astimezone(timezone.utc).replace(tzinfo=None)
        if end.tzinfo:
            end = end.astimezone(timezone.utc).replace(tzinfo=None)
        if end <= start:
            return []
        event_id = after.get("id") or after.get("event_id")
        rows = (
            await session.execute(
                select(CalendarOccurrenceDB, CalendarEventDB)
                .join(CalendarEventDB, CalendarEventDB.id == CalendarOccurrenceDB.event_id)
                .where(
                    CalendarOccurrenceDB.user_id == user_id,
                    CalendarOccurrenceDB.all_day.is_(False),
                    CalendarOccurrenceDB.start_at < end,
                    CalendarOccurrenceDB.end_at > start,
                    CalendarOccurrenceDB.status == "confirmed",
                    CalendarEventDB.availability == "busy",
                    CalendarEventDB.deleted_at.is_(None),
                    CalendarEventDB.id != event_id if event_id else True,
                )
                .limit(20)
            )
        ).all()
        return [f"Overlaps {event.title}" for _occurrence, event in rows]

    async def create(self, user_id: str, payload: CalendarProposalCreate) -> list[dict]:
        created: list[ApprovalRequestDB] = []
        now = _now()
        async with get_db_session() as session:
            for draft in payload.changes:
                before = None
                if draft.event_id:
                    event = await session.get(CalendarEventDB, draft.event_id)
                    if not event or event.user_id != user_id or event.deleted_at is not None:
                        raise ValueError("Calendar proposal references an unavailable event")
                    before = {
                        "id": event.id,
                        "title": event.title,
                        "start_at": event.start_at.isoformat() if event.start_at else None,
                        "end_at": event.end_at.isoformat() if event.end_at else None,
                        "revision": event.revision,
                    }
                after = dict(draft.after)
                if before and "expected_revision" not in after:
                    after["expected_revision"] = before["revision"]
                conflicts = await self._conflicts(session, user_id, {**after, "event_id": draft.event_id})
                proposal_id = str(uuid4())
                action = {
                    "action": draft.action,
                    "event_id": draft.event_id,
                    "occurrence_id": draft.occurrence_id,
                    "recurrence_scope": draft.recurrence_scope,
                    "before": before,
                    "after": after,
                    "conflicts": conflicts,
                }
                approval = ApprovalRequestDB(
                    id=proposal_id,
                    user_id=user_id,
                    workflow_run_id=None,
                    action_kind=f"calendar.{draft.action}",
                    capability="calendar_events",
                    status="pending",
                    reason="AI calendar mutations require explicit approval.",
                    payload_json=json.dumps(after, default=str),
                    proposed_action_json=json.dumps(action, default=str),
                    policy_decision_json=json.dumps({"outcome": "requires_approval"}),
                    expires_at=now + timedelta(minutes=30),
                    created_at=now,
                    updated_at=now,
                )
                session.add(approval)
                session.add(
                    ActionReceiptDB(
                        id=str(uuid4()),
                        user_id=user_id,
                        conversation_id=payload.conversation_id,
                        client_event_id=proposal_id,
                        action_kind=f"calendar.{draft.action}",
                        capability="calendar_events",
                        target_ref=f"calendar_event:{draft.event_id}" if draft.event_id else None,
                        status="approved_pending",
                        before_json=json.dumps(before, default=str) if before else None,
                        after_json=None,
                        undo_json=json.dumps(before, default=str) if before else None,
                        metadata_json=json.dumps({"source": "calendar_ai_proposal", "conflicts": conflicts}),
                        created_at=now,
                    )
                )
                created.append(approval)
            await session.commit()
        return [self.to_read(item) for item in created]

    async def list_pending(self, user_id: str) -> list[dict]:
        async with get_db_session() as session:
            rows = list(
                (
                    await session.execute(
                        select(ApprovalRequestDB).where(
                            ApprovalRequestDB.user_id == user_id,
                            ApprovalRequestDB.capability == "calendar_events",
                            ApprovalRequestDB.status == "pending",
                            or_(ApprovalRequestDB.expires_at.is_(None), ApprovalRequestDB.expires_at > _now()),
                        ).order_by(ApprovalRequestDB.created_at.asc()).limit(100)
                    )
                ).scalars().all()
            )
            return [self.to_read(item) for item in rows]

    async def _set_outcome(self, user_id: str, proposal_id: str, status: str, result: Any = None) -> None:
        async with get_db_session() as session:
            approval = await session.get(ApprovalRequestDB, proposal_id)
            if approval and approval.user_id == user_id:
                approval.status = "pending" if status == "failed" else status
                approval.resolved_at = None if status == "failed" else _now()
                approval.updated_at = _now()
            receipt = (
                await session.execute(
                    select(ActionReceiptDB).where(
                        ActionReceiptDB.user_id == user_id,
                        ActionReceiptDB.client_event_id == proposal_id,
                    )
                )
            ).scalar_one_or_none()
            if receipt:
                receipt.status = "applied" if status == "approved" else status
                if result is not None:
                    receipt.after_json = json.dumps(result, default=str)
            await session.commit()

    async def apply(self, user_id: str, proposal_ids: list[str]) -> dict:
        applied: list[str] = []
        failed: dict[str, str] = {}
        events: list[dict] = []
        for proposal_id in proposal_ids:
            async with get_db_session() as session:
                row = await session.get(ApprovalRequestDB, proposal_id)
                if not row or row.user_id != user_id or row.capability != "calendar_events":
                    failed[proposal_id] = "Proposal not found"
                    continue
                if row.status != "pending" or (row.expires_at and row.expires_at <= _now()):
                    failed[proposal_id] = "Proposal expired or was superseded"
                    continue
                action = _json(row.proposed_action_json, {})
            try:
                kind = action.get("action")
                after = action.get("after") or {}
                event_id = action.get("event_id")
                scope = action.get("recurrence_scope") or "series"
                occurrence_id = action.get("occurrence_id")
                result = None
                if kind in {"create_event", "create_task_allocation"}:
                    after["origin"] = "ai"
                    if kind == "create_task_allocation":
                        after["kind"] = "task_allocation"
                    result = await calendar_service.create_event(user_id, CalendarEventCreate.model_validate(after))
                elif kind in {"update_event", "move_event", "resize_event"} and event_id:
                    after.update({"recurrence_scope": scope, "occurrence_id": occurrence_id})
                    result = await calendar_service.update_event(user_id, event_id, CalendarEventUpdate.model_validate(after))
                elif kind == "delete_event" and event_id:
                    await calendar_service.delete_event(user_id, event_id, scope=scope, occurrence_id=occurrence_id)
                    result = {"deleted": True, "event_id": event_id}
                elif kind == "rsvp" and event_id:
                    result = await calendar_service.rsvp(user_id, event_id, str(after.get("response")))
                elif kind == "publish" and event_id:
                    result = await calendar_service.publish_event(user_id, event_id, str(after.get("source_id")))
                else:
                    raise ValueError("Unsupported calendar proposal")
                await self._set_outcome(user_id, proposal_id, "approved", result)
                applied.append(proposal_id)
                if result and isinstance(result, dict) and result.get("id"):
                    events.append(result)
            except Exception as exc:
                failed[proposal_id] = str(exc)
                await self._set_outcome(user_id, proposal_id, "failed", {"error": str(exc)})
        return {"applied": applied, "failed": failed, "events": events}

    async def reject(self, user_id: str, proposal_id: str) -> None:
        await self._set_outcome(user_id, proposal_id, "rejected")


calendar_proposal_service = CalendarProposalService()
