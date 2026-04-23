"""Migration script to create the user_ui_preferences table."""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from database.connection import get_db_session
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError


CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS user_ui_preferences (
    user_id TEXT PRIMARY KEY REFERENCES users(id),
    habit_text_color TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
"""


async def create_ui_preferences_table() -> bool:
    async with get_db_session() as session:
        try:
            print("📊 Creating user_ui_preferences table (if not exists)...")
            await session.execute(text(CREATE_TABLE_SQL))
            await session.commit()
            print("✅ user_ui_preferences table ready.")
            return True
        except SQLAlchemyError as exc:
            print(f"❌ Error creating table: {exc}")
            await session.rollback()
            return False


async def main() -> bool:
    print("=" * 60)
    print("🔧 Migration: Add user_ui_preferences")
    print("=" * 60)
    ok = await create_ui_preferences_table()
    if not ok:
        print("\n❌ Migration failed")
        return False
    print("\n✅ Migration completed successfully!")
    return True


if __name__ == "__main__":
    asyncio.run(main())
