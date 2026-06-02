# Prod Incident Review — Habit Logging 500s (2026-05-28)

## Summary

Logging any habit (e.g. "consumed 4mg of nicotine") failed in the app with
**"Failed to log your habit. Please try again."** The root cause was a
**database schema drift**: deployed backend code referenced columns/tables that
had never been created in the production Turso database. Fixed by manually
applying the pending Alembic migrations to the prod `ritual` DB.

This was **not** a bug in the habit-logging code itself.

## Symptoms

- UI: `POST /api/logs/batch` → 500 → "Failed to log your habit."
- Sentry (`ritual-backend`), three recurring error clusters:

| Error | Missing schema | Impact |
|---|---|---|
| `no such column: habit_logs.location_lat` | `habit_logs` location columns | **Habit logging (every log)** |
| `no such column: activity_events.device_platform` | `activity_events` Biome columns | SMS copilot loop (failing every ~5 min) |
| `no such table: user_location_pings` | whole table | Location retention cleanup |

## Root Cause

The branch `codex/release-0.1.1-prep` added new schema in two migrations:

- `apps/backend/migrations/versions/20260527_0001_add_location_tracking.py`
  — creates `user_location_pings`, adds `habit_logs.location_lat/lon`
- `apps/backend/migrations/versions/20260528_0001_add_biome_iphone_activity_columns.py`
  — adds `activity_events.device_platform`, location columns, `event_uid`, etc.

The code that **reads** those columns (`apps/backend/database/models.py`) was
deployed and running on Railway, but the migrations were **never applied to the
prod database**. Code expected columns the DB didn't have → `no such column` /
`no such table` 500s.

### Why migrations didn't run automatically

The deferred startup maintenance task is now **verify-only**
(`apps/backend/database/connection.py::complete_database_startup_maintenance`):
it runs `SELECT 1` + replica validation and returns `status: "verify_only"`. It
**does not apply Alembic migrations**, even with `ENABLE_STARTUP_MAINTENANCE_TASK=1`.
So schema changes must be applied manually.

## Investigation

1. Read the provided Railway log + correlated with Sentry — identified
   `POST /api/logs/batch` → `habits_service.batch_log_habits` → SELECT on
   `habit_logs` including the missing `location_lat` column.
2. Confirmed the new columns/tables exist in models + migrations on the branch.
3. Verified the prod `ritual` Turso DB was missing them, and had **no
   `alembic_version` table** (Alembic had never tracked this DB).
4. Confirmed all three migrations are **idempotent** (`_table_exists` /
   `_column_exists` guards + `Base.metadata.create_all` with checkfirst), so
   replaying the whole chain against the existing schema is safe.

## Fix Applied

Ran `alembic upgrade head` against the prod `ritual` Turso DB
(`ritual-nickgardner0651.aws-us-east-1.turso.io`).

### Two workarounds were required

1. **`env.py` can't connect to Turso.** `apps/backend/migrations/env.py`
   rejects `libsql://` URLs and builds its own engine with no `connect_args`, so
   it can't pass the auth token. Working form for a direct remote connection:
   ```
   create_engine("sqlite+libsql://<HOST>/?secure=true",
                 connect_args={"auth_token": TOKEN})
   ```
   (The token must go in `connect_args`; `?authToken=...` in the URL yields
   `Unauthorized: empty JWT token`.)

2. **Alembic's transaction commit doesn't flush through the libsql dialect.**
   Wrapping migrations in `ctx.begin_transaction()` silently failed to persist
   `ALTER TABLE`/`INSERT` — only auto-committed `CREATE TABLE` survived, leaving
   a partial schema and no `alembic_version` row. Fixed by calling
   `connection.commit()` explicitly after `ctx.run_migrations()`.
   (`isolation_level="AUTOCOMMIT"` does not work — the libsql Connection's
   `isolation_level` is not writable.)

A standalone runner (`/tmp/run_prod_migration.py`) bypassed `env.py` via
`EnvironmentContext`, injected the connection, ran migrations, then committed
explicitly. No committed project files were modified.

### Safety steps

- Took a full backup before any writes:
  `.db-backups/ritual-20260528-095709.sql` (19 MB, verified complete with
  trailing `COMMIT;`).
- Migrations are idempotent, so the run was safe to repeat (it took two
  attempts — the first did not commit the ALTERs; see workaround #2).

## Verification

Fresh-connection queries against prod `ritual` after the fix:

- `alembic_version` = `20260528_0001` (chain head) ✓
- `habit_logs`: `location_lat`, `location_lon` present ✓
- `activity_events`: `device_platform`, `location_lat`, `biome_source_file`,
  `biome_is_provisional` present ✓
- `user_location_pings` table exists ✓

## Scope Notes

- **Backend uses the central `ritual` DB** for `habit_logs` / `activity_events`
  (confirmed: the prod errors matched exactly the columns missing there).
- **Per-user DBs** (`ritual-user-*`) are empty stubs — no `habit_logs`, no
  `alembic_version`. Not used by the backend yet, so no action needed now. When
  the per-user read path is flipped on, those DBs will need the same migration.
- **Codex's uncommitted location/Biome changes did not cause this** — they are
  application logic built on top of this same schema and are not deployed. They
  depend on this schema being present (now it is).

## Tokens / Cleanup

- Several `ritual` access tokens were minted via `turso db tokens create ritual`
  to run the migration; they remain valid.
- **Do not** run `turso db tokens invalidate ritual` — it rotates the signing
  key and would break the token Railway's backend uses.

## Follow-ups / Recommendations

1. **Add a manual migration step to the release process.** Since startup no
   longer auto-migrates, every schema-changing deploy needs
   `alembic upgrade head` against prod. Consider wiring this as a deploy step or
   release-checklist item.
2. **Fix `migrations/env.py` to support Turso** (accept an auth token via env
   var into `connect_args`, and commit explicitly) so migrations can be run with
   the standard `alembic upgrade head` / `scripts/run_database_migrations.py`
   instead of a one-off script.
3. **Plan per-user DB migrations** before flipping the per-user read path.
4. **Retry logging a habit in the app** to confirm the end-to-end fix.
