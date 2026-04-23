"""
Database connection and session management
Turso Cloud with embedded replica
"""

import os
import logging
import shutil
from datetime import datetime
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from typing import Any, Dict, List
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

async def force_local_replica_sync() -> bool:
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
        import asyncio

        synced = await asyncio.to_thread(_sync_once)
        if synced:
            logger.info("🔄 Forced local replica sync before consistency-sensitive read")
        return synced
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
                    # Verify replica integrity before running migrations so broken
                    # habit_logs indexes trigger recovery during startup.
                    await _validate_local_replica(session, full_check=True)

                    # Run lightweight migrations for new columns
                    migration_summary = await _run_migrations(session)
                    DATABASE_RUNTIME_STATE["migration"] = migration_summary
                
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

    timestamp = datetime.utcnow().strftime("%Y%m%d%H%M%S")
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
    """Finish expensive replica validation and migrations after the app is already serving."""
    from sqlalchemy import text

    async with async_session_factory() as session:
        await session.execute(text("SELECT 1"))
        await _validate_local_replica(session, full_check=True)
        migration_summary = await _run_migrations(session)
        DATABASE_RUNTIME_STATE["migration"] = migration_summary
        DATABASE_RUNTIME_STATE["last_error"] = None
        return migration_summary


async def _run_migrations(session):
    """Run lightweight schema migrations for new columns."""
    from sqlalchemy import text
    warnings: List[str] = []
    applied: List[str] = []

    def add_warning(scope: str, message: str) -> None:
        warnings.append(f"{scope}: {message}")
    
    migrations = [
        # Add afk_timeout_seconds to watcher_state (15 min default)
        ("watcher_state", "afk_timeout_seconds", "ALTER TABLE watcher_state ADD COLUMN afk_timeout_seconds INTEGER DEFAULT 900"),
        # Import v2 undo support columns (required by import service queries)
        ("import_runs", "undo_expires_at", "ALTER TABLE import_runs ADD COLUMN undo_expires_at DATETIME"),
        ("import_runs", "undo_package_json", "ALTER TABLE import_runs ADD COLUMN undo_package_json TEXT"),
        # Unified wearable compatibility fields
        ("habit_logs", "origin_record_kind", "ALTER TABLE habit_logs ADD COLUMN origin_record_kind TEXT"),
        ("habit_logs", "origin_record_id", "ALTER TABLE habit_logs ADD COLUMN origin_record_id TEXT"),
        ("wearable_devices", "provider", "ALTER TABLE wearable_devices ADD COLUMN provider TEXT DEFAULT 'apple_health'"),
        ("wearable_devices", "connection_id", "ALTER TABLE wearable_devices ADD COLUMN connection_id TEXT"),
        ("wearable_devices", "last_seen_at", "ALTER TABLE wearable_devices ADD COLUMN last_seen_at DATETIME"),
        ("wearable_devices", "sdk_version", "ALTER TABLE wearable_devices ADD COLUMN sdk_version TEXT"),
        # Phone number for iMessage integration
        ("users", "phone_number", "ALTER TABLE users ADD COLUMN phone_number TEXT"),
        ("users", "sms_welcome_sent_at", "ALTER TABLE users ADD COLUMN sms_welcome_sent_at DATETIME"),
        ("users", "turso_db_name", "ALTER TABLE users ADD COLUMN turso_db_name TEXT"),
        ("users", "turso_db_url", "ALTER TABLE users ADD COLUMN turso_db_url TEXT"),
        ("users", "turso_provisioned_at", "ALTER TABLE users ADD COLUMN turso_provisioned_at DATETIME"),
        ("users", "turso_migrated_at", "ALTER TABLE users ADD COLUMN turso_migrated_at DATETIME"),
        # OAuth scope for Whoop token refresh
        ("whoop_integrations", "scope", "ALTER TABLE whoop_integrations ADD COLUMN scope TEXT"),
        # SMS chatbot: channel column on conversations + user timezone
        ("ai_conversations", "channel", "ALTER TABLE ai_conversations ADD COLUMN channel TEXT NOT NULL DEFAULT 'app'"),
        ("users", "timezone", "ALTER TABLE users ADD COLUMN timezone TEXT"),
        ("sms_preferences", "daily_narrative_enabled", "ALTER TABLE sms_preferences ADD COLUMN daily_narrative_enabled INTEGER NOT NULL DEFAULT 1"),
        ("sms_preferences", "interrupts_enabled", "ALTER TABLE sms_preferences ADD COLUMN interrupts_enabled INTEGER NOT NULL DEFAULT 1"),
        ("sms_preferences", "allowed_interrupt_kinds", "ALTER TABLE sms_preferences ADD COLUMN allowed_interrupt_kinds TEXT NOT NULL DEFAULT 'distraction_spiral'"),
        ("sms_preferences", "max_interrupts_per_day", "ALTER TABLE sms_preferences ADD COLUMN max_interrupts_per_day INTEGER NOT NULL DEFAULT 2"),
        ("sms_preferences", "min_hours_between_interrupts", "ALTER TABLE sms_preferences ADD COLUMN min_hours_between_interrupts INTEGER NOT NULL DEFAULT 4"),
    ]
    
    for table, column, sql in migrations:
        try:
            # Check if column exists
            result = await session.execute(text(f"PRAGMA table_info({table})"))
            columns = [row[1] for row in result.fetchall()]
            
            if column not in columns:
                await session.execute(text(sql))
                await session.commit()
                applied.append(f"{table}.{column}")
                logger.info(f"  ✅ Added {table}.{column}")
        except Exception as e:
            # Table might not exist yet, or column already exists
            if "no such table" not in str(e).lower():
                add_warning(f"migration:{table}.{column}", str(e))
                logger.warning(f"  ⚠️ Migration {table}.{column}: {e}")

    create_table_sql = [
        (
            "wearable_connections",
            """
            CREATE TABLE IF NOT EXISTS wearable_connections (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                provider TEXT NOT NULL,
                auth_method TEXT NOT NULL,
                provider_user_id TEXT,
                status TEXT NOT NULL DEFAULT 'active',
                access_token TEXT,
                refresh_token TEXT,
                token_expires_at DATETIME,
                scopes_json TEXT,
                settings_json TEXT,
                last_sync_at DATETIME,
                last_successful_sync_at DATETIME,
                last_error_json TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
            """,
        ),
        (
            "wearable_sources",
            """
            CREATE TABLE IF NOT EXISTS wearable_sources (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                connection_id TEXT,
                provider TEXT NOT NULL,
                source_kind TEXT NOT NULL,
                external_source_id TEXT,
                external_source_name TEXT,
                device_name TEXT,
                device_model TEXT,
                device_type TEXT,
                platform TEXT,
                source_bundle_id TEXT,
                priority_rank INTEGER NOT NULL DEFAULT 100,
                is_active BOOLEAN DEFAULT 1,
                metadata_json TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id),
                FOREIGN KEY(connection_id) REFERENCES wearable_connections(id)
            )
            """,
        ),
        (
            "wearable_raw_payloads",
            """
            CREATE TABLE IF NOT EXISTS wearable_raw_payloads (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                connection_id TEXT,
                provider TEXT NOT NULL,
                direction TEXT NOT NULL,
                external_id TEXT,
                payload_sha256 TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                expires_at DATETIME,
                FOREIGN KEY(user_id) REFERENCES users(id),
                FOREIGN KEY(connection_id) REFERENCES wearable_connections(id)
            )
            """,
        ),
        (
            "wearable_samples",
            """
            CREATE TABLE IF NOT EXISTS wearable_samples (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                connection_id TEXT,
                source_id TEXT,
                provider TEXT NOT NULL,
                metric_type TEXT NOT NULL,
                provider_metric_type TEXT,
                external_id TEXT,
                recorded_at DATETIME,
                start_time DATETIME,
                end_time DATETIME,
                attributed_date TEXT,
                value REAL NOT NULL,
                unit TEXT NOT NULL,
                aggregation_kind TEXT NOT NULL DEFAULT 'point',
                confidence REAL,
                timezone TEXT,
                attributes_json TEXT,
                raw_payload_id TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                deleted_at DATETIME,
                FOREIGN KEY(user_id) REFERENCES users(id),
                FOREIGN KEY(connection_id) REFERENCES wearable_connections(id),
                FOREIGN KEY(source_id) REFERENCES wearable_sources(id),
                FOREIGN KEY(raw_payload_id) REFERENCES wearable_raw_payloads(id)
            )
            """,
        ),
        (
            "wearable_events",
            """
            CREATE TABLE IF NOT EXISTS wearable_events (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                connection_id TEXT,
                source_id TEXT,
                provider TEXT NOT NULL,
                event_type TEXT NOT NULL,
                provider_event_type TEXT,
                external_id TEXT,
                start_time DATETIME NOT NULL,
                end_time DATETIME NOT NULL,
                attributed_date TEXT,
                timezone TEXT,
                title TEXT,
                summary_value REAL,
                summary_unit TEXT,
                details_json TEXT,
                raw_payload_id TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                deleted_at DATETIME,
                FOREIGN KEY(user_id) REFERENCES users(id),
                FOREIGN KEY(connection_id) REFERENCES wearable_connections(id),
                FOREIGN KEY(source_id) REFERENCES wearable_sources(id),
                FOREIGN KEY(raw_payload_id) REFERENCES wearable_raw_payloads(id)
            )
            """,
        ),
        (
            "wearable_sync_cursors",
            """
            CREATE TABLE IF NOT EXISTS wearable_sync_cursors (
                id TEXT PRIMARY KEY,
                connection_id TEXT NOT NULL,
                source_id TEXT,
                cursor_key TEXT NOT NULL,
                cursor_type TEXT NOT NULL,
                cursor_value TEXT NOT NULL,
                last_synced_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(connection_id) REFERENCES wearable_connections(id),
                FOREIGN KEY(source_id) REFERENCES wearable_sources(id)
            )
            """,
        ),
        (
            "wearable_sync_runs",
            """
            CREATE TABLE IF NOT EXISTS wearable_sync_runs (
                id TEXT PRIMARY KEY,
                connection_id TEXT,
                provider TEXT NOT NULL,
                trigger TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'running',
                started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                completed_at DATETIME,
                items_seen INTEGER DEFAULT 0,
                items_written INTEGER DEFAULT 0,
                items_updated INTEGER DEFAULT 0,
                items_deleted INTEGER DEFAULT 0,
                error_json TEXT,
                metadata_json TEXT,
                FOREIGN KEY(connection_id) REFERENCES wearable_connections(id)
            )
            """,
        ),
        (
            "heart_rate_sessions",
            """
            CREATE TABLE IF NOT EXISTS heart_rate_sessions (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                source_type TEXT NOT NULL,
                source_device_id TEXT NOT NULL,
                status TEXT NOT NULL,
                started_at DATETIME NOT NULL,
                ended_at DATETIME,
                app_version TEXT,
                device_model TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
            """,
        ),
        (
            "heart_rate_samples",
            """
            CREATE TABLE IF NOT EXISTS heart_rate_samples (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                session_id TEXT NOT NULL,
                source_type TEXT NOT NULL,
                source_device_id TEXT NOT NULL,
                bpm_raw INTEGER NOT NULL,
                bpm_display INTEGER NOT NULL,
                quality_score REAL,
                is_outlier BOOLEAN NOT NULL DEFAULT 0,
                rr_intervals_json TEXT,
                contact_detected BOOLEAN,
                received_at DATETIME NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id),
                FOREIGN KEY(session_id) REFERENCES heart_rate_sessions(id)
            )
            """,
        ),
        (
            "heart_rate_1m_rollups",
            """
            CREATE TABLE IF NOT EXISTS heart_rate_1m_rollups (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                bucket_start DATETIME NOT NULL,
                source_preference TEXT NOT NULL,
                sample_count INTEGER NOT NULL,
                bpm_avg REAL NOT NULL,
                bpm_min INTEGER NOT NULL,
                bpm_max INTEGER NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
            """,
        ),
        (
            "live_biometrics_state",
            """
            CREATE TABLE IF NOT EXISTS live_biometrics_state (
                user_id TEXT PRIMARY KEY,
                current_bpm INTEGER,
                current_source_type TEXT,
                latest_sample_at DATETIME,
                connection_state TEXT,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
            """,
        ),
        (
            "sms_preferences",
            """
            CREATE TABLE IF NOT EXISTS sms_preferences (
                user_id TEXT PRIMARY KEY,
                enabled INTEGER NOT NULL DEFAULT 1,
                proactive_enabled INTEGER NOT NULL DEFAULT 1,
                quiet_hours_start TEXT,
                quiet_hours_end TEXT,
                max_proactive_per_day INTEGER NOT NULL DEFAULT 1,
                allowed_triggers TEXT NOT NULL DEFAULT '',
                daily_narrative_enabled INTEGER NOT NULL DEFAULT 1,
                interrupts_enabled INTEGER NOT NULL DEFAULT 1,
                allowed_interrupt_kinds TEXT NOT NULL DEFAULT 'distraction_spiral',
                max_interrupts_per_day INTEGER NOT NULL DEFAULT 2,
                min_hours_between_interrupts INTEGER NOT NULL DEFAULT 4,
                last_proactive_sent_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
            """,
        ),
        (
            "sms_copilot_events",
            """
            CREATE TABLE IF NOT EXISTS sms_copilot_events (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                conversation_id TEXT,
                kind TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'candidate',
                score REAL NOT NULL DEFAULT 0,
                confidence REAL NOT NULL DEFAULT 0,
                novelty_score REAL NOT NULL DEFAULT 0,
                actionability_score REAL NOT NULL DEFAULT 0,
                dedupe_key TEXT NOT NULL,
                suppression_reason TEXT,
                trigger_window_start DATETIME,
                trigger_window_end DATETIME,
                headline TEXT,
                body TEXT,
                metrics_json TEXT,
                response_options_json TEXT,
                assistant_message_id TEXT,
                user_reply_message_id TEXT,
                provider_message_id TEXT,
                sent_at DATETIME,
                replied_at DATETIME,
                acted_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY(conversation_id) REFERENCES ai_conversations(id) ON DELETE SET NULL
            )
            """,
        ),
        (
            "behavior_baseline_snapshots",
            """
            CREATE TABLE IF NOT EXISTS behavior_baseline_snapshots (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                metric_key TEXT NOT NULL,
                lookback_days INTEGER NOT NULL DEFAULT 14,
                baseline_json TEXT NOT NULL,
                computed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """,
        ),
        (
            "report_schedules",
            """
            CREATE TABLE IF NOT EXISTS report_schedules (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                name TEXT NOT NULL,
                cadence TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'draft',
                timezone TEXT NOT NULL DEFAULT 'America/New_York',
                delivery_channel TEXT NOT NULL DEFAULT 'email',
                delivery_label TEXT NOT NULL,
                send_hour_local INTEGER NOT NULL DEFAULT 8,
                send_minute_local INTEGER NOT NULL DEFAULT 0,
                send_weekday INTEGER,
                send_day_of_month INTEGER,
                recipients_json TEXT NOT NULL DEFAULT '[]',
                sections_json TEXT NOT NULL DEFAULT '[]',
                last_sent_at DATETIME,
                next_run_at DATETIME,
                last_error TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """,
        ),
        (
            "report_runs",
            """
            CREATE TABLE IF NOT EXISTS report_runs (
                id TEXT PRIMARY KEY,
                schedule_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                cadence TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'queued',
                period_start TEXT NOT NULL,
                period_end TEXT NOT NULL,
                subject TEXT,
                summary_json TEXT,
                email_html TEXT,
                generated_at DATETIME,
                sent_at DATETIME,
                error_json TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(schedule_id) REFERENCES report_schedules(id) ON DELETE CASCADE,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """,
        ),
        (
            "report_notifications",
            """
            CREATE TABLE IF NOT EXISTS report_notifications (
                id TEXT PRIMARY KEY,
                report_run_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                channel TEXT NOT NULL DEFAULT 'email',
                recipient_email TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'queued',
                provider_message_id TEXT,
                payload_json TEXT,
                sent_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(report_run_id) REFERENCES report_runs(id) ON DELETE CASCADE,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """,
        ),
    ]

    for table_name, sql in create_table_sql:
        try:
            await session.execute(text(sql))
            await session.commit()
            applied.append(f"table:{table_name}")
            logger.info(f"  ✅ Ensured table {table_name}")
        except Exception as e:
            add_warning(f"table:{table_name}", str(e))
            logger.warning(f"  ⚠️ Create table {table_name}: {e}")

    index_sql = [
        ("idx_habit_logs_origin_record", "CREATE UNIQUE INDEX IF NOT EXISTS idx_habit_logs_origin_record ON habit_logs (habit_id, origin_record_kind, origin_record_id)"),
        ("idx_wearable_connections_user_provider", "CREATE UNIQUE INDEX IF NOT EXISTS idx_wearable_connections_user_provider ON wearable_connections (user_id, provider)"),
        ("idx_wearable_sources_user_provider_external", "CREATE INDEX IF NOT EXISTS idx_wearable_sources_user_provider_external ON wearable_sources (user_id, provider, external_source_id)"),
        ("idx_wearable_samples_user_metric_recorded", "CREATE INDEX IF NOT EXISTS idx_wearable_samples_user_metric_recorded ON wearable_samples (user_id, metric_type, recorded_at)"),
        ("idx_wearable_samples_user_provider_date", "CREATE INDEX IF NOT EXISTS idx_wearable_samples_user_provider_date ON wearable_samples (user_id, provider, attributed_date)"),
        ("idx_wearable_samples_user_provider_external", "CREATE INDEX IF NOT EXISTS idx_wearable_samples_user_provider_external ON wearable_samples (user_id, provider, external_id)"),
        ("idx_wearable_events_user_type_start", "CREATE INDEX IF NOT EXISTS idx_wearable_events_user_type_start ON wearable_events (user_id, event_type, start_time)"),
        ("idx_wearable_events_user_provider_external", "CREATE INDEX IF NOT EXISTS idx_wearable_events_user_provider_external ON wearable_events (user_id, provider, external_id)"),
        ("idx_wearable_sync_cursors_unique", "CREATE UNIQUE INDEX IF NOT EXISTS idx_wearable_sync_cursors_unique ON wearable_sync_cursors (connection_id, COALESCE(source_id, ''), cursor_key)"),
        ("idx_wearable_raw_payloads_provider_received", "CREATE INDEX IF NOT EXISTS idx_wearable_raw_payloads_provider_received ON wearable_raw_payloads (provider, received_at)"),
        ("idx_heart_rate_sessions_user_started", "CREATE INDEX IF NOT EXISTS idx_heart_rate_sessions_user_started ON heart_rate_sessions (user_id, started_at)"),
        ("idx_heart_rate_sessions_user_status", "CREATE INDEX IF NOT EXISTS idx_heart_rate_sessions_user_status ON heart_rate_sessions (user_id, status)"),
        ("idx_heart_rate_samples_user_received", "CREATE INDEX IF NOT EXISTS idx_heart_rate_samples_user_received ON heart_rate_samples (user_id, received_at)"),
        ("idx_heart_rate_samples_user_source_received", "CREATE INDEX IF NOT EXISTS idx_heart_rate_samples_user_source_received ON heart_rate_samples (user_id, source_type, received_at)"),
        ("idx_heart_rate_samples_session_received", "CREATE INDEX IF NOT EXISTS idx_heart_rate_samples_session_received ON heart_rate_samples (session_id, received_at)"),
        ("idx_heart_rate_rollups_user_bucket_source", "CREATE UNIQUE INDEX IF NOT EXISTS idx_heart_rate_rollups_user_bucket_source ON heart_rate_1m_rollups (user_id, bucket_start, source_preference)"),
        # SMS chatbot: unique SMS conversation per user
        ("idx_ai_conversations_user_sms_unique", "CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_conversations_user_sms_unique ON ai_conversations (user_id) WHERE channel = 'sms'"),
        ("idx_sms_copilot_events_user_dedupe", "CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_copilot_events_user_dedupe ON sms_copilot_events (user_id, dedupe_key)"),
        ("idx_sms_copilot_events_user_status_created", "CREATE INDEX IF NOT EXISTS idx_sms_copilot_events_user_status_created ON sms_copilot_events (user_id, status, created_at)"),
        ("idx_sms_copilot_events_user_kind_created", "CREATE INDEX IF NOT EXISTS idx_sms_copilot_events_user_kind_created ON sms_copilot_events (user_id, kind, created_at)"),
        ("idx_behavior_baselines_user_metric_computed", "CREATE INDEX IF NOT EXISTS idx_behavior_baselines_user_metric_computed ON behavior_baseline_snapshots (user_id, metric_key, computed_at)"),
        ("idx_report_schedules_user_status", "CREATE INDEX IF NOT EXISTS idx_report_schedules_user_status ON report_schedules (user_id, status)"),
        ("idx_report_schedules_next_run", "CREATE INDEX IF NOT EXISTS idx_report_schedules_next_run ON report_schedules (status, next_run_at)"),
        ("idx_report_runs_schedule_created", "CREATE INDEX IF NOT EXISTS idx_report_runs_schedule_created ON report_runs (schedule_id, created_at)"),
        ("idx_report_runs_user_status", "CREATE INDEX IF NOT EXISTS idx_report_runs_user_status ON report_runs (user_id, status, created_at)"),
        ("idx_report_notifications_run_recipient", "CREATE INDEX IF NOT EXISTS idx_report_notifications_run_recipient ON report_notifications (report_run_id, recipient_email)"),
    ]

    for index_name, sql in index_sql:
        try:
            await session.execute(text(sql))
            await session.commit()
            applied.append(f"index:{index_name}")
        except Exception as e:
            add_warning(f"index:{index_name}", str(e))
            logger.warning(f"  ⚠️ Create index {index_name}: {e}")

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
            add_warning("migration:scheduled_blocks", str(e))
            logger.warning(f"  ⚠️ Migration scheduled_blocks: {e}")

    # Integrations provider table (Whoop, wearables, etc.).
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
        await session.commit()
    except Exception as e:
        if "no such table" not in str(e).lower():
            add_warning("migration:integrations", str(e))
            logger.warning(f"  ⚠️ Migration integrations: {e}")

    # Enforce one derived Computer Time projection row per (habit_id, date, source).
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
            add_warning("migration:habit_logs_projection_unique", str(e))
            logger.warning(f"  ⚠️ Migration habit_logs.projection_unique: {e}")

    # One-time data migration: persistently rename computer habit records to "Computer Time".
    # This is idempotent and will no-op once data has already been renamed.
    try:
        await session.execute(text("""
            UPDATE habits
            SET name = 'Computer Time',
                updated_at = CURRENT_TIMESTAMP
            WHERE LOWER(TRIM(name)) IN ('computer use', 'computer activity')
        """))
        renamed_habits = int((await session.execute(text("SELECT changes()"))).scalar() or 0)

        await session.execute(text("""
            UPDATE habit_logs
            SET habit_name = 'Computer Time'
            WHERE habit_name IS NOT NULL
              AND LOWER(TRIM(habit_name)) IN ('computer use', 'computer activity')
        """))
        renamed_logs = int((await session.execute(text("SELECT changes()"))).scalar() or 0)

        if renamed_habits > 0 or renamed_logs > 0:
            applied.append(f"data:computer_time_rename habits={renamed_habits} logs={renamed_logs}")
            logger.info(
                "  ✅ Renamed computer habit records to Computer Time (habits=%s, logs=%s)",
                renamed_habits,
                renamed_logs,
            )
        await session.commit()
    except Exception as e:
        if "no such table" not in str(e).lower():
            add_warning("migration:computer_time_rename", str(e))
            logger.warning(f"  ⚠️ Migration computer_time_rename: {e}")

    return {
        "status": "degraded" if warnings else "ok",
        "warning_count": len(warnings),
        "warnings": warnings,
        "applied": applied,
    }


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
