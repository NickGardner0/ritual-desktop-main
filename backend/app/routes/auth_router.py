from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from supabase import Client

from app.utils.supabase import get_supabase_client
from app.models.auth import Token # We'll need to create this Pydantic model

router = APIRouter()

@router.post("/token", response_model=Token)
async def login_for_access_token(
    form_data: OAuth2PasswordRequestForm = Depends(), 
    supabase: Client = Depends(get_supabase_client)
):
    try:
        # Authenticate with Supabase using email and password
        response = supabase.auth.sign_in_with_password({
            "email": form_data.username, 
            "password": form_data.password
        })
        
        if not response.session or not response.session.access_token:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Incorrect email or password",
                headers={"WWW-Authenticate": "Bearer"},
            )
        
        return {"access_token": response.session.access_token, "token_type": "bearer"}
    
    except Exception as e:
        # Log the exception e if you have logging setup
        print(f"Error in login_for_access_token: {e}") # Basic logging
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password", # Keep error generic for security
            headers={"WWW-Authenticate": "Bearer"},
        ) 