"""
User Service - Handles user profile and onboarding operations
"""

import json
from typing import Optional, List
from datetime import datetime
from sqlalchemy import select, update
from sqlalchemy.exc import SQLAlchemyError
from database.connection import get_db_session
from database.models import UserDB

class UserService:
    """Service class for user operations"""
    
    async def get_user_profile(self, user_id: str) -> Optional[UserDB]:
        """
        Get user profile by ID
        """
        async with get_db_session() as session:
            try:
                result = await session.execute(
                    select(UserDB).where(UserDB.id == user_id)
                )
                user = result.scalar_one_or_none()
                return user
            except SQLAlchemyError as e:
                print(f"❌ Database error getting user profile: {str(e)}")
                raise Exception(f"Failed to get user profile: {str(e)}")
    
    async def update_onboarding(
        self, 
        user_id: str, 
        name: str,
        age_bracket: str,
        gender: str,
        country: str,
        tracking_interests: List[str],
        wearable_devices: List[str]
    ) -> UserDB:
        """
        Update user profile with onboarding data
        """
        async with get_db_session() as session:
            try:
                # Check if user exists
                result = await session.execute(
                    select(UserDB).where(UserDB.id == user_id)
                )
                user = result.scalar_one_or_none()
                
                if not user:
                    print(f"❌ User not found: {user_id}")
                    raise Exception(f"User not found with ID: {user_id}")
                
                # Update user profile
                await session.execute(
                    update(UserDB)
                    .where(UserDB.id == user_id)
                    .values(
                        full_name=name,
                        age_bracket=age_bracket,
                        gender=gender,
                        country=country,
                        tracking_interests=json.dumps(tracking_interests),  # Store as JSON string
                        wearable_devices=json.dumps(wearable_devices),  # Store as JSON string
                        onboarding_completed=True
                    )
                )
                
                await session.commit()
                
                # Fetch updated user
                result = await session.execute(
                    select(UserDB).where(UserDB.id == user_id)
                )
                updated_user = result.scalar_one()
                
                print(f"✅ Successfully updated onboarding for user: {user_id}")
                return updated_user
                
            except SQLAlchemyError as e:
                await session.rollback()
                print(f"❌ Database error updating onboarding: {str(e)}")
                raise Exception(f"Failed to update onboarding: {str(e)}")
    
    async def ensure_user_exists(self, user_id: str, email: str, full_name: Optional[str] = None) -> UserDB:
        """
        Ensure user exists in database, create if not
        """
        async with get_db_session() as session:
            try:
                # Check if user exists
                result = await session.execute(
                    select(UserDB).where(UserDB.id == user_id)
                )
                user = result.scalar_one_or_none()
                
                if user:
                    # Update email if it's the fallback format and we have a real email
                    if email and email != user.email and user.email.endswith("@clerk.user"):
                        print(f"🔄 Updating email from fallback to: {email}")
                        await session.execute(
                            update(UserDB)
                            .where(UserDB.id == user_id)
                            .values(email=email, updated_at=datetime.utcnow())
                        )
                        await session.commit()
                        await session.refresh(user)
                    print(f"✅ User already exists: {user.email}")
                    return user
                
                # Create new user with defaults
                print(f"🆕 Creating new user: {email or user_id}")
                
                # Handle case where email might be None
                default_name = full_name
                if not default_name and email:
                    default_name = email.split('@')[0]
                elif not default_name:
                    default_name = f"User_{user_id[:8]}"
                
                new_user = UserDB(
                    id=user_id,
                    email=email or f"{user_id}@clerk.user",  # Fallback email if not provided
                    full_name=default_name,
                    onboarding_completed=False,
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow()
                )
                session.add(new_user)
                await session.commit()
                
                print(f"✅ Created new user: {email or user_id}")
                return new_user
                
            except SQLAlchemyError as e:
                await session.rollback()
                print(f"❌ Database error ensuring user exists: {str(e)}")
                import traceback
                traceback.print_exc()
                raise Exception(f"Failed to ensure user exists: {str(e)}")

