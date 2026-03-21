"""
Provider adapter abstractions for the unified wearable system.
"""

from __future__ import annotations

import base64
import json
import os
import secrets
import hashlib
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Dict, Optional
from urllib.parse import urlencode

from services.unified_wearables_service import PROVIDER_CAPABILITIES


@dataclass
class AuthorizationRequest:
    authorization_url: str
    state: str
    transient_settings: Optional[Dict[str, Any]] = None


class WearableProviderAdapter(ABC):
    provider: str

    @abstractmethod
    def begin_auth(self, user_id: str, redirect_uri: Optional[str] = None) -> AuthorizationRequest:
        raise NotImplementedError

    @abstractmethod
    def supports_oauth(self) -> bool:
        raise NotImplementedError


class AppleHealthAdapter(WearableProviderAdapter):
    provider = "apple_health"

    def begin_auth(self, user_id: str, redirect_uri: Optional[str] = None) -> AuthorizationRequest:
        raise ValueError("Apple Health uses the Ritual iOS companion app and does not support OAuth")

    def supports_oauth(self) -> bool:
        return False


class WhoopAdapter(WearableProviderAdapter):
    provider = "whoop"

    def begin_auth(self, user_id: str, redirect_uri: Optional[str] = None) -> AuthorizationRequest:
        client_id = os.getenv("WHOOP_CLIENT_ID") or os.getenv("NEXT_PUBLIC_WHOOP_CLIENT_ID")
        default_redirect = os.getenv("NEXT_PUBLIC_WHOOP_REDIRECT_URI")
        if not client_id or not (redirect_uri or default_redirect):
            raise ValueError("Whoop OAuth configuration missing")
        state_payload = {"user_id": user_id, "provider": self.provider}
        state = base64.urlsafe_b64encode(json.dumps(state_payload).encode("utf-8")).decode("utf-8")
        params = urlencode(
            {
                "client_id": client_id,
                "redirect_uri": redirect_uri or default_redirect,
                "response_type": "code",
                "scope": "offline read:recovery read:sleep read:workout read:cycles read:profile",
                "state": state,
            }
        )
        return AuthorizationRequest(
            authorization_url=f"https://api.prod.whoop.com/oauth/oauth2/auth?{params}",
            state=state,
        )

    def supports_oauth(self) -> bool:
        return True


class GarminAdapter(WearableProviderAdapter):
    provider = "garmin"

    def begin_auth(self, user_id: str, redirect_uri: Optional[str] = None) -> AuthorizationRequest:
        client_id = os.getenv("GARMIN_CLIENT_ID")
        auth_url = os.getenv("GARMIN_AUTH_URL", "https://connect.garmin.com/oauth2Confirm")
        redirect = redirect_uri or os.getenv("GARMIN_REDIRECT_URI")
        if not client_id or not redirect:
            raise ValueError("Garmin OAuth configuration missing")
        verifier = secrets.token_urlsafe(64)
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("utf-8")).digest()).decode("utf-8").rstrip("=")
        state_payload = {
            "user_id": user_id,
            "provider": self.provider,
            "nonce": secrets.token_urlsafe(24),
        }
        state = base64.urlsafe_b64encode(json.dumps(state_payload).encode("utf-8")).decode("utf-8")
        params = urlencode(
            {
                "response_type": "code",
                "client_id": client_id,
                "redirect_uri": redirect,
                "code_challenge": challenge,
                "code_challenge_method": "S256",
                "state": state,
            }
        )
        return AuthorizationRequest(
            authorization_url=f"{auth_url}?{params}",
            state=state,
            transient_settings={
                "oauth_state": state,
                "pkce_verifier": verifier,
            },
        )

    def supports_oauth(self) -> bool:
        return True


class OuraAdapter(WearableProviderAdapter):
    provider = "oura"

    def begin_auth(self, user_id: str, redirect_uri: Optional[str] = None) -> AuthorizationRequest:
        client_id = os.getenv("OURA_CLIENT_ID")
        redirect = redirect_uri or os.getenv("OURA_REDIRECT_URI")
        auth_url = os.getenv("OURA_AUTH_URL", "https://cloud.ouraring.com/oauth/authorize")
        if not client_id or not redirect:
            raise ValueError("Oura OAuth configuration missing")
        state_payload = {"user_id": user_id, "provider": self.provider}
        state = base64.urlsafe_b64encode(json.dumps(state_payload).encode("utf-8")).decode("utf-8")
        params = urlencode(
            {
                "response_type": "code",
                "client_id": client_id,
                "redirect_uri": redirect,
                "scope": "email personal daily heartrate session workout tag",
                "state": state,
            }
        )
        return AuthorizationRequest(
            authorization_url=f"{auth_url}?{params}",
            state=state,
        )

    def supports_oauth(self) -> bool:
        return True


class FitbitAdapter(WearableProviderAdapter):
    provider = "fitbit"

    def begin_auth(self, user_id: str, redirect_uri: Optional[str] = None) -> AuthorizationRequest:
        raise ValueError("Fitbit is not enabled in this build")

    def supports_oauth(self) -> bool:
        return False


ADAPTERS = {
    "apple_health": AppleHealthAdapter(),
    "whoop": WhoopAdapter(),
    "garmin": GarminAdapter(),
    "oura": OuraAdapter(),
    "fitbit": FitbitAdapter(),
}


def get_provider_adapter(provider: str) -> WearableProviderAdapter:
    adapter = ADAPTERS.get(provider)
    if adapter is None:
        raise ValueError(f"Unsupported provider: {provider}")
    return adapter


def list_provider_defs() -> list[dict[str, Any]]:
    items = []
    for provider, definition in PROVIDER_CAPABILITIES.items():
        items.append(
            {
                "provider": provider,
                "display_name": definition.display_name,
                "auth_method": definition.auth_method,
                "supports_sync": True,
                "supports_webhook": definition.supports_webhook,
                "supports_import_fallback": definition.supports_import_fallback,
                "supports_metric_selection": definition.supports_metric_selection,
                "supports_backfill": definition.supports_backfill,
            }
        )
    return items
