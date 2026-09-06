"""
Artifact storage, serialization, revisioning, and report/workflow bridging.
"""

from __future__ import annotations

import base64
import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from uuid import uuid4

from sqlalchemy import and_, desc, func, or_, select

from database.connection import get_db_session
from database.models import (
    ArtifactDB,
    ArtifactLinkDB,
    ArtifactRevisionDB,
    ReportRunDB,
    ReportScheduleDB,
)
from schemas.artifacts import (
    ArtifactCreate,
    ArtifactDetailRead,
    ArtifactLinkCreate,
    ArtifactLinkListResponse,
    ArtifactLinkRead,
    ArtifactListItem,
    ArtifactListResponse,
    ArtifactPeriod,
    ArtifactRevisionCreate,
    ArtifactRevisionListResponse,
    ArtifactRevisionRead,
    ArtifactSource,
    ArtifactUpdate,
)
from schemas.reports import HabitReportPreview

logger = logging.getLogger(__name__)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class ArtifactVersionConflictError(ValueError):
    pass


class ArtifactService:
    def _parse_json(self, raw: Optional[str], fallback: Any) -> Any:
        if not raw:
            return fallback
        try:
            return json.loads(raw)
        except Exception:
            return fallback

    def _encode_cursor(self, created_at: Optional[datetime], artifact_id: str) -> Optional[str]:
        if not created_at:
            return None
        payload = json.dumps({"created_at": created_at.isoformat(), "id": artifact_id})
        return base64.urlsafe_b64encode(payload.encode("utf-8")).decode("ascii")

    def _decode_cursor(self, cursor: Optional[str]) -> Optional[Tuple[datetime, str]]:
        if not cursor:
            return None
        try:
            raw = base64.urlsafe_b64decode(cursor.encode("ascii")).decode("utf-8")
            payload = json.loads(raw)
            return datetime.fromisoformat(str(payload["created_at"])), str(payload["id"])
        except Exception:
            return None

    def _preview_from_json(self, raw: Optional[str]) -> Optional[HabitReportPreview]:
        data = self._parse_json(raw, None)
        if not data:
            return None
        try:
            return HabitReportPreview.model_validate(data)
        except Exception:
            return None

    def _artifact_body_from_preview(self, preview: HabitReportPreview) -> Dict[str, Any]:
        metric_items = [
            {
                "label": item.label,
                "value": item.value,
                "unit": item.unit or "",
                "note": item.note,
            }
            for item in preview.metrics
        ]
        return {
            "schemaVersion": 1,
            "blocks": [
                {
                    "type": "hero",
                    "title": preview.title,
                    "periodLabel": preview.period_label,
                    "intro": preview.intro_line,
                },
                {"type": "summary", "text": preview.summary},
                {"type": "metric_list", "items": metric_items},
                {"type": "bullet_list", "title": "Highlights", "items": list(preview.highlights)},
            ],
        }

    def _revision_to_schema(self, revision: ArtifactRevisionDB) -> ArtifactRevisionRead:
        return ArtifactRevisionRead(
            id=revision.id,
            artifact_id=revision.artifact_id,
            version=int(revision.version or 1),
            editor_type=revision.editor_type,  # type: ignore[arg-type]
            summary=revision.summary,
            change_note=revision.change_note,
            created_at=revision.created_at,
        )

    def _link_to_schema(self, link: ArtifactLinkDB) -> ArtifactLinkRead:
        return ArtifactLinkRead(
            id=link.id,
            artifact_id=link.artifact_id,
            target_type=link.target_type,  # type: ignore[arg-type]
            target_id=link.target_id,
            relationship=link.relationship,
            metadata=self._parse_json(link.metadata_json, {}),
            created_at=link.created_at,
        )

    def _artifact_to_list_item(self, artifact: ArtifactDB) -> ArtifactListItem:
        return ArtifactListItem(
            id=artifact.id,
            kind=artifact.kind,  # type: ignore[arg-type]
            title=artifact.title,
            slug=artifact.slug,
            status=artifact.status,  # type: ignore[arg-type]
            summary=artifact.summary,
            preview_text=artifact.preview_text,
            folder_key=artifact.folder_key,
            is_pinned=bool(artifact.is_pinned),
            period=ArtifactPeriod(
                start=artifact.period_start,
                end=artifact.period_end,
                timezone=artifact.timezone or "America/New_York",
            ),
            source=ArtifactSource(
                type=artifact.source_type,  # type: ignore[arg-type]
                id=artifact.source_id,
            ),
            conversation_id=artifact.conversation_id,
            created_at=artifact.created_at,
            published_at=artifact.published_at,
        )

    def _derive_preview_text(self, body: Dict[str, Any], summary: Optional[str]) -> Optional[str]:
        if summary:
            return summary[:240]
        blocks = body.get("blocks") if isinstance(body, dict) else None
        if not isinstance(blocks, list):
            return None
        for block in blocks:
            if isinstance(block, dict):
                text = block.get("text") or block.get("intro")
                if isinstance(text, str) and text.strip():
                    return text.strip()[:240]
        return None

    async def _latest_revision(self, session, artifact_id: str) -> Optional[ArtifactRevisionDB]:
        result = await session.execute(
            select(ArtifactRevisionDB)
            .where(ArtifactRevisionDB.artifact_id == artifact_id)
            .order_by(desc(ArtifactRevisionDB.version), desc(ArtifactRevisionDB.created_at))
            .limit(1)
        )
        return result.scalars().first()

    async def _latest_version(self, session, artifact_id: str) -> int:
        latest = await self._latest_revision(session, artifact_id)
        return int(latest.version or 0) if latest else 0

    async def _index_artifact(self, artifact: ArtifactDB) -> None:
        del artifact
        return None

    async def list_artifacts(
        self,
        user_id: str,
        *,
        kind: Optional[str] = None,
        status: Optional[str] = None,
        limit: int = 20,
        cursor: Optional[str] = None,
        linked_to: Optional[str] = None,
    ) -> ArtifactListResponse:
        limit = max(1, min(int(limit or 20), 100))
        cursor_data = self._decode_cursor(cursor)

        async with get_db_session() as session:
            filters = [ArtifactDB.user_id == user_id]
            if kind:
                filters.append(ArtifactDB.kind == kind)
            if status:
                filters.append(ArtifactDB.status == status)
            if linked_to:
                filters.append(
                    ArtifactDB.id.in_(
                        select(ArtifactLinkDB.artifact_id).where(
                            ArtifactLinkDB.user_id == user_id,
                            ArtifactLinkDB.target_id == linked_to,
                        )
                    )
                )
            if cursor_data:
                created_at, artifact_id = cursor_data
                filters.append(
                    or_(
                        ArtifactDB.created_at < created_at,
                        and_(ArtifactDB.created_at == created_at, ArtifactDB.id < artifact_id),
                    )
                )

            result = await session.execute(
                select(ArtifactDB)
                .where(*filters)
                .order_by(desc(ArtifactDB.is_pinned), desc(ArtifactDB.created_at), desc(ArtifactDB.id))
                .limit(limit + 1)
            )
            rows = list(result.scalars().all())
            next_cursor = None
            if len(rows) > limit:
                tail = rows.pop()
                next_cursor = self._encode_cursor(tail.created_at, tail.id)
            return ArtifactListResponse(
                items=[self._artifact_to_list_item(item) for item in rows],
                next_cursor=next_cursor,
            )

    async def get_artifact(self, user_id: str, artifact_id: str) -> Optional[ArtifactDetailRead]:
        async with get_db_session() as session:
            artifact = await session.get(ArtifactDB, artifact_id)
            if not artifact or artifact.user_id != user_id:
                return None

            revision_count_result = await session.execute(
                select(func.count(ArtifactRevisionDB.id)).where(ArtifactRevisionDB.artifact_id == artifact_id)
            )
            revision_count = int(revision_count_result.scalar() or 0)
            latest_revision = await self._latest_revision(session, artifact_id)
            links_result = await session.execute(
                select(ArtifactLinkDB).where(ArtifactLinkDB.artifact_id == artifact_id).order_by(desc(ArtifactLinkDB.created_at))
            )
            item = self._artifact_to_list_item(artifact)
            return ArtifactDetailRead(
                **item.model_dump(),
                body=self._parse_json(artifact.body_json, {"schemaVersion": 1, "blocks": []}),
                metadata=self._parse_json(artifact.metadata_json, {}),
                revision_count=revision_count,
                latest_revision=self._revision_to_schema(latest_revision) if latest_revision else None,
                links=[self._link_to_schema(link) for link in links_result.scalars().all()],
            )

    async def list_revisions(self, user_id: str, artifact_id: str) -> ArtifactRevisionListResponse:
        async with get_db_session() as session:
            artifact = await session.get(ArtifactDB, artifact_id)
            if not artifact or artifact.user_id != user_id:
                return ArtifactRevisionListResponse(items=[])
            result = await session.execute(
                select(ArtifactRevisionDB)
                .where(ArtifactRevisionDB.artifact_id == artifact_id)
                .order_by(desc(ArtifactRevisionDB.version), desc(ArtifactRevisionDB.created_at))
            )
            return ArtifactRevisionListResponse(
                items=[self._revision_to_schema(item) for item in result.scalars().all()]
            )

    async def list_links(self, user_id: str, artifact_id: str) -> ArtifactLinkListResponse:
        async with get_db_session() as session:
            artifact = await session.get(ArtifactDB, artifact_id)
            if not artifact or artifact.user_id != user_id:
                return ArtifactLinkListResponse(items=[])
            result = await session.execute(
                select(ArtifactLinkDB)
                .where(ArtifactLinkDB.artifact_id == artifact_id)
                .order_by(desc(ArtifactLinkDB.created_at))
            )
            return ArtifactLinkListResponse(items=[self._link_to_schema(item) for item in result.scalars().all()])

    async def create_artifact(self, user_id: str, payload: ArtifactCreate) -> ArtifactDetailRead:
        async with get_db_session() as session:
            body = payload.body or {"schemaVersion": 1, "blocks": []}
            artifact = ArtifactDB(
                id=str(uuid4()),
                user_id=user_id,
                kind=payload.kind,
                source_type=payload.source.type,
                source_id=payload.source.id,
                title=payload.title,
                slug=payload.slug,
                status=payload.status,
                summary=payload.summary,
                preview_text=payload.preview_text or self._derive_preview_text(body, payload.summary),
                folder_key=payload.folder_key,
                is_pinned=payload.is_pinned,
                body_json=json.dumps(body),
                metadata_json=json.dumps(payload.metadata),
                period_start=payload.period.start,
                period_end=payload.period.end,
                timezone=payload.period.timezone,
                conversation_id=payload.conversation_id,
                published_at=_utc_now() if payload.status == "published" else None,
                created_at=_utc_now(),
                updated_at=_utc_now(),
            )
            session.add(artifact)
            await session.flush()
            session.add(
                ArtifactRevisionDB(
                    id=str(uuid4()),
                    artifact_id=artifact.id,
                    version=1,
                    editor_type="user",
                    body_json=json.dumps(body),
                    summary=payload.summary,
                    change_note="Initial artifact creation",
                    created_at=_utc_now(),
                )
            )
            await session.commit()
            await self._index_artifact(artifact)
            detail = await self.get_artifact(user_id, artifact.id)
            if detail is None:
                raise RuntimeError("Artifact creation failed")
            return detail

    async def update_artifact(self, user_id: str, artifact_id: str, payload: ArtifactUpdate) -> Optional[ArtifactDetailRead]:
        async with get_db_session() as session:
            artifact = await session.get(ArtifactDB, artifact_id)
            if artifact is None or artifact.user_id != user_id:
                return None

            latest_version = await self._latest_version(session, artifact_id)
            if payload.base_version is not None and payload.base_version != latest_version:
                raise ArtifactVersionConflictError("Artifact revision is out of date.")

            if payload.title is not None:
                artifact.title = payload.title
            if payload.slug is not None:
                artifact.slug = payload.slug
            if payload.status is not None:
                artifact.status = payload.status
                if payload.status == "published" and artifact.published_at is None:
                    artifact.published_at = _utc_now()
            if payload.summary is not None:
                artifact.summary = payload.summary
            if payload.preview_text is not None:
                artifact.preview_text = payload.preview_text
            if payload.folder_key is not None:
                artifact.folder_key = payload.folder_key
            if payload.is_pinned is not None:
                artifact.is_pinned = payload.is_pinned
            if payload.body is not None:
                artifact.body_json = json.dumps(payload.body)
                if payload.preview_text is None:
                    artifact.preview_text = self._derive_preview_text(payload.body, artifact.summary)
            if payload.metadata is not None:
                artifact.metadata_json = json.dumps(payload.metadata)
            if payload.period is not None:
                artifact.period_start = payload.period.start
                artifact.period_end = payload.period.end
                artifact.timezone = payload.period.timezone
            artifact.updated_at = _utc_now()
            await session.commit()
            await self._index_artifact(artifact)
        return await self.get_artifact(user_id, artifact_id)

    async def create_revision(self, user_id: str, artifact_id: str, payload: ArtifactRevisionCreate) -> Optional[ArtifactDetailRead]:
        async with get_db_session() as session:
            artifact = await session.get(ArtifactDB, artifact_id)
            if artifact is None or artifact.user_id != user_id:
                return None
            latest_version = await self._latest_version(session, artifact_id)
            if payload.base_version is not None and payload.base_version != latest_version:
                raise ArtifactVersionConflictError("Artifact revision is out of date.")

            body = payload.body or self._parse_json(artifact.body_json, {"schemaVersion": 1, "blocks": []})
            next_version = latest_version + 1
            session.add(
                ArtifactRevisionDB(
                    id=str(uuid4()),
                    artifact_id=artifact.id,
                    version=next_version,
                    editor_type=payload.editor_type,
                    body_json=json.dumps(body),
                    summary=payload.summary,
                    change_note=payload.change_note,
                    created_at=_utc_now(),
                )
            )
            artifact.body_json = json.dumps(body)
            if payload.summary is not None:
                artifact.summary = payload.summary
            artifact.preview_text = self._derive_preview_text(body, artifact.summary)
            artifact.updated_at = _utc_now()
            await session.commit()
            await self._index_artifact(artifact)
        return await self.get_artifact(user_id, artifact_id)

    async def add_link(self, user_id: str, artifact_id: str, payload: ArtifactLinkCreate) -> Optional[ArtifactLinkRead]:
        async with get_db_session() as session:
            artifact = await session.get(ArtifactDB, artifact_id)
            if artifact is None or artifact.user_id != user_id:
                return None
            result = await session.execute(
                select(ArtifactLinkDB).where(
                    ArtifactLinkDB.artifact_id == artifact_id,
                    ArtifactLinkDB.target_type == payload.target_type,
                    ArtifactLinkDB.target_id == payload.target_id,
                )
            )
            existing = result.scalars().first()
            if existing is not None:
                return self._link_to_schema(existing)
            link = ArtifactLinkDB(
                id=str(uuid4()),
                artifact_id=artifact_id,
                user_id=user_id,
                target_type=payload.target_type,
                target_id=payload.target_id,
                relationship=payload.relationship,
                metadata_json=json.dumps(payload.metadata),
                created_at=_utc_now(),
            )
            session.add(link)
            await session.commit()
            return self._link_to_schema(link)

    async def create_conversation_artifact(
        self,
        *,
        user_id: str,
        conversation_id: str,
        title: str,
        summary: Optional[str],
        body: Dict[str, Any],
        kind: str = "conversation_brief",
    ) -> ArtifactDetailRead:
        artifact = await self.create_artifact(
            user_id,
            ArtifactCreate(
                kind=kind,  # type: ignore[arg-type]
                title=title,
                status="draft",
                summary=summary,
                preview_text=self._derive_preview_text(body, summary),
                body=body,
                metadata={"created_from": "conversation"},
                period=ArtifactPeriod(),
                source=ArtifactSource(type="conversation", id=conversation_id),
                conversation_id=conversation_id,
            ),
        )
        await self.add_link(
            user_id,
            artifact.id,
            ArtifactLinkCreate(target_type="conversation", target_id=conversation_id, relationship="source"),
        )
        refreshed = await self.get_artifact(user_id, artifact.id)
        if refreshed is None:
            raise RuntimeError("Conversation artifact link failed")
        return refreshed

    async def ensure_report_run_artifact(
        self,
        session,
        *,
        run: ReportRunDB,
        schedule: Optional[ReportScheduleDB] = None,
    ) -> Optional[ArtifactDB]:
        preview = self._preview_from_json(run.summary_json)
        if not preview:
            return None

        artifact = None
        if getattr(run, "artifact_id", None):
            artifact = await session.get(ArtifactDB, run.artifact_id)
        if artifact is None:
            result = await session.execute(
                select(ArtifactDB).where(
                    ArtifactDB.source_type == "report_run",
                    ArtifactDB.source_id == run.id,
                )
            )
            artifact = result.scalars().first()

        body = self._artifact_body_from_preview(preview)
        metadata = {
            "template_version": 1,
            "source_type": "report_run",
            "source_id": run.id,
            "schedule_id": run.schedule_id,
            "cadence": run.cadence,
            "preview": preview.model_dump(mode="json"),
        }
        timezone_name = (schedule.timezone if schedule else None) or "America/New_York"
        published_at = run.generated_at or run.sent_at or _utc_now()

        created = False
        if artifact is None:
            artifact = ArtifactDB(
                id=str(uuid4()),
                user_id=run.user_id,
                kind="report",
                source_type="report_run",
                source_id=run.id,
                title=preview.title,
                slug=None,
                status="published",
                summary=preview.summary,
                preview_text=self._derive_preview_text(body, preview.summary),
                folder_key="reports",
                is_pinned=False,
                body_json=json.dumps(body),
                metadata_json=json.dumps(metadata),
                period_start=run.period_start,
                period_end=run.period_end,
                timezone=timezone_name,
                conversation_id=None,
                published_at=published_at,
                created_at=_utc_now(),
                updated_at=_utc_now(),
            )
            session.add(artifact)
            created = True
        else:
            artifact.title = preview.title
            artifact.status = "published"
            artifact.summary = preview.summary
            artifact.preview_text = self._derive_preview_text(body, preview.summary)
            artifact.body_json = json.dumps(body)
            artifact.metadata_json = json.dumps(metadata)
            artifact.period_start = run.period_start
            artifact.period_end = run.period_end
            artifact.timezone = timezone_name
            artifact.published_at = published_at
            artifact.updated_at = _utc_now()

        await session.flush()
        run.artifact_id = artifact.id

        if created:
            revision = ArtifactRevisionDB(
                id=str(uuid4()),
                artifact_id=artifact.id,
                version=1,
                editor_type="system",
                body_json=json.dumps(body),
                summary=preview.summary,
                change_note=f"Created from report_run {run.id}",
                created_at=_utc_now(),
            )
            session.add(revision)
            await session.flush()

        return artifact

    async def create_workflow_artifact(
        self,
        session,
        *,
        user_id: str,
        kind: str,
        source_id: str,
        title: str,
        summary: str,
        body: Dict[str, Any],
        metadata: Dict[str, Any],
        period_start: Optional[str],
        period_end: Optional[str],
        timezone: str,
        conversation_id: Optional[str] = None,
        source_type: str = "workflow_run",
        folder_key: Optional[str] = "routines",
    ) -> ArtifactDB:
        artifact = ArtifactDB(
            id=str(uuid4()),
            user_id=user_id,
            kind=kind,
            source_type=source_type,
            source_id=source_id,
            title=title,
            slug=None,
            status="published",
            summary=summary,
            preview_text=self._derive_preview_text(body, summary),
            folder_key=folder_key,
            is_pinned=False,
            body_json=json.dumps(body),
            metadata_json=json.dumps(metadata),
            period_start=period_start,
            period_end=period_end,
            timezone=timezone,
            conversation_id=conversation_id,
            published_at=_utc_now(),
            created_at=_utc_now(),
            updated_at=_utc_now(),
        )
        session.add(artifact)
        await session.flush()

        revision = ArtifactRevisionDB(
            id=str(uuid4()),
            artifact_id=artifact.id,
            version=1,
            editor_type="assistant",
            body_json=json.dumps(body),
            summary=summary,
            change_note=f"Created from {source_type} {source_id}",
            created_at=_utc_now(),
        )
        session.add(revision)
        await session.flush()
        return artifact

    async def backfill_report_run_artifacts(self, *, limit: int = 500) -> int:
        written = 0
        async with get_db_session() as session:
            result = await session.execute(
                select(ReportRunDB, ReportScheduleDB)
                .join(ReportScheduleDB, ReportScheduleDB.id == ReportRunDB.schedule_id)
                .where(ReportRunDB.summary_json.is_not(None), ReportRunDB.artifact_id.is_(None))
                .order_by(ReportRunDB.created_at.asc())
                .limit(limit)
            )
            rows = result.all()
            for run, schedule in rows:
                artifact = await self.ensure_report_run_artifact(session, run=run, schedule=schedule)
                if artifact is not None:
                    written += 1
            if rows:
                await session.commit()
                for run, _schedule in rows:
                    if run.artifact_id:
                        artifact = await session.get(ArtifactDB, run.artifact_id)
                        if artifact is not None:
                            await self._index_artifact(artifact)
        if written:
            logger.info("📦 Backfilled %d report artifacts", written)
        return written


artifact_service = ArtifactService()
