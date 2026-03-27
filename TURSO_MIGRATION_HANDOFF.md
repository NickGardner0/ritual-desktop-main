# Turso Migration & RAG Pipeline Handoff for Codex

## What Was Done

We migrated Ritual's screen activity data from local SQLite (`~/.ritual/activity.db`) to Turso Cloud so the production FastAPI backend on Railway can access it. Previously, the AI chat and calendar daily summaries only worked in dev mode because Railway couldn't read the local SQLite database on the user's Mac.

### Data Migration (Complete)
- **session_retrieval_docs**: 3,481 rows in Turso (fully migrated) — primary search target for AI chat
- **context_snapshots**: 18,513 rows in Turso (fully migrated) — rich accessibility data for calendar summaries
- **context_sessions**: 3,549 rows in Turso (fully migrated)
- **activity_events**: ~542K rows, migration in progress (not needed for AI summaries, only for Computer Time stats)
- **Turbopuffer**: 3,114 session docs embedded with OpenAI text-embedding-3-small (document_path + ax_richness_score enriched)

### Code Changes Made

**Python backend changes:**

1. `apps/backend/services/watcher_service_local_db.py` — Added `get_turso_activity_conn()` that uses `libsql_experimental` to connect directly to Turso cloud for activity data (context_snapshots, session_retrieval_docs). Falls back to plain sqlite3 on the unencrypted replica, then to local activity.db.

2. `apps/backend/services/watcher_service_search.py` (~line 1006) — Modified `search_context_memory_impl()` to try Turso connection first via `get_turso_activity_conn()`, then fall back to local SQLite. When using Turso, skips `_attach_activity_view_if_needed()` since all tables are in one DB.

3. `apps/backend/api/watcher_activity.py` (~line 236) — Modified `get_screen_evidence()` endpoint to try Turso first → local activity.db → memory.db fallback chain. Also fixed an indentation bug in the local activity.db fallback path (lines 277-290). Modified `process_semantic_summaries()` to use activity.db path.

4. `apps/backend/services/session_embedding_service.py` — Modified `process_session_embeddings()` and `get_embedding_status()` to try Turso replica first for embedding new session docs.

5. `apps/backend/requirements.txt` — Added `libsql-experimental>=0.0.50` (was missing, causing Railway to fail silently on import).

**Rust watcher changes (for future — not deployed yet):**

6. `apps/desktop/src-tauri/crates/ritual-db/Cargo.toml` — Upgraded libsql from 0.6 to 0.9, enabled `sync` feature
7. `apps/desktop/src-tauri/crates/ritual-db/src/lib.rs` — Extended `DatabaseConfig` with `sync_url`, `sync_auth_token`, `sync_interval_secs`. Modified `RitualDatabase::open()` to use `Builder::new_remote_replica()` when Turso env vars are set.
8. `apps/desktop/src-tauri/src/ritual_database.rs` — Reads `TURSO_SYNC_URL` and `TURSO_AUTH_TOKEN` from env to enable embedded replica sync.

**Prompt/quality improvements (all local, need Railway deploy):**

9. `apps/dashboard/app/api/calendar/summary/route.ts` — Rewrote LLM prompt for Littlebird-parity: narrative style, anti-hallucination rules, time ranges, confidence tiers, cross-app threading
10. `apps/dashboard/lib/ai/chat-stream/orchestrator.ts` — Added applicationSummary, timeAgo, threading hints, evidence-grounding rules
11. Disabled Cohere reranking (wasn't adding value, only latency)

### Migration Scripts
- `apps/backend/scripts/migrate_activity_to_turso.py` — Full migration script (creates tables + bulk inserts)
- `apps/backend/scripts/fast_migrate_to_turso.py` — Faster version with 5K-row batch syncs
- `apps/backend/scripts/backfill_session_embeddings.py` — Embeds session docs to Turbopuffer

---

## The Current Problem

**Both the calendar daily summary and AI chat are still not working on the production Railway app.** After deploying via `railway up`, the endpoints return "No activity data found" or hang on "Thinking..." indefinitely.

### What's happening

The `get_turso_activity_conn()` function in `watcher_service_local_db.py` connects to Turso using `libsql_experimental`. It was verified working locally:

```python
# This works locally:
conn = get_turso_activity_conn()
# Returns: "Connected! context_snapshots: 18,513, Mar 20: 1,242"
```

But on Railway, something is preventing the connection from working. Possible causes:

### Hypothesis 1: `libsql_experimental` connection fails on Railway
The function creates a local replica file at `/app/.turso_activity_replica.db` and syncs from Turso cloud. On Railway's container filesystem, this might fail due to:
- Permissions on `/app/` directory
- DNS resolution differences in Railway's container
- The `libsql.connect()` + `sync()` call timing out during request handling

### Hypothesis 2: The Turso connection works but the screen-evidence/search endpoints have a different issue
The search pipeline (`search_context_memory_impl`) and screen-evidence endpoint both try `get_turso_activity_conn()` first. If it returns `None` (connection fails), they fall back to local SQLite which doesn't exist on Railway → returns empty results.

The chat "Thinking..." hang might be a different issue — the search could be returning empty, and the LLM synthesis call or Turbopuffer cloud call could be timing out.

### Hypothesis 3: The `.turso_replica.db` encryption is blocking reads
Railway's `connection.py` creates `.turso_replica.db` with encryption enabled (`TURSO_LOCAL_ENCRYPTION_KEY`). Our `get_turso_activity_conn()` creates a SEPARATE replica file (`.turso_activity_replica.db`) without encryption, which should work. But if the `libsql.connect()` call is interfering with the encrypted replica, it could cause issues.

---

## How to Debug

### Step 1: Check if `get_turso_activity_conn()` works on Railway
Add a debug endpoint or check Railway logs for the "Turso activity conn:" log line. The function logs at INFO level when it succeeds.

```python
# Add to api/watcher_activity.py temporarily:
@router.get("/debug-turso")
async def debug_turso():
    from services.watcher_service_local_db import get_turso_activity_conn
    conn = get_turso_activity_conn()
    if conn:
        count = conn.execute("SELECT COUNT(*) FROM context_snapshots").fetchone()[0]
        return {"status": "connected", "context_snapshots": count}
    return {"status": "failed"}
```

### Step 2: Check Railway logs for errors
Look for:
- "Failed to connect to Turso for activity data:" — libsql connection error
- "Fallback sqlite3 also failed:" — both paths failed
- Any Python tracebacks around the screen-evidence or memory/query endpoints

### Step 3: Test the search endpoint directly
```bash
curl -H "Authorization: Bearer <token>" \
  "https://backend-api-production-a37e.up.railway.app/api/watcher/screen-evidence?date=2026-03-20&limit=5"
```

If this returns `{"success": true, "window_titles": [], "ocr_snippets": [], "total_captures": 0}` then the Turso connection is failing silently.

### Step 4: If libsql_experimental doesn't work on Railway
The fallback approach is to use the Turso HTTP API instead of the embedded replica:
```python
# Instead of libsql.connect() with sync, use Turso's HTTP endpoint:
import requests
resp = requests.post(
    "https://ritual-nickgardner0651.aws-us-east-1.turso.io",
    headers={"Authorization": f"Bearer {auth_token}"},
    json={"statements": [{"q": "SELECT COUNT(*) FROM context_snapshots"}]}
)
```

---

## Architecture Overview

```
User's Mac (Tauri app)
├── ritual-watcher → writes to ~/.ritual/activity.db
│   (future: embedded replica syncs to Turso automatically)

Turso Cloud (libsql://ritual-nickgardner0651.aws-us-east-1.turso.io)
├── context_snapshots: 18,513 rows
├── session_retrieval_docs: 3,481 rows
├── context_sessions: 3,549 rows
├── activity_events: migrating (~542K)
├── + all app data (habits, users, wearables, etc.)

Turbopuffer Cloud
├── 3,114 session docs with OpenAI embeddings
├── Enriched with document_path + ax_richness_score

Railway (FastAPI backend)
├── get_turso_activity_conn() → libsql_experimental → Turso Cloud
│   ├── Tier 1: session_retrieval_docs (lexical search)
│   ├── Tier 2: context_snapshots (ax_richness ranking)
│   └── Tier 3: Turbopuffer (vector search via API)
├── RRF fusion merges all tiers
└── LLM synthesis (GPT-4o-mini via OpenAI)

Vercel (Next.js dashboard)
├── Calendar page → calls Railway /api/watcher/screen-evidence → Turso
├── Chat page → calls Railway /api/memory/query → Turso + Turbopuffer
├── Calendar summary → calls Railway /api/calendar/summary → GPT-4o
```

## Key Files

| File | Purpose |
|------|---------|
| `apps/backend/services/watcher_service_local_db.py` | `get_turso_activity_conn()` — THE critical function |
| `apps/backend/services/watcher_service_search.py` | Search pipeline with Turso-first logic (~line 1006) |
| `apps/backend/api/watcher_activity.py` | Screen evidence + semantic summary endpoints |
| `apps/backend/services/session_embedding_service.py` | Embedding pipeline (Turso → OpenAI → Turbopuffer) |
| `apps/backend/database/connection.py` | Turso Cloud connection for app data (habits, etc.) |
| `apps/backend/requirements.txt` | Must include `libsql-experimental>=0.0.50` |
| `apps/dashboard/app/api/calendar/summary/route.ts` | Calendar daily summary LLM prompt |
| `apps/dashboard/lib/ai/chat-stream/orchestrator.ts` | Chat AI system prompt + evidence formatting |

## Environment Variables (Railway must have these)

```
DATABASE_URL=libsql://ritual-nickgardner0651.aws-us-east-1.turso.io?authToken=<jwt>
TURSO_LOCAL_ENCRYPTION_KEY=<key>
OPENAI_API_KEY=<key>
TURBOPUFFER_API_KEY=<key>
RITUAL_MEMORY_CLOUD_ENABLED=true
```

## What Needs to Happen

1. **Debug why `get_turso_activity_conn()` fails on Railway** — this is the single blocker. Once Railway can read from Turso, both calendar and chat will work.
2. **Optionally**: Finish `activity_events` migration for Computer Time stats (low priority — Tinybird fallback covers this).
3. **Optionally**: Wire the Rust watcher to use Turso embedded replicas (Step 1 code is written but not deployed in the desktop app yet — requires a new macOS app build).
