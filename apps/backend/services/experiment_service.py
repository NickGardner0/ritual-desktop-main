"""Persistence and retrieval for durable experiment workspaces."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import and_, desc, func, select

from database.connection import get_db_session
from database.models import AIConversationDB, AIMessageDB, ExperimentDB, ExperimentEntryDB
from schemas.experiments import (
    ExperimentCreate,
    ExperimentDetailRead,
    ExperimentEntryCreate,
    ExperimentEntryRead,
    ExperimentRead,
    ExperimentThreadCreate,
    ExperimentThreadRead,
    ExperimentUpdate,
)


class ExperimentNotFoundError(ValueError):
    pass


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _clean_required(value: str, field: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise ValueError(f"{field} is required")
    return cleaned


class ExperimentService:
    async def list_experiments(self, user_id: str, *, limit: int = 20) -> list[ExperimentRead]:
        async with get_db_session() as session:
            result = await session.execute(
                select(ExperimentDB)
                .where(ExperimentDB.user_id == user_id)
                .order_by(desc(ExperimentDB.updated_at), desc(ExperimentDB.created_at))
                .limit(limit)
            )
            experiments = result.scalars().all()
            items: list[ExperimentRead] = []
            for experiment in experiments:
                thread_count = await session.scalar(
                    select(func.count(AIConversationDB.id)).where(AIConversationDB.experiment_id == experiment.id)
                )
                entry_count = await session.scalar(
                    select(func.count(ExperimentEntryDB.id)).where(ExperimentEntryDB.experiment_id == experiment.id)
                )
                items.append(self._serialize_experiment(experiment, int(thread_count or 0), int(entry_count or 0)))
            return items

    async def create_experiment(self, user_id: str, payload: ExperimentCreate) -> ExperimentRead:
        now = _utc_now()
        async with get_db_session() as session:
            experiment = ExperimentDB(
                id=str(uuid.uuid4()),
                user_id=user_id,
                title=_clean_required(payload.title, "title"),
                description=payload.description.strip() if payload.description else None,
                status="active",
                created_at=now,
                updated_at=now,
            )
            session.add(experiment)
            await session.commit()
            return self._serialize_experiment(experiment, 0, 0)

    async def get_experiment(self, user_id: str, experiment_id: str) -> ExperimentDetailRead:
        async with get_db_session() as session:
            experiment = await self._get_owned(session, user_id, experiment_id)
            if experiment is None:
                raise ExperimentNotFoundError("Experiment not found")

            threads_result = await session.execute(
                select(AIConversationDB)
                .where(AIConversationDB.experiment_id == experiment_id)
                .order_by(desc(AIConversationDB.updated_at), desc(AIConversationDB.created_at))
            )
            threads = threads_result.scalars().all()
            thread_reads: list[ExperimentThreadRead] = []
            for thread in threads:
                first_message = await session.scalar(
                    select(AIMessageDB.content)
                    .where(and_(AIMessageDB.conversation_id == thread.id, AIMessageDB.role == "user"))
                    .order_by(AIMessageDB.created_at)
                    .limit(1)
                )
                thread_reads.append(
                    ExperimentThreadRead(
                        id=thread.id,
                        title=thread.title,
                        first_message=first_message,
                        created_at=thread.created_at,
                        updated_at=thread.updated_at,
                    )
                )

            entries_result = await session.execute(
                select(ExperimentEntryDB)
                .where(ExperimentEntryDB.experiment_id == experiment_id)
                .order_by(desc(ExperimentEntryDB.updated_at), desc(ExperimentEntryDB.created_at))
            )
            entries = [self._serialize_entry(entry) for entry in entries_result.scalars().all()]
            base = self._serialize_experiment(experiment, len(thread_reads), len(entries))
            return ExperimentDetailRead(**base.model_dump(), threads=thread_reads, entries=entries)

    async def update_experiment(
        self,
        user_id: str,
        experiment_id: str,
        payload: ExperimentUpdate,
    ) -> ExperimentDetailRead:
        async with get_db_session() as session:
            experiment = await self._get_owned(session, user_id, experiment_id)
            if experiment is None:
                raise ExperimentNotFoundError("Experiment not found")
            if payload.title is not None:
                experiment.title = _clean_required(payload.title, "title")
            if payload.description is not None:
                experiment.description = payload.description.strip() or None
            if payload.status is not None:
                experiment.status = payload.status
            experiment.updated_at = _utc_now()
            await session.commit()
        return await self.get_experiment(user_id, experiment_id)

    async def delete_experiment(self, user_id: str, experiment_id: str) -> None:
        async with get_db_session() as session:
            experiment = await self._get_owned(session, user_id, experiment_id)
            if experiment is None:
                raise ExperimentNotFoundError("Experiment not found")
            await session.delete(experiment)
            await session.commit()

    async def create_thread(
        self,
        user_id: str,
        experiment_id: str,
        payload: ExperimentThreadCreate,
    ) -> ExperimentThreadRead:
        now = _utc_now()
        async with get_db_session() as session:
            experiment = await self._get_owned(session, user_id, experiment_id)
            if experiment is None:
                raise ExperimentNotFoundError("Experiment not found")
            thread = AIConversationDB(
                id=str(uuid.uuid4()),
                user_id=user_id,
                experiment_id=experiment_id,
                title=payload.title.strip() if payload.title else None,
                response_mode="text",
                channel="app",
                created_at=now,
                updated_at=now,
            )
            experiment.updated_at = now
            session.add(thread)
            await session.commit()
            return ExperimentThreadRead(
                id=thread.id,
                title=thread.title,
                first_message=None,
                created_at=thread.created_at,
                updated_at=thread.updated_at,
            )

    async def create_entry(
        self,
        user_id: str,
        experiment_id: str,
        payload: ExperimentEntryCreate,
    ) -> ExperimentEntryRead:
        now = _utc_now()
        async with get_db_session() as session:
            experiment = await self._get_owned(session, user_id, experiment_id)
            if experiment is None:
                raise ExperimentNotFoundError("Experiment not found")
            entry = ExperimentEntryDB(
                id=str(uuid.uuid4()),
                experiment_id=experiment_id,
                user_id=user_id,
                kind=payload.kind,
                title=_clean_required(payload.title, "title"),
                content=payload.content.strip() if payload.content else None,
                metadata_json=json.dumps(payload.metadata),
                created_at=now,
                updated_at=now,
            )
            experiment.updated_at = now
            session.add(entry)
            await session.commit()
            return self._serialize_entry(entry)

    async def delete_entry(self, user_id: str, experiment_id: str, entry_id: str) -> None:
        async with get_db_session() as session:
            experiment = await self._get_owned(session, user_id, experiment_id)
            if experiment is None:
                raise ExperimentNotFoundError("Experiment not found")
            entry = await session.scalar(
                select(ExperimentEntryDB).where(
                    and_(
                        ExperimentEntryDB.id == entry_id,
                        ExperimentEntryDB.experiment_id == experiment_id,
                        ExperimentEntryDB.user_id == user_id,
                    )
                )
            )
            if entry is None:
                raise ExperimentNotFoundError("Experiment entry not found")
            await session.delete(entry)
            experiment.updated_at = _utc_now()
            await session.commit()

    async def _get_owned(self, session, user_id: str, experiment_id: str) -> Optional[ExperimentDB]:
        return await session.scalar(
            select(ExperimentDB).where(
                and_(ExperimentDB.id == experiment_id, ExperimentDB.user_id == user_id)
            )
        )

    @staticmethod
    def _serialize_experiment(experiment: ExperimentDB, thread_count: int, entry_count: int) -> ExperimentRead:
        return ExperimentRead(
            id=experiment.id,
            title=experiment.title,
            description=experiment.description,
            status=experiment.status,
            thread_count=thread_count,
            entry_count=entry_count,
            created_at=experiment.created_at,
            updated_at=experiment.updated_at,
        )

    @staticmethod
    def _serialize_entry(entry: ExperimentEntryDB) -> ExperimentEntryRead:
        try:
            metadata = json.loads(entry.metadata_json or "{}")
        except json.JSONDecodeError:
            metadata = {}
        return ExperimentEntryRead(
            id=entry.id,
            experiment_id=entry.experiment_id,
            kind=entry.kind,
            title=entry.title,
            content=entry.content,
            metadata=metadata,
            created_at=entry.created_at,
            updated_at=entry.updated_at,
        )


experiment_service = ExperimentService()
