"""
Service for habit-related operations
"""

import uuid
from datetime import datetime, timedelta, date
from typing import List, Dict, Any, Optional

from app.models.habit import (
    HabitCreate, 
    HabitUpdate, 
    HabitResponse, 
    HabitCompletion,
    HabitStats,
    HabitCategory,
    HabitFrequency
)

# TODO: Replace this with actual database
# Mock database for habits (will be replaced with real database)
_habits_db: Dict[str, Dict[str, Any]] = {}
_completions_db: Dict[str, List[Dict[str, Any]]] = {}

async def get_habits(user_id: str) -> List[HabitResponse]:
    """
    Get all habits for a user
    """
    user_habits = [
        HabitResponse(**habit_data)
        for habit_id, habit_data in _habits_db.items()
        if habit_data["user_id"] == user_id
    ]
    return user_habits

async def get_habits_by_category(user_id: str, category: HabitCategory) -> List[HabitResponse]:
    """
    Get habits for a user filtered by category
    """
    filtered_habits = [
        HabitResponse(**habit_data)
        for habit_id, habit_data in _habits_db.items()
        if (habit_data["user_id"] == user_id and habit_data["category"] == category)
    ]
    return filtered_habits

async def get_habit(habit_id: str) -> HabitResponse:
    """
    Get a specific habit by ID
    """
    if habit_id not in _habits_db:
        raise ValueError(f"Habit with ID {habit_id} not found")
    
    return HabitResponse(**_habits_db[habit_id])

async def create_habit(user_id: str, habit_data: HabitCreate) -> HabitResponse:
    """
    Create a new habit for a user
    """
    habit_id = str(uuid.uuid4())
    now = datetime.now()
    
    # Prepare habit data
    habit_dict = habit_data.dict()
    habit_dict.update({
        "id": habit_id,
        "user_id": user_id,
        "created_at": now,
        "updated_at": now,
        "streak": 0,
        "longest_streak": 0,
        "total_completions": 0,
        "last_completed_at": None,
        "next_due_at": _calculate_next_due_date(habit_data.frequency, habit_data.target_days)
    })
    
    # Save to mock database
    _habits_db[habit_id] = habit_dict
    _completions_db[habit_id] = []
    
    return HabitResponse(**habit_dict)

async def update_habit(habit_id: str, habit_data: HabitUpdate) -> HabitResponse:
    """
    Update an existing habit
    """
    if habit_id not in _habits_db:
        raise ValueError(f"Habit with ID {habit_id} not found")
    
    # Get existing habit data
    existing_habit = _habits_db[habit_id]
    
    # Update fields
    update_dict = habit_data.dict(exclude_unset=True)
    existing_habit.update(update_dict)
    existing_habit["updated_at"] = datetime.now()
    
    # Recalculate next due date if frequency or target days changed
    if "frequency" in update_dict or "target_days" in update_dict:
        existing_habit["next_due_at"] = _calculate_next_due_date(
            existing_habit["frequency"], existing_habit["target_days"]
        )
    
    return HabitResponse(**existing_habit)

async def delete_habit(habit_id: str) -> Dict[str, Any]:
    """
    Delete a habit
    """
    if habit_id not in _habits_db:
        raise ValueError(f"Habit with ID {habit_id} not found")
    
    # Remove from mock databases
    del _habits_db[habit_id]
    if habit_id in _completions_db:
        del _completions_db[habit_id]
    
    return {"success": True, "message": f"Habit {habit_id} deleted"}

async def complete_habit(habit_id: str, completion: HabitCompletion) -> HabitResponse:
    """
    Mark a habit as completed
    """
    if habit_id not in _habits_db:
        raise ValueError(f"Habit with ID {habit_id} not found")
    
    habit = _habits_db[habit_id]
    completion_data = completion.dict()
    completion_data["id"] = str(uuid.uuid4())
    
    # Add to completions
    if habit_id not in _completions_db:
        _completions_db[habit_id] = []
    
    _completions_db[habit_id].append(completion_data)
    
    # Update habit stats
    habit["last_completed_at"] = completion.completed_at
    habit["total_completions"] += 1
    
    # Update streak
    streak_updated = _update_streak(habit_id)
    
    # Calculate next due date
    habit["next_due_at"] = _calculate_next_due_date(
        habit["frequency"], habit["target_days"], completion.completed_at
    )
    
    return HabitResponse(**habit)

async def get_habit_stats(habit_id: str) -> HabitStats:
    """
    Get statistics for a habit
    """
    if habit_id not in _habits_db:
        raise ValueError(f"Habit with ID {habit_id} not found")
    
    habit = _habits_db[habit_id]
    completions = _completions_db.get(habit_id, [])
    
    # Calculate completion rate
    days_since_creation = max(1, (datetime.now() - habit["created_at"]).days)
    completion_rate = len(completions) / days_since_creation * 100 if days_since_creation > 0 else 0
    
    # Count completions by day of week
    completions_by_day = {str(i): 0 for i in range(7)}  # 0 = Monday, 6 = Sunday
    for completion in completions:
        day = completion["completed_at"].weekday()
        completions_by_day[str(day)] += 1
    
    return HabitStats(
        habit_id=habit_id,
        current_streak=habit["streak"],
        longest_streak=habit["longest_streak"],
        completion_rate=completion_rate,
        total_completions=habit["total_completions"],
        completions_by_day=completions_by_day
    )

async def get_starter_habits(user_id: str) -> List[HabitResponse]:
    """
    Get a list of recommended starter habits for a new user
    """
    starter_habits = [
        HabitCreate(
            name="Morning Routine",
            emoji="🌅",
            category=HabitCategory.PRODUCTIVITY,
            description="Complete your morning routine",
            frequency=HabitFrequency.DAILY,
            target_count=1,
            user_id=user_id
        ),
        HabitCreate(
            name="Deep Work",
            emoji="🧠",
            category=HabitCategory.PRODUCTIVITY,
            description="Focus on deep work without distractions",
            frequency=HabitFrequency.DAILY,
            target_count=1,
            user_id=user_id
        ),
        HabitCreate(
            name="Reading",
            emoji="📚",
            category=HabitCategory.LEARNING,
            description="Read books or articles",
            frequency=HabitFrequency.DAILY,
            target_count=1,
            user_id=user_id
        ),
        HabitCreate(
            name="Writing",
            emoji="✍️",
            category=HabitCategory.CREATIVE,
            description="Write something creative or journaling",
            frequency=HabitFrequency.DAILY,
            target_count=1,
            user_id=user_id
        ),
        HabitCreate(
            name="Exercise",
            emoji="🏋️",
            category=HabitCategory.FITNESS,
            description="Do some physical exercise",
            frequency=HabitFrequency.DAILY,
            target_count=1,
            user_id=user_id
        )
    ]
    
    # Create each habit
    created_habits = []
    for habit in starter_habits:
        created = await create_habit(user_id, habit)
        created_habits.append(created)
    
    return created_habits

def _calculate_next_due_date(
    frequency: HabitFrequency, 
    target_days: Optional[List[int]] = None,
    from_date: Optional[datetime] = None
) -> datetime:
    """
    Calculate the next due date for a habit based on frequency and target days
    """
    now = from_date or datetime.now()
    
    if frequency == HabitFrequency.DAILY:
        return datetime.combine(now.date() + timedelta(days=1), datetime.min.time())
    
    elif frequency == HabitFrequency.WEEKLY:
        if target_days and len(target_days) > 0:
            # Find the next target day
            today_weekday = now.weekday()
            next_days = [day for day in target_days if day > today_weekday]
            if next_days:
                # There are target days later this week
                days_until_next = min(next_days) - today_weekday
            else:
                # Wrap around to next week
                days_until_next = 7 - today_weekday + min(target_days)
            
            return datetime.combine(now.date() + timedelta(days=days_until_next), datetime.min.time())
        else:
            # Default to next week same day
            return datetime.combine(now.date() + timedelta(days=7), datetime.min.time())
    
    elif frequency == HabitFrequency.MONTHLY:
        # Go to next month, same day
        year = now.year + (1 if now.month == 12 else 0)
        month = 1 if now.month == 12 else now.month + 1
        day = min(now.day, [31, 29 if year % 4 == 0 else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1])
        return datetime(year, month, day)
    
    # Default: tomorrow
    return datetime.combine(now.date() + timedelta(days=1), datetime.min.time())

def _update_streak(habit_id: str) -> bool:
    """
    Update the streak count for a habit
    Returns True if streak was updated, False otherwise
    """
    if habit_id not in _habits_db:
        return False
    
    habit = _habits_db[habit_id]
    completions = _completions_db.get(habit_id, [])
    
    if not completions:
        return False
    
    # Sort completions by date
    sorted_completions = sorted(completions, key=lambda c: c["completed_at"])
    
    # Calculate streak
    current_streak = 1
    longest_streak = max(habit["longest_streak"], 1)
    
    if len(sorted_completions) > 1:
        prev_date = sorted_completions[0]["completed_at"].date()
        
        for i in range(1, len(sorted_completions)):
            curr_date = sorted_completions[i]["completed_at"].date()
            diff_days = (curr_date - prev_date).days
            
            if diff_days <= 1:  # Consecutive days or same day
                current_streak += (1 if diff_days == 1 else 0)
                longest_streak = max(longest_streak, current_streak)
            else:
                # Streak broken
                current_streak = 1
            
            prev_date = curr_date
    
    # Update habit
    habit["streak"] = current_streak
    habit["longest_streak"] = longest_streak
    
    return True 