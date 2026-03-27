# Per-User Turso Rollout

## Required backend env vars

Add these on the backend host before rollout:

- `TURSO_PLATFORM_API_TOKEN`
- `TURSO_ORGANIZATION`
- `TURSO_GROUP`
- `TURSO_DATABASE_PREFIX=ritual_user`
- `TURSO_MIGRATION_GATE_USER_ID=<rollout-clerk-user-id>`

The existing shared activity replica still uses:

- `DATABASE_URL`
- `TURSO_LOCAL_ENCRYPTION_KEY`

## 1. Verify backend host env

From the backend host:

```bash
cd /path/to/repo/apps/backend
python - <<'PY'
import os
required = [
    "DATABASE_URL",
    "TURSO_PLATFORM_API_TOKEN",
    "TURSO_ORGANIZATION",
    "TURSO_GROUP",
    "TURSO_MIGRATION_GATE_USER_ID",
]
missing = [key for key in required if not (os.getenv(key) or "").strip()]
print({"missing": missing, "ok": not missing})
PY
```

## 2. Provision and migrate the rollout user

```bash
cd /path/to/repo/apps/backend
python scripts/run_per_user_turso_migration.py \
  --user-id "$TURSO_MIGRATION_GATE_USER_ID" \
  --ensure-provisioned \
  --migrate
```

The script prints:

- provisioned DB name and URL
- migration timestamp
- per-table source/target counts
- exact-match results
- rollout-floor checks

The rollout user should only cut over when:

- `context_snapshots`, `session_retrieval_docs`, `context_sessions`, and `activity_events` all have exact source/target matches
- rollout floor checks are all `true`
- `migrated_at` is non-null

## 3. Verify authenticated backend endpoints

Get a real Clerk bearer token from an authenticated browser session or the desktop app, then run:

```bash
cd /path/to/repo
python apps/backend/scripts/verify_per_user_turso_endpoints.py \
  --base-url "https://your-backend-host" \
  --bearer-token "<real-clerk-jwt>"
```

Expected:

- `GET /api/user/profile` returns `200`
- `GET /api/user/turso-sync-config` returns `200`
- sync-config payload contains:
  - `sync_url`
  - `auth_token`
  - `expires_at`
  - `database_name`

If the rollout user has not passed migration verification yet, `/api/user/turso-sync-config` should return `409`.

## 4. Desktop verification

Launch the desktop app, sign in with the rollout user, then confirm:

```bash
cat ~/.ritual/turso_sync.json
```

Expected keys:

- `sync_url`
- `auth_token`
- `expires_at`
- `database_name`

Then confirm the watcher keeps running after token refresh:

```bash
ls -l ~/.ritual/turso_sync.json
```

Wait for a refresh window or force one by shortening token TTL on the backend, then verify:

- `~/.ritual/turso_sync.json` updates
- the desktop app stays connected
- watcher continues writing to `~/.ritual/activity.db`

## 5. Backend health

After rollout, confirm:

```bash
curl -s http://127.0.0.1:8000/health | jq
```

Expected:

- top-level `status` is `healthy`
- `checks.database.status` is `ok`

## Notes

- This rollout cannot be fully proven without the Turso platform env vars on the real backend host.
- Manual desktop sign-in still requires real interaction; the scripts here only reduce the operational ambiguity around the rollout.
