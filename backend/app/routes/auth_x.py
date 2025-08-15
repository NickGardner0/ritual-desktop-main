import os
import secrets
import hashlib
import base64
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import RedirectResponse, Response, JSONResponse
from starlette.requests import Request

# Load environment variables
# Ensure your .env file has X_OAUTH2_CLIENT_ID and X_CALLBACK_URL
# X_OAUTH2_CLIENT_SECRET will be used in the callback route
CLIENT_ID = os.getenv("X_OAUTH2_CLIENT_ID")
# It's good practice to define the callback URL in one place
# Ensure this matches EXACTLY what's in your X Dev Portal app settings
CALLBACK_URL = "http://localhost:3000/api/auth/callback/twitter" 
# Define the scopes your application needs
SCOPES = ["users.read", "tweet.read", "offline.access"]

router = APIRouter(
    prefix="/api/auth/x",
    tags=["Authentication with X/Twitter"],
)

@router.get("/login", summary="Initiate OAuth 2.0 login with X/Twitter")
async def login_with_x(response: Response):
    if not CLIENT_ID:
        raise HTTPException(status_code=500, detail="X_OAUTH2_CLIENT_ID not configured")

    # 1. Generate code_verifier
    code_verifier = secrets.token_urlsafe(64) # Create a high-entropy cryptographic random string

    # 2. Generate code_challenge
    hashed_code_verifier = hashlib.sha256(code_verifier.encode('utf-8')).digest()
    code_challenge = base64.urlsafe_b64encode(hashed_code_verifier).decode('utf-8').rstrip('=')
    code_challenge_method = "S256"

    # 3. Generate state
    state = secrets.token_urlsafe(32)

    # 4. Store code_verifier and state. For simplicity in this example, we'll use an HttpOnly cookie for code_verifier.
    # State will be passed through X and verified on callback.
    # In a production app, consider more robust session management if you need to store more server-side.
    response.set_cookie(
        key="x_oauth_code_verifier",
        value=code_verifier,
        httponly=True,
        max_age=300,  # 5 minutes, should be enough for the auth flow
        samesite="lax", # Lax is generally fine for OAuth redirects
        # secure=True, # Uncomment in production when using HTTPS
    )
    # We also store state in a cookie to verify on callback
    response.set_cookie(
        key="x_oauth_state",
        value=state,
        httponly=True,
        max_age=300,
        samesite="lax",
        # secure=True, # Uncomment in production
    )
    
    # 5. Construct the X Authorization URL
    auth_url_params = {
        "response_type": "code",
        "client_id": CLIENT_ID,
        "redirect_uri": CALLBACK_URL,
        "scope": " ".join(SCOPES), # Scopes are space-separated
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": code_challenge_method,
    }
    authorization_url = f"https://x.com/i/oauth2/authorize?{urlencode(auth_url_params)}"

    # 6. Redirect the user
    return RedirectResponse(url=authorization_url)

# Callback route to handle the redirect from X/Twitter
@router.get("/callback", summary="Handle callback from X/Twitter OAuth")
async def x_oauth_callback(request: Request, code: str | None = None, error: str | None = None, state: str | None = None):
    # Retrieve state and code_verifier from cookies
    stored_state = request.cookies.get("x_oauth_state")
    code_verifier = request.cookies.get("x_oauth_code_verifier")

    # 1. Handle errors from X/Twitter or missing parameters
    if error:
        raise HTTPException(status_code=400, detail=f"Error from X/Twitter: {error}")
    if not code:
        raise HTTPException(status_code=400, detail="Missing authorization code from X/Twitter")
    if not state:
        raise HTTPException(status_code=400, detail="Missing state from X/Twitter")
    if not stored_state:
        raise HTTPException(status_code=400, detail="OAuth state cookie not found. Please try logging in again.")
    if not code_verifier:
        raise HTTPException(status_code=400, detail="OAuth code_verifier cookie not found. Please try logging in again.")

    # 2. Validate state parameter to prevent CSRF attacks
    if state != stored_state:
        raise HTTPException(status_code=400, detail="Invalid OAuth state. CSRF attack suspected.")

    # 3. Exchange authorization code for an access token
    token_url = "https://api.x.com/2/oauth2/token"
    CLIENT_SECRET = os.getenv("X_OAUTH2_CLIENT_SECRET")
    if not CLIENT_SECRET:
        raise HTTPException(status_code=500, detail="X_OAUTH2_CLIENT_SECRET not configured on server.")

    payload = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": CALLBACK_URL,
        "code_verifier": code_verifier,
    }

    # For confidential clients, client_id and client_secret are sent via Basic Auth header
    # For public clients, client_id is in the body and no client_secret is used.
    # Your app is a "Web App" (confidential client), so we use Basic Auth.
    auth_header_val = f"{CLIENT_ID}:{CLIENT_SECRET}"
    auth_header_b64 = base64.b64encode(auth_header_val.encode('utf-8')).decode('utf-8')
    headers = {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": f"Basic {auth_header_b64}"
    }

    async with httpx.AsyncClient() as client:
        try:
            token_response = await client.post(token_url, data=payload, headers=headers)
            token_response.raise_for_status()  # Raise an exception for bad status codes (4xx or 5xx)
            token_data = token_response.json()
        except httpx.HTTPStatusError as e:
            # Log the actual error from X for debugging
            error_detail = e.response.json() if e.response else str(e)
            print(f"Error exchanging code for token: {error_detail}")
            raise HTTPException(status_code=500, detail=f"Could not exchange code for token: {error_detail}")
        except Exception as e:
            print(f"Unexpected error during token exchange: {e}")
            raise HTTPException(status_code=500, detail=f"An unexpected error occurred: {str(e)}")

    access_token = token_data.get("access_token")
    refresh_token = token_data.get("refresh_token") # Will be present if 'offline.access' scope was granted
    expires_in = token_data.get("expires_in")
    # token_type = token_data.get("token_type") # Usually "bearer"
    # scope = token_data.get("scope") # Granted scopes

    if not access_token:
        raise HTTPException(status_code=500, detail="Failed to obtain access token from X/Twitter.")

    # 4. Fetch user profile from X/Twitter
    user_profile_url = "https://api.x.com/2/users/me"
    # Specify the fields you want. `profile_image_url` and `created_at` are good additions.
    user_fields = "id,name,username,created_at,description,profile_image_url"
    headers_user_info = {
        "Authorization": f"Bearer {access_token}"
    }
    x_user_profile_data = None
    async with httpx.AsyncClient() as client:
        try:
            profile_response = await client.get(f"{user_profile_url}?user.fields={user_fields}", headers=headers_user_info)
            profile_response.raise_for_status()
            x_user_profile_data = profile_response.json().get("data")
        except httpx.HTTPStatusError as e:
            error_detail = e.response.json() if e.response else str(e)
            print(f"Error fetching X user profile: {error_detail}")
            # Decide if this is fatal. For login, it likely is.
            raise HTTPException(status_code=500, detail=f"Could not fetch X user profile: {error_detail}")
        except Exception as e:
            print(f"Unexpected error fetching X user profile: {e}")
            raise HTTPException(status_code=500, detail=f"An unexpected error occurred while fetching X profile: {str(e)}")

    if not x_user_profile_data:
        raise HTTPException(status_code=500, detail="Failed to obtain user profile data from X/Twitter.")

    # (Next Steps) Integrate with Supabase: Find/Create Supabase user, create Supabase session.
    # For now, return X profile data for testing.
    
    # Clear the state and code_verifier cookies as they are single-use
    # We need to construct a proper Response object to set cookies and return content.
    # For now, let's use a JSONResponse if we want to return JSON data easily.
    
    response_content = {
        "message": "X/Twitter login successful (for testing - profile fetched).",
        "x_user_profile": x_user_profile_data,
        "x_access_token": access_token, # Consider not sending this to client in prod before session established
        "x_refresh_token": refresh_token # Definitely don't send this to client in prod usually
    }
    
    final_response = JSONResponse(content=response_content)
    final_response.delete_cookie("x_oauth_state")
    final_response.delete_cookie("x_oauth_code_verifier")
    
    # Here you would typically redirect to a frontend page AFTER establishing a Supabase session.
    # e.g., return RedirectResponse(url="/dashboard?supabase_session_token=...")
    # Or the frontend would poll or be redirected by Supabase itself if using client-side Supabase OAuth.
    return final_response 