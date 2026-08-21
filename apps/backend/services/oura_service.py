"""
Oura cloud integration service.

Implements OAuth token exchange, token refresh, and normalized sync into the
canonical wearable storage layer.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

import httpx

from services.token_crypto import token_crypto
from services.wearables_unified import (
    wearable_connection_service,
)
from services import oura_sync_payload

logger = logging.getLogger(__name__)


class OuraService:
    OAUTH_BASE = "https://api.ouraring.com"
    TOKEN_URL = f"{OAUTH_BASE}/oauth/token"
    API_BASE = f"{OAUTH_BASE}/v2/usercollection"

    def __init__(self) -> None:
        self.client_id = os.getenv("OURA_CLIENT_ID")
        self.client_secret = os.getenv("OURA_CLIENT_SECRET")
        self.redirect_uri = os.getenv("OURA_REDIRECT_URI")

    async def exchange_code_for_token(self, code: str) -> Dict[str, Any]:
        if not self.client_id or not self.client_secret or not self.redirect_uri:
            raise ValueError("Oura OAuth configuration missing")

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
                },
            )
            response.raise_for_status()
            return response.json()

    async def refresh_access_token(self, user_id: str) -> str:
        connection = await wearable_connection_service.get_connection(user_id, "oura")
        if not connection or not connection.refresh_token:
            raise ValueError("Oura refresh token missing")
        refresh_token = token_crypto.decrypt(connection.refresh_token)
        if not refresh_token:
            raise ValueError("Oura refresh token could not be decrypted")
        if not self.client_id or not self.client_secret:
            raise ValueError("Oura OAuth configuration missing")

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
            provider="oura",
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
        connection = await wearable_connection_service.get_connection(user_id, "oura")
        if not connection or not connection.access_token:
            raise ValueError("Oura connection not found")

        access_token = token_crypto.decrypt(connection.access_token)
        if not access_token:
            raise ValueError("Oura access token could not be decrypted")

        expires_at = connection.token_expires_at
        if expires_at and expires_at < datetime.utcnow() + timedelta(minutes=5):
            return await self.refresh_access_token(user_id)
        return access_token

    async def get_personal_info(self, access_token: str) -> Dict[str, Any]:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.get(
                f"{self.API_BASE}/personal_info",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            response.raise_for_status()
            return response.json().get("data", {})

    async def fetch_oura_sync_payload(
        self,
        user_id: str,
        *,
        days_back: Optional[int] = None,
        force_full_sync: bool = False,
    ) -> Dict[str, Any]:
        return await oura_sync_payload.fetch_oura_sync_payload(
            self,
            user_id,
            days_back=days_back,
            force_full_sync=force_full_sync,
        )

    async def write_oura_sync_payload(
        self,
        user_id: str,
        payload: Dict[str, Any],
    ) -> Dict[str, Any]:
        return await oura_sync_payload.write_oura_sync_payload(user_id, payload)

    async def sync_oura_data(
        self,
        user_id: str,
        *,
        days_back: Optional[int] = None,
        force_full_sync: bool = False,
    ) -> Dict[str, Any]:
        payload = await self.fetch_oura_sync_payload(
            user_id,
            days_back=days_back,
            force_full_sync=force_full_sync,
        )
        counts = await self.write_oura_sync_payload(user_id, payload)
        start_date = payload["start_date"]
        end_date = payload["end_date"]

        return {
            "status": "success",
            "synced_at": datetime.utcnow().isoformat(),
            "sync_period": {
                "start_date": start_date.isoformat(),
                "end_date": end_date.isoformat(),
                "days": (end_date - start_date).days,
            },
            "data": counts,
        }

    async def _fetch_collection(
        self,
        client: httpx.AsyncClient,
        access_token: str,
        collection: str,
        start_date: str,
        end_date: str,
        *,
        swallow_404: bool = False,
    ) -> List[Dict[str, Any]]:
        results: List[Dict[str, Any]] = []
        next_token: Optional[str] = None

        while True:
            params: Dict[str, Any] = {
                "start_date": start_date,
                "end_date": end_date,
            }
            if next_token:
                params["next_token"] = next_token

            response = await client.get(
                f"{self.API_BASE}/{collection}",
                params=params,
                headers={"Authorization": f"Bearer {access_token}"},
            )
            if swallow_404 and response.status_code == 404:
                return []
            if response.status_code in {403, 404}:
                logger.info("Oura collection %s unavailable for current scope/token (%s)", collection, response.status_code)
                return results
            response.raise_for_status()
            payload = response.json()
            page_data = payload.get("data", [])
            if isinstance(page_data, list):
                results.extend(page_data)
            next_token = payload.get("next_token")
            if not next_token:
                break

        return results


oura_service = OuraService()
