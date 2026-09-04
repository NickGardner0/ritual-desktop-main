from __future__ import annotations

import tempfile
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import unittest
from unittest.mock import AsyncMock, patch

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from database.models import (  # noqa: E402
    ApprovalRequestDB,
    Base,
    CalendarEventDB,
    CalendarOccurrenceDB,
    TaskDB,
    UserDB,
)
from schemas.calendar import (  # noqa: E402
    CalendarEventCreate,
    CalendarEventUpdate,
    CalendarMutationDraft,
    CalendarProposalCreate,
)
from services.calendar_proposal_service import calendar_proposal_service  # noqa: E402
from services.calendar_service import calendar_service  # noqa: E402
from services.tasks_service import tasks_service  # noqa: E402
from schemas.tasks import TaskUpdate  # noqa: E402


UTC = timezone.utc


class CalendarV2Tests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        db_path = Path(self._tmpdir.name) / "calendar-v2.db"
        self.engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
        self.Session = async_sessionmaker(self.engine, expire_on_commit=False)
        async with self.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with self.Session() as session:
            session.add(UserDB(id="calendar-user", email="calendar@example.com", full_name="Calendar User"))
            session.add(
                TaskDB(
                    id="task-1",
                    user_id="calendar-user",
                    title="Write launch brief",
                    status="open",
                    priority="high",
                    source="manual",
                    tags_json="[]",
                )
            )
            await session.commit()
        self.notify = patch.object(calendar_service, "_notify", AsyncMock())
        self.notify.start()

    async def asyncTearDown(self) -> None:
        self.notify.stop()
        await self.engine.dispose()
        self._tmpdir.cleanup()

    @asynccontextmanager
    async def db_session(self):
        async with self.Session() as session:
            try:
                yield session
            except Exception:
                await session.rollback()
                raise

    def allocation(self, start: datetime, *, client_id: str) -> CalendarEventCreate:
        return CalendarEventCreate(
            title="Write launch brief",
            kind="task_allocation",
            task_id="task-1",
            start_at=start,
            end_at=start + timedelta(minutes=45),
            timezone="America/New_York",
            all_day=False,
            client_event_id=client_id,
        )

    async def test_multiple_task_allocations_preserve_independent_deadline_and_are_idempotent(self):
        first_start = datetime(2026, 11, 1, 13, 0, tzinfo=UTC)
        second_start = datetime(2026, 11, 2, 15, 0, tzinfo=UTC)
        with patch("services.calendar_service.get_db_session", self.db_session):
            first = await calendar_service.create_event(
                "calendar-user", self.allocation(first_start, client_id="allocate-1")
            )
            duplicate = await calendar_service.create_event(
                "calendar-user", self.allocation(first_start, client_id="allocate-1")
            )
            second = await calendar_service.create_event(
                "calendar-user", self.allocation(second_start, client_id="allocate-2")
            )
            model = await calendar_service.list_range(
                "calendar-user",
                start=datetime(2026, 11, 1, tzinfo=UTC),
                end=datetime(2026, 11, 4, tzinfo=UTC),
                timezone_name="America/New_York",
                mode="plan",
            )

        self.assertEqual(first["id"], duplicate["id"])
        self.assertNotEqual(first["id"], second["id"])
        self.assertEqual(len([item for item in model["occurrences"] if item["task_id"] == "task-1"]), 2)
        task = next(item for item in model["tasks"] if item["id"] == "task-1")
        self.assertEqual(task["allocation_count"], 2)
        self.assertIsNone(task["due_at"])

    async def test_task_completion_hides_future_native_allocations_but_preserves_history(self):
        now = datetime.now(UTC)
        with (
            patch("services.calendar_service.get_db_session", self.db_session),
            patch("services.tasks_service.get_db_session", self.db_session),
        ):
            await calendar_service.create_event(
                "calendar-user", self.allocation(now - timedelta(days=1), client_id="past-allocation")
            )
            await calendar_service.create_event(
                "calendar-user", self.allocation(now + timedelta(days=1), client_id="future-allocation")
            )
            await tasks_service.update_task("calendar-user", "task-1", TaskUpdate(status="completed"))

        async with self.Session() as session:
            rows = list(
                (
                    await session.execute(
                        select(CalendarOccurrenceDB).order_by(CalendarOccurrenceDB.start_at.asc())
                    )
                ).scalars().all()
            )
        self.assertEqual(rows[0].status, "confirmed")
        self.assertEqual(rows[1].status, "canceled")

    async def test_recurrence_materialization_and_occurrence_move(self):
        start = datetime(2026, 3, 7, 14, 0, tzinfo=UTC)
        with patch("services.calendar_service.get_db_session", self.db_session):
            event = await calendar_service.create_event(
                "calendar-user",
                CalendarEventCreate(
                    title="Weekly planning",
                    start_at=start,
                    end_at=start + timedelta(hours=1),
                    timezone="America/New_York",
                    recurrence=["RRULE:FREQ=DAILY;COUNT=3"],
                    client_event_id="recurring-1",
                ),
            )
            model = await calendar_service.list_range(
                "calendar-user",
                start=datetime(2026, 3, 7, tzinfo=UTC),
                end=datetime(2026, 3, 12, tzinfo=UTC),
                timezone_name="America/New_York",
                mode="plan",
            )
            occurrences = [item for item in model["occurrences"] if item["event_id"] == event["id"]]
            moved = occurrences[1]
            await calendar_service.update_event(
                "calendar-user",
                event["id"],
                CalendarEventUpdate(
                    start_at=moved["start_at"] + timedelta(hours=2),
                    end_at=moved["end_at"] + timedelta(hours=2),
                    recurrence_scope="occurrence",
                    occurrence_id=moved["id"],
                ),
            )

        self.assertEqual(len(occurrences), 3)
        async with self.Session() as session:
            stored = await session.get(CalendarOccurrenceDB, moved["id"])
        self.assertTrue(stored.is_exception)
        self.assertEqual(stored.start_at, moved["start_at"].replace(tzinfo=None) + timedelta(hours=2))

    async def test_ai_proposal_does_not_mutate_calendar_until_explicit_apply(self):
        proposed_start = datetime(2026, 9, 7, 13, 0, tzinfo=UTC)
        proposal_input = CalendarProposalCreate(
            changes=[
                CalendarMutationDraft(
                    action="create_event",
                    after={
                        "title": "Protected focus",
                        "start_at": proposed_start.isoformat(),
                        "end_at": (proposed_start + timedelta(hours=1)).isoformat(),
                        "timezone": "America/New_York",
                        "all_day": False,
                        "client_event_id": "proposal-event-1",
                    },
                )
            ]
        )
        with (
            patch("services.calendar_proposal_service.get_db_session", self.db_session),
            patch("services.calendar_service.get_db_session", self.db_session),
        ):
            proposals = await calendar_proposal_service.create("calendar-user", proposal_input)
            async with self.Session() as session:
                before_count = int((await session.execute(select(func.count(CalendarEventDB.id)))).scalar_one())
                approval = await session.get(ApprovalRequestDB, proposals[0]["id"])
            applied = await calendar_proposal_service.apply("calendar-user", [proposals[0]["id"]])
            async with self.Session() as session:
                after_count = int((await session.execute(select(func.count(CalendarEventDB.id)))).scalar_one())

        self.assertEqual(before_count, 0)
        self.assertEqual(approval.status, "pending")
        self.assertEqual(applied["applied"], [proposals[0]["id"]])
        self.assertEqual(after_count, 1)


if __name__ == "__main__":
    unittest.main()
