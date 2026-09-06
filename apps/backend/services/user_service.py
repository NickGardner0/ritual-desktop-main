"""
User Service - Handles user profile and onboarding operations
"""

import json
import logging
import re
from typing import Optional, List
from datetime import datetime
from types import SimpleNamespace
from sqlalchemy import func, select, update
from sqlalchemy.exc import SQLAlchemyError
from database.connection import get_db_session
from database.models import UserActivationStateDB, UserDB

logger = logging.getLogger(__name__)


class AccountIdentityConflictError(RuntimeError):
    """A Clerk id changed while the email is still owned by an older Ritual row."""

    def __init__(self, *, email: str, existing_user_id: str, requested_user_id: str):
        super().__init__("This email is still attached to a previous Ritual account.")
        self.email = email
        self.existing_user_id = existing_user_id
        self.requested_user_id = requested_user_id


_USER_SAFE_COLUMNS = (
    UserDB.id,
    UserDB.email,
    UserDB.full_name,
    UserDB.phone_number,
    UserDB.age_bracket,
    UserDB.gender,
    UserDB.country,
    UserDB.tracking_interests,
    UserDB.wearable_devices,
    UserDB.onboarding_completed,
    UserDB.created_at,
    UserDB.updated_at,
    UserDB.timezone,
    UserDB.sms_welcome_sent_at,
)


def _normalize_phone_number(phone_number: Optional[str]) -> Optional[str]:
    """
    Normalize phone numbers into a stable comparable format.

    Clerk tends to provide E.164 values, but webhook providers and manual inputs
    can include spaces, parentheses, or dashes. Normalize common US inputs so
    backend lookups remain stable.
    """
    if not phone_number:
        return None

    value = phone_number.strip()
    if not value:
        return None

    digits = re.sub(r"\D", "", value)
    if not digits:
        return value

    if value.startswith("+"):
        return f"+{digits}"
    if len(digits) == 11 and digits.startswith("1"):
        return f"+{digits}"
    if len(digits) == 10:
        return f"+1{digits}"
    return digits

class UserService:
    """Service class for user operations"""

    @staticmethod
    def _row_to_user_projection(row) -> SimpleNamespace:
        return SimpleNamespace(
            id=row[0],
            email=row[1],
            full_name=row[2],
            phone_number=row[3],
            age_bracket=row[4],
            gender=row[5],
            country=row[6],
            tracking_interests=row[7],
            wearable_devices=row[8],
            onboarding_completed=row[9],
            created_at=row[10],
            updated_at=row[11],
            timezone=row[12],
            sms_welcome_sent_at=row[13],
        )
    
    async def get_user_profile(self, user_id: str) -> Optional[UserDB]:
        """
        Get user profile by ID
        """
        async with get_db_session() as session:
            try:
                result = await session.execute(
                    select(*_USER_SAFE_COLUMNS).where(UserDB.id == user_id)
                )
                row = result.first()
                user = self._row_to_user_projection(row) if row else None
                return user
            except SQLAlchemyError as e:
                logger.error(f"❌ Database error getting user profile: {str(e)}")
                raise Exception(f"Failed to get user profile: {str(e)}")
    
    async def update_onboarding(
        self,
        user_id: str,
        name: str,
        age_bracket: str,
        gender: str,
        country: str,
        tracking_interests: List[str],
        wearable_devices: List[str],
        phone_number: Optional[str] = None,
        client_surface: str = "web",
    ) -> UserDB:
        """
        Update user profile with onboarding data
        """
        async with get_db_session() as session:
            try:
                # Check if user exists
                result = await session.execute(
                    select(*_USER_SAFE_COLUMNS).where(UserDB.id == user_id)
                )
                row = result.first()
                user = self._row_to_user_projection(row) if row else None
                
                if not user:
                    logger.error(f"❌ User not found: {user_id}")
                    raise Exception(f"User not found with ID: {user_id}")

                normalized_phone_number = _normalize_phone_number(phone_number)
                
                # Update user profile
                values = dict(
                    full_name=name,
                    age_bracket=age_bracket,
                    gender=gender,
                    country=country,
                    tracking_interests=json.dumps(tracking_interests),
                    wearable_devices=json.dumps(wearable_devices),
                    onboarding_completed=True,
                )
                if normalized_phone_number:
                    values["phone_number"] = normalized_phone_number
                await session.execute(
                    update(UserDB)
                    .where(UserDB.id == user_id)
                    .values(**values)
                )
                
                await session.commit()

                # Fetch updated user
                result = await session.execute(
                    select(*_USER_SAFE_COLUMNS).where(UserDB.id == user_id)
                )
                row = result.first()
                updated_user = self._row_to_user_projection(row) if row else None
                if updated_user is None:
                    raise Exception(f"User not found with ID: {user_id}")

                logger.info(f"✅ Successfully updated onboarding for user: {user_id}")
                return updated_user
                
            except SQLAlchemyError as e:
                await session.rollback()
                logger.error(f"❌ Database error updating onboarding: {str(e)}")
                raise Exception(f"Failed to update onboarding: {str(e)}")
    
    async def ensure_user_exists(
        self,
        user_id: str,
        email: str,
        full_name: Optional[str] = None,
        phone_number: Optional[str] = None,
        *,
        send_welcome_sms: bool = True,
    ) -> UserDB:
        """
        Ensure user exists in database, create if not
        """
        del send_welcome_sms
        normalized_phone_number = _normalize_phone_number(phone_number)
        async with get_db_session() as session:
            try:
                # Check if user exists
                result = await session.execute(
                    select(*_USER_SAFE_COLUMNS).where(UserDB.id == user_id)
                )
                row = result.first()
                user = self._row_to_user_projection(row) if row else None
                
                if user:
                    setattr(user, "_ritual_created", False)
                    # Update email if it's the fallback format and we have a real email
                    updates = {}
                    if email and email != user.email and user.email.endswith("@clerk.user"):
                        updates["email"] = email
                    # Sync phone number from Clerk if we have one and it differs
                    if normalized_phone_number and normalized_phone_number != user.phone_number:
                        updates["phone_number"] = normalized_phone_number
                    if updates:
                        updates["updated_at"] = datetime.utcnow()
                        logger.info(f"🔄 Updating user fields: {list(updates.keys())}")
                        await session.execute(
                            update(UserDB)
                            .where(UserDB.id == user_id)
                            .values(**updates)
                        )
                        await session.commit()
                        for key, value in updates.items():
                            setattr(user, key, value)

                    logger.info(f"✅ User already exists: {user.email}")
                    return user

                if email:
                    existing_email_result = await session.execute(
                        select(UserDB.id).where(
                            func.lower(UserDB.email) == email.strip().lower()
                        )
                    )
                    existing_user_id = existing_email_result.scalar_one_or_none()
                    if existing_user_id and existing_user_id != user_id:
                        raise AccountIdentityConflictError(
                            email=email,
                            existing_user_id=existing_user_id,
                            requested_user_id=user_id,
                        )
                
                # Create new user with defaults
                logger.info(f"🆕 Creating new user: {email or user_id}")
                
                # Handle case where email might be None
                default_name = full_name
                if not default_name and email:
                    default_name = email.split('@')[0]
                elif not default_name:
                    default_name = f"User_{user_id[:8]}"
                
                now = datetime.utcnow()
                new_user = UserDB(
                    id=user_id,
                    email=email or f"{user_id}@clerk.user",  # Fallback email if not provided
                    full_name=default_name,
                    phone_number=normalized_phone_number,
                    onboarding_completed=False,
                    created_at=now,
                    updated_at=now,
                )
                initial_activation_state = UserActivationStateDB(
                    user_id=user_id,
                    created_at=now,
                    updated_at=now,
                )
                session.add(new_user)
                session.add(initial_activation_state)
                await session.commit()

                setattr(new_user, "_ritual_created", True)
                setattr(
                    new_user,
                    "_ritual_initial_activation_state",
                    initial_activation_state,
                )

                logger.info(f"✅ Created new user: {email or user_id}")
                return new_user
                
            except SQLAlchemyError as e:
                await session.rollback()
                logger.error(f"❌ Database error ensuring user exists: {str(e)}")
                import traceback
                traceback.print_exc()
                raise Exception(f"Failed to ensure user exists: {str(e)}")
