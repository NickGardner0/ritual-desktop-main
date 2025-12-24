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

if not DATABASE_URL:
    raise ValueError(
        "DATABASE_URL environment variable is required.\n"
        "Expected format: libsql://[HOST].turso.io?authToken=[TOKEN]\n"
        "Set this in your backend/.env file"
    )

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

# Use a local replica in the backend directory
project_root = Path(__file__).parent.parent
local_db_path = project_root / ".turso_replica.db"

print(f"💾 Local replica: {local_db_path}")

# Create the engine with embedded replica
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
    pool_pre_ping=False,
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

async def close_database():
    """Close database connections"""
    await engine.dispose()
    print("✅ Database connections closed")
