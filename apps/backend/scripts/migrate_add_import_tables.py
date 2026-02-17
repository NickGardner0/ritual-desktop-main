"""
Migration script to add robust import system tables.

Tables added:
- import_runs: Track every import as a first-class object
- import_items: Staging table for preview
- import_mapping_presets: User-saved mapping configurations

Columns added to habit_logs:
- import_run_id: FK to import_runs
- source_id: Original record ID from source
- dedupe_key: SHA256 hash for deduplication
- updated_at: Timestamp for updates

Run with: 
  From project root: python -m backend.scripts.migrate_add_import_tables
  From backend dir:  python scripts/migrate_add_import_tables.py
"""

import asyncio
import os
import sys

# Get the directory containing this script
script_dir = os.path.dirname(os.path.abspath(__file__))
# Get the backend directory (parent of scripts)
backend_dir = os.path.dirname(script_dir)
# Get the project root (parent of backend)
project_root = os.path.dirname(backend_dir)

# Add project root to path so we can import backend.*
if project_root not in sys.path:
    sys.path.insert(0, project_root)

# Also add backend dir to path for direct imports
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

# Load environment variables from backend/.env
from dotenv import load_dotenv
env_path = os.path.join(backend_dir, ".env")
if os.path.exists(env_path):
    load_dotenv(env_path)
    print(f"📁 Loaded environment from: {env_path}")
else:
    # Try project root .env
    env_path = os.path.join(project_root, ".env")
    if os.path.exists(env_path):
        load_dotenv(env_path)
        print(f"📁 Loaded environment from: {env_path}")

# Try importing from backend package first, fall back to direct import
try:
    from backend.database.connection import get_db_session
except ImportError:
    from database.connection import get_db_session

from sqlalchemy import text


MIGRATION_SQLS = [
    # Create import_runs table
    """
    CREATE TABLE IF NOT EXISTS import_runs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        source TEXT NOT NULL,
        file_name TEXT,
        file_hash_sha256 TEXT,
        file_size INTEGER,
        status TEXT NOT NULL DEFAULT 'created',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        started_at TIMESTAMP,
        completed_at TIMESTAMP,
        options_json TEXT,
        summary_json TEXT,
        error_json TEXT,
        progress_current INTEGER DEFAULT 0,
        progress_total INTEGER DEFAULT 0,
        undo_available BOOLEAN DEFAULT FALSE,
        undone_at TIMESTAMP
    )
    """,
    
    # Create index on import_runs
    """
    CREATE INDEX IF NOT EXISTS idx_import_runs_user_id ON import_runs(user_id)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_import_runs_status ON import_runs(status)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_import_runs_file_hash ON import_runs(file_hash_sha256)
    """,
    
    # Create import_items table
    """
    CREATE TABLE IF NOT EXISTS import_items (
        id TEXT PRIMARY KEY,
        import_run_id TEXT NOT NULL REFERENCES import_runs(id) ON DELETE CASCADE,
        habit_key TEXT NOT NULL,
        habit_name TEXT,
        date TEXT NOT NULL,
        amount REAL,
        unit_type TEXT,
        raw_json TEXT,
        row_index INTEGER,
        validation_status TEXT DEFAULT 'ok',
        validation_messages TEXT,
        dedupe_key TEXT,
        conflict_status TEXT,
        existing_log_id TEXT
    )
    """,
    
    # Create indexes on import_items
    """
    CREATE INDEX IF NOT EXISTS idx_import_items_run_id ON import_items(import_run_id)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_import_items_validation ON import_items(validation_status)
    """,
    
    # Create import_mapping_presets table
    """
    CREATE TABLE IF NOT EXISTS import_mapping_presets (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        name TEXT NOT NULL,
        source TEXT NOT NULL,
        mapping_json TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """,
    
    # Create index on presets
    """
    CREATE INDEX IF NOT EXISTS idx_import_presets_user_source ON import_mapping_presets(user_id, source)
    """,
]

# Columns to add to habit_logs (run separately to handle existing tables)
HABIT_LOGS_COLUMNS = [
    ("import_run_id", "TEXT REFERENCES import_runs(id) ON DELETE SET NULL"),
    ("source_id", "TEXT"),
    ("dedupe_key", "TEXT"),
    ("updated_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"),
]


async def check_column_exists(session, table: str, column: str) -> bool:
    """Check if a column exists in a table."""
    try:
        result = await session.execute(text(f"PRAGMA table_info({table})"))
        columns = [row[1] for row in result.fetchall()]
        return column in columns
    except Exception:
        return False


async def run_migration():
    """Run the migration."""
    print("🚀 Starting import system migration...")
    
    async with get_db_session() as session:
        # Run table creation SQLs
        for sql in MIGRATION_SQLS:
            try:
                await session.execute(text(sql))
                print(f"✅ Executed: {sql[:50]}...")
            except Exception as e:
                if "already exists" in str(e).lower():
                    print(f"⏭️  Skipped (already exists): {sql[:50]}...")
                else:
                    print(f"❌ Error: {e}")
                    print(f"   SQL: {sql[:100]}...")
        
        # Add columns to habit_logs
        print("\n📝 Adding columns to habit_logs...")
        for col_name, col_def in HABIT_LOGS_COLUMNS:
            if await check_column_exists(session, "habit_logs", col_name):
                print(f"⏭️  Column {col_name} already exists")
                continue
            
            try:
                alter_sql = f"ALTER TABLE habit_logs ADD COLUMN {col_name} {col_def}"
                await session.execute(text(alter_sql))
                print(f"✅ Added column: {col_name}")
            except Exception as e:
                if "duplicate column" in str(e).lower():
                    print(f"⏭️  Column {col_name} already exists")
                else:
                    print(f"❌ Error adding {col_name}: {e}")
        
        # Create index on dedupe_key
        try:
            await session.execute(
                text("CREATE INDEX IF NOT EXISTS idx_habit_logs_dedupe_key ON habit_logs(dedupe_key)")
            )
            print("✅ Created index on dedupe_key")
        except Exception as e:
            print(f"⏭️  Index on dedupe_key: {e}")
        
        # Create index on import_run_id
        try:
            await session.execute(
                text("CREATE INDEX IF NOT EXISTS idx_habit_logs_import_run ON habit_logs(import_run_id)")
            )
            print("✅ Created index on import_run_id")
        except Exception as e:
            print(f"⏭️  Index on import_run_id: {e}")
        
        await session.commit()
    
    print("\n✅ Migration completed successfully!")


if __name__ == "__main__":
    asyncio.run(run_migration())

