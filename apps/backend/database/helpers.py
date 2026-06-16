"""
Database helper functions
Simplifies common operations and reduces code duplication
"""

import json
from typing import List, Optional
from database.models import UserDB, HabitDB, HabitLogDB
from models.habit_models import Habit, HabitLog
from models.user_models import UserProfile


def parse_json_field(value: Optional[str], default=None) -> any:
    """
    Safely parse JSON string field
    Returns default value if parsing fails or value is None
    """
    if not value:
        return default if default is not None else []
    
    try:
        return json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return default if default is not None else []


def user_db_to_profile(user: UserDB) -> UserProfile:
    """
    Convert UserDB model to UserProfile Pydantic model
    Handles JSON parsing automatically
    """
    return UserProfile(
        id=user.id,
        email=user.email,
        full_name=user.full_name or "",
        phone_number=user.phone_number,
        timezone=user.timezone,
        age_bracket=user.age_bracket,
        gender=user.gender,
        country=user.country,
        tracking_interests=parse_json_field(user.tracking_interests),
        wearable_devices=parse_json_field(user.wearable_devices),
        onboarding_completed=bool(user.onboarding_completed),
        created_at=user.created_at,
        updated_at=user.updated_at
    )


def habit_db_to_pydantic(habit: HabitDB) -> Habit:
    """Convert HabitDB model to Habit Pydantic model"""
    return Habit(
        id=habit.id,
        user_id=habit.user_id,
        name=habit.name,
        category=habit.category,
        icon=habit.icon,
        is_custom=habit.is_custom,
        integration_source=habit.integration_source,
        unit_type=habit.unit_type,
        sensor_type=habit.sensor_type,
        metric_type=habit.metric_type,
        created_at=habit.created_at,
        updated_at=habit.updated_at
    )


def habit_log_db_to_pydantic(log: HabitLogDB) -> HabitLog:
    """Convert HabitLogDB model to HabitLog Pydantic model"""
    return HabitLog(
        id=log.id,
        habit_id=log.habit_id,
        habit_name=log.habit_name,
        duration=log.duration,
        amount=log.amount,
        date=log.date,
        completed_at=log.completed_at,
        status=log.status,
        notes=log.notes,
        source=log.source,
        log_metadata=log.log_metadata,
        location_lat=getattr(log, "location_lat", None),
        location_lon=getattr(log, "location_lon", None),
        location_accuracy_m=getattr(log, "location_accuracy_m", None),
        location_source=getattr(log, "location_source", None),
        location_place_label=getattr(log, "location_place_label", None),
        location_confidence=getattr(log, "location_confidence", None),
        location_resolved_at=getattr(log, "location_resolved_at", None),
        location_signal_age_ms=getattr(log, "location_signal_age_ms", None),
    )
