"""
Database connection and session management
Turso Cloud with embedded replica
"""

import os
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.pool import NullPool
from database.models import Base
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Get Turso Cloud DATABASE_URL
DATABASE_URL = os.getenv("DATABASE_URL")
LOCAL_ONLY_MODE = os.getenv("RITUAL_DB_LOCAL_ONLY", "").strip().lower() in {"1", "true", "yes", "on"}

# Use a local replica in the backend directory
project_root = Path(__file__).parent.parent
local_db_path = project_root / ".turso_replica.db"

if not DATABASE_URL:
    raise ValueError(
        "DATABASE_URL environment variable is required.\n"
        "Expected format: libsql://[HOST].turso.io?authToken=[TOKEN]\n"
        "Set this in your backend/.env file"
    )

if LOCAL_ONLY_MODE:
    print("📡 Mode: Local replica only (RITUAL_DB_LOCAL_ONLY=1)")
    print(f"💾 Local replica: {local_db_path}")

    # Local-only mode avoids libsql sync/TLS dependencies for scripts and CI.
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{local_db_path}",
        echo=False,
        poolclass=NullPool,
        connect_args={"check_same_thread": False},
    )
else:
    if not DATABASE_URL.startswith("libsql://") or "turso.io" not in DATABASE_URL:
        raise ValueError(
            f"Invalid DATABASE_URL format. Expected Turso Cloud URL (libsql://...turso.io)\n"
            f"Got: {DATABASE_URL[:50]}..."
        )

    # Parse Turso Cloud connection details
    parsed = urlparse(DATABASE_URL)
    query_params = parse_qs(parsed.query)
    auth_token = query_params.get('authToken', [None])[0]

    if not auth_token:
        raise ValueError(
            "DATABASE_URL must include authToken query parameter.\n"
            "Format: libsql://[HOST].turso.io?authToken=[TOKEN]"
        )

    # HTTPS URL for syncing with Turso Cloud
    sync_url = f"https://{parsed.netloc}"

    print(f"🔗 Connecting to Turso Cloud: {parsed.netloc}")
    print(f"📡 Mode: Local replica with automatic sync")
    print(f"💾 Local replica: {local_db_path}")

    # Create the engine with embedded replica
    # Note: Must use NullPool for async SQLite/libsql engines - QueuePool is not compatible
    engine = create_async_engine(
        f"sqlite+aiolibsql:///{local_db_path}",
        echo=False,
        poolclass=NullPool,
        connect_args={
            "sync_url": sync_url,
            "auth_token": auth_token,
            "check_same_thread": False,
            # Note: sync_interval removed - libsql uses default (5 seconds)
            # Setting to 0 causes Rust panic: "`period` must be non-zero"
        },
    )

# Create session factory
async_session_factory = async_sessionmaker(
    engine, 
    class_=AsyncSession, 
    expire_on_commit=False
)

@asynccontextmanager
async def get_db_session():
    """Get database session with automatic cleanup"""
    async with async_session_factory() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()

async def init_database():
    """
    Initialize database - verifies connection and waits for sync.
    Schema is managed by migration scripts, not create_all().
    """
    from sqlalchemy import text
    import asyncio
    
    max_retries = 5
    retry_delay = 1.0  # seconds
    
    for attempt in range(max_retries):
        try:
            # Just verify we can query the database - don't try to create tables
            # Schema is managed by migration scripts (migrate_add_import_tables.py)
            async with async_session_factory() as session:
                result = await session.execute(text("SELECT COUNT(*) FROM users"))
                count = result.scalar()
                print(f"✅ Database ready: {count} user(s)")
                
                # Run lightweight migrations for new columns
                await _run_migrations(session)
                
                return  # Success!
                
        except Exception as e:
            error_msg = str(e)
            if attempt < max_retries - 1:
                # Likely sync hasn't completed yet, wait and retry
                print(f"⏳ Waiting for database sync (attempt {attempt + 1}/{max_retries})...")
                await asyncio.sleep(retry_delay)
                retry_delay *= 1.5  # Exponential backoff
            else:
                if "no such table" in error_msg.lower():
                    print(f"❌ Database tables missing: {error_msg}")
                    print("💡 Run: cd backend && python scripts/migrate_add_import_tables.py")
                else:
                    print(f"⚠️  Database check failed after {max_retries} attempts: {error_msg}")


async def _run_migrations(session):
    """Run lightweight schema migrations for new columns."""
    from sqlalchemy import text
    
    migrations = [
        # Add afk_timeout_seconds to watcher_state (15 min default)
        ("watcher_state", "afk_timeout_seconds", "ALTER TABLE watcher_state ADD COLUMN afk_timeout_seconds INTEGER DEFAULT 900"),
    ]
    
    for table, column, sql in migrations:
        try:
            # Check if column exists
            result = await session.execute(text(f"PRAGMA table_info({table})"))
            columns = [row[1] for row in result.fetchall()]
            
            if column not in columns:
                await session.execute(text(sql))
                await session.commit()
                print(f"  ✅ Added {table}.{column}")
        except Exception as e:
            # Table might not exist yet, or column already exists
            if "no such table" not in str(e).lower():
                print(f"  ⚠️ Migration {table}.{column}: {e}")

    # Create scheduled blocks table for calendar week-view planner.
    try:
        await session.execute(text("""
            CREATE TABLE IF NOT EXISTS scheduled_blocks (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                notes TEXT,
                day TEXT NOT NULL,
                start_minutes INTEGER NOT NULL,
                end_minutes INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """))
        await session.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_scheduled_blocks_user_day
            ON scheduled_blocks (user_id, day)
        """))
        await session.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_scheduled_blocks_user_day_start
            ON scheduled_blocks (user_id, day, start_minutes)
        """))
        await session.commit()
    except Exception as e:
        if "no such table" not in str(e).lower():
            print(f"  ⚠️ Migration scheduled_blocks: {e}")

    # Weather integration tables (privacy-first weather snapshots).
    try:
        await session.execute(text("""
            CREATE TABLE IF NOT EXISTS integrations (
                user_id TEXT NOT NULL,
                provider TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 0,
                connected_at TIMESTAMP,
                disabled_at TIMESTAMP,
                metadata TEXT,
                last_sync_at TIMESTAMP,
                last_error TEXT,
                PRIMARY KEY (user_id, provider),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        """))
        await session.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_integrations_provider_enabled
            ON integrations (provider, enabled)
        """))
        await session.execute(text("""
            CREATE TABLE IF NOT EXISTS weather_observations (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                observed_at TIMESTAMP NOT NULL,
                tz TEXT NOT NULL,
                location_label TEXT NOT NULL,
                condition_code TEXT NOT NULL,
                temperature_c REAL NOT NULL,
                feels_like_c REAL NOT NULL,
                humidity REAL NOT NULL,
                wind_speed_mps REAL NOT NULL,
                wind_gust_mps REAL,
                wind_direction_deg REAL NOT NULL,
                precip_probability REAL NOT NULL,
                precip_intensity REAL,
                cloud_cover REAL,
                pressure_hpa REAL,
                visibility_m REAL,
                source TEXT NOT NULL DEFAULT 'weatherkit',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        """))
        await session.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_weather_observations_user_observed
            ON weather_observations (user_id, observed_at)
        """))
        await session.execute(text("""
            CREATE TABLE IF NOT EXISTS weather_daily (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                date_local TEXT NOT NULL,
                tz TEXT NOT NULL,
                location_label TEXT NOT NULL,
                condition_code TEXT,
                high_c REAL NOT NULL,
                low_c REAL NOT NULL,
                sunrise TIMESTAMP,
                sunset TIMESTAMP,
                uv_index_max REAL,
                source TEXT NOT NULL DEFAULT 'weatherkit',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        """))
        await session.execute(text("""
            CREATE UNIQUE INDEX IF NOT EXISTS idx_weather_daily_user_date_unique
            ON weather_daily (user_id, date_local)
        """))
        await session.commit()
    except Exception as e:
        if "no such table" not in str(e).lower():
            print(f"  ⚠️ Migration weather tables: {e}")

    # Enforce one derived Computer Use projection row per (habit_id, date, source).
    # This prevents duplicate projection logs during concurrent sync operations.
    try:
        await session.execute(text("""
            DELETE FROM habit_logs
            WHERE source = 'ritual_watcher_projection_v1'
              AND EXISTS (
                SELECT 1
                FROM habit_logs newer
                WHERE newer.source = 'ritual_watcher_projection_v1'
                  AND newer.habit_id = habit_logs.habit_id
                  AND newer.date = habit_logs.date
                  AND newer.id <> habit_logs.id
                  AND (
                    COALESCE(newer.completed_at, '') > COALESCE(habit_logs.completed_at, '')
                    OR (
                      COALESCE(newer.completed_at, '') = COALESCE(habit_logs.completed_at, '')
                      AND newer.id > habit_logs.id
                    )
                  )
              )
        """))
        await session.execute(text("""
            CREATE UNIQUE INDEX IF NOT EXISTS idx_habit_logs_projection_unique
            ON habit_logs (habit_id, date, source)
            WHERE source = 'ritual_watcher_projection_v1'
        """))
        await session.commit()
    except Exception as e:
        if "no such table" not in str(e).lower():
            print(f"  ⚠️ Migration habit_logs.projection_unique: {e}")

async def close_database():
    """Close database connections"""
    await engine.dispose()
    print("✅ Database connections closed")
