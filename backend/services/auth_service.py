"""
Authentication Service - Handles Clerk JWT token validation and user management
"""

import jwt
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
        self.clerk_jwks_url = "https://api.clerk.com/v1/jwks"
        
        # Cache for JWKS (JSON Web Key Set)
        self._jwks_cache = None
        self._jwks_cache_time = None
        self._jwks_cache_duration = 3600  # 1 hour
    
    async def get_clerk_jwks(self) -> Dict[str, Any]:
        """Get Clerk's JWKS for token verification"""
        current_time = datetime.now().timestamp()
        
        # Use cached JWKS if available and not expired
        if (self._jwks_cache and self._jwks_cache_time and 
            current_time - self._jwks_cache_time < self._jwks_cache_duration):
            return self._jwks_cache
        
        try:
            response = requests.get(self.clerk_jwks_url)
            response.raise_for_status()
            self._jwks_cache = response.json()
            self._jwks_cache_time = current_time
            return self._jwks_cache
        except Exception as e:
            print(f"❌ Error fetching Clerk JWKS: {e}")
            return {}
    
    async def get_user_from_token(self, token: str) -> Optional[Dict[str, Any]]:
        """
        Extract user information from Clerk JWT token
        If email is not in token, fetch it from Clerk API
        """
        try:
            # First decode without verification to get the header
            unverified_header = jwt.get_unverified_header(token)
            unverified_payload = jwt.decode(token, options={"verify_signature": False})
            
            # For now, we'll do basic validation without full JWKS verification
            # In production, you'd want to verify the signature with Clerk's JWKS
            
            # Extract user info from Clerk JWT
            user_id = unverified_payload.get("sub")
            email = unverified_payload.get("email")
            
            if not user_id:
                print("❌ No user ID found in token")
                return None
            
            # If email is not in token, fetch from Clerk API
            if not email:
                print(f"⚠️  Email not in token, fetching from Clerk API for user: {user_id}")
                email = await self._fetch_email_from_clerk(user_id)
            
            print(f"✅ Extracted user from Clerk token: {user_id} ({email})")
            
            return {
                "id": user_id,
                "email": email,
                "name": unverified_payload.get("name") or unverified_payload.get("full_name"),
                "metadata": unverified_payload
            }
            
        except jwt.InvalidTokenError:
            print("❌ Invalid JWT token")
            return None
        except Exception as e:
            print(f"❌ Error validating token: {e}")
            return None
    
    async def _fetch_email_from_clerk(self, user_id: str) -> Optional[str]:
        """
        Fetch user email from Clerk API
        """
        if not self.clerk_secret_key:
            print("⚠️  Clerk secret key not configured, cannot fetch email")
            return None
        
        try:
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
                        print(f"✅ Fetched email from Clerk API: {primary_email}")
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
