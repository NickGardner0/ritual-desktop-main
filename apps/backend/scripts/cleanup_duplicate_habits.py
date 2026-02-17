
#!/usr/bin/env python3
"""
Remove duplicate habits for a user by name+unit (case-insensitive),
keeping the habit with the most logs (tie-break: oldest created_at).

Safety:
- DRY RUN by default. Set DRY_RUN=no to actually delete.
- Only affects the specified USER_ID.

Usage:
  cd backend
  USER_ID=<your-clerk-user-id> python3 scripts/cleanup_duplicate_habits.py
  USER_ID=<id> DRY_RUN=no python3 scripts/cleanup_duplicate_habits.py  # apply changes
"""
import os
import sys
import asyncio
from collections import defaultdict
from pathlib import Path

# Ensure backend imports work when running as a script
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from services.habits_service import HabitsService
from database.connection import get_db_session
from database.models import HabitDB, HabitLogDB
from sqlalchemy import select, func

USER_ID = os.getenv("USER_ID")
DRY_RUN = os.getenv("DRY_RUN", "yes").lower() not in ("no", "false", "0")

if not USER_ID:
    print("❌ USER_ID env var is required.")
    sys.exit(1)

def key(name: str, unit: str) -> str:
    return f"{(name or '').strip().lower()}__{(unit or '').strip().lower()}"

async def main():
    svc = HabitsService()
    habits = await svc.get_habits(USER_ID)
    if not habits:
        print("No habits found for user.")
        return

    # Get log counts per habit_id
    log_counts = {}
    async with get_db_session() as session:
        res = await session.execute(
            select(HabitLogDB.habit_id, func.count(HabitLogDB.id))
            .join(HabitDB, HabitDB.id == HabitLogDB.habit_id)
            .where(HabitDB.user_id == USER_ID)
            .group_by(HabitLogDB.habit_id)
        )
        for hid, cnt in res.all():
            log_counts[hid] = int(cnt or 0)

    # Group by (name, unit)
    grouped = defaultdict(list)
    for h in habits:
        grouped[key(h.name, h.unit_type)].append(h)

    total_candidates = 0
    total_deleted = 0

    for k, hs in grouped.items():
        if len(hs) <= 1:
            continue
        total_candidates += len(hs) - 1
        # Choose keep: max logs, then oldest created_at
        def score(h):
            return (log_counts.get(h.id, 0), -(h.created_at.timestamp() if h.created_at else 0))
        keep = max(hs, key=score)
        delete_list = [h for h in hs if h.id != keep.id]

        print(f"\n🧹 Duplicate set: {hs[0].name} [{hs[0].unit_type}]")
        print(f"   Keeping: {keep.id} (logs={log_counts.get(keep.id,0)})")
        for d in delete_list:
            print(f"   Deleting: {d.id} (logs={log_counts.get(d.id,0)})")
            if not DRY_RUN:
                try:
                    await svc.delete_habit(d.id, USER_ID)
                    total_deleted += 1
                    print("   ✅ Deleted.")
                except Exception as e:
                    print(f"   ❌ Failed to delete {d.id}: {e}")

    if total_candidates == 0:
        print("✅ No duplicates found.")
    else:
        if DRY_RUN:
            print(f"\nDRY RUN complete. {total_candidates} duplicates identified. Set DRY_RUN=no to apply.")
        else:
            print(f"\n✅ Cleanup complete. Deleted {total_deleted} duplicate habit(s).")

if __name__ == "__main__":
    asyncio.run(main())


