"""
Approved and pending semantic memory facts for Ritual AI.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional
from uuid import uuid4

from sqlalchemy import desc, select

from database.connection import get_db_session
from database.models import AiFactDB, AiFactEventDB, UserDB
from schemas.facts import (
    AiFactCreate,
    AiFactEventListResponse,
    AiFactEventRead,
    AiFactListResponse,
    AiFactRead,
    AiFactUpdate,
)

logger = logging.getLogger(__name__)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class FactService:
    def _parse_json(self, raw: Optional[str], fallback: Any) -> Any:
        if not raw:
            return fallback
        try:
            return json.loads(raw)
        except Exception:
            return fallback

    def _fact_to_schema(self, fact: AiFactDB) -> AiFactRead:
        return AiFactRead(
            id=fact.id,
            user_id=fact.user_id,
            category=fact.category,  # type: ignore[arg-type]
            subject=fact.subject,
            predicate=fact.predicate,
            value=self._parse_json(fact.value_json, {}),
            status=fact.status,  # type: ignore[arg-type]
            confidence=float(fact.confidence or 0.5),
            source_type=fact.source_type,  # type: ignore[arg-type]
            source_ref=fact.source_ref,
            visibility=fact.visibility,  # type: ignore[arg-type]
            last_confirmed_at=fact.last_confirmed_at,
            expires_at=fact.expires_at,
            created_at=fact.created_at,
            updated_at=fact.updated_at,
        )

    def _event_to_schema(self, event: AiFactEventDB) -> AiFactEventRead:
        return AiFactEventRead(
            id=event.id,
            fact_id=event.fact_id,
            user_id=event.user_id,
            event_type=event.event_type,
            payload=self._parse_json(event.payload_json, {}),
            created_at=event.created_at,
        )

    async def _record_event(
        self,
        session,
        *,
        fact_id: str,
        user_id: str,
        event_type: str,
        payload: Optional[Dict[str, Any]] = None,
    ) -> None:
        session.add(
            AiFactEventDB(
                id=str(uuid4()),
                fact_id=fact_id,
                user_id=user_id,
                event_type=event_type,
                payload_json=json.dumps(payload or {}),
                created_at=_utc_now(),
            )
        )
        await session.flush()

    async def _index_fact(self, fact: AiFactDB) -> None:
        try:
            from services.search_service import search_service

            await search_service.index_ai_fact(self._fact_to_schema(fact).model_dump(mode="json"), fact.user_id)
        except Exception:
            logger.exception("Failed to index AI fact %s", fact.id)

    async def ensure_seeded_profile_facts(self, user_id: str) -> None:
        async with get_db_session() as session:
            user = await session.get(UserDB, user_id)
            if user is None:
                return

            result = await session.execute(select(AiFactDB).where(AiFactDB.user_id == user_id))
            existing = list(result.scalars().all())
            existing_keys = {
                (fact.category, fact.subject, fact.predicate, fact.source_type)
                for fact in existing
            }

            seed_rows: List[AiFactDB] = []

            if user.timezone and ("preference", "user", "timezone", "onboarding") not in existing_keys:
                seed_rows.append(
                    AiFactDB(
                        id=str(uuid4()),
                        user_id=user_id,
                        category="preference",
                        subject="user",
                        predicate="timezone",
                        value_json=json.dumps({"value": user.timezone}),
                        status="active",
                        confidence=1.0,
                        source_type="onboarding",
                        source_ref=None,
                        visibility="prompt",
                        last_confirmed_at=_utc_now(),
                        created_at=_utc_now(),
                        updated_at=_utc_now(),
                    )
                )

            interests = self._parse_json(getattr(user, "tracking_interests", None), [])
            if interests and ("goal", "user", "tracking_interests", "onboarding") not in existing_keys:
                seed_rows.append(
                    AiFactDB(
                        id=str(uuid4()),
                        user_id=user_id,
                        category="goal",
                        subject="user",
                        predicate="tracking_interests",
                        value_json=json.dumps({"items": interests}),
                        status="active",
                        confidence=0.9,
                        source_type="onboarding",
                        visibility="prompt",
                        last_confirmed_at=_utc_now(),
                        created_at=_utc_now(),
                        updated_at=_utc_now(),
                    )
                )

            wearables = self._parse_json(getattr(user, "wearable_devices", None), [])
            if wearables and ("profile", "user", "wearables", "onboarding") not in existing_keys:
                seed_rows.append(
                    AiFactDB(
                        id=str(uuid4()),
                        user_id=user_id,
                        category="profile",
                        subject="user",
                        predicate="wearables",
                        value_json=json.dumps({"items": wearables}),
                        status="active",
                        confidence=0.9,
                        source_type="onboarding",
                        visibility="ui",
                        last_confirmed_at=_utc_now(),
                        created_at=_utc_now(),
                        updated_at=_utc_now(),
                    )
                )

            for row in seed_rows:
                session.add(row)
                await session.flush()
                await self._record_event(
                    session,
                    fact_id=row.id,
                    user_id=user_id,
                    event_type="seeded",
                    payload={"source_type": row.source_type, "predicate": row.predicate},
                )

            if seed_rows:
                await session.commit()
                for row in seed_rows:
                    await self._index_fact(row)

    async def list_facts(
        self,
        user_id: str,
        *,
        status: Optional[str] = None,
        category: Optional[str] = None,
    ) -> AiFactListResponse:
        await self.ensure_seeded_profile_facts(user_id)
        async with get_db_session() as session:
            filters = [AiFactDB.user_id == user_id]
            if status:
                filters.append(AiFactDB.status == status)
            if category:
                filters.append(AiFactDB.category == category)
            result = await session.execute(
                select(AiFactDB).where(*filters).order_by(desc(AiFactDB.created_at))
            )
            return AiFactListResponse(items=[self._fact_to_schema(item) for item in result.scalars().all()])

    async def list_events(self, user_id: str, fact_id: str) -> AiFactEventListResponse:
        async with get_db_session() as session:
            fact = await session.get(AiFactDB, fact_id)
            if fact is None or fact.user_id != user_id:
                return AiFactEventListResponse(items=[])
            result = await session.execute(
                select(AiFactEventDB)
                .where(AiFactEventDB.fact_id == fact_id)
                .order_by(desc(AiFactEventDB.created_at))
            )
            return AiFactEventListResponse(items=[self._event_to_schema(item) for item in result.scalars().all()])

    async def create_fact(self, user_id: str, payload: AiFactCreate) -> AiFactRead:
        async with get_db_session() as session:
            fact = AiFactDB(
                id=str(uuid4()),
                user_id=user_id,
                category=payload.category,
                subject=payload.subject,
                predicate=payload.predicate,
                value_json=json.dumps(payload.value),
                status=payload.status,
                confidence=payload.confidence,
                source_type=payload.source_type,
                source_ref=payload.source_ref,
                visibility=payload.visibility,
                expires_at=payload.expires_at,
                last_confirmed_at=_utc_now() if payload.status == "active" else None,
                created_at=_utc_now(),
                updated_at=_utc_now(),
            )
            session.add(fact)
            await session.flush()
            await self._record_event(
                session,
                fact_id=fact.id,
                user_id=user_id,
                event_type="created" if payload.source_type == "user" else "suggested",
                payload={"status": payload.status, "source_type": payload.source_type},
            )
            await session.commit()
            await self._index_fact(fact)
            return self._fact_to_schema(fact)

    async def create_suggestions(
        self,
        *,
        user_id: str,
        suggestions: Iterable[Dict[str, Any]],
        source_type: str,
        source_ref: Optional[str],
    ) -> List[AiFactRead]:
        created: List[AiFactRead] = []
        async with get_db_session() as session:
            for suggestion in suggestions:
                subject = str(suggestion.get("subject") or "user")
                predicate = str(suggestion.get("predicate") or "").strip()
                category = str(suggestion.get("category") or "preference")
                if not predicate:
                    continue
                fact = AiFactDB(
                    id=str(uuid4()),
                    user_id=user_id,
                    category=category,
                    subject=subject,
                    predicate=predicate,
                    value_json=json.dumps(suggestion.get("value") or {}),
                    status="pending",
                    confidence=float(suggestion.get("confidence") or 0.5),
                    source_type=source_type,
                    source_ref=source_ref,
                    visibility=str(suggestion.get("visibility") or "prompt"),
                    created_at=_utc_now(),
                    updated_at=_utc_now(),
                )
                session.add(fact)
                await session.flush()
                await self._record_event(
                    session,
                    fact_id=fact.id,
                    user_id=user_id,
                    event_type="suggested",
                    payload={"source_ref": source_ref, "source_type": source_type},
                )
                created.append(self._fact_to_schema(fact))
            if created:
                await session.commit()
                for fact in created:
                    pseudo_row = AiFactDB(
                        id=fact.id,
                        user_id=fact.user_id,
                        category=fact.category,
                        subject=fact.subject,
                        predicate=fact.predicate,
                        value_json=json.dumps(fact.value),
                        status=fact.status,
                        confidence=fact.confidence,
                        source_type=fact.source_type,
                        source_ref=fact.source_ref,
                        visibility=fact.visibility,
                        last_confirmed_at=fact.last_confirmed_at,
                        expires_at=fact.expires_at,
                        created_at=fact.created_at,
                        updated_at=fact.updated_at,
                    )
                    await self._index_fact(pseudo_row)
        return created

    async def update_fact(self, user_id: str, fact_id: str, payload: AiFactUpdate) -> Optional[AiFactRead]:
        async with get_db_session() as session:
            fact = await session.get(AiFactDB, fact_id)
            if fact is None or fact.user_id != user_id:
                return None
            before = self._fact_to_schema(fact).model_dump(mode="json")
            if payload.category is not None:
                fact.category = payload.category
            if payload.subject is not None:
                fact.subject = payload.subject
            if payload.predicate is not None:
                fact.predicate = payload.predicate
            if payload.value is not None:
                fact.value_json = json.dumps(payload.value)
            if payload.status is not None:
                fact.status = payload.status
                if payload.status == "active":
                    fact.last_confirmed_at = _utc_now()
            if payload.confidence is not None:
                fact.confidence = payload.confidence
            if payload.visibility is not None:
                fact.visibility = payload.visibility
            if payload.expires_at is not None:
                fact.expires_at = payload.expires_at
            fact.updated_at = _utc_now()
            await self._record_event(
                session,
                fact_id=fact.id,
                user_id=user_id,
                event_type="updated",
                payload={"before": before},
            )
            await session.commit()
            await self._index_fact(fact)
            return self._fact_to_schema(fact)

    async def approve_fact(self, user_id: str, fact_id: str) -> Optional[AiFactRead]:
        return await self.update_fact(user_id, fact_id, AiFactUpdate(status="active"))

    async def dismiss_fact(self, user_id: str, fact_id: str) -> Optional[AiFactRead]:
        return await self.update_fact(user_id, fact_id, AiFactUpdate(status="dismissed"))

    async def get_prompt_facts(self, user_id: str) -> List[Dict[str, Any]]:
        await self.ensure_seeded_profile_facts(user_id)
        async with get_db_session() as session:
            result = await session.execute(
                select(AiFactDB)
                .where(
                    AiFactDB.user_id == user_id,
                    AiFactDB.status == "active",
                )
                .order_by(desc(AiFactDB.last_confirmed_at), desc(AiFactDB.created_at))
            )
            return [
                {
                    "id": fact.id,
                    "category": fact.category,
                    "subject": fact.subject,
                    "predicate": fact.predicate,
                    "value": self._parse_json(fact.value_json, {}),
                    "visibility": fact.visibility,
                }
                for fact in result.scalars().all()
                if fact.visibility in {"prompt", "ui"}
            ]


fact_service = FactService()
