"""
Authentication Service - Handles Clerk JWT token validation and user management
"""

import jwt
from jwt import PyJWKClient
import os
import asyncio
import httpx
import time
import logging
from typing import Optional, Dict, Any
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

class AuthService:
    """Service for handling Clerk authentication"""
    
    def __init__(self):
        # Clerk configuration
        self.clerk_publishable_key = os.getenv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY")
        self.clerk_secret_key = os.getenv("CLERK_SECRET_KEY")
        
        # User info cache to avoid repeated Clerk API calls
        # Format: {user_id: {"email": email, "phone": phone, "cached_at": timestamp}}
        self._user_cache: Dict[str, Dict[str, Any]] = {}
        self._user_cache_ttl = 3600  # Cache for 1 hour
        
        # Prefer an explicit JWKS endpoint so backend auth is decoupled from
        # whichever frontend sign-in route the Next app happens to use.
        self.clerk_jwks_url = (os.getenv("CLERK_JWKS_URL") or "").strip()

        # Backward-compatible fallback for older env files.
        clerk_sign_in_url = os.getenv("NEXT_PUBLIC_CLERK_SIGN_IN_URL", "").strip()

        if self.clerk_jwks_url:
            pass
        elif clerk_sign_in_url:
            frontend_domain = clerk_sign_in_url.replace("https://", "").replace("/sign-in", "").split("/")[0]
            self.clerk_jwks_url = f"https://{frontend_domain}/.well-known/jwks.json"
        else:
            # Fallback: try to extract from publishable key or use default
            # For development instances, it's typically: {instance}.clerk.accounts.dev
            # For production: clerk.{your-domain}.com
            if self.clerk_publishable_key and self.clerk_publishable_key.startswith("pk_test_"):
                logger.warning("CLERK_JWKS_URL not set, using fallback JWKS URL")
                self.clerk_jwks_url = "https://api.clerk.com/v1/jwks"
            else:
                self.clerk_jwks_url = "https://api.clerk.com/v1/jwks"
        
        logger.info("Clerk JWKS URL: %s", self.clerk_jwks_url)

        self.clerk_issuer = (os.getenv("CLERK_ISSUER") or "").strip()
        if not self.clerk_issuer:
            parsed_jwks_url = urlparse(self.clerk_jwks_url)
            if parsed_jwks_url.scheme == "https" and parsed_jwks_url.netloc:
                suffix = "/.well-known/jwks.json"
                if parsed_jwks_url.path.endswith(suffix):
                    issuer_path = parsed_jwks_url.path[: -len(suffix)].rstrip("/")
                    self.clerk_issuer = (
                        f"{parsed_jwks_url.scheme}://{parsed_jwks_url.netloc}{issuer_path}"
                    )

        configured_parties = (os.getenv("CLERK_AUTHORIZED_PARTIES") or "").strip()
        fallback_parties = (os.getenv("CORS_ORIGINS") or "").strip()
        party_source = configured_parties or fallback_parties
        self.authorized_parties = {
            value.strip().rstrip("/")
            for value in party_source.split(",")
            if value.strip()
        }
        self.clerk_audience = (os.getenv("CLERK_AUDIENCE") or "").strip() or None

        if not self.clerk_issuer:
            logger.warning(
                "CLERK_ISSUER is not configured and could not be inferred from CLERK_JWKS_URL"
            )
        if not self.authorized_parties:
            logger.warning(
                "CLERK_AUTHORIZED_PARTIES is not configured; Clerk azp validation is disabled"
            )
        
        # Initialize PyJWKClient for automatic JWKS fetching and caching
        self.jwks_client = PyJWKClient(
            self.clerk_jwks_url,
            cache_keys=True,
            max_cached_keys=16,
            cache_jwk_set=True,
            lifespan=3600  # Cache for 1 hour
        )
    
    def get_clerk_jwks_url(self) -> str:
        """Get Clerk's JWKS URL for the current environment"""
        return self.clerk_jwks_url
    
    async def get_user_from_token(self, token: str) -> Optional[Dict[str, Any]]:
        """
        Extract user information from Clerk JWT token with proper signature verification
        If email is not in token, fetch it from Clerk API
        """
        try:
            # Get the signing key from JWKS (PyJWKClient handles caching)
            signing_key = self.jwks_client.get_signing_key_from_jwt(token)
            
            # Verify and decode the token with signature verification
            payload = jwt.decode(
                token,
                signing_key.key,
                algorithms=["RS256"],
                issuer=self.clerk_issuer or None,
                audience=self.clerk_audience,
                options={
                    "verify_signature": True,
                    "verify_exp": True,
                    "verify_iat": True,
                    "verify_nbf": True,
                    "verify_iss": bool(self.clerk_issuer),
                    "verify_aud": bool(self.clerk_audience),
                    "require": ["exp", "iat", "sub"],
                }
            )
            
            # Extract user info from verified Clerk JWT
            user_id = payload.get("sub")
            email = payload.get("email")
            
            if not user_id:
                logger.error("No user ID found in token")
                return None

            authorized_party = str(payload.get("azp") or "").strip().rstrip("/")
            if (
                authorized_party
                and self.authorized_parties
                and authorized_party not in self.authorized_parties
            ):
                logger.warning("Rejected Clerk token from an unauthorized party")
                return None

            if payload.get("sts") == "pending":
                logger.warning("Rejected Clerk session whose status is pending")
                return None
            
            # If email is not in token, fetch from Clerk API
            phone = None
            if not email:
                user_info = await self._fetch_user_info_from_clerk(user_id)
                email = user_info.get("email") if user_info else None
                phone = user_info.get("phone") if user_info else None
            else:
                # Even if we have email, try to get phone from cache or Clerk
                # Evict expired entries when cache grows too large
                if len(self._user_cache) > 100:
                    now = time.time()
                    expired_keys = [k for k, v in self._user_cache.items() if now - v.get("cached_at", 0) > self._user_cache_ttl]
                    for k in expired_keys:
                        del self._user_cache[k]
                cached = self._user_cache.get(user_id)
                if cached and (datetime.now(timezone.utc).timestamp() - cached["cached_at"]) < self._user_cache_ttl:
                    phone = cached.get("phone")
                else:
                    user_info = await self._fetch_user_info_from_clerk(user_id)
                    phone = user_info.get("phone") if user_info else None

            return {
                "id": user_id,
                "email": email,
                "phone": phone,
                "name": payload.get("name") or payload.get("full_name"),
                "metadata": payload
            }
            
        except jwt.ExpiredSignatureError:
            logger.warning("Token has expired")
            return None
        except jwt.InvalidTokenError as e:
            logger.warning("Invalid JWT token: %s", e)
            return None
        except Exception as e:
            logger.exception("Error validating token")
            return None
    
    async def _fetch_user_info_from_clerk(self, user_id: str) -> Optional[Dict[str, Any]]:
        """
        Fetch user email and phone from Clerk API with caching.
        Returns dict with 'email' and 'phone' keys.
        """
        # Check cache first
        cached = self._user_cache.get(user_id)
        if cached:
            cached_at = cached.get("cached_at")
            cache_age = datetime.now(timezone.utc).timestamp() - cached_at

            if cache_age < self._user_cache_ttl:
                return cached
            else:
                logger.info("User cache expired for user %s, refreshing", user_id)
                del self._user_cache[user_id]

        if not self.clerk_secret_key:
            logger.warning("Clerk secret key not configured, cannot fetch user info")
            return None

        try:
            logger.info("[CLERK API] Fetching user info for: %s", user_id)
            retries = 3
            response = None
            async with httpx.AsyncClient(timeout=10.0) as client:
                for attempt in range(1, retries + 1):
                    response = await client.get(
                        f"https://api.clerk.com/v1/users/{user_id}",
                        headers={
                            "Authorization": f"Bearer {self.clerk_secret_key}",
                            "Content-Type": "application/json"
                        },
                    )
                    if response.status_code not in (408, 429, 500, 502, 503, 504):
                        break
                    if attempt < retries:
                        await asyncio.sleep(0.5 * (2 ** (attempt - 1)))
                        continue
                    break

                if response.status_code == 200:
                    user_data = response.json()

                    # Extract primary email
                    primary_email = None
                    email_addresses = user_data.get("email_addresses", [])
                    if email_addresses:
                        primary_email = next(
                            (e.get("email_address") for e in email_addresses if e.get("verification", {}).get("status") == "verified"),
                            email_addresses[0].get("email_address")
                        )

                    # Extract primary phone number
                    primary_phone = None
                    phone_numbers = user_data.get("phone_numbers", [])
                    if phone_numbers:
                        primary_phone = next(
                            (p.get("phone_number") for p in phone_numbers if p.get("verification", {}).get("status") == "verified"),
                            phone_numbers[0].get("phone_number")
                        )

                    # Cache both
                    self._user_cache[user_id] = {
                        "email": primary_email,
                        "phone": primary_phone,
                        "cached_at": datetime.now(timezone.utc).timestamp()
                    }

                    logger.info("[CLERK API] User info cached for %s (valid for 1 hour)", user_id)
                    return self._user_cache[user_id]
                else:
                    logger.warning("Failed to fetch user from Clerk API: %s", response.status_code)
                    return None

        except Exception as e:
            logger.warning("Error fetching user info from Clerk API: %s", e)
            return None
    
    def extract_token_from_header(self, authorization_header: str) -> Optional[str]:
        """
        Extract JWT token from Authorization header
        """
        if not authorization_header:
            return None
            
        # Expected format: "Bearer <token>"
        parts = authorization_header.split(" ")
        if len(parts) != 2 or parts[0].lower() != "bearer":
            return None
            
        return parts[1]
    
    def create_custom_token(self, user_data: Dict[str, Any]) -> str:
        """
        Create a custom JWT token (for future use when migrating away from Supabase)
        """
        if not hasattr(self, 'jwt_secret') or not self.jwt_secret:
            raise NotImplementedError("JWT secret not configured")
        payload = {
            "sub": user_data["id"],
            "email": user_data["email"],
            "full_name": user_data.get("full_name"),
            "iat": datetime.utcnow(),
            "exp": datetime.utcnow() + timedelta(hours=24)
        }

        return jwt.encode(payload, self.jwt_secret, algorithm="HS256")

    def verify_custom_token(self, token: str) -> Optional[Dict[str, Any]]:
        """
        Verify a custom JWT token (for future use)
        """
        if not hasattr(self, 'jwt_secret') or not self.jwt_secret:
            raise NotImplementedError("JWT secret not configured")
        try:
            payload = jwt.decode(token, self.jwt_secret, algorithms=["HS256"])
            return payload
        except jwt.InvalidTokenError:
            return None
