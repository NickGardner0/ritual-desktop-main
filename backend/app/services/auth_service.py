from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from supabase import Client

from app.utils.supabase import get_supabase_client
from app.models.user import UserResponse # Assuming UserResponse is the Pydantic model for a user
from app.services.user_service import get_user_by_id # To fetch full profile if needed

# This should point to your token generation endpoint (e.g., /api/auth/token or /auth/token)
# Adjust if your token URL is different. If you handle token generation client-side via Supabase SDK
# and only pass JWTs to the backend, this specific URL might be less critical for this function's direct use
# but is standard practice for OAuth2PasswordBearer.
# Let's assume it's /api/auth/token for now, matching a common pattern.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/token")

async def get_current_active_user(token: str = Depends(oauth2_scheme), supabase: Client = Depends(get_supabase_client)) -> UserResponse:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        user_response = supabase.auth.get_user(jwt=token)
        if not user_response or not user_response.user:
            raise credentials_exception
        
        # The user object from supabase.auth.get_user() might be minimal.
        # You might want to fetch the full user profile from your 'users' table.
        # This assumes user_response.user.id exists and is the ID in your 'users' table.
        # If get_user_by_id is not async, remove await
        db_user = await get_user_by_id(user_id=str(user_response.user.id)) 
        if db_user is None:
            # This case might happen if a user exists in Supabase auth but not in your public users table
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, 
                detail="User profile not found in database"
            )
        return db_user
    except Exception as e: # Catch Supabase errors or other issues
        # Log the exception e if you have logging setup
        print(f"Error in get_current_active_user: {e}") # Basic logging
        raise credentials_exception 