"""Google Calendar OAuth, provider writes, and incremental synchronization."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional
from urllib.parse import quote, urlencode
from uuid import NAMESPACE_URL, uuid4, uuid5

import httpx
from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import delete, select

from database.connection import get_db_session
from database.models import (
    CalendarAccountDB,
    CalendarEventDB,
    CalendarOccurrenceDB,
    CalendarSourceDB,
    CalendarSyncRunDB,
)
from database.models.base import _utcnow_naive
from services.token_crypto import token_crypto


GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3"
GOOGLE_SCOPES = (
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
)


class GoogleCalendarConfigurationError(RuntimeError):
    pass


class GoogleCalendarProviderError(RuntimeError):
    def __init__(self, code: str, message: str = "Google Calendar request failed"):
        self.code = code
        super().__init__(message)


def _b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _b64decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _aware_utc(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _naive_utc(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    return value.astimezone(timezone.utc).replace(tzinfo=None) if value.tzinfo else value


def _parse_provider_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    normalized = value.replace("Z", "+00:00")
    try:
        return _naive_utc(datetime.fromisoformat(normalized))
    except ValueError:
        return None


class GoogleCalendarService:
    def __init__(self) -> None:
        self._recent_notifications: dict[str, float] = {}

    def _config(self) -> tuple[str, str, str, str]:
        client_id = os.getenv("GOOGLE_CALENDAR_CLIENT_ID", "").strip()
        client_secret = os.getenv("GOOGLE_CALENDAR_CLIENT_SECRET", "").strip()
        redirect_uri = os.getenv("GOOGLE_CALENDAR_REDIRECT_URI", "").strip()
        state_secret = os.getenv("GOOGLE_CALENDAR_OAUTH_STATE_SECRET", "").strip() or client_secret
        if not all((client_id, client_secret, redirect_uri, state_secret)):
            raise GoogleCalendarConfigurationError(
                "Google Calendar OAuth is not configured. Set GOOGLE_CALENDAR_CLIENT_ID, "
                "GOOGLE_CALENDAR_CLIENT_SECRET, and GOOGLE_CALENDAR_REDIRECT_URI."
            )
        return client_id, client_secret, redirect_uri, state_secret

    @staticmethod
    def _safe_return_url(return_url: str) -> str:
        return return_url if return_url.startswith("/") and not return_url.startswith("//") else "/calendar"

    @staticmethod
    def _state_cipher(state_secret: str) -> Fernet:
        key = base64.urlsafe_b64encode(hashlib.sha256(state_secret.encode("utf-8")).digest())
        return Fernet(key)

    def _sign_state(self, user_id: str, return_url: str, code_verifier: str) -> str:
        _client_id, _client_secret, _redirect_uri, state_secret = self._config()
        payload = {
            "user_id": user_id,
            "return_url": self._safe_return_url(return_url),
            "pkce": self._state_cipher(state_secret).encrypt(code_verifier.encode("utf-8")).decode("ascii"),
            "nonce": secrets.token_urlsafe(16),
            "expires": int(time.time()) + 600,
        }
        encoded = _b64encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
        signature = _b64encode(hmac.new(state_secret.encode("utf-8"), encoded.encode("ascii"), hashlib.sha256).digest())
        return f"{encoded}.{signature}"

    def _verify_state(self, state: str) -> dict[str, Any]:
        _client_id, _client_secret, _redirect_uri, state_secret = self._config()
        try:
            encoded, signature = state.split(".", 1)
            expected = _b64encode(
                hmac.new(state_secret.encode("utf-8"), encoded.encode("ascii"), hashlib.sha256).digest()
            )
            if not hmac.compare_digest(signature, expected):
                raise ValueError("signature")
            payload = json.loads(_b64decode(encoded))
            if int(payload.get("expires", 0)) < int(time.time()):
                raise ValueError("expired")
            if not payload.get("user_id"):
                raise ValueError("user")
            encrypted_verifier = str(payload.pop("pkce", ""))
            payload["code_verifier"] = self._state_cipher(state_secret).decrypt(
                encrypted_verifier.encode("ascii")
            ).decode("utf-8")
            return payload
        except (ValueError, TypeError, json.JSONDecodeError, InvalidToken) as exc:
            raise GoogleCalendarProviderError("invalid_oauth_state", "OAuth state is invalid or expired") from exc

    async def authorization_url(self, user_id: str, return_url: str = "/calendar") -> str:
        async with get_db_session() as session:
            existing = (
                await session.execute(
                    select(CalendarAccountDB).where(
                        CalendarAccountDB.user_id == user_id,
                        CalendarAccountDB.provider == "google",
                        CalendarAccountDB.status == "active",
                    )
                )
            ).scalar_one_or_none()
            if existing:
                raise GoogleCalendarProviderError("account_already_connected", "A Google account is already connected")
        client_id, _client_secret, redirect_uri, _state_secret = self._config()
        code_verifier = secrets.token_urlsafe(64)
        code_challenge = _b64encode(hashlib.sha256(code_verifier.encode("ascii")).digest())
        query = urlencode({
            'client_id': client_id,
            'redirect_uri': redirect_uri,
            'response_type': 'code',
            'scope': ' '.join(GOOGLE_SCOPES),
            'access_type': 'offline',
            'prompt': 'consent',
            'include_granted_scopes': 'true',
            'state': self._sign_state(user_id, return_url, code_verifier),
            'code_challenge': code_challenge,
            'code_challenge_method': 'S256',
        })
        return f"{GOOGLE_AUTH_URL}?{query}"

    async def complete_oauth(self, code: str, state: str) -> str:
        state_payload = self._verify_state(state)
        user_id = str(state_payload["user_id"])
        client_id, client_secret, redirect_uri, _state_secret = self._config()
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                GOOGLE_TOKEN_URL,
                data={
                    "code": code,
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "redirect_uri": redirect_uri,
                    "grant_type": "authorization_code",
                    "code_verifier": state_payload["code_verifier"],
                },
            )
        if response.status_code >= 400:
            raise GoogleCalendarProviderError("oauth_exchange_failed")
        token = response.json()
        access_token = token.get("access_token")
        refresh_token = token.get("refresh_token")
        if not access_token or not refresh_token:
            raise GoogleCalendarProviderError("oauth_tokens_missing")

        calendar_list = await self._provider_json(
            "GET",
            "/users/me/calendarList",
            access_token=access_token,
            params={"maxResults": 250},
        )
        primary = next((item for item in calendar_list.get("items", []) if item.get("primary")), None)
        if not primary:
            raise GoogleCalendarProviderError("primary_calendar_missing")
        provider_identity = str(primary.get("id"))
        now = _utcnow_naive()
        async with get_db_session() as session:
            existing = (
                await session.execute(
                    select(CalendarAccountDB).where(
                        CalendarAccountDB.user_id == user_id,
                        CalendarAccountDB.provider == "google",
                    )
                )
            ).scalar_one_or_none()
            if existing and existing.provider_account_id != provider_identity and existing.status == "active":
                raise GoogleCalendarProviderError("account_already_connected")
            account = existing or CalendarAccountDB(
                id=str(uuid4()),
                user_id=user_id,
                provider="google",
                provider_account_id=provider_identity,
                created_at=now,
            )
            account.email = provider_identity if "@" in provider_identity else None
            account.status = "active"
            account.scopes_json = json.dumps(GOOGLE_SCOPES)
            account.access_token = token_crypto.encrypt(access_token)
            account.refresh_token = token_crypto.encrypt(refresh_token)
            account.token_expires_at = now + timedelta(seconds=int(token.get("expires_in", 3600)))
            account.consented_at = now
            account.connected_at = now
            account.last_error = None
            account.updated_at = now
            if not existing:
                session.add(account)
            await session.commit()
            await self._upsert_sources(session, account, calendar_list.get("items", []))
            await session.commit()
        await self.sync_account(user_id, trigger="oauth")
        return str(state_payload.get("return_url") or "/calendar")

    async def _access_token(self, session, account: CalendarAccountDB) -> str:
        now = _utcnow_naive()
        if account.access_token and account.token_expires_at and account.token_expires_at > now + timedelta(minutes=2):
            return token_crypto.decrypt(account.access_token) or ""
        refresh = token_crypto.decrypt(account.refresh_token)
        if not refresh:
            raise GoogleCalendarProviderError("refresh_token_missing")
        client_id, client_secret, _redirect_uri, _state_secret = self._config()
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                GOOGLE_TOKEN_URL,
                data={
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "refresh_token": refresh,
                    "grant_type": "refresh_token",
                },
            )
        if response.status_code >= 400:
            account.status = "reauthorization_required"
            account.last_error = "token_refresh_failed"
            await session.flush()
            raise GoogleCalendarProviderError("token_refresh_failed")
        token = response.json()
        account.access_token = token_crypto.encrypt(token["access_token"])
        if token.get("refresh_token"):
            account.refresh_token = token_crypto.encrypt(token["refresh_token"])
        account.token_expires_at = now + timedelta(seconds=int(token.get("expires_in", 3600)))
        account.updated_at = now
        await session.flush()
        return str(token["access_token"])

    async def _provider_json(
        self,
        method: str,
        path: str,
        *,
        access_token: str,
        params: Optional[dict[str, Any]] = None,
        json_body: Optional[dict[str, Any]] = None,
        headers: Optional[dict[str, str]] = None,
    ) -> dict[str, Any]:
        request_headers = {"Authorization": f"Bearer {access_token}", **(headers or {})}
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.request(
                method,
                f"{GOOGLE_CALENDAR_API}{path}",
                params=params,
                json=json_body,
                headers=request_headers,
            )
        if response.status_code == 410:
            raise GoogleCalendarProviderError("sync_token_expired")
        if response.status_code == 412:
            raise GoogleCalendarProviderError("etag_conflict")
        if response.status_code >= 400:
            raise GoogleCalendarProviderError(f"provider_http_{response.status_code}")
        if response.status_code == 204 or not response.content:
            return {}
        return response.json()

    async def _upsert_sources(
        self, session, account: CalendarAccountDB, items: list[dict[str, Any]]
    ) -> None:
        existing = {
            source.provider_calendar_id: source
            for source in (
                await session.execute(
                    select(CalendarSourceDB).where(CalendarSourceDB.account_id == account.id)
                )
            ).scalars().all()
        }
        for item in items:
            provider_id = str(item.get("id") or "")
            if not provider_id:
                continue
            source = existing.get(provider_id) or CalendarSourceDB(
                id=str(uuid4()),
                user_id=account.user_id,
                account_id=account.id,
                provider_calendar_id=provider_id,
            )
            source.name = str(item.get("summaryOverride") or item.get("summary") or "Google Calendar")
            source.color = item.get("backgroundColor")
            source.timezone = str(item.get("timeZone") or "UTC")
            source.access_role = str(item.get("accessRole") or "reader")
            source.is_visible = bool(item.get("selected", True))
            source.is_primary = bool(item.get("primary", False))
            source.is_default_write = bool(item.get("primary", False))
            source.updated_at = _utcnow_naive()
            if provider_id not in existing:
                session.add(source)
        await session.flush()

    async def account_status(self, user_id: str) -> dict[str, Any]:
        async with get_db_session() as session:
            account = (
                await session.execute(
                    select(CalendarAccountDB).where(
                        CalendarAccountDB.user_id == user_id,
                        CalendarAccountDB.provider == "google",
                        CalendarAccountDB.status == "active",
                    )
                )
            ).scalar_one_or_none()
            return {
                "connected": bool(account),
                "account_id": account.id if account else None,
                "email": account.email if account else None,
                "last_sync_at": _aware_utc(account.last_sync_at) if account else None,
                "last_error": account.last_error if account else None,
            }

    async def sync_account(self, user_id: str, *, trigger: str = "manual") -> dict[str, int]:
        async with get_db_session() as session:
            account = (
                await session.execute(
                    select(CalendarAccountDB).where(
                        CalendarAccountDB.user_id == user_id,
                        CalendarAccountDB.provider == "google",
                        CalendarAccountDB.status == "active",
                    )
                )
            ).scalar_one_or_none()
            if not account:
                raise GoogleCalendarProviderError("account_not_connected")
            access_token = await self._access_token(session, account)
            calendar_list = await self._provider_json(
                "GET", "/users/me/calendarList", access_token=access_token, params={"maxResults": 250}
            )
            await self._upsert_sources(session, account, calendar_list.get("items", []))
            sources = list(
                (
                    await session.execute(
                        select(CalendarSourceDB).where(CalendarSourceDB.account_id == account.id)
                    )
                ).scalars().all()
            )
            imported = 0
            deleted_count = 0
            for source in sources:
                counts = await self._sync_source(session, account, source, access_token, trigger)
                imported += counts["imported"]
                deleted_count += counts["deleted"]
            account.last_sync_at = _utcnow_naive()
            account.last_error = None
            await session.commit()
            return {"imported": imported, "deleted": deleted_count}

    async def sync_all_active_accounts(self, *, trigger: str = "reconciliation") -> dict[str, int]:
        """Reconcile every active account without allowing one failure to stop the batch."""
        async with get_db_session() as session:
            user_ids = list(
                (
                    await session.execute(
                        select(CalendarAccountDB.user_id).where(
                            CalendarAccountDB.provider == "google",
                            CalendarAccountDB.status == "active",
                        )
                    )
                ).scalars().all()
            )
        result = {"accounts": len(user_ids), "synced": 0, "failed": 0, "imported": 0, "deleted": 0}
        for user_id in user_ids:
            try:
                counts = await self.sync_account(user_id, trigger=trigger)
                result["synced"] += 1
                result["imported"] += int(counts.get("imported", 0))
                result["deleted"] += int(counts.get("deleted", 0))
            except Exception:
                result["failed"] += 1
        return result

    async def _sync_source(
        self,
        session,
        account: CalendarAccountDB,
        source: CalendarSourceDB,
        access_token: str,
        trigger: str,
    ) -> dict[str, int]:
        started = time.monotonic()
        run = CalendarSyncRunDB(
            id=str(uuid4()),
            user_id=account.user_id,
            account_id=account.id,
            source_id=source.id,
            trigger=trigger,
            status="running",
        )
        session.add(run)
        await session.flush()
        imported = 0
        deleted_count = 0
        page_token: Optional[str] = None
        next_sync_token: Optional[str] = None
        cursor_reset = False
        try:
            while True:
                params: dict[str, Any] = {
                    # Preserve recurring masters and explicit exceptions. Ritual
                    # materializes the display window locally so recurrence
                    # identity survives incremental synchronization.
                    "singleEvents": "false",
                    "showDeleted": "true",
                    "maxResults": 2500,
                }
                if source.sync_token:
                    params["syncToken"] = source.sync_token
                if page_token:
                    params["pageToken"] = page_token
                try:
                    payload = await self._provider_json(
                        "GET",
                        f"/calendars/{quote(source.provider_calendar_id or '', safe='')}/events",
                        access_token=access_token,
                        params=params,
                    )
                except GoogleCalendarProviderError as exc:
                    if exc.code == "sync_token_expired" and source.sync_token:
                        source.sync_token = None
                        page_token = None
                        cursor_reset = True
                        continue
                    raise
                page_items = sorted(
                    payload.get("items", []),
                    key=lambda item: 1 if item.get("recurringEventId") else 0,
                )
                for item in page_items:
                    was_deleted = await self._upsert_provider_event(session, source, item)
                    imported += 1
                    deleted_count += int(was_deleted)
                page_token = payload.get("nextPageToken")
                next_sync_token = payload.get("nextSyncToken") or next_sync_token
                if not page_token:
                    break
            await self._reapply_provider_exceptions(session, source)
            source.sync_token = next_sync_token or source.sync_token
            source.last_sync_at = _utcnow_naive()
            source.last_error = None
            run.status = "completed"
            run.imported_count = imported
            run.deleted_count = deleted_count
            run.cursor_reset = cursor_reset
        except GoogleCalendarProviderError as exc:
            source.last_error = exc.code
            run.status = "failed"
            run.error_code = exc.code
            raise
        finally:
            run.finished_at = _utcnow_naive()
            run.duration_ms = int((time.monotonic() - started) * 1000)
        await self._ensure_watch(session, account, source, access_token)
        return {"imported": imported, "deleted": deleted_count}

    async def _upsert_provider_event(
        self, session, source: CalendarSourceDB, item: dict[str, Any]
    ) -> bool:
        provider_event_id = str(item.get("id") or "")
        if not provider_event_id:
            return False
        event = (
            await session.execute(
                select(CalendarEventDB).where(
                    CalendarEventDB.source_id == source.id,
                    CalendarEventDB.provider_event_id == provider_event_id,
                )
            )
        ).scalar_one_or_none()
        now = _utcnow_naive()
        event = event or CalendarEventDB(
            id=str(uuid4()),
            user_id=source.user_id,
            source_id=source.id,
            provider_event_id=provider_event_id,
            origin="google",
            kind="event",
            created_at=now,
        )
        if event.id is None:
            event.id = str(uuid4())
        start = item.get("start") or {}
        end = item.get("end") or {}
        all_day = bool(start.get("date"))
        deleted = item.get("status") == "cancelled"
        event.title = str(item.get("summary") or "Untitled event")
        event.description = item.get("description")
        event.start_at = None if all_day else _parse_provider_datetime(start.get("dateTime"))
        event.end_at = None if all_day else _parse_provider_datetime(end.get("dateTime"))
        event.start_date = start.get("date") if all_day else None
        event.end_date = end.get("date") if all_day else None
        event.timezone = str(start.get("timeZone") or source.timezone or "UTC")
        event.all_day = all_day
        event.status = "canceled" if deleted else ("tentative" if item.get("status") == "tentative" else "confirmed")
        event.availability = "free" if item.get("transparency") == "transparent" else "busy"
        event.visibility = str(item.get("visibility") or "default")
        event.location_json = json.dumps({"displayName": item.get("location")} if item.get("location") else {})
        event.conference_json = json.dumps(item.get("conferenceData") or {})
        event.organizer_json = json.dumps(item.get("organizer") or {})
        event.attendees_json = json.dumps(item.get("attendees") or [])
        event.reminders_json = json.dumps(item.get("reminders") or {})
        event.recurrence_json = json.dumps(item.get("recurrence") or [])
        event.provider_etag = item.get("etag")
        event.provider_event_type = str(item.get("eventType") or "default")
        event.ical_uid = item.get("iCalUID")
        event.provider_payload_json = json.dumps(item, separators=(",", ":"))
        event.sync_state = "synced"
        event.deleted_at = now if deleted else None
        event.updated_at = now
        event.revision = int(event.revision or 0) + 1
        recurring_provider_id = str(item.get("recurringEventId") or "") or None
        master = None
        if recurring_provider_id:
            master = (
                await session.execute(
                    select(CalendarEventDB).where(
                        CalendarEventDB.source_id == source.id,
                        CalendarEventDB.provider_event_id == recurring_provider_id,
                    )
                )
            ).scalar_one_or_none()
            event.recurring_event_id = master.id if master else None
        if event not in session:
            session.add(event)
        await session.flush()
        await session.execute(delete(CalendarOccurrenceDB).where(CalendarOccurrenceDB.event_id == event.id))
        original = item.get("originalStartTime") or start
        original_at = None if all_day else _parse_provider_datetime(original.get("dateTime"))
        original_date = original.get("date") if all_day else None
        if master:
            if original_at:
                await session.execute(
                    delete(CalendarOccurrenceDB).where(
                        CalendarOccurrenceDB.event_id == master.id,
                        CalendarOccurrenceDB.original_start_at == original_at,
                    )
                )
            elif original_date:
                await session.execute(
                    delete(CalendarOccurrenceDB).where(
                        CalendarOccurrenceDB.event_id == master.id,
                        CalendarOccurrenceDB.original_start_date == original_date,
                    )
                )
        if not deleted and event.recurrence_json != "[]" and not recurring_provider_id:
            from services.calendar_service import calendar_service

            await calendar_service._materialize_event(session, event)
        elif not deleted or master:
            original_key = original_date or (original_at.isoformat() if original_at else provider_event_id)
            session.add(
                CalendarOccurrenceDB(
                    id=str(uuid5(NAMESPACE_URL, f"google:{source.id}:{provider_event_id}:{original_key}")),
                    event_id=master.id if master else event.id,
                    override_event_id=event.id if master else None,
                    user_id=source.user_id,
                    source_id=source.id,
                    provider_instance_id=provider_event_id,
                    original_start_at=original_at,
                    original_start_date=original_date,
                    start_at=event.start_at if not deleted else original_at,
                    end_at=event.end_at if not deleted else original_at,
                    start_date=event.start_date if not deleted else original_date,
                    end_date=event.end_date if not deleted else original_date,
                    timezone=event.timezone,
                    all_day=all_day,
                    status=event.status,
                    is_exception=bool(item.get("recurringEventId")),
                    revision=event.revision,
                )
            )
        await session.flush()
        return deleted

    async def _reapply_provider_exceptions(self, session, source: CalendarSourceDB) -> None:
        exceptions = list(
            (
                await session.execute(
                    select(CalendarEventDB).where(
                        CalendarEventDB.source_id == source.id,
                        CalendarEventDB.recurring_event_id.is_not(None),
                    )
                )
            ).scalars().all()
        )
        for exception in exceptions:
            master_id = exception.recurring_event_id
            if not master_id:
                continue
            conditions = [CalendarOccurrenceDB.event_id == master_id]
            if exception.original_start_at:
                conditions.append(CalendarOccurrenceDB.original_start_at == exception.original_start_at)
            elif exception.original_start_date:
                conditions.append(CalendarOccurrenceDB.original_start_date == exception.original_start_date)
            else:
                continue
            existing = (
                await session.execute(select(CalendarOccurrenceDB).where(*conditions))
            ).scalar_one_or_none()
            if exception.deleted_at is not None:
                if existing:
                    existing.status = "canceled"
                    existing.is_exception = True
                    existing.override_event_id = exception.id
                continue
            if existing:
                existing.override_event_id = exception.id
                existing.provider_instance_id = exception.provider_event_id
                existing.start_at = exception.start_at
                existing.end_at = exception.end_at
                existing.start_date = exception.start_date
                existing.end_date = exception.end_date
                existing.status = exception.status
                existing.is_exception = True
                existing.revision = exception.revision
                await session.execute(
                    delete(CalendarOccurrenceDB).where(
                        CalendarOccurrenceDB.event_id == exception.id,
                        CalendarOccurrenceDB.id != existing.id,
                    )
                )

    def _event_body(self, event: CalendarEventDB) -> dict[str, Any]:
        if event.all_day:
            start: dict[str, Any] = {"date": event.start_date}
            end: dict[str, Any] = {"date": event.end_date}
        else:
            start = {"dateTime": _aware_utc(event.start_at).isoformat(), "timeZone": event.timezone}
            end = {"dateTime": _aware_utc(event.end_at).isoformat(), "timeZone": event.timezone}
        location = json.loads(event.location_json or "{}")
        conference = json.loads(event.conference_json or "{}")
        body: dict[str, Any] = {
            "summary": event.title,
            "description": event.description,
            "start": start,
            "end": end,
            "attendees": json.loads(event.attendees_json or "[]"),
            "reminders": json.loads(event.reminders_json or "{}"),
            "recurrence": json.loads(event.recurrence_json or "[]"),
            "transparency": "transparent" if event.availability == "free" else "opaque",
            "visibility": event.visibility,
        }
        if location.get("displayName"):
            body["location"] = location["displayName"]
        if conference:
            body["conferenceData"] = conference
        return {key: value for key, value in body.items() if value not in (None, [], {})}

    async def create_provider_event(
        self, session, event: CalendarEventDB, source: CalendarSourceDB
    ) -> None:
        account = await session.get(CalendarAccountDB, source.account_id)
        if not account or account.user_id != event.user_id:
            raise GoogleCalendarProviderError("account_not_connected")
        access_token = await self._access_token(session, account)
        body = self._event_body(event)
        if event.conference_json and json.loads(event.conference_json or "{}").get("createMeet"):
            body["conferenceData"] = {
                "createRequest": {"requestId": str(uuid4()), "conferenceSolutionKey": {"type": "hangoutsMeet"}}
            }
        payload = await self._provider_json(
            "POST",
            f"/calendars/{quote(source.provider_calendar_id or '', safe='')}/events",
            access_token=access_token,
            params={"conferenceDataVersion": 1, "sendUpdates": "all"},
            json_body=body,
        )
        event.provider_event_id = payload.get("id")
        event.provider_etag = payload.get("etag")
        event.ical_uid = payload.get("iCalUID")
        event.provider_payload_json = json.dumps(payload, separators=(",", ":"))
        event.sync_state = "synced"
        event.updated_at = _utcnow_naive()

    async def update_provider_event(
        self, session, event: CalendarEventDB, source: CalendarSourceDB
    ) -> None:
        if not event.provider_event_id:
            await self.create_provider_event(session, event, source)
            return
        account = await session.get(CalendarAccountDB, source.account_id)
        if not account:
            raise GoogleCalendarProviderError("account_not_connected")
        access_token = await self._access_token(session, account)
        payload = await self._provider_json(
            "PATCH",
            f"/calendars/{quote(source.provider_calendar_id or '', safe='')}/events/{quote(event.provider_event_id, safe='')}",
            access_token=access_token,
            params={"conferenceDataVersion": 1, "sendUpdates": "all"},
            json_body=self._event_body(event),
            headers={"If-Match": event.provider_etag} if event.provider_etag else None,
        )
        event.provider_etag = payload.get("etag")
        event.provider_payload_json = json.dumps(payload, separators=(",", ":"))
        event.sync_state = "synced"

    async def move_provider_event(
        self,
        session,
        event: CalendarEventDB,
        source: CalendarSourceDB,
        destination: CalendarSourceDB,
    ) -> None:
        if not event.provider_event_id or not source.account_id or source.account_id != destination.account_id:
            raise GoogleCalendarProviderError("calendar_move_not_supported")
        account = await session.get(CalendarAccountDB, source.account_id)
        if not account:
            raise GoogleCalendarProviderError("account_not_connected")
        access_token = await self._access_token(session, account)
        payload = await self._provider_json(
            "POST",
            f"/calendars/{quote(source.provider_calendar_id or '', safe='')}/events/{quote(event.provider_event_id, safe='')}/move",
            access_token=access_token,
            params={"destination": destination.provider_calendar_id},
            headers={"If-Match": event.provider_etag} if event.provider_etag else None,
        )
        event.provider_event_id = payload.get("id") or event.provider_event_id
        event.provider_etag = payload.get("etag")
        event.provider_payload_json = json.dumps(payload, separators=(",", ":"))
        event.sync_state = "synced"

    async def _find_provider_instance(
        self,
        *,
        access_token: str,
        source: CalendarSourceDB,
        master: CalendarEventDB,
        occurrence: CalendarOccurrenceDB,
    ) -> dict[str, Any]:
        if not master.provider_event_id:
            raise GoogleCalendarProviderError("provider_event_missing")
        if occurrence.original_start_at:
            original = _aware_utc(occurrence.original_start_at)
            time_min = original - timedelta(days=1)
            time_max = original + timedelta(days=2)
        elif occurrence.original_start_date:
            original_day = date.fromisoformat(occurrence.original_start_date)
            time_min = datetime.combine(original_day - timedelta(days=1), datetime.min.time(), timezone.utc)
            time_max = datetime.combine(original_day + timedelta(days=2), datetime.min.time(), timezone.utc)
        else:
            raise GoogleCalendarProviderError("provider_instance_missing")
        payload = await self._provider_json(
            "GET",
            f"/calendars/{quote(source.provider_calendar_id or '', safe='')}/events/{quote(master.provider_event_id, safe='')}/instances",
            access_token=access_token,
            params={
                "timeMin": time_min.isoformat(),
                "timeMax": time_max.isoformat(),
                "showDeleted": "true",
                "maxResults": 50,
            },
        )
        for item in payload.get("items", []):
            candidate = item.get("originalStartTime") or item.get("start") or {}
            if occurrence.original_start_at and _parse_provider_datetime(candidate.get("dateTime")) == occurrence.original_start_at:
                return item
            if occurrence.original_start_date and candidate.get("date") == occurrence.original_start_date:
                return item
        raise GoogleCalendarProviderError("provider_instance_missing")

    async def update_provider_occurrence(
        self,
        session,
        master: CalendarEventDB,
        override: CalendarEventDB,
        occurrence: CalendarOccurrenceDB,
        source: CalendarSourceDB,
    ) -> None:
        account = await session.get(CalendarAccountDB, source.account_id)
        if not account:
            raise GoogleCalendarProviderError("account_not_connected")
        access_token = await self._access_token(session, account)
        provider_instance = await self._find_provider_instance(
            access_token=access_token,
            source=source,
            master=master,
            occurrence=occurrence,
        )
        instance_id = str(provider_instance.get("id") or "")
        if not instance_id:
            raise GoogleCalendarProviderError("provider_instance_missing")
        payload = await self._provider_json(
            "PATCH",
            f"/calendars/{quote(source.provider_calendar_id or '', safe='')}/events/{quote(instance_id, safe='')}",
            access_token=access_token,
            params={"conferenceDataVersion": 1, "sendUpdates": "all"},
            json_body=self._event_body(override),
            headers={"If-Match": provider_instance.get("etag")} if provider_instance.get("etag") else None,
        )
        override.provider_event_id = payload.get("id") or instance_id
        override.provider_etag = payload.get("etag")
        override.provider_payload_json = json.dumps(payload, separators=(",", ":"))
        override.sync_state = "synced"
        occurrence.provider_instance_id = override.provider_event_id

    async def delete_provider_occurrence(
        self,
        session,
        master: CalendarEventDB,
        occurrence: CalendarOccurrenceDB,
        source: CalendarSourceDB,
    ) -> None:
        account = await session.get(CalendarAccountDB, source.account_id)
        if not account:
            raise GoogleCalendarProviderError("account_not_connected")
        access_token = await self._access_token(session, account)
        provider_instance = await self._find_provider_instance(
            access_token=access_token,
            source=source,
            master=master,
            occurrence=occurrence,
        )
        instance_id = str(provider_instance.get("id") or "")
        await self._provider_json(
            "DELETE",
            f"/calendars/{quote(source.provider_calendar_id or '', safe='')}/events/{quote(instance_id, safe='')}",
            access_token=access_token,
            params={"sendUpdates": "all"},
            headers={"If-Match": provider_instance.get("etag")} if provider_instance.get("etag") else None,
        )

    async def delete_provider_event(
        self,
        session,
        event: CalendarEventDB,
        source: CalendarSourceDB,
        *,
        scope: str,
    ) -> None:
        if not event.provider_event_id:
            return
        account = await session.get(CalendarAccountDB, source.account_id)
        if not account:
            raise GoogleCalendarProviderError("account_not_connected")
        provider_id = event.provider_event_id
        raw = json.loads(event.provider_payload_json or "{}")
        if scope == "series" and raw.get("recurringEventId"):
            provider_id = str(raw["recurringEventId"])
        access_token = await self._access_token(session, account)
        await self._provider_json(
            "DELETE",
            f"/calendars/{quote(source.provider_calendar_id or '', safe='')}/events/{quote(provider_id, safe='')}",
            access_token=access_token,
            params={"sendUpdates": "all"},
            headers={"If-Match": event.provider_etag} if event.provider_etag else None,
        )

    async def _ensure_watch(
        self,
        session,
        account: CalendarAccountDB,
        source: CalendarSourceDB,
        access_token: str,
    ) -> None:
        webhook_url = os.getenv("GOOGLE_CALENDAR_WEBHOOK_URL", "").strip()
        if not webhook_url:
            return
        if source.watch_expires_at and source.watch_expires_at > _utcnow_naive() + timedelta(hours=12):
            return
        channel_id = str(uuid4())
        channel_token = secrets.token_urlsafe(32)
        payload = await self._provider_json(
            "POST",
            f"/calendars/{quote(source.provider_calendar_id or '', safe='')}/events/watch",
            access_token=access_token,
            json_body={
                "id": channel_id,
                "type": "web_hook",
                "address": webhook_url,
                "token": channel_token,
            },
        )
        source.watch_channel_id = channel_id
        source.watch_resource_id = payload.get("resourceId")
        source.watch_token = token_crypto.encrypt(channel_token)
        expiration = payload.get("expiration")
        source.watch_expires_at = (
            datetime.fromtimestamp(int(expiration) / 1000, tz=timezone.utc).replace(tzinfo=None)
            if expiration
            else _utcnow_naive() + timedelta(days=6)
        )

    async def process_notification(self, channel_id: str, channel_token: str) -> None:
        now = time.monotonic()
        if now - self._recent_notifications.get(channel_id, 0) < 3:
            return
        async with get_db_session() as session:
            source = (
                await session.execute(
                    select(CalendarSourceDB).where(CalendarSourceDB.watch_channel_id == channel_id)
                )
            ).scalar_one_or_none()
            if not source or not source.watch_token:
                raise GoogleCalendarProviderError("unknown_watch_channel")
            expected = token_crypto.decrypt(source.watch_token) or ""
            if not hmac.compare_digest(expected, channel_token):
                raise GoogleCalendarProviderError("invalid_watch_token")
            user_id = source.user_id
        self._recent_notifications[channel_id] = now
        if len(self._recent_notifications) > 1000:
            self._recent_notifications = {
                key: seen for key, seen in self._recent_notifications.items() if now - seen < 300
            }
        await self.sync_account(user_id, trigger="push")

    async def disconnect(self, user_id: str) -> None:
        async with get_db_session() as session:
            account = (
                await session.execute(
                    select(CalendarAccountDB).where(
                        CalendarAccountDB.user_id == user_id,
                        CalendarAccountDB.provider == "google",
                    )
                )
            ).scalar_one_or_none()
            if not account:
                return
            access_token = None
            try:
                access_token = await self._access_token(session, account)
            except (GoogleCalendarConfigurationError, GoogleCalendarProviderError, RuntimeError):
                access_token = token_crypto.decrypt(account.access_token)
            connected_sources = list(
                (
                    await session.execute(
                        select(CalendarSourceDB).where(CalendarSourceDB.account_id == account.id)
                    )
                ).scalars().all()
            )
            if access_token:
                for connected_source in connected_sources:
                    if not connected_source.watch_channel_id or not connected_source.watch_resource_id:
                        continue
                    try:
                        await self._provider_json(
                            "POST",
                            "/channels/stop",
                            access_token=access_token,
                            json_body={
                                "id": connected_source.watch_channel_id,
                                "resourceId": connected_source.watch_resource_id,
                            },
                        )
                    except GoogleCalendarProviderError:
                        pass
                try:
                    async with httpx.AsyncClient(timeout=15) as client:
                        await client.post(
                            "https://oauth2.googleapis.com/revoke",
                            data={"token": token_crypto.decrypt(account.refresh_token) or access_token},
                            headers={"Content-Type": "application/x-www-form-urlencoded"},
                        )
                except httpx.HTTPError:
                    pass
            ritual_source_id = str(uuid5(NAMESPACE_URL, f"ritual:calendar-source:{user_id}"))
            ritual_source = await session.get(CalendarSourceDB, ritual_source_id)
            if not ritual_source:
                ritual_source = CalendarSourceDB(
                    id=ritual_source_id,
                    user_id=user_id,
                    name="Ritual",
                    color="#9f7a4f",
                    timezone="UTC",
                    access_role="owner",
                    is_visible=True,
                    is_primary=True,
                    is_default_write=True,
                )
                session.add(ritual_source)
                await session.flush()
            source_ids = list(
                (
                    await session.execute(
                        select(CalendarSourceDB.id).where(CalendarSourceDB.account_id == account.id)
                    )
                ).scalars().all()
            )
            if source_ids:
                await session.execute(
                    delete(CalendarEventDB).where(
                        CalendarEventDB.source_id.in_(source_ids),
                        CalendarEventDB.origin == "google",
                    )
                )
                ritual_events = list(
                    (
                        await session.execute(
                            select(CalendarEventDB).where(
                                CalendarEventDB.source_id.in_(source_ids),
                                CalendarEventDB.origin != "google",
                            )
                        )
                    ).scalars().all()
                )
                for event in ritual_events:
                    event.source_id = ritual_source.id
                    event.provider_event_id = None
                    event.provider_etag = None
                    event.ical_uid = None
                    event.provider_payload_json = "{}"
                    event.sync_state = "local"
                    await session.execute(
                        CalendarOccurrenceDB.__table__.update()
                        .where(CalendarOccurrenceDB.event_id == event.id)
                        .values(source_id=ritual_source.id)
                    )
            await session.delete(account)
            await session.commit()


google_calendar_service = GoogleCalendarService()
