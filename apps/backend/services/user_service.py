"""
User Service - Handles user profile and onboarding operations
"""

import json
import logging
import re
from typing import Optional, List
from datetime import datetime, timezone
from types import SimpleNamespace
from sqlalchemy import select, update
from sqlalchemy.exc import SQLAlchemyError
from database.connection import get_db_session
from database.models import UserDB

logger = logging.getLogger(__name__)

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
            sms_welcome_sent_at=row[12],
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

                # Send desktop onboarding copilot welcome SMS (once)
                if (
                    client_surface == "desktop"
                    and normalized_phone_number
                    and not getattr(user, "sms_welcome_sent_at", None)
                ):
                    try:
                        from services.sms_onboarding_service import sms_onboarding_service

                        onboarding_result = await sms_onboarding_service.send_desktop_welcome(
                            user_id=user_id,
                            phone_number=normalized_phone_number,
                            full_name=name,
                        )
                        if onboarding_result.get("sent"):
                            sent_at = datetime.now(timezone.utc)
                            await session.execute(
                                update(UserDB)
                                .where(UserDB.id == user_id)
                                .values(sms_welcome_sent_at=sent_at)
                            )
                            await session.commit()
                            updated_user.sms_welcome_sent_at = sent_at
                            logger.info(
                                "✅ Desktop copilot welcome SMS sent to %s for user %s",
                                normalized_phone_number,
                                user_id,
                            )
                    except Exception as sms_exc:
                        logger.warning(
                            "⚠️ Failed to send desktop copilot welcome SMS for user %s: %s",
                            user_id,
                            sms_exc,
                        )

                logger.info(f"✅ Successfully updated onboarding for user: {user_id}")
                return updated_user
                
            except SQLAlchemyError as e:
                await session.rollback()
                logger.error(f"❌ Database error updating onboarding: {str(e)}")
                raise Exception(f"Failed to update onboarding: {str(e)}")
    
    async def get_user_by_phone(self, phone_number: str) -> Optional[UserDB]:
        """Look up a user by phone number (for Sendblue webhook)"""
        async with get_db_session() as session:
            try:
                normalized_phone = _normalize_phone_number(phone_number)
                candidates = [phone_number]
                if normalized_phone and normalized_phone not in candidates:
                    candidates.append(normalized_phone)

                result = await session.execute(
                    select(*_USER_SAFE_COLUMNS).where(UserDB.phone_number.in_(candidates))
                )
                row = result.first()
                user = self._row_to_user_projection(row) if row else None
                if user:
                    return user

                if not normalized_phone:
                    return None

                result = await session.execute(
                    select(*_USER_SAFE_COLUMNS).where(UserDB.phone_number.is_not(None))
                )
                for row in result.fetchall():
                    candidate = self._row_to_user_projection(row)
                    if _normalize_phone_number(candidate.phone_number) == normalized_phone:
                        return candidate
                return None
            except SQLAlchemyError as e:
                logger.error(f"❌ Database error looking up user by phone: {str(e)}")
                return None

    async def ensure_user_exists(self, user_id: str, email: str, full_name: Optional[str] = None, phone_number: Optional[str] = None) -> UserDB:
        """
        Ensure user exists in database, create if not
        """
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
                
                # Create new user with defaults
                logger.info(f"🆕 Creating new user: {email or user_id}")
                
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
                    phone_number=normalized_phone_number,
                    onboarding_completed=False,
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow()
                )
                session.add(new_user)
                await session.commit()
                
                logger.info(f"✅ Created new user: {email or user_id}")
                return new_user
                
            except SQLAlchemyError as e:
                await session.rollback()
                logger.error(f"❌ Database error ensuring user exists: {str(e)}")
                import traceback
                traceback.print_exc()
                raise Exception(f"Failed to ensure user exists: {str(e)}")
