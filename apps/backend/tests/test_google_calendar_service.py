from __future__ import annotations

import tempfile
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from pathlib import Path
import sys
import unittest
from unittest.mock import AsyncMock, patch
from urllib.parse import parse_qs, urlparse

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from database.models import (  # noqa: E402
    Base,
    CalendarAccountDB,
    CalendarEventDB,
    CalendarOccurrenceDB,
    CalendarSourceDB,
    CalendarSyncRunDB,
    UserDB,
)
from services.google_calendar_service import (  # noqa: E402
    GoogleCalendarProviderError,
    google_calendar_service,
)
from services.token_crypto import token_crypto  # noqa: E402


class GoogleCalendarServiceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        db_path = Path(self._tmpdir.name) / "google-calendar.db"
        self.engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
        self.Session = async_sessionmaker(self.engine, expire_on_commit=False)
        async with self.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with self.Session() as session:
            session.add(UserDB(id="google-user", email="google@example.com", full_name="Google User"))
            session.add(UserDB(id="oauth-user", email="oauth@example.com", full_name="OAuth User"))
            account = CalendarAccountDB(
                id="google-account",
                user_id="google-user",
                provider="google",
                provider_account_id="google@example.com",
                status="active",
                scopes_json="[]",
                access_token=token_crypto.encrypt("access-token"),
                refresh_token=token_crypto.encrypt("refresh-token"),
                token_expires_at=datetime.utcnow() + timedelta(hours=1),
            )
            session.add(account)
            session.add(
                CalendarSourceDB(
                    id="google-source",
                    user_id="google-user",
                    account_id="google-account",
                    provider_calendar_id="primary",
                    name="Primary",
                    timezone="America/New_York",
                    access_role="owner",
                    is_visible=True,
                    is_primary=True,
                    sync_token="expired-token",
                )
            )
            await session.commit()
        google_calendar_service._recent_notifications.clear()

    async def asyncTearDown(self) -> None:
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

    async def test_oauth_url_uses_signed_encrypted_state_and_s256_pkce(self):
        environment = {
            "GOOGLE_CALENDAR_CLIENT_ID": "client-id",
            "GOOGLE_CALENDAR_CLIENT_SECRET": "client-secret",
            "GOOGLE_CALENDAR_REDIRECT_URI": "https://ritual.example/api/integrations/google-calendar/callback",
            "GOOGLE_CALENDAR_OAUTH_STATE_SECRET": "state-secret",
        }
        with (
            patch.dict("os.environ", environment, clear=False),
            patch("services.google_calendar_service.get_db_session", self.db_session),
        ):
            url = await google_calendar_service.authorization_url("oauth-user", "//untrusted.example")
            query = parse_qs(urlparse(url).query)
            state = google_calendar_service._verify_state(query["state"][0])

        self.assertEqual(query["code_challenge_method"], ["S256"])
        self.assertTrue(query["code_challenge"][0])
        self.assertTrue(state["code_verifier"])
        self.assertEqual(state["return_url"], "/calendar")

    async def test_incremental_410_reset_imports_recurring_master_and_exception_idempotently(self):
        master = {
            "id": "provider-master",
            "summary": "Weekly planning",
            "status": "confirmed",
            "eventType": "focusTime",
            "start": {"dateTime": "2026-09-07T09:00:00-04:00", "timeZone": "America/New_York"},
            "end": {"dateTime": "2026-09-07T10:00:00-04:00", "timeZone": "America/New_York"},
            "recurrence": ["RRULE:FREQ=WEEKLY;COUNT=3"],
            "etag": "master-etag",
        }
        exception = {
            "id": "provider-exception",
            "recurringEventId": "provider-master",
            "summary": "Weekly planning — moved",
            "status": "confirmed",
            "start": {"dateTime": "2026-09-14T11:00:00-04:00", "timeZone": "America/New_York"},
            "end": {"dateTime": "2026-09-14T12:00:00-04:00", "timeZone": "America/New_York"},
            "originalStartTime": {"dateTime": "2026-09-14T09:00:00-04:00", "timeZone": "America/New_York"},
            "etag": "exception-etag",
        }
        expired_once = False

        async def provider(_method, path, *, params=None, **_kwargs):
            nonlocal expired_once
            if path == "/users/me/calendarList":
                return {
                    "items": [
                        {
                            "id": "primary",
                            "summary": "Primary",
                            "primary": True,
                            "selected": True,
                            "accessRole": "owner",
                            "timeZone": "America/New_York",
                        }
                    ]
                }
            if path.endswith("/events"):
                if params and params.get("syncToken") and not expired_once:
                    expired_once = True
                    raise GoogleCalendarProviderError("sync_token_expired")
                return {"items": [master, exception], "nextSyncToken": "fresh-token"}
            raise AssertionError(path)

        with (
            patch("services.google_calendar_service.get_db_session", self.db_session),
            patch.object(google_calendar_service, "_provider_json", AsyncMock(side_effect=provider)),
        ):
            first = await google_calendar_service.sync_account("google-user", trigger="manual")
            second = await google_calendar_service.sync_account("google-user", trigger="manual")

        self.assertEqual(first["imported"], 2)
        self.assertEqual(second["imported"], 2)
        async with self.Session() as session:
            source = await session.get(CalendarSourceDB, "google-source")
            event_count = int((await session.execute(select(func.count(CalendarEventDB.id)))).scalar_one())
            occurrence_count = int((await session.execute(select(func.count(CalendarOccurrenceDB.id)))).scalar_one())
            exception_event = (
                await session.execute(
                    select(CalendarEventDB).where(CalendarEventDB.provider_event_id == "provider-exception")
                )
            ).scalar_one()
            exception_occurrence = (
                await session.execute(
                    select(CalendarOccurrenceDB).where(CalendarOccurrenceDB.override_event_id == exception_event.id)
                )
            ).scalar_one()
            reset_runs = int(
                (
                    await session.execute(
                        select(func.count(CalendarSyncRunDB.id)).where(CalendarSyncRunDB.cursor_reset.is_(True))
                    )
                ).scalar_one()
            )

        self.assertEqual(source.sync_token, "fresh-token")
        self.assertEqual(event_count, 2)
        self.assertEqual(occurrence_count, 3)
        self.assertEqual(exception_event.provider_event_type, "default")
        self.assertEqual(exception_occurrence.provider_instance_id, "provider-exception")
        self.assertEqual(reset_runs, 1)

    async def test_duplicate_push_notifications_are_debounced_after_token_validation(self):
        channel_token = "channel-secret"
        async with self.Session() as session:
            source = await session.get(CalendarSourceDB, "google-source")
            source.watch_channel_id = "channel-1"
            source.watch_token = token_crypto.encrypt(channel_token)
            await session.commit()

        sync = AsyncMock(return_value={"imported": 0, "deleted": 0})
        with (
            patch("services.google_calendar_service.get_db_session", self.db_session),
            patch.object(google_calendar_service, "sync_account", sync),
        ):
            await google_calendar_service.process_notification("channel-1", channel_token)
            await google_calendar_service.process_notification("channel-1", channel_token)

        sync.assert_awaited_once_with("google-user", trigger="push")


if __name__ == "__main__":
    unittest.main()
