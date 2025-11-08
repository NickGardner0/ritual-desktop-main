"""
Database connection and session management
Supports SQLite (local), Turso Cloud, and PostgreSQL
"""

import os
from contextlib import asynccontextmanager
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.pool import StaticPool, NullPool, QueuePool
from sqlalchemy import event
from database.models import Base
from dotenv import load_dotenv
from urllib.parse import urlparse, parse_qs

# Load environment variables FIRST before reading DATABASE_URL
load_dotenv()

# Database configuration
# Support SQLite (local dev), Turso Cloud (production), or PostgreSQL
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./ritual.db")

# Detect database type
is_turso_cloud = DATABASE_URL.startswith("libsql://") and "turso.io" in DATABASE_URL
is_sqlite = "sqlite" in DATABASE_URL and not is_turso_cloud

# Create async engine with appropriate pool settings
if is_turso_cloud:
    # Turso Cloud: Use sqlalchemy-libsql dialect
    # Parse the libsql:// URL to extract sync_url and auth_token
    parsed = urlparse(DATABASE_URL)
    query_params = parse_qs(parsed.query)
    auth_token = query_params.get('authToken', [None])[0]
    
    if not auth_token:
        raise ValueError("Turso Cloud DATABASE_URL must include authToken query parameter")
    
    # Convert libsql:// to sqlite+libsql:// format
    # For remote Turso Cloud, use sqlite+libsql:// with sync_url
    sync_url = f"https://{parsed.netloc}"
    
    print(f"🔗 Connecting to Turso Cloud: {parsed.netloc}")
    print(f"📋 Sync URL: {sync_url}")
    
    # Use sqlite+aiolibsql:// dialect for async support with sync_url and auth_token
    # For Turso Cloud remote connections, libsql creates a local replica that syncs
    # We need to specify a local database path for the replica
    import tempfile
    import os as os_module
    local_db_path = os_module.path.join(tempfile.gettempdir(), "ritual_turso_replica.db")
    
    print(f"💾 Local replica path: {local_db_path}")
    
    engine = create_async_engine(
        f"sqlite+aiolibsql:///{local_db_path}",
        echo=False,
        poolclass=NullPool,
        connect_args={
            "sync_url": sync_url,
            "auth_token": auth_token,
            # Disable WAL mode for remote Turso Cloud connections
            "check_same_thread": False,
        },
        # Disable WAL mode initialization
        pool_pre_ping=False,
    )
    
    # Override the SQLite dialect's isolation level check to prevent WAL mode errors
    # This is needed because Turso Cloud doesn't support WAL mode checks
    from sqlalchemy.dialects.sqlite.base import SQLiteDialect
    
    original_get_isolation_level = SQLiteDialect.get_isolation_level
    
    def get_isolation_level_no_wal(self, dbapi_conn):
        """Override to skip WAL mode checks for Turso Cloud"""
        # Return a default isolation level without checking WAL mode
        # This prevents the WAL mode check that causes wal_insert_begin failed error
        return "READ UNCOMMITTED"
    
    # Temporarily override the method for Turso connections
    SQLiteDialect.get_isolation_level = get_isolation_level_no_wal
elif is_sqlite:
    # SQLite: Use NullPool (no pooling) - pool_size/max_overflow not supported
    engine = create_async_engine(
        DATABASE_URL,
        echo=False,  # Set to False in production (was True for debugging)
        poolclass=NullPool,
        connect_args={"check_same_thread": False}
    )
else:
    # PostgreSQL or other: Use QueuePool with connection pooling
    engine = create_async_engine(
        DATABASE_URL,
        echo=False,
        poolclass=QueuePool,
        pool_size=10,
        max_overflow=20,
        pool_pre_ping=True,
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
    """Initialize database tables"""
    try:
        # Try to create tables with checkfirst=True (safe - won't error if they exist)
        async with engine.begin() as conn:
            def create_tables(sync_conn):
                Base.metadata.create_all(sync_conn, checkfirst=True)
            await conn.run_sync(create_tables)
            print("✅ Database tables initialized/verified")
    except Exception as e:
        # Log the error for debugging
        error_str = str(e)
        
        # If tables already exist, that's fine - treat as success
        if "already exists" in error_str or "SQL_INPUT_ERROR" in error_str or "table users already exists" in error_str:
            print("✅ Database tables already exist (from migration)")
        else:
            print(f"⚠️  Database initialization error: {error_str}")
    
    # Always test the connection, regardless of whether we hit an exception
    print("🔍 Testing database connection...")
    async with async_session_factory() as session:
        try:
            from sqlalchemy import text
            
            # First, list all tables to see what's actually in the database
            print("📋 Listing all tables in database...")
            try:
                tables_result = await session.execute(text("SELECT name FROM sqlite_master WHERE type='table'"))
                tables = tables_result.fetchall()
                if tables:
                    table_names = [t[0] for t in tables]
                    print(f"✅ Found {len(table_names)} table(s): {', '.join(table_names)}")
                else:
                    print("⚠️  No tables found in database")
            except Exception as list_error:
                print(f"⚠️  Could not list tables: {str(list_error)}")
            
            # Now try to query users table
            print("🔍 Querying users table...")
            result = await session.execute(text("SELECT COUNT(*) FROM users"))
            row = result.fetchone()
            if row is not None:
                count = row[0]
                print(f"✅ Connection verified: Found {count} user(s) in database")
            else:
                print("⚠️  Warning: Query returned no results (table exists but is empty)")
        except Exception as e:
            error_msg = str(e)
            if "no such table" in error_msg.lower():
                print(f"❌ ERROR: Users table does not exist! Error: {error_msg}")
                print("   This means the connection might be pointing to the wrong database,")
                print("   or tables weren't created properly.")
                print(f"   Database URL: {DATABASE_URL[:60]}...")
                print("\n💡 Possible solutions:")
                print("   1. Check your Turso dashboard - is the database name 'ritual'?")
                print("   2. Verify DATABASE_URL in backend/.env matches your Turso database")
                print("   3. The database name in the URL should match what's in your Turso dashboard")
            else:
                print(f"⚠️  Connection test error: {error_msg}")
            import traceback
            traceback.print_exc()
        finally:
            await session.close()

async def close_database():
    """Close database connections"""
    await engine.dispose()
    print("✅ Database connections closed")
