#!/usr/bin/env python3
"""
Seed Turso with realistic fake habits and logs for the current user.
This uses the same service layer as the API so Tinybird ingestion happens too.

Usage:
  cd backend
  USER_ID=<your-clerk-user-id> python3 scripts/seed_fake_habit_logs.py
Optional:
  DAYS=30  # how many days back to generate
  TZ_OFFSET_HOURS=0  # shift completed_at times if desired
"""
import os
import sys
import asyncio
from datetime import datetime, timedelta
from random import random, gauss, choice
from pathlib import Path

# Ensure backend package imports
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from services.habits_service import HabitsService
from models.habit_models import HabitCreate, HabitLogCreate
from services.user_service import UserService

USER_ID = os.getenv("USER_ID")
if not USER_ID:
    print("❌ USER_ID env var required (Clerk user id)")
    sys.exit(1)

DAYS = int(os.getenv("DAYS", "30"))
TZ_OFFSET_HOURS = int(os.getenv("TZ_OFFSET_HOURS", "0"))

async def ensure_user_exists(user_id: str):
    """Create a minimal user record if it doesn't exist."""
    svc = UserService()
    await svc.ensure_user_exists(user_id=user_id, email=f"{user_id}@example.local", full_name="Seeded User")

def iso_date(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d")

def iso_dt(dt: datetime) -> str:
    return dt.isoformat(timespec="seconds")

async def main():
    await ensure_user_exists(USER_ID)

    habits_service = HabitsService()

    # Create a few example habits with different unit types
    habit_defs = [
        ("Coding", "PRODUCTIVITY", "code", "Hours"),
        ("Meditation", "WELLNESS", "sparkles", "Minutes"),
        ("Morning Workout", "FITNESS & HEALTH", "dumbbell", "Hours"),
        ("Daily Reading", "EDUCATION", "book", "Pages"),
        ("Deep Work Sessions", "PRODUCTIVITY", "brain", "count"),
    ]

    # Reuse existing habits if they already exist for this user (match by name + unit, case-insensitive)
    created = []
    try:
        existing = await habits_service.get_habits(USER_ID)
    except Exception:
        existing = []
    for name, category, icon, unit in habit_defs:
        # Try to find an existing habit with same name and unit (case-insensitive)
        match = next(
            (h for h in existing if (h.name or '').strip().lower() == name.lower() and (h.unit_type or '').strip().lower() == unit.lower()),
            None
        )
        if match:
            created.append(match)
            print(f"🔁 Using existing habit: {match.name} ({match.unit_type})")
            continue
        # Create only if not found
        habit = await habits_service.create_habit(
            HabitCreate(
                name=name,
                category=category,
                icon=icon,
                is_custom=True,
                integration_source=None,
                unit_type=unit,
            ),
            USER_ID,
        )
        created.append(habit)
        print(f"✅ Created habit: {habit.name} ({habit.unit_type})")

    # Generate logs for each day for the past N days with realistic variance
    now = datetime.utcnow()
    total_logs = 0
    for habit in created:
        for i in range(DAYS):
            day = now - timedelta(days=i)
            # 70% chance of an entry for a given day
            if random() < 0.7:
                # Create value based on habit type
                unit = (habit.unit_type or "").lower()
                if "hour" in unit:
                    hours = max(0.25, gauss(1.2, 0.6))  # avg ~1.2h
                    duration_sec = int(hours * 3600)
                    amount = None
                elif "minute" in unit:
                    minutes = max(5, gauss(20, 10))
                    duration_sec = int(minutes * 60)
                    amount = None
                elif "page" in unit:
                    amount = max(5, int(gauss(25, 12)))
                    duration_sec = None
                elif "count" in unit:
                    amount = max(1, int(gauss(2, 1)))
                    duration_sec = None
                else:
                    amount = max(1, int(gauss(3, 2)))
                    duration_sec = None

                completed_time = day.replace(hour=choice([6, 8, 12, 18, 21])) + timedelta(hours=TZ_OFFSET_HOURS)

                await habits_service.log_habit(
                    habit.id,
                    HabitLogCreate(
                        duration=duration_sec,
                        amount=amount,
                        date=iso_date(day),
                        completed_at=iso_dt(completed_time),
                        status="completed",
                        notes=None,
                    ),
                    USER_ID,
                )
                total_logs += 1
    print(f"🎯 Seed complete: {len(created)} habits, {total_logs} logs over {DAYS} days")

if __name__ == "__main__":
    asyncio.run(main())


