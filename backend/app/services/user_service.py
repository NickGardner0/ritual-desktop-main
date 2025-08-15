"""
User service for handling user operations
"""

from typing import Dict, Optional, List, Any
from fastapi import HTTPException, status

from app.models.user import UserCreate, UserUpdate, UserResponse
from app.utils.supabase import get_supabase_client, get_supabase_admin_client


async def get_user_by_id(user_id: str) -> UserResponse:
    """
    Retrieve a user by ID
    """
    supabase = get_supabase_client()
    
    response = supabase.table("users").select("*").eq("id", user_id).execute()
    
    if not response.data or len(response.data) == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User with ID {user_id} not found"
        )
    
    return UserResponse(**response.data[0])


async def get_users(limit: int = 10, offset: int = 0) -> List[UserResponse]:
    """
    Retrieve a list of users with pagination
    """
    supabase = get_supabase_client()
    
    response = supabase.table("users").select("*").range(offset, offset + limit - 1).execute()
    
    if not response.data:
        return []
    
    return [UserResponse(**user) for user in response.data]


async def create_user(user_data: UserCreate) -> UserResponse:
    """
    Create a new user
    """
    supabase = get_supabase_admin_client()
    
    # First create the auth user
    try:
        auth_response = supabase.auth.admin.create_user({
            "email": user_data.email,
            "password": user_data.password,
            "email_confirm": True
        })
        
        if not auth_response.user:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create user in auth system"
            )
        
        # Then create the user profile
        user_profile = {
            "id": auth_response.user.id,
            "email": user_data.email,
            "full_name": user_data.full_name,
        }
        
        profile_response = supabase.table("users").insert(user_profile).execute()
        
        if not profile_response.data or len(profile_response.data) == 0:
            # If profile creation fails, we should clean up the auth user
            supabase.auth.admin.delete_user(auth_response.user.id)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create user profile"
            )
        
        return UserResponse(**profile_response.data[0])
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to create user: {str(e)}"
        )


async def update_user(user_id: str, user_data: UserUpdate) -> UserResponse:
    """
    Update an existing user
    """
    supabase = get_supabase_client()
    
    # First check if the user exists
    await get_user_by_id(user_id)
    
    # Update the user
    update_data = user_data.dict(exclude_unset=True)
    if not update_data:  # If no fields to update
        return await get_user_by_id(user_id)
    
    response = supabase.table("users").update(update_data).eq("id", user_id).execute()
    
    if not response.data or len(response.data) == 0:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update user"
        )
    
    return UserResponse(**response.data[0])


async def delete_user(user_id: str) -> Dict[str, Any]:
    """
    Delete a user
    """
    supabase = get_supabase_admin_client()
    
    # First check if the user exists
    await get_user_by_id(user_id)
    
    # Delete the user from the profile table first
    profile_response = supabase.table("users").delete().eq("id", user_id).execute()
    
    if not profile_response.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete user profile"
        )
    
    # Then delete from auth
    try:
        supabase.auth.admin.delete_user(user_id)
    except Exception as e:
        # If auth deletion fails, we should log this, but the profile is already deleted
        print(f"Failed to delete user from auth: {str(e)}")
    
    return {"message": "User deleted successfully", "id": user_id} 