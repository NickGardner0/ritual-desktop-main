#!/usr/bin/env python3
"""
Migration: Add performance indexes for import system

Run this once to add the required indexes:
    cd backend && python scripts/migrate_import_indexes.py
"""

import asyncio
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from database.connection import get_db_session
from sqlalchemy import text


async def migrate():
    """Add performance indexes for import system"""
    
    indexes = [
        # Composite index for habit_id + date lookups (critical for duplicate checking)
        ("idx_habit_logs_habit_date", "habit_logs", "habit_id, date"),
        # Index for import_run_id (for undo operations and run analytics)
        ("idx_habit_logs_import_run", "habit_logs", "import_run_id"),
        # Index for file hash lookup (for idempotent imports)
        ("idx_import_runs_file_hash", "import_runs", "file_hash_sha256"),
        # Index for user + status queries
        ("idx_import_runs_user_status", "import_runs", "user_id, status"),
        # Index for import items by run
        ("idx_import_items_run", "import_items", "import_run_id"),
    ]
    
    async with get_db_session() as session:
        for idx_name, table, columns in indexes:
            try:
                # Check if index already exists
                check = await session.execute(text(
                    f"SELECT name FROM sqlite_master WHERE type='index' AND name='{idx_name}'"
                ))
                if check.scalar():
                    print(f"✓ Index {idx_name} already exists")
                    continue
                
                # Create the index
                sql = f"CREATE INDEX IF NOT EXISTS {idx_name} ON {table} ({columns})"
                await session.execute(text(sql))
                print(f"✓ Created index: {idx_name} ON {table} ({columns})")
                
            except Exception as e:
                print(f"⚠ Error creating {idx_name}: {e}")
        
        await session.commit()
        print("\n✅ Migration complete!")


if __name__ == "__main__":
    asyncio.run(migrate())

