"""
Database connection and session management
Turso Cloud with embedded replica
"""

import asyncio
import os
import logging
import shutil
from datetime import datetime, timezone
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from typing import Any, Dict
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.pool import NullPool
from database.models import Base
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Patch aiolibsql cursor to add missing _async_soft_close method
# SQLAlchemy 2.0.48 expects this method on async cursors but sqlalchemy-libsql
# 0.2.0 doesn't implement it, causing "'builtins.Cursor' object has no
# attribute '_async_soft_close'" errors on every DB write.
# ---------------------------------------------------------------------------
try:
    from sqlalchemy_libsql.aiolibsql import SQLiteDialect_aiolibsql
    _orig_create_cursor = getattr(SQLiteDialect_aiolibsql, "create_connect_args", None)

    # Patch at the DBAPI cursor level — add _async_soft_close if missing
    import sqlalchemy_libsql.aiolibsql as _aiolibsql_mod
    _orig_connect = getattr(_aiolibsql_mod, "connect", None)

    if _orig_connect is not None:
        import functools

        @functools.wraps(_orig_connect)
        def _patched_connect(*args, **kwargs):
            conn = _orig_connect(*args, **kwargs)
            _orig_cursor = conn.cursor

            @functools.wraps(_orig_cursor)
            def _patched_cursor(*a, **kw):
                cur = _orig_cursor(*a, **kw)
                if not hasattr(cur, '_async_soft_close'):
                    async def _noop_soft_close():
                        pass
                    cur._async_soft_close = _noop_soft_close
                return cur
            conn.cursor = _patched_cursor
            return conn

        _aiolibsql_mod.connect = _patched_connect
        logger.debug("✅ Patched aiolibsql cursor with _async_soft_close")
except Exception as _patch_err:
    logger.warning(f"⚠️ Could not patch aiolibsql cursor: {_patch_err}")

# Load environment variables
load_dotenv()

# Get Turso Cloud DATABASE_URL
DATABASE_URL = os.getenv("DATABASE_URL")
LOCAL_ONLY_MODE = os.getenv("RITUAL_DB_LOCAL_ONLY", "").strip().lower() in {"1", "true", "yes", "on"}
LOCAL_REPLICA_ENCRYPTION_KEY = (os.getenv("TURSO_LOCAL_ENCRYPTION_KEY") or "").strip() or None

# Use a local replica in the backend directory
project_root = Path(__file__).parent.parent
local_db_path = project_root / ".turso_replica.db"

DATABASE_RUNTIME_STATE: Dict[str, Any] = {
    "db_ready": False,
    "last_error": None,
    "migration": {
        "status": "unknown",
        "warning_count": 0,
        "warnings": [],
        "applied": [],
    },
}

if not DATABASE_URL:
    raise ValueError(
        "DATABASE_URL environment variable is required.\n"
        "Expected format: libsql://[HOST].turso.io?authToken=[TOKEN]\n"
        "Set this in your backend/.env file"
    )

if LOCAL_ONLY_MODE:
    logger.info("📡 Mode: Local replica only (RITUAL_DB_LOCAL_ONLY=1)")
    logger.info(f"💾 Local replica: {local_db_path}")

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

    logger.info(f"🔗 Connecting to Turso Cloud: {parsed.netloc}")
    logger.info(f"📡 Mode: Local replica with automatic sync")
    logger.info(f"💾 Local replica: {local_db_path}")
    if LOCAL_REPLICA_ENCRYPTION_KEY:
        logger.info("🔐 Local replica encryption: enabled")
    else:
        logger.warning(
            "⚠️ Local replica encryption is disabled. Set TURSO_LOCAL_ENCRYPTION_KEY in production to encrypt the embedded replica at rest."
        )

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
            **({"encryption_key": LOCAL_REPLICA_ENCRYPTION_KEY} if LOCAL_REPLICA_ENCRYPTION_KEY else {}),
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

async def force_local_replica_sync(*, timeout_seconds: float = 2.5) -> bool:
    """Best-effort immediate sync for read-after-write consistency-sensitive reads."""
    if LOCAL_ONLY_MODE:
        return False

    sync_engine = getattr(engine, "sync_engine", None)
    if sync_engine is None:
        return False

    def _sync_once() -> bool:
        raw_conn = None
        try:
            raw_conn = sync_engine.raw_connection()
            candidates = [
                raw_conn,
                getattr(raw_conn, "connection", None),
                getattr(raw_conn, "driver_connection", None),
                getattr(getattr(raw_conn, "connection", None), "driver_connection", None),
                getattr(getattr(raw_conn, "connection", None), "dbapi_connection", None),
            ]
            for candidate in candidates:
                sync_method = getattr(candidate, "sync", None)
                if callable(sync_method):
                    sync_method()
                    return True
            return False
        finally:
            if raw_conn is not None:
                try:
                    raw_conn.close()
                except Exception:
                    pass

    try:
        synced = await asyncio.wait_for(asyncio.to_thread(_sync_once), timeout=timeout_seconds)
        if synced:
            logger.info("🔄 Forced local replica sync before consistency-sensitive read")
        return synced
    except asyncio.TimeoutError:
        logger.warning(
            "Timed out forcing local replica sync after %.1fs; continuing with current replica",
            timeout_seconds,
        )
        return False
    except Exception as exc:
        logger.warning("Failed forcing local replica sync: %s", exc)
        return False

async def init_database(*, fast_startup: bool = False):
    """
    Initialize database - verifies connection and waits for sync.
    Schema is managed by migration scripts, not create_all().
    """
    from sqlalchemy import text
    import asyncio
    
    max_retries = 5
    retry_delay = 1.0  # seconds
    DATABASE_RUNTIME_STATE["db_ready"] = False
    DATABASE_RUNTIME_STATE["last_error"] = None
    DATABASE_RUNTIME_STATE["migration"] = {
        "status": "unknown",
        "warning_count": 0,
        "warnings": [],
        "applied": [],
    }
    
    recovery_attempted = False

    for attempt in range(max_retries):
        try:
            # Just verify we can query the database - don't try to create tables
            # Schema is managed by migration scripts (migrate_add_import_tables.py)
            async with async_session_factory() as session:
                result = await session.execute(text("SELECT COUNT(*) FROM users"))
                count = result.scalar()
                logger.info(f"✅ Database ready: {count} user(s)")

                DATABASE_RUNTIME_STATE["db_ready"] = True

                if fast_startup:
                    # Railway healthchecks only need the service to become ready;
                    # defer replica validation + schema maintenance entirely.
                    DATABASE_RUNTIME_STATE["migration"] = {
                        "status": "pending",
                        "warning_count": 0,
                        "warnings": [],
                        "applied": [],
                    }
                else:
                    # Verify replica integrity without mutating schema by default.
                    await _validate_local_replica(session, full_check=True)

                    DATABASE_RUNTIME_STATE["migration"] = {
                        "status": "verify_only",
                        "warning_count": 0,
                        "warnings": [],
                        "applied": [],
                    }
                
                return  # Success!
                
        except Exception as e:
            error_msg = str(e)
            DATABASE_RUNTIME_STATE["last_error"] = error_msg

            # Recover once from local replica corruption and retry startup.
            if (
                not recovery_attempted
                and (
                    "database disk image is malformed" in error_msg.lower()
                    or "integrity check failed" in error_msg.lower()
                    or "file is not a database" in error_msg.lower()
                )
            ):
                recovery_attempted = True
                recovered = await _recover_corrupt_local_replica()
                if recovered:
                    logger.warning(
                        "⚠️ Recreated corrupted local replica; retrying database initialization"
                    )
                    continue

            if attempt < max_retries - 1:
                # Likely sync hasn't completed yet, wait and retry
                logger.info(f"⏳ Waiting for database sync (attempt {attempt + 1}/{max_retries})...")
                await asyncio.sleep(retry_delay)
                retry_delay *= 1.5  # Exponential backoff
            else:
                DATABASE_RUNTIME_STATE["db_ready"] = False
                if "no such table" in error_msg.lower():
                    logger.error(f"❌ Database tables missing: {error_msg}")
                    if "wearable_events" in error_msg:
                        logger.info("💡 Run: cd backend && python scripts/repair_wearable_events_schema.py")
                    else:
                        logger.info("💡 Run: cd backend && python scripts/migrate_add_import_tables.py")
                else:
                    logger.warning(f"⚠️  Database check failed after {max_retries} attempts: {error_msg}")


async def _recover_corrupt_local_replica() -> bool:
    """Quarantine a malformed local replica so libsql can resync a clean copy."""
    try:
        await engine.dispose()
    except Exception as e:
        logger.warning("⚠️ Failed to dispose database engine before recovery: %s", e)

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    candidates = [
        local_db_path,
        local_db_path.with_name(f"{local_db_path.name}-wal"),
        local_db_path.with_name(f"{local_db_path.name}-shm"),
        local_db_path.with_name(f"{local_db_path.name}-journal"),
        local_db_path.with_name(f"{local_db_path.name}-info"),
    ]

    moved_any = False
    for src in candidates:
        if not src.exists():
            continue
        backup = src.with_name(f"{src.name}.corrupt-{timestamp}")
        try:
            shutil.move(str(src), str(backup))
            moved_any = True
            logger.warning("⚠️ Quarantined malformed replica file: %s", src.name)
        except Exception as e:
            logger.error("❌ Failed to quarantine replica file %s: %s", src, e)
            return False

    if not moved_any:
        logger.warning("⚠️ Malformed replica was reported, but no local replica files were found")

    return True


async def _validate_local_replica(session, *, full_check: bool = True) -> None:
    """Detect index/table corruption in the embedded replica before serving traffic."""
    from sqlalchemy import text

    pragma = "PRAGMA integrity_check" if full_check else "PRAGMA quick_check"
    result = await session.execute(text(pragma))
    rows = [str(row[0]) for row in result.fetchall()]
    if rows == ["ok"]:
        return

    summary = "; ".join(rows[:8])
    if len(rows) > 8:
        summary = f"{summary}; ... ({len(rows)} issues)"
    raise RuntimeError(f"Local replica integrity check failed: {summary}")


async def complete_database_startup_maintenance() -> Dict[str, Any]:
    """Finish expensive replica validation after the app is already serving."""
    from sqlalchemy import text

    async with async_session_factory() as session:
        await session.execute(text("SELECT 1"))
        await _validate_local_replica(session, full_check=True)
        migration_summary = {
            "status": "verify_only",
            "warning_count": 0,
            "warnings": [],
            "applied": [],
        }
        DATABASE_RUNTIME_STATE["migration"] = migration_summary
        DATABASE_RUNTIME_STATE["last_error"] = None
        return migration_summary



def get_database_runtime_health() -> Dict[str, Any]:
    """Return structured DB/runtime migration health state for /health checks."""
    return {
        "db_ready": DATABASE_RUNTIME_STATE["db_ready"],
        "last_error": DATABASE_RUNTIME_STATE["last_error"],
        "migration": DATABASE_RUNTIME_STATE["migration"],
        "mode": "local_only" if LOCAL_ONLY_MODE else "cloud_replica",
        "local_replica_path": str(local_db_path),
    }

async def close_database():
    """Close database connections"""
    await engine.dispose()
    DATABASE_RUNTIME_STATE["db_ready"] = False
    logger.info("✅ Database connections closed")
