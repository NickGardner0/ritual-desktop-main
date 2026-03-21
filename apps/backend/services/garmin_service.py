"""
Garmin cloud integration service.

Implements OAuth token exchange and webhook-driven ingestion into canonical
wearable storage. Garmin Health/Activity delivery is typically partner-gated
and webhook/push driven, so the sync path here focuses on authenticated account
setup plus server-side ingestion of Garmin payloads.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta
from typing import Any, Dict, Optional

import httpx

from services.token_crypto import token_crypto
from services.unified_wearables_service import (
    wearable_connection_service,
    wearable_sync_service,
)

logger = logging.getLogger(__name__)


class GarminService:
    TOKEN_URL = os.getenv("GARMIN_TOKEN_URL", "https://api.garmin.com/oauth-service/oauth/token")
    USER_ID_URL = os.getenv("GARMIN_USER_ID_URL", "https://apis.garmin.com/wellness-api/rest/user/id")
    PERMISSIONS_URL = os.getenv(
        "GARMIN_PERMISSIONS_URL",
        "https://apis.garmin.com/wellness-api/rest/permissions",
    )

    def __init__(self) -> None:
        self.client_id = os.getenv("GARMIN_CLIENT_ID")
        self.client_secret = os.getenv("GARMIN_CLIENT_SECRET")
        self.redirect_uri = os.getenv("GARMIN_REDIRECT_URI")

    async def exchange_code_for_token(self, code: str, code_verifier: str) -> Dict[str, Any]:
        if not self.client_id or not self.client_secret or not self.redirect_uri:
            raise ValueError("Garmin OAuth configuration missing")

        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(
                self.TOKEN_URL,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "redirect_uri": self.redirect_uri,
                    "code_verifier": code_verifier,
                },
            )
            response.raise_for_status()
            return response.json()

    async def refresh_access_token(self, user_id: str) -> str:
        connection = await wearable_connection_service.get_connection(user_id, "garmin")
        if not connection or not connection.refresh_token:
            raise ValueError("Garmin refresh token missing")
        refresh_token = token_crypto.decrypt(connection.refresh_token)
        if not refresh_token:
            raise ValueError("Garmin refresh token could not be decrypted")
        if not self.client_id or not self.client_secret:
            raise ValueError("Garmin OAuth configuration missing")

        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(
                self.TOKEN_URL,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                data={
                    "grant_type": "refresh_token",
                    "refresh_token": refresh_token,
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                },
            )
            response.raise_for_status()
            token_data = response.json()

        expires_at = datetime.utcnow() + timedelta(seconds=token_data.get("expires_in", 3600))
        await wearable_connection_service.get_or_create_connection(
            user_id=user_id,
            provider="garmin",
            auth_method="oauth",
            provider_user_id=connection.provider_user_id,
            access_token=token_data["access_token"],
            refresh_token=token_data.get("refresh_token") or refresh_token,
            token_expires_at=expires_at,
            settings={
                "sync_hour": 9,
                "auto_sync_enabled": True,
            },
            status="active",
        )
        return token_data["access_token"]

    async def get_valid_access_token(self, user_id: str) -> str:
        connection = await wearable_connection_service.get_connection(user_id, "garmin")
        if not connection or not connection.access_token:
            raise ValueError("Garmin connection not found")
        access_token = token_crypto.decrypt(connection.access_token)
        if not access_token:
            raise ValueError("Garmin access token could not be decrypted")
        expires_at = connection.token_expires_at
        if expires_at and expires_at < datetime.utcnow() + timedelta(minutes=5):
            return await self.refresh_access_token(user_id)
        return access_token

    async def get_user_id(self, access_token: str) -> Optional[str]:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.get(
                self.USER_ID_URL,
                headers={"Authorization": f"Bearer {access_token}"},
            )
            if response.status_code in {403, 404}:
                return None
            response.raise_for_status()
            payload = response.json()
            return str(payload.get("userId") or payload.get("id")) if payload else None

    async def get_permissions(self, access_token: str) -> Dict[str, Any]:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.get(
                self.PERMISSIONS_URL,
                headers={"Authorization": f"Bearer {access_token}"},
            )
            if response.status_code in {403, 404}:
                return {}
            response.raise_for_status()
            payload = response.json()
            return payload if isinstance(payload, dict) else {}

    async def sync_garmin_account(self, user_id: str) -> Dict[str, Any]:
        access_token = await self.get_valid_access_token(user_id)
        provider_user_id = await self.get_user_id(access_token)
        permissions = await self.get_permissions(access_token)
        connection = await wearable_connection_service.get_connection(user_id, "garmin")

        await wearable_connection_service.get_or_create_connection(
            user_id=user_id,
            provider="garmin",
            auth_method="oauth",
            provider_user_id=provider_user_id or (connection.provider_user_id if connection else None),
            access_token=access_token,
            refresh_token=token_crypto.decrypt(connection.refresh_token) if connection and connection.refresh_token else None,
            token_expires_at=connection.token_expires_at if connection else None,
            settings={"permissions": permissions},
            status="active",
        )

        return {
            "status": "success",
            "synced_at": datetime.utcnow().isoformat(),
            "data": {
                "permissions_loaded": bool(permissions),
                "webhook_driven": True,
            },
        }

    async def ingest_webhook_payload(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        provider_user_id = self.extract_provider_user_id(payload)
        if not provider_user_id:
            raise ValueError("Garmin webhook payload did not include a provider user id")

        user_id = await self.lookup_ritual_user_id(provider_user_id)
        if not user_id:
            raise ValueError("No Ritual Garmin connection found for webhook payload")

        connection = await wearable_connection_service.get_connection(user_id, "garmin")
        counts = await wearable_sync_service.ingest_garmin_payload(
            user_id=user_id,
            provider_user_id=provider_user_id,
            payload=payload,
            access_token=token_crypto.decrypt(connection.access_token) if connection and connection.access_token else None,
            refresh_token=token_crypto.decrypt(connection.refresh_token) if connection and connection.refresh_token else None,
            token_expires_at=connection.token_expires_at if connection else None,
        )
        return {"user_id": user_id, **counts}

    async def lookup_ritual_user_id(self, provider_user_id: str) -> Optional[str]:
        from database.connection import get_db_session
        from database.models import WearableConnectionDB
        from sqlalchemy import select

        async with get_db_session() as session:
            result = await session.execute(
                select(WearableConnectionDB).where(
                    WearableConnectionDB.provider == "garmin",
                    WearableConnectionDB.provider_user_id == provider_user_id,
                )
            )
            connection = result.scalar_one_or_none()
            return connection.user_id if connection else None

    @staticmethod
    def extract_provider_user_id(payload: Dict[str, Any]) -> Optional[str]:
        for key in ("userId", "user_id", "externalUserId", "garminUserId"):
            value = payload.get(key)
            if value:
                return str(value)
        meta = payload.get("meta") or {}
        for key in ("userId", "user_id", "externalUserId", "garminUserId"):
            value = meta.get(key)
            if value:
                return str(value)
        return None


garmin_service = GarminService()
