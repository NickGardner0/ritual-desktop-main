# Ritual Context Retrieval / RAG Pipeline Updates

## Overview

These changes simplify and improve Ritual's context retrieval pipeline to achieve Littlebird-parity AI summary quality. The core architectural change is a **simplified cloud embedding pipeline** that reads directly from `activity.db/session_retrieval_docs` and uploads to Turbopuffer, replacing the old multi-hop path through `memory.db`.

## Architecture: Before vs After

### Before (broken — recorder stopped March 18)
```
ritual-recorder (dead) → ocr_frames (memory.db, stale)
    → search_chunks → memory_chunks → memory_embedding_jobs
    → OpenAI embedding → Turbopuffer
```

### After (working — simplified pipeline)
```
ritual-watcher (running) → context_snapshots + session_retrieval_docs (activity.db)
    │
    ├── LOCAL SEARCH (Tiers 1+2) — lexical + recency + ax_richness scoring
    │   Reads directly from activity.db
    │
    └── CLOUD SEARCH (Tier 3) — OpenAI embeddings + Turbopuffer hybrid search
        session_retrieval_docs → OpenAI text-embedding-3-small → Turbopuffer
        Now includes: document_path, ax_richness_score
        Results sorted chronologically for overview queries
```

## Files Modified

### Backend (Python — `apps/backend/`)

#### `services/session_embedding_service.py` — **NEW FILE**
Simplified embedding pipeline: `activity.db/session_retrieval_docs` → OpenAI → Turbopuffer in one pass.
- `process_session_embeddings(batch_size)` — main entry point
- `get_embedding_status()` — returns total/embedded/pending counts
- Tracks progress via `embedded_at` column on `session_retrieval_docs`
- JOINs to `context_snapshots` to pick up `document_path` and `ax_richness_score` per session
- Truncates text attributes to 1200 chars for Turbopuffer's 4096-byte limit
- Marks failed docs with `embedded_at = -1` to skip on retry

#### `api/memory.py`
- Added `POST /api/memory/process-session-embeddings` — trigger a batch of session embeddings
- Added `GET /api/memory/session-embedding-status` — check pipeline progress

#### `api/watcher_activity.py` — Screen evidence endpoint changes
1. **Database priority**: Tries `activity.db` first (where watcher writes), falls back to `memory.db`
2. **JIT semantic summaries**: Calls `process_pending_summaries(db_path, 30)` before returning results — ensures fresh captures have semantic summaries when user clicks a calendar day
3. **Chronological evidence**: Replaced `PARTITION BY app_name, window_title` with `LAG()` window function that enforces 3-minute minimum gap. Evidence now flows chronologically for cross-app project threading.
4. **Turbopuffer fallback**: When local `activity.db` is unavailable (production Railway), falls back to querying Turbopuffer for screen evidence. This is critical for production deployment.

#### `services/memory_turbopuffer_service.py`
- Added `document_path` (string) and `ax_richness_score` (float) to the Turbopuffer upsert schema

#### `services/watcher_service_search.py`
- After RRF fusion of local + cloud results, overview queries now re-sort citations chronologically by timestamp — enables the LLM to see temporal flow for cross-app project threading

#### `services/memory_semantic_summary_service.py`
- The endpoint `POST /api/watcher/process-semantic-summaries` now reads from `activity.db` (was `memory.db`)

#### `main.py`
- Disabled the background semantic summary worker loop — summaries are now JIT-only (triggered when user requests screen evidence), saving LLM costs for captures the user never looks at

#### `scripts/backfill_session_embeddings.py` — **NEW FILE**
One-time backfill script to embed all existing session docs to Turbopuffer.
```bash
cd apps/backend && python scripts/backfill_session_embeddings.py
```
Status: 3,135 docs backfilled successfully. Run again to catch new sessions.

### Dashboard (TypeScript — `apps/dashboard/`)

#### `app/api/calendar/summary/route.ts` — Calendar daily summary prompt
1. **Tiered confidence**: Replaced flat conservative rules with three tiers:
   - RICH evidence (git commits, OCR code, file paths) → detailed confident narrative
   - MODERATE evidence (window titles, semantic summaries) → specific measured statements
   - THIN evidence (app name + domain only) → one factual sentence
2. **Cross-app threading instruction**: "When captures from DIFFERENT apps appear close in time and share keywords/file paths/topics, thread them into ONE workstream"
3. **Adjusted banned phrases**: Removed "suggesting" and "indicating" (useful for rich evidence), added "spent time in"

#### `lib/ai/chat-stream/orchestrator.ts` — Chat system prompt
1. **Cross-app threading**: Added to CONTEXT MEMORY NARRATIVE FORMAT section — instructs LLM to thread temporally-close captures across different apps into one workstream by shared project/task
2. **Evidence-grounding rule 8**: "MATCH CONFIDENCE TO EVIDENCE DEPTH" — rich evidence gets confident narrative, thin evidence gets brevity

## Production Deployment Considerations

### What works from Railway (cloud backend)
- Tier 3 cloud search (Turbopuffer) — fully functional
- Screen evidence via Turbopuffer fallback — returns chronological evidence with document_path and ax_richness_score
- Calendar daily summary — uses Turbopuffer fallback when local DB unavailable
- Chat queries — Turbopuffer cloud search provides citations

### What requires local access (dev only)
- Tier 1+2 local search — reads `activity.db` directly
- JIT semantic summaries — reads/writes `activity.db`
- Git commits endpoint — scans local filesystem for repos

### Required environment variables (Railway)
```
OPENAI_API_KEY=sk-...              # For LLM summaries + embeddings
TURBOPUFFER_API_KEY=tpuf_...       # Cloud vector store
RITUAL_MEMORY_CLOUD_ENABLED=true   # Enable Tier 3 cloud search
```

### Keeping Turbopuffer in sync
New session docs are created by the Rust watcher as the user works. To keep Turbopuffer current, the Tauri desktop app needs to periodically call:
```
POST /api/memory/process-session-embeddings?batch_size=32
```
This should be triggered:
- On a timer (every 5 minutes while the app is running)
- Or when the user opens the chat/calendar (just-in-time)

The endpoint is idempotent — it only processes docs where `embedded_at IS NULL`.

### Session embedding sync flow (production)
```
User's Mac:
  ritual-watcher → activity.db (context_snapshots + session_retrieval_docs)
       │
       │ Tauri app periodically calls Railway backend:
       │ POST /api/memory/process-session-embeddings
       │ (backend reads activity.db... wait, this won't work from Railway)
       │
       ▼
  THIS IS THE GAP: Railway can't read the user's local activity.db
```

**The remaining gap**: The `process-session-embeddings` endpoint reads from `activity.db` which lives on the user's Mac. From Railway, this endpoint can't access the local file.

**Options to close this gap:**
1. **Push from Tauri**: The Tauri app calls a NEW endpoint that accepts session doc payloads (text + metadata) and the Railway backend embeds + uploads to Turbopuffer. The Tauri app reads `activity.db` locally and POSTs the data.
2. **Local embedding**: The Tauri app embeds locally (using the Rust fastembed/OpenAI) and calls Turbopuffer directly, bypassing the Railway backend entirely.
3. **Bundled local backend**: Run a lightweight FastAPI server inside the Tauri app as a sidecar process.

Option 1 is simplest: add a `POST /api/memory/ingest-and-embed-sessions` endpoint that accepts session doc data in the request body (no local DB read needed), and have the Tauri app send batches periodically.

## Testing

```bash
cd apps/backend

# Run all tests (1 pre-existing failure in test_memory_contextual_retrieval.py)
python -m pytest tests/ -x -q --ignore=tests/test_memory_contextual_retrieval.py

# Run Littlebird parity tests specifically
python -m pytest tests/test_littlebird_parity.py -v

# Check embedding pipeline status
python -c "
import asyncio
from services.session_embedding_service import get_embedding_status
asyncio.run(get_embedding_status())
"

# Backfill all session docs to Turbopuffer
python scripts/backfill_session_embeddings.py
```

## Turso Cloud Migration (Production Architecture)

### Problem
The screen activity data lives in local SQLite (`~/.ritual/activity.db`) which the Railway production backend cannot access. The search pipeline, calendar summaries, and all 6 Littlebird parity improvements only work in dev mode.

### Solution
Migrate activity data to Turso Cloud (same database used for app data). The Tauri desktop app writes to a local embedded replica that auto-syncs to Turso cloud. The Railway backend reads from its own synced replica.

### Changes Made

**Rust watcher (Tauri desktop app):**
- `crates/ritual-db/Cargo.toml` — upgraded libsql from 0.6 to 0.9 (adds `sync` feature)
- `crates/ritual-db/src/lib.rs` — extended `DatabaseConfig` with `sync_url`, `sync_auth_token`, `sync_interval_secs`; modified `RitualDatabase::open()` to use `Builder::new_remote_replica()` when Turso env vars are set
- `src/ritual_database.rs` — reads `TURSO_SYNC_URL` and `TURSO_AUTH_TOKEN` env vars; falls back to local-only if not set

**Python backend:**
- `services/watcher_service_local_db.py` — added `get_turso_activity_conn()` that opens `.turso_replica.db` for activity data
- `services/watcher_service_search.py` — `search_context_memory_impl()` tries Turso replica first, falls back to local SQLite
- `api/watcher_activity.py` — `get_screen_evidence()` and `process_semantic_summaries()` try Turso replica first

**Migration script:**
- `scripts/migrate_activity_to_turso.py` — creates tables in Turso and bulk-inserts from local activity.db

### Env vars needed for production
```
TURSO_SYNC_URL=libsql://ritual-xxx.turso.io
TURSO_AUTH_TOKEN=<jwt-token>
```

### Data flow in production
```
User's Mac:
  ritual-watcher → local activity.db (embedded replica)
       ↕ auto-sync (every 30s)
  Turso Cloud (libsql://ritual-xxx.turso.io)
       ↕ auto-sync (every 5s)
Railway:
  FastAPI backend → .turso_replica.db → search/evidence queries
       → OpenAI for LLM synthesis
```

## Summary of Quality Improvements

| Change | What it does | Impact |
|--------|-------------|--------|
| JIT semantic summaries | Pre-analyzed "what user was doing" per capture, generated on-demand | LLM gets rich semantic descriptions instead of raw OCR |
| Chronological evidence | Evidence in temporal order, not grouped by app | Enables cross-app project threading narratives |
| document_path in Turbopuffer | File paths stored in cloud vector store | LLM can reference specific files in summaries |
| ax_richness_score in Turbopuffer | Capture quality signal in cloud | Better ranking of evidence |
| Tiered confidence prompt | Rich evidence → detailed narrative; thin → brief | Eliminates generic filler while enabling confident assertions |
| Cross-app threading hint | LLM instruction to thread captures across apps by project | "Plaid / Spending Integration" instead of separate Codex + Chrome + Cursor sections |
| Evidence-grounding rule 8 | Match confidence to evidence depth | Prevents both hallucination AND unnecessary conservatism |
| Turbopuffer fallback for screen-evidence | Calendar summary works from cloud backend | Production calendar summaries possible without local DB |
