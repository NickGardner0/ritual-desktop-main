"""Entity Protocol: identity, summaries, derived related objects, authored refs."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, List, Optional, Sequence, Tuple
from uuid import uuid4

from sqlalchemy import and_, desc, or_, select

from database.connection import get_db_session
from database.models import (
    AIConversationDB,
    ArtifactDB,
    ArtifactLinkDB,
    CalendarEventDB,
    CalendarOccurrenceDB,
    EntityReferenceDB,
    ExperimentDB,
    HabitDB,
    HabitLogDB,
    RoutineDB,
    RoutineRunDB,
    TaskDB,
)
from database.models.base import _utcnow_naive
from schemas.entities import (
    ENTITY_TYPES,
    EntityRef,
    EntityReferenceRead,
    EntitySummary,
    RelatedEntity,
    RelatedEntityItem,
    canonical_entity_type,
    entity_route,
    is_day_id,
    is_time_window_id,
    parse_date_mention_query,
    unavailable_summary,
    virtual_date_summary,
)
from services.privacy_policy import data_class_for_entity_type

FORBIDDEN_ENTITY = object()


def _iso(value: Any) -> Optional[str]:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        try:
            return value.isoformat()
        except Exception:
            return str(value)
    return str(value)


def _ok_summary(
    *,
    entity_type: str,
    entity_id: str,
    title: str,
    subtitle: Optional[str] = None,
    status: Optional[str] = None,
    icon: Optional[str] = None,
    updated_at: Any = None,
) -> EntitySummary:
    return EntitySummary(
        ref=EntityRef(type=entity_type, id=entity_id),
        title=title or "Untitled",
        subtitle=subtitle,
        status=status,
        icon=icon,
        route=entity_route(entity_type, entity_id),
        updatedAt=_iso(updated_at),
        privacyClass=data_class_for_entity_type(entity_type),
        availability="ok",
    )


class EntityService:
    async def get_summary(self, user_id: str, entity_type: str, entity_id: str) -> EntitySummary:
        canonical = canonical_entity_type(entity_type) or entity_type
        if canonical in {"day", "time_window"}:
            summary = virtual_date_summary(canonical, entity_id)
            return summary or unavailable_summary(EntityRef(type=canonical, id=entity_id), "unknown")
        ref = EntityRef(type=canonical, id=entity_id)
        row = await self._load(user_id, canonical, entity_id)
        if row is FORBIDDEN_ENTITY:
            return unavailable_summary(ref, "forbidden")
        if row is None:
            return unavailable_summary(ref, "unknown")
        return self._to_summary(canonical, row)

    async def resolve_many(self, user_id: str, refs: Sequence[EntityRef]) -> List[EntitySummary]:
        items: List[EntitySummary] = []
        seen: set[Tuple[str, str]] = set()
        ordered: List[Tuple[str, str]] = []
        by_type: dict[str, List[str]] = {}
        virtual: dict[Tuple[str, str], EntitySummary] = {}

        for raw in refs[:50]:
            canonical = canonical_entity_type(raw.type) or raw.type
            key = (canonical, raw.id)
            if key in seen:
                continue
            seen.add(key)
            ordered.append(key)
            if canonical in {"day", "time_window"}:
                virtual[key] = await self.get_summary(user_id, canonical, raw.id)
                continue
            by_type.setdefault(canonical, []).append(raw.id)

        loaded: dict[Tuple[str, str], Any] = {}
        if by_type:
            async with get_db_session() as session:
                for entity_type, ids in by_type.items():
                    loaded.update(await self._load_many(session, user_id, entity_type, ids))

        for entity_type, entity_id in ordered:
            key = (entity_type, entity_id)
            if key in virtual:
                items.append(virtual[key])
                continue
            row = loaded.get(key)
            if row is FORBIDDEN_ENTITY:
                items.append(unavailable_summary(EntityRef(type=entity_type, id=entity_id), "forbidden"))
            elif row is None:
                items.append(unavailable_summary(EntityRef(type=entity_type, id=entity_id), "unknown"))
            else:
                items.append(self._to_summary(entity_type, row))
        return items

    async def related(self, user_id: str, entity_type: str, entity_id: str) -> List[RelatedEntityItem]:
        canonical = canonical_entity_type(entity_type) or entity_type
        summary = await self.get_summary(user_id, canonical, entity_id)
        if summary.availability != "ok":
            return []
        edges = await self._derived_edges(user_id, canonical, entity_id)
        authored = await self._authored_edges(user_id, canonical, entity_id)
        unique_edges: List[RelatedEntity] = []
        seen: set[Tuple[str, str, str]] = set()
        for edge in edges + authored:
            key = (edge.ref.type, edge.ref.id, edge.relationship)
            if key in seen:
                continue
            seen.add(key)
            unique_edges.append(edge)
            if len(unique_edges) >= 24:
                break
        summaries = await self.resolve_many(user_id, [edge.ref for edge in unique_edges])
        by_ref = {(item.ref.type, item.ref.id): item for item in summaries}
        return [
            RelatedEntityItem(
                edge=edge,
                summary=by_ref.get((edge.ref.type, edge.ref.id))
                or unavailable_summary(edge.ref, "unknown"),
            )
            for edge in unique_edges
        ]

    async def search(
        self,
        user_id: str,
        query: str,
        types: Optional[Sequence[str]] = None,
        limit: int = 20,
    ) -> List[EntitySummary]:
        needle = (query or "").strip()
        wanted = []
        for item in types or ENTITY_TYPES:
            canonical = canonical_entity_type(item)
            if canonical and canonical not in wanted:
                wanted.append(canonical)
        if not wanted:
            wanted = list(ENTITY_TYPES)
        cap = max(1, min(int(limit or 20), 40))
        per_type = max(3, cap // max(1, len(wanted)))
        results: List[EntitySummary] = []
        parsed_date = parse_date_mention_query(needle)
        if parsed_date and parsed_date[0] in wanted:
            date_summary = virtual_date_summary(parsed_date[0], parsed_date[1])
            if date_summary:
                results.append(date_summary)
        async with get_db_session() as session:
            for entity_type in wanted:
                if entity_type in {"day", "time_window"}:
                    continue
                results.extend(
                    await self._search_type(session, user_id, entity_type, needle, per_type)
                )
        return results[:cap]

    async def create_reference(
        self,
        user_id: str,
        *,
        source: EntityRef,
        target: EntityRef,
        relationship: str = "references",
        provenance: str = "user",
        anchor_json: Optional[str] = None,
        client_event_id: Optional[str] = None,
    ) -> EntityReferenceRead:
        if source.type == target.type and source.id == target.id:
            raise ValueError("An entity cannot reference itself")
        if relationship in {"supports", "contradicts", "evidence_for"}:
            if source.type != "experiment" and target.type != "experiment":
                raise ValueError("Typed evidence relationships require an experiment")

        async with get_db_session() as session:
            if client_event_id:
                existing = await session.execute(
                    select(EntityReferenceDB).where(
                        EntityReferenceDB.user_id == user_id,
                        EntityReferenceDB.client_event_id == client_event_id,
                        EntityReferenceDB.deleted_at.is_(None),
                    )
                )
                row = existing.scalar_one_or_none()
                if row is not None:
                    return self._reference_to_schema(row)

            duplicate = await session.execute(
                select(EntityReferenceDB).where(
                    EntityReferenceDB.user_id == user_id,
                    EntityReferenceDB.source_type == source.type,
                    EntityReferenceDB.source_id == source.id,
                    EntityReferenceDB.target_type == target.type,
                    EntityReferenceDB.target_id == target.id,
                    EntityReferenceDB.relationship == relationship,
                    EntityReferenceDB.deleted_at.is_(None),
                )
            )
            row = duplicate.scalar_one_or_none()
            if row is not None:
                return self._reference_to_schema(row)

            row = EntityReferenceDB(
                id=str(uuid4()),
                user_id=user_id,
                source_type=source.type,
                source_id=source.id,
                target_type=target.type,
                target_id=target.id,
                relationship=relationship or "references",
                provenance=provenance or "user",
                anchor_json=anchor_json,
                client_event_id=client_event_id,
            )
            session.add(row)
            await session.commit()
            await session.refresh(row)
            return self._reference_to_schema(row)

    async def sync_mentions(
        self,
        user_id: str,
        *,
        source: EntityRef,
        targets: Sequence[EntityRef],
        provenance: str = "user",
    ) -> List[EntityReferenceRead]:
        wanted: List[EntityRef] = []
        seen: set[Tuple[str, str]] = set()
        for target in targets:
            if source.type == target.type and source.id == target.id:
                continue
            key = (target.type, target.id)
            if key in seen:
                continue
            seen.add(key)
            wanted.append(target)
        remaining = {(item.type, item.id) for item in wanted}

        async with get_db_session() as session:
            existing = await session.execute(
                select(EntityReferenceDB).where(
                    EntityReferenceDB.user_id == user_id,
                    EntityReferenceDB.source_type == source.type,
                    EntityReferenceDB.source_id == source.id,
                    EntityReferenceDB.relationship == "mentions",
                    EntityReferenceDB.deleted_at.is_(None),
                )
            )
            rows = list(existing.scalars().all())
            kept: set[Tuple[str, str]] = set()
            now = _utcnow_naive()
            prune = source.type != "conversation"
            for row in rows:
                key = (row.target_type, row.target_id)
                if key in remaining:
                    kept.add(key)
                elif prune:
                    row.deleted_at = now
                else:
                    kept.add(key)

            created: List[EntityReferenceDB] = []
            for target in wanted:
                key = (target.type, target.id)
                if key in kept:
                    continue
                client_event_id = f"mention:{source.type}:{source.id}:{target.type}:{target.id}"
                prior = await session.execute(
                    select(EntityReferenceDB).where(
                        EntityReferenceDB.user_id == user_id,
                        EntityReferenceDB.client_event_id == client_event_id,
                    )
                )
                row = prior.scalar_one_or_none()
                if row is not None:
                    row.deleted_at = None
                    row.provenance = provenance or "user"
                    row.target_type = target.type
                    row.target_id = target.id
                    created.append(row)
                    continue
                row = EntityReferenceDB(
                    id=str(uuid4()),
                    user_id=user_id,
                    source_type=source.type,
                    source_id=source.id,
                    target_type=target.type,
                    target_id=target.id,
                    relationship="mentions",
                    provenance=provenance or "user",
                    client_event_id=client_event_id,
                )
                session.add(row)
                created.append(row)

            await session.commit()
            for row in created:
                await session.refresh(row)
            live = await session.execute(
                select(EntityReferenceDB).where(
                    EntityReferenceDB.user_id == user_id,
                    EntityReferenceDB.source_type == source.type,
                    EntityReferenceDB.source_id == source.id,
                    EntityReferenceDB.relationship == "mentions",
                    EntityReferenceDB.deleted_at.is_(None),
                )
            )
            return [self._reference_to_schema(row) for row in live.scalars().all()]

    async def list_references(
        self,
        user_id: str,
        *,
        entity_type: str,
        entity_id: str,
        direction: str = "both",
    ) -> List[EntityReferenceRead]:
        async with get_db_session() as session:
            filters = [EntityReferenceDB.user_id == user_id, EntityReferenceDB.deleted_at.is_(None)]
            outgoing = and_(
                EntityReferenceDB.source_type == entity_type,
                EntityReferenceDB.source_id == entity_id,
            )
            incoming = and_(
                EntityReferenceDB.target_type == entity_type,
                EntityReferenceDB.target_id == entity_id,
            )
            if direction == "outgoing":
                filters.append(outgoing)
            elif direction == "incoming":
                filters.append(incoming)
            else:
                filters.append(or_(outgoing, incoming))
            result = await session.execute(
                select(EntityReferenceDB).where(*filters).order_by(desc(EntityReferenceDB.created_at))
            )
            return [self._reference_to_schema(row) for row in result.scalars().all()]

    async def delete_reference(self, user_id: str, reference_id: str) -> bool:
        async with get_db_session() as session:
            result = await session.execute(
                select(EntityReferenceDB).where(
                    EntityReferenceDB.id == reference_id,
                    EntityReferenceDB.user_id == user_id,
                    EntityReferenceDB.deleted_at.is_(None),
                )
            )
            row = result.scalar_one_or_none()
            if row is None:
                return False
            row.deleted_at = _utcnow_naive()
            await session.commit()
            return True

    async def _owned_or_forbidden(self, session, model, entity_id: str, user_id: str) -> Any:
        loaded = await self._load_owned_many(session, model, [entity_id], user_id)
        if entity_id in loaded:
            return loaded[entity_id]
        return None

    async def _load_owned_many(self, session, model, ids: Sequence[str], user_id: str) -> dict[str, Any]:
        unique_ids = list(dict.fromkeys(ids))
        if not unique_ids:
            return {}
        result: dict[str, Any] = {}
        owned = await session.execute(select(model).where(model.id.in_(unique_ids), model.user_id == user_id))
        for row in owned.scalars().all():
            result[row.id] = row
        missing = [entity_id for entity_id in unique_ids if entity_id not in result]
        if missing:
            exists = await session.execute(select(model.id).where(model.id.in_(missing)))
            for entity_id in exists.scalars().all():
                result[entity_id] = FORBIDDEN_ENTITY
        return result

    async def _load_habit_logs_many(self, session, user_id: str, ids: Sequence[str]) -> dict[str, Any]:
        unique_ids = list(dict.fromkeys(ids))
        if not unique_ids:
            return {}
        result: dict[str, Any] = {}
        rows = await session.execute(
            select(HabitLogDB, HabitDB)
            .join(HabitDB, HabitLogDB.habit_id == HabitDB.id)
            .where(HabitLogDB.id.in_(unique_ids), HabitDB.user_id == user_id)
        )
        for row in rows.all():
            result[row[0].id] = row
        missing = [entity_id for entity_id in unique_ids if entity_id not in result]
        if missing:
            exists = await session.execute(select(HabitLogDB.id).where(HabitLogDB.id.in_(missing)))
            for entity_id in exists.scalars().all():
                result[entity_id] = FORBIDDEN_ENTITY
        return result

    async def _load_calendar_occurrences_many(self, session, user_id: str, ids: Sequence[str]) -> dict[str, Any]:
        unique_ids = list(dict.fromkeys(ids))
        if not unique_ids:
            return {}
        rows = await session.execute(
            select(CalendarOccurrenceDB, CalendarEventDB)
            .join(CalendarEventDB, CalendarEventDB.id == CalendarOccurrenceDB.event_id)
            .where(CalendarOccurrenceDB.id.in_(unique_ids), CalendarOccurrenceDB.user_id == user_id)
        )
        return {row[0].id: row for row in rows.all()}

    async def _load_many(self, session, user_id: str, entity_type: str, ids: Sequence[str]) -> dict[Tuple[str, str], Any]:
        loaded: dict[str, Any]
        if entity_type == "habit_log":
            loaded = await self._load_habit_logs_many(session, user_id, ids)
        elif entity_type == "habit":
            loaded = await self._load_owned_many(session, HabitDB, ids, user_id)
        elif entity_type == "task":
            loaded = await self._load_owned_many(session, TaskDB, ids, user_id)
        elif entity_type == "routine":
            loaded = await self._load_owned_many(session, RoutineDB, ids, user_id)
        elif entity_type == "artifact":
            loaded = await self._load_owned_many(session, ArtifactDB, ids, user_id)
        elif entity_type == "conversation":
            loaded = await self._load_owned_many(session, AIConversationDB, ids, user_id)
        elif entity_type == "experiment":
            loaded = await self._load_owned_many(session, ExperimentDB, ids, user_id)
        elif entity_type == "calendar_event":
            loaded = await self._load_owned_many(session, CalendarEventDB, ids, user_id)
        elif entity_type == "calendar_occurrence":
            loaded = await self._load_calendar_occurrences_many(session, user_id, ids)
        else:
            return {}
        return {(entity_type, entity_id): row for entity_id, row in loaded.items()}

    async def _load(self, user_id: str, entity_type: str, entity_id: str) -> Any:
        async with get_db_session() as session:
            loaded = await self._load_many(session, user_id, entity_type, [entity_id])
            return loaded.get((entity_type, entity_id))

    def _to_summary(self, entity_type: str, row: Any) -> EntitySummary:
        if entity_type == "habit":
            return _ok_summary(
                entity_type="habit",
                entity_id=row.id,
                title=row.name,
                subtitle=row.category,
                icon=row.icon,
                updated_at=row.updated_at,
            )
        if entity_type == "habit_log":
            log, habit = row
            title = (log.habit_name or habit.name or "Log").strip()
            return _ok_summary(
                entity_type="habit_log",
                entity_id=log.id,
                title=title,
                subtitle=log.date,
                status=log.status,
                updated_at=log.completed_at or log.date,
            )
        if entity_type == "task":
            return _ok_summary(
                entity_type="task",
                entity_id=row.id,
                title=row.title,
                subtitle=row.category or row.source,
                status=row.status,
                updated_at=row.updated_at,
            )
        if entity_type == "routine":
            return _ok_summary(
                entity_type="routine",
                entity_id=row.id,
                title=row.title,
                subtitle=row.kind,
                status=row.status,
                updated_at=row.updated_at,
            )
        if entity_type == "artifact":
            return _ok_summary(
                entity_type="artifact",
                entity_id=row.id,
                title=row.title,
                subtitle=row.kind,
                status=row.status,
                updated_at=row.updated_at,
            )
        if entity_type == "conversation":
            return _ok_summary(
                entity_type="conversation",
                entity_id=row.id,
                title=row.title or "Conversation",
                subtitle=row.channel,
                status=row.response_mode,
                updated_at=row.updated_at,
            )
        if entity_type == "experiment":
            return _ok_summary(
                entity_type="experiment",
                entity_id=row.id,
                title=row.title,
                subtitle=getattr(row, "hypothesis", None) or getattr(row, "description", None),
                status=row.status,
                updated_at=row.updated_at,
            )
        if entity_type == "calendar_event":
            subtitle = row.start_date or _iso(row.start_at)
            return _ok_summary(
                entity_type="calendar_event",
                entity_id=row.id,
                title=row.title,
                subtitle=subtitle,
                status=row.status,
                updated_at=row.updated_at,
            )
        if entity_type == "calendar_occurrence":
            occurrence, event = row
            subtitle = occurrence.start_date or _iso(occurrence.start_at)
            return _ok_summary(
                entity_type="calendar_occurrence",
                entity_id=occurrence.id,
                title=event.title,
                subtitle=subtitle,
                status=occurrence.status,
                updated_at=occurrence.updated_at,
            )
        return unavailable_summary(EntityRef(type=entity_type, id=getattr(row, "id", "")), "unknown")

    async def _search_type(
        self,
        session,
        user_id: str,
        entity_type: str,
        needle: str,
        limit: int,
    ) -> List[EntitySummary]:
        like = f"%{needle.lower()}%" if needle else None

        if entity_type == "habit":
            query = select(HabitDB).where(HabitDB.user_id == user_id)
            if like:
                query = query.where(HabitDB.name.ilike(like) | HabitDB.category.ilike(like))
            query = query.order_by(desc(HabitDB.updated_at)).limit(limit)
            rows = (await session.execute(query)).scalars().all()
            return [self._to_summary("habit", row) for row in rows]

        if entity_type == "habit_log":
            query = (
                select(HabitLogDB, HabitDB)
                .join(HabitDB, HabitLogDB.habit_id == HabitDB.id)
                .where(HabitDB.user_id == user_id)
            )
            if like:
                query = query.where(
                    HabitLogDB.habit_name.ilike(like)
                    | HabitDB.name.ilike(like)
                    | HabitLogDB.notes.ilike(like)
                    | HabitLogDB.date.ilike(like)
                )
            query = query.order_by(desc(HabitLogDB.date)).limit(limit)
            return [self._to_summary("habit_log", row) for row in (await session.execute(query)).all()]

        if entity_type == "task":
            query = select(TaskDB).where(TaskDB.user_id == user_id)
            if like:
                query = query.where(TaskDB.title.ilike(like) | TaskDB.notes.ilike(like))
            query = query.order_by(desc(TaskDB.updated_at)).limit(limit)
            return [self._to_summary("task", row) for row in (await session.execute(query)).scalars().all()]

        if entity_type == "routine":
            query = select(RoutineDB).where(RoutineDB.user_id == user_id)
            if like:
                query = query.where(RoutineDB.title.ilike(like) | RoutineDB.description.ilike(like))
            query = query.order_by(desc(RoutineDB.updated_at)).limit(limit)
            return [self._to_summary("routine", row) for row in (await session.execute(query)).scalars().all()]

        if entity_type == "artifact":
            query = select(ArtifactDB).where(ArtifactDB.user_id == user_id)
            if like:
                query = query.where(ArtifactDB.title.ilike(like) | ArtifactDB.summary.ilike(like))
            query = query.order_by(desc(ArtifactDB.updated_at)).limit(limit)
            return [self._to_summary("artifact", row) for row in (await session.execute(query)).scalars().all()]

        if entity_type == "conversation":
            query = select(AIConversationDB).where(AIConversationDB.user_id == user_id)
            if like:
                query = query.where(AIConversationDB.title.ilike(like))
            query = query.order_by(desc(AIConversationDB.updated_at)).limit(limit)
            return [self._to_summary("conversation", row) for row in (await session.execute(query)).scalars().all()]

        if entity_type == "experiment":
            query = select(ExperimentDB).where(ExperimentDB.user_id == user_id)
            if like:
                query = query.where(
                    ExperimentDB.title.ilike(like)
                    | ExperimentDB.description.ilike(like)
                    | ExperimentDB.hypothesis.ilike(like)
                )
            query = query.order_by(desc(ExperimentDB.updated_at)).limit(limit)
            return [self._to_summary("experiment", row) for row in (await session.execute(query)).scalars().all()]

        if entity_type == "calendar_event":
            query = select(CalendarEventDB).where(
                CalendarEventDB.user_id == user_id,
                CalendarEventDB.deleted_at.is_(None),
            )
            if like:
                query = query.where(
                    CalendarEventDB.title.ilike(like)
                    | CalendarEventDB.description.ilike(like)
                    | CalendarEventDB.attendees_json.ilike(like)
                )
            query = query.order_by(desc(CalendarEventDB.updated_at)).limit(limit)
            return [self._to_summary("calendar_event", row) for row in (await session.execute(query)).scalars().all()]

        return []

    async def _derived_edges(self, user_id: str, entity_type: str, entity_id: str) -> List[RelatedEntity]:
        edges: List[RelatedEntity] = []
        async with get_db_session() as session:
            if entity_type == "task":
                result = await session.execute(
                    select(TaskDB).where(TaskDB.id == entity_id, TaskDB.user_id == user_id)
                )
                task = result.scalar_one_or_none()
                if task is None:
                    return []
                if task.routine_id:
                    edges.append(RelatedEntity(ref=EntityRef(type="routine", id=task.routine_id), relationship="generated_by", source="fk"))
                if task.linked_habit_id:
                    edges.append(RelatedEntity(ref=EntityRef(type="habit", id=task.linked_habit_id), relationship="linked_habit", source="fk"))
                if task.linked_artifact_id:
                    edges.append(RelatedEntity(ref=EntityRef(type="artifact", id=task.linked_artifact_id), relationship="linked", source="fk"))
                events = await session.execute(
                    select(CalendarEventDB).where(
                        CalendarEventDB.user_id == user_id,
                        CalendarEventDB.task_id == entity_id,
                        CalendarEventDB.deleted_at.is_(None),
                    )
                )
                for event in events.scalars().all():
                    edges.append(RelatedEntity(ref=EntityRef(type="calendar_event", id=event.id), relationship="scheduled_as", source="fk"))
            elif entity_type == "habit_log":
                result = await session.execute(
                    select(HabitLogDB, HabitDB)
                    .join(HabitDB, HabitLogDB.habit_id == HabitDB.id)
                    .where(HabitLogDB.id == entity_id, HabitDB.user_id == user_id)
                )
                row = result.first()
                if row is None:
                    return []
                log, _habit = row
                edges.append(RelatedEntity(ref=EntityRef(type="habit", id=log.habit_id), relationship="belongs_to", source="fk"))
                if log.actor_ref and (log.actor_type in {"assistant", "user"} or (log.actor_ref and len(log.actor_ref) > 8)):
                    edges.append(RelatedEntity(ref=EntityRef(type="conversation", id=log.actor_ref), relationship="source_conversation", source="fk"))
            elif entity_type == "routine":
                result = await session.execute(
                    select(RoutineRunDB)
                    .where(RoutineRunDB.routine_id == entity_id, RoutineRunDB.user_id == user_id)
                    .order_by(desc(RoutineRunDB.scheduled_for))
                    .limit(8)
                )
                for run in result.scalars().all():
                    if run.generated_task_id:
                        edges.append(RelatedEntity(ref=EntityRef(type="task", id=run.generated_task_id), relationship="generated_by", source="fk"))
            elif entity_type == "artifact":
                result = await session.execute(
                    select(ArtifactDB).where(ArtifactDB.id == entity_id, ArtifactDB.user_id == user_id)
                )
                artifact = result.scalar_one_or_none()
                if artifact is None:
                    return []
                if artifact.conversation_id:
                    edges.append(RelatedEntity(ref=EntityRef(type="conversation", id=artifact.conversation_id), relationship="source_conversation", source="fk"))
                if artifact.source_type == "conversation" and artifact.source_id:
                    edges.append(RelatedEntity(ref=EntityRef(type="conversation", id=artifact.source_id), relationship="source_conversation", source="fk"))
                links = await session.execute(
                    select(ArtifactLinkDB).where(
                        ArtifactLinkDB.artifact_id == entity_id,
                        ArtifactLinkDB.user_id == user_id,
                        ArtifactLinkDB.target_type == "conversation",
                    )
                )
                for link in links.scalars().all():
                    edges.append(RelatedEntity(ref=EntityRef(type="conversation", id=link.target_id), relationship=link.relationship or "linked", source="artifact_link"))
            elif entity_type == "conversation":
                result = await session.execute(
                    select(ArtifactDB)
                    .where(ArtifactDB.user_id == user_id, ArtifactDB.conversation_id == entity_id)
                    .order_by(desc(ArtifactDB.updated_at))
                    .limit(3)
                )
                for artifact in result.scalars().all():
                    edges.append(RelatedEntity(ref=EntityRef(type="artifact", id=artifact.id), relationship="source_conversation", source="fk"))
            elif entity_type == "calendar_event":
                result = await session.execute(
                    select(CalendarEventDB).where(
                        CalendarEventDB.id == entity_id,
                        CalendarEventDB.user_id == user_id,
                        CalendarEventDB.deleted_at.is_(None),
                    )
                )
                event = result.scalar_one_or_none()
                if event is None:
                    return []
                if event.task_id:
                    edges.append(RelatedEntity(ref=EntityRef(type="task", id=event.task_id), relationship="scheduled_as", source="fk"))
                if event.routine_run_id:
                    run = await session.get(RoutineRunDB, event.routine_run_id)
                    if run and run.user_id == user_id:
                        edges.append(RelatedEntity(ref=EntityRef(type="routine", id=run.routine_id), relationship="generated_by", source="fk"))
            elif entity_type == "calendar_occurrence":
                occurrence = await session.get(CalendarOccurrenceDB, entity_id)
                if occurrence and occurrence.user_id == user_id:
                    edges.append(RelatedEntity(ref=EntityRef(type="calendar_event", id=occurrence.event_id), relationship="occurrence_of", source="fk"))
            elif entity_type == "experiment":
                result = await session.execute(
                    select(ExperimentDB).where(ExperimentDB.id == entity_id, ExperimentDB.user_id == user_id)
                )
                if result.scalar_one_or_none() is None:
                    return []
            elif entity_type == "day":
                if not is_day_id(entity_id):
                    return []
                logs = await session.execute(
                    select(HabitLogDB, HabitDB)
                    .join(HabitDB, HabitLogDB.habit_id == HabitDB.id)
                    .where(HabitDB.user_id == user_id, HabitLogDB.date == entity_id)
                    .order_by(desc(HabitLogDB.date))
                    .limit(12)
                )
                for log, _habit in logs.all():
                    edges.append(
                        RelatedEntity(
                            ref=EntityRef(type="habit_log", id=log.id),
                            relationship="logged_on",
                            source="fk",
                        )
                    )
                start_at = datetime.fromisoformat(entity_id)
                end_at = start_at + timedelta(days=1)
                events = await session.execute(
                    select(CalendarEventDB).where(
                        CalendarEventDB.user_id == user_id,
                        CalendarEventDB.deleted_at.is_(None),
                        or_(
                            CalendarEventDB.start_date == entity_id,
                            and_(CalendarEventDB.start_at >= start_at, CalendarEventDB.start_at < end_at),
                        ),
                    )
                    .limit(12)
                )
                for event in events.scalars().all():
                    edges.append(
                        RelatedEntity(
                            ref=EntityRef(type="calendar_event", id=event.id),
                            relationship="scheduled_on",
                            source="fk",
                        )
                    )
                experiments = await session.execute(
                    select(ExperimentDB)
                    .where(
                        ExperimentDB.user_id == user_id,
                        ExperimentDB.period_start.is_not(None),
                        ExperimentDB.period_end.is_not(None),
                        ExperimentDB.period_start <= entity_id,
                        ExperimentDB.period_end >= entity_id,
                    )
                    .limit(8)
                )
                for experiment in experiments.scalars().all():
                    edges.append(
                        RelatedEntity(
                            ref=EntityRef(type="experiment", id=experiment.id),
                            relationship="covers",
                            source="fk",
                        )
                    )
            elif entity_type == "time_window":
                if not is_time_window_id(entity_id):
                    return []
                start, end = entity_id.split("/", 1)
                logs = await session.execute(
                    select(HabitLogDB, HabitDB)
                    .join(HabitDB, HabitLogDB.habit_id == HabitDB.id)
                    .where(
                        HabitDB.user_id == user_id,
                        HabitLogDB.date >= start,
                        HabitLogDB.date <= end,
                    )
                    .order_by(desc(HabitLogDB.date))
                    .limit(12)
                )
                for log, _habit in logs.all():
                    edges.append(
                        RelatedEntity(
                            ref=EntityRef(type="habit_log", id=log.id),
                            relationship="logged_on",
                            source="fk",
                        )
                    )
                start_at = datetime.fromisoformat(start)
                end_at = datetime.fromisoformat(end) + timedelta(days=1)
                events = await session.execute(
                    select(CalendarEventDB)
                    .where(
                        CalendarEventDB.user_id == user_id,
                        CalendarEventDB.deleted_at.is_(None),
                        or_(
                            and_(CalendarEventDB.start_date >= start, CalendarEventDB.start_date <= end),
                            and_(CalendarEventDB.start_at >= start_at, CalendarEventDB.start_at < end_at),
                        ),
                    )
                    .order_by(CalendarEventDB.start_at, CalendarEventDB.start_date)
                    .limit(12)
                )
                for event in events.scalars().all():
                    edges.append(
                        RelatedEntity(
                            ref=EntityRef(type="calendar_event", id=event.id),
                            relationship="scheduled_on",
                            source="fk",
                        )
                    )
        return edges

    async def _authored_edges(self, user_id: str, entity_type: str, entity_id: str) -> List[RelatedEntity]:
        refs = await self.list_references(user_id, entity_type=entity_type, entity_id=entity_id, direction="both")
        edges: List[RelatedEntity] = []
        for item in refs:
            if item.source.type == entity_type and item.source.id == entity_id:
                edges.append(RelatedEntity(ref=item.target, relationship=item.relationship, source="authored"))
            else:
                edges.append(RelatedEntity(ref=item.source, relationship=item.relationship, source="authored"))
        return edges

    def _reference_to_schema(self, row: EntityReferenceDB) -> EntityReferenceRead:
        return EntityReferenceRead(
            id=row.id,
            source=EntityRef(type=row.source_type, id=row.source_id),
            target=EntityRef(type=row.target_type, id=row.target_id),
            relationship=row.relationship,
            provenance=row.provenance,
            anchor_json=row.anchor_json,
            client_event_id=row.client_event_id,
            created_at=_iso(row.created_at),
        )


entity_service = EntityService()
