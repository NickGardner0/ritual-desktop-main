# app/dependencies.py
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from supabase import create_client, Client
from app.utils.supabase import get_supabase_client, get_supabase_admin_client
from app.models.user import Profile
from sqlalchemy.orm import Session
from app.utils.database import get_db  # or however you import your DB session
import requests

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/token")

def debug_get_token(token: str = Depends(oauth2_scheme)):
    """Debug function to see if OAuth2PasswordBearer is working"""
    print(f"🔧 [DEBUG] OAuth2PasswordBearer extracted token: {token[:20] if token and len(token) > 20 else token}")
    
    # Try to decode token to see its claims (without verification)
    try:
        import jwt
        decoded = jwt.decode(token, options={"verify_signature": False})
        print(f"🔧 [DEBUG] Token claims: {list(decoded.keys())}")
        print(f"🔧 [DEBUG] Has 'sub' claim: {'sub' in decoded}")
        if 'sub' in decoded:
            print(f"🔧 [DEBUG] Subject: {decoded['sub']}")
    except Exception as e:
        print(f"🔧 [DEBUG] Could not decode token: {e}")
    
    return token

def get_current_user(
    token: str = Depends(debug_get_token),
    supabase: Client = Depends(get_supabase_client),
    db: Session = Depends(get_db)
) -> Profile:
    try:
        print(f"🔐 [DEBUG] Received token: {token[:20]}..." if len(token) > 20 else token)
        
        # Validate token with Supabase
        user_response = supabase.auth.get_user(token)
        user_data = user_response.user
        
        print(f"🔐 [DEBUG] Supabase response: {user_data is not None}")
        print(f"🔐 [DEBUG] User ID: {user_data.id if user_data else 'None'}")

        if not user_data or not user_data.id:
            print("❌ [DEBUG] Invalid user data from Supabase")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication credentials",
                headers={"WWW-Authenticate": "Bearer"},
            )

        # Fetch from your `profiles` table
        user_id = user_data.id
        user = db.query(Profile).filter(Profile.id == user_id).first()
        
        print(f"🔐 [DEBUG] Profile found in DB: {user is not None}")

        if not user:
            print(f"❌ [DEBUG] User {user_id} not found in profiles table")
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found in profiles table"
            )

        print(f"✅ [DEBUG] Authentication successful for user: {user_id}")
        return user

    except Exception as e:
        print(f"[get_current_user] Auth error: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
