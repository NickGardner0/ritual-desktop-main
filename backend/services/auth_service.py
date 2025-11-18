"""
Authentication Service - Handles Clerk JWT token validation and user management
"""

import jwt
from jwt import PyJWKClient
import os
import httpx
import requests
from typing import Optional, Dict, Any
from datetime import datetime, timedelta, timezone

class AuthService:
    """Service for handling Clerk authentication"""
    
    def __init__(self):
        # Clerk configuration
        self.clerk_publishable_key = os.getenv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY")
        self.clerk_secret_key = os.getenv("CLERK_SECRET_KEY")
        
        # Email cache to avoid repeated Clerk API calls
        # Format: {user_id: {"email": email, "cached_at": timestamp}}
        self._email_cache: Dict[str, Dict[str, Any]] = {}
        self._email_cache_ttl = 3600  # Cache for 1 hour
        
        # Get Clerk frontend API domain from environment or extract from sign-in URL
        clerk_sign_in_url = os.getenv("NEXT_PUBLIC_CLERK_SIGN_IN_URL", "")
        
        if clerk_sign_in_url:
            # Extract domain from sign-in URL
            # Format: https://{domain}/sign-in
            frontend_domain = clerk_sign_in_url.replace("https://", "").replace("/sign-in", "").split("/")[0]
            self.clerk_jwks_url = f"https://{frontend_domain}/.well-known/jwks.json"
        else:
            # Fallback: try to extract from publishable key or use default
            # For development instances, it's typically: {instance}.clerk.accounts.dev
            # For production: clerk.{your-domain}.com
            if self.clerk_publishable_key and self.clerk_publishable_key.startswith("pk_test_"):
                # Development instance - use a common pattern
                # User should set NEXT_PUBLIC_CLERK_SIGN_IN_URL in .env for accuracy
                print("⚠️  NEXT_PUBLIC_CLERK_SIGN_IN_URL not set, using fallback JWKS URL")
                self.clerk_jwks_url = "https://api.clerk.com/v1/jwks"
            else:
                self.clerk_jwks_url = "https://api.clerk.com/v1/jwks"
        
        print(f"🔑 Clerk JWKS URL: {self.clerk_jwks_url}")
        
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
                options={
                    "verify_signature": True,
                    "verify_exp": True,
                    "verify_iat": True,
                }
            )
            
            # Extract user info from verified Clerk JWT
            user_id = payload.get("sub")
            email = payload.get("email")
            
            if not user_id:
                print("❌ No user ID found in token")
                return None
            
            # If email is not in token, fetch from Clerk API
            if not email:
                # Only log when actually fetching (not from cache)
                # print(f"⚠️  Email not in token, fetching from Clerk API for user: {user_id}")
                email = await self._fetch_email_from_clerk(user_id)
            
            # Reduce verbosity - only log failures, not every successful auth
            # print(f"✅ Verified and extracted user from Clerk token: {user_id} ({email})")
            
            return {
                "id": user_id,
                "email": email,
                "name": payload.get("name") or payload.get("full_name"),
                "metadata": payload
            }
            
        except jwt.ExpiredSignatureError:
            print("❌ Token has expired")
            return None
        except jwt.InvalidTokenError as e:
            print(f"❌ Invalid JWT token: {e}")
            return None
        except Exception as e:
            print(f"❌ Error validating token: {e}")
            import traceback
            traceback.print_exc()
            return None
    
    async def _fetch_email_from_clerk(self, user_id: str) -> Optional[str]:
        """
        Fetch user email from Clerk API with caching
        Cache emails for 1 hour to avoid repeated API calls
        """
        # Check cache first
        cached = self._email_cache.get(user_id)
        if cached:
            cached_at = cached.get("cached_at")
            cache_age = datetime.now(timezone.utc).timestamp() - cached_at
            
            # Return cached email if still fresh
            if cache_age < self._email_cache_ttl:
                email = cached.get("email")
                # Only log cache hits in debug mode (reduce verbosity)
                # print(f"✅ Email retrieved from cache: {email} (cached {int(cache_age)}s ago)")
                return email
            else:
                # Cache expired, remove it
                print(f"🔄 Email cache expired for user {user_id}, refreshing...")
                del self._email_cache[user_id]
        
        if not self.clerk_secret_key:
            print("⚠️  Clerk secret key not configured, cannot fetch email")
            return None
        
        try:
            print(f"🌐 [CLERK API] Fetching email for user: {user_id}")
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"https://api.clerk.com/v1/users/{user_id}",
                    headers={
                        "Authorization": f"Bearer {self.clerk_secret_key}",
                        "Content-Type": "application/json"
                    },
                    timeout=10.0
                )
                
                if response.status_code == 200:
                    user_data = response.json()
                    # Clerk returns email_addresses array
                    email_addresses = user_data.get("email_addresses", [])
                    if email_addresses:
                        # Get the primary email (first verified email, or first one)
                        primary_email = next(
                            (e.get("email_address") for e in email_addresses if e.get("verification", {}).get("status") == "verified"),
                            email_addresses[0].get("email_address")
                        )
                        
                        # Cache the email
                        self._email_cache[user_id] = {
                            "email": primary_email,
                            "cached_at": datetime.now(timezone.utc).timestamp()
                        }
                        
                        print(f"✅ [CLERK API] Email cached: {primary_email} (valid for 1 hour)")
                        return primary_email
                    else:
                        print(f"⚠️  No email addresses found for user {user_id}")
                        return None
                else:
                    print(f"⚠️  Failed to fetch user from Clerk API: {response.status_code}")
                    return None
                    
        except Exception as e:
            print(f"⚠️  Error fetching email from Clerk API: {e}")
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
        try:
            payload = jwt.decode(token, self.jwt_secret, algorithms=["HS256"])
            return payload
        except jwt.InvalidTokenError:
            return None
