"""
Database connection and session management
"""

import os
from contextlib import asynccontextmanager
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.pool import StaticPool, NullPool, QueuePool
from database.models import Base

# Database configuration
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./ritual.db")

# Use connection pooling for better performance
# Note: SQLite doesn't support pooling well, use NullPool
# For PostgreSQL in production, use QueuePool
is_sqlite = "sqlite" in DATABASE_URL

# Create async engine with appropriate pool settings
if is_sqlite:
    # SQLite: Use NullPool (no pooling) - pool_size/max_overflow not supported
    engine = create_async_engine(
        DATABASE_URL,
        echo=False,  # Set to False in production (was True for debugging)
        poolclass=NullPool,
        connect_args={"check_same_thread": False}
    )
else:
    # PostgreSQL: Use QueuePool with connection pooling
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
    async with engine.begin() as conn:
        # Create all tables
        await conn.run_sync(Base.metadata.create_all)
        print("✅ Database tables created successfully")

async def close_database():
    """Close database connections"""
    await engine.dispose()
    print("✅ Database connections closed")
