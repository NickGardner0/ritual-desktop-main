# memory.db Removal Plan

## Executive Summary

`memory.db` (~/.ritual/memory.db) is a local SQLite database that was the backbone of Ritual's original OCR-based screen recording pipeline. The app has since migrated to an accessibility-based capture system (context_snapshots + session_retrieval_docs in activity.db) with cloud vector search via Turbopuffer. **Every capability memory.db provides now has a production replacement**, but the legacy code paths still touch it on every /chat query, adding latency and complexity.

### Current State
- **No new data is being written** to memory.db (the native recorder is disabled in `recorder_disabled.rs`)
- **Historical data exists**: 95,589 ocr_frames, 17,429 search_chunks, 26,168 chunk_embeddings, 18,682 outbox rows
- **Still opened on every /chat query** for freshness checks and OCR fallback
- **Primary retrieval** already comes from activity.db/Turso + Turbopuffer

### Impact of Removal
- Eliminates unnecessary SQLite I/O on every AI chat query
- Removes ~6 legacy backend services and 1 dashboard component
- Simplifies the search codepaths (one pipeline instead of two)
- Does NOT shrink the app bundle (memory.db is runtime data in ~/.ritual/, not bundled)
- Does NOT lose any active data capture (recorder is already disabled)

---

## What memory.db Contains

| Table | Row Count | Purpose | Still Getting New Data? |
|-------|-----------|---------|------------------------|
| `ocr_frames` | 95,589 | OCR'd screen captures | **No** — recorder disabled |
| `search_chunks` | 17,429 | Chunked OCR text for search | **No** — recorder disabled |
| `chunk_embeddings` | 26,168 | Embedding job queue/status | **No** — replaced by session_embedding_service |
| `memory_upload_outbox` | 18,682 | Upload staging queue | **No** — replaced by session_embedding_service |
| `pipeline_watermarks` | — | Embedding job tracking | **No** |

---

## What Replaces Each Capability

| Capability | Old (memory.db) | New (already in production) | Status |
|---|---|---|---|
| Screen content capture | `ocr_frames` (OCR from screen recorder) | `context_snapshots` + `session_retrieval_docs` (accessibility/screen reader) in activity.db → Turso | **Fully replaced** |
| Text search | `ocr_frames_fts` (FTS on OCR text) | Lexical scoring on `session_retrieval_docs` + Turbopuffer BM25 | **Fully replaced** |
| Semantic search | `search_chunks` → OpenAI embeddings → Turbopuffer | `session_retrieval_docs` → OpenAI embeddings → Turbopuffer (direct, no queue) | **Fully replaced** |
| Freshness checks | `ocr_frames` max timestamp | `session_retrieval_docs.chunk_end_ts` + `video_chunks.end_time` | **Fully replaced** (code already prioritizes these) |
| Cloud backfill | `search_chunks` → `memory_upload_outbox` → cloud | `session_embedding_service` embeds directly, no staging | **Fully replaced** |
| Reranking | Cloud memory_chunks → Cohere | Turbopuffer candidates → Cohere (same reranker, different source) | **Fully replaced** |

---

## Removal Phases

### Phase 1: Backend — Remove memory.db from /chat query path
**Risk: Medium | Impact: Highest (removes latency from every chat query)**

These changes make the search endpoints stop opening memory.db entirely.

#### 1a. `apps/backend/services/watcher_service_search.py`
- **`search_context_memory_impl()`**: Currently opens memory.db as main connection and attaches activity.db. Change to open activity.db (or Turso replica) directly. Remove OCR fallback queries against `ocr_frames` / `ocr_frames_fts`.
- **`query_memory_impl()`**: Same pattern — opens memory.db, attaches activity. Change to activity-first. Remove `_auto_backfill_cloud_if_needed()` call (no longer needed).
- **`_compute_freshness()`**: Remove checks against `ocr_frames`, `search_chunks`, `chunk_embeddings`. Use `session_retrieval_docs.chunk_end_ts` and `video_chunks.end_time` (code already has these paths, just remove the memory.db branches).
- **`search_screen_recordings_impl()`**: Remove `ocr_frames_fts` fallback. The Tauri hybrid bridge + session_retrieval_docs lexical search already handle this.

#### 1b. `apps/backend/services/watcher_service_local_db.py`
- **`get_local_memory_db_path_impl()`**: This function resolves the memory.db path. It can be deprecated/removed after Phase 1a.

#### 1c. `apps/backend/api/memory.py`
- **`_local_pipeline_snapshot()`**: Remove queries against `ocr_frames`, `search_chunks`, `chunk_embeddings`, `memory_upload_outbox`. Replace with a simpler status check against `session_retrieval_docs` count + `embedded_at` coverage.

### Phase 2: Backend — Remove memory cloud pipeline services
**Risk: Low | Impact: Removes dead background jobs**

These services powered the old `search_chunks → cloud memory` pipeline. The new `session_embedding_service.py` replaces all of them.

| File | Action | Why Safe |
|---|---|---|
| `apps/backend/services/memory_backfill_service.py` | **Delete** | Old pipeline: local search_chunks → cloud. Replaced by session_embedding_service |
| `apps/backend/services/memory_embedding_service.py` | **Delete** | Old embedding queue processor for memory_chunks. Replaced by session_embedding_service |
| `apps/backend/services/memory_ingest_service.py` | **Delete** | Received chunks from dashboard uploader. No longer needed |
| `apps/backend/services/memory_cloud_store.py` | **Delete** | Created/managed .memory_cloud.db schema. No longer needed |
| `apps/backend/services/memory_retention_service.py` | **Delete** | Cleaned up expired memory_chunks. No longer needed |
| `apps/backend/services/memory_cloud_query_service.py` | **Review** | May still be used as Turbopuffer fallback — verify before deleting |

Also remove the corresponding API endpoints:
- `POST /api/memory/ingest-chunks` (in `apps/backend/api/memory.py`)
- Any background job registrations in `apps/backend/main.py` that reference these services

### Phase 3: Dashboard — Remove memory cloud uploader
**Risk: Low | Impact: Removes background upload churn**

| File | Action | Why Safe |
|---|---|---|
| `apps/dashboard/components/memory-cloud-uploader.tsx` | **Delete** | Uploads search_chunks via outbox to cloud. Replaced by session_embedding_service |

Remove references to this component from the dashboard's root layout/providers.

### Phase 4: Desktop — Remove memory.db initialization and commands
**Risk: Low | Impact: Removes dead Tauri commands**

#### 4a. `apps/desktop/src-tauri/src/ritual_database.rs`
- Remove `get_memory_db_path()` function
- Remove memory.db initialization in `initialize_database()`
- Remove `seed_memory_upload_outbox` Tauri command
- Remove `claim_memory_upload_outbox_batch` Tauri command
- Remove `ack_memory_upload_outbox_batch` Tauri command
- Remove `log_startup_pipeline_snapshot()` memory.db queries

#### 4b. `apps/desktop/src-tauri/crates/ritual-db/src/vector.rs`
- Remove `rebuild_recent_search_chunks()`, `rebuild_oldest_missing_search_chunks()`, `ensure_chunk_embedding_queue()`, `embed_pending_chunks()` — all operate on memory.db tables that are no longer written to.

#### 4c. `apps/desktop/src-tauri/crates/ritual-db/src/schema.rs`
- Remove CREATE TABLE statements for: `capture_events_raw`, `search_chunks`, `search_chunk_frames`, `chunk_embeddings`, `pipeline_watermarks`

#### 4d. `apps/desktop/src-tauri/src/recorder_disabled.rs`
- Remove OCR frame cache and legacy Tauri commands. These provide read-only access to historical ocr_frames that will no longer exist.

### Phase 5: Cleanup
**Risk: None | Impact: Code hygiene**

- Remove `apps/backend/services/memory_cloud_store.py` references from `__init__.py` / imports
- Remove test files: `apps/backend/tests/test_memory_*.py` (6 files)
- Delete `~/.ritual/memory.db` from local dev machines (users will need to do this manually or via a migration)
- Update any documentation that references the old pipeline

---

## Files Affected (Complete List)

### Delete entirely (7 files):
1. `apps/backend/services/memory_backfill_service.py`
2. `apps/backend/services/memory_embedding_service.py`
3. `apps/backend/services/memory_ingest_service.py`
4. `apps/backend/services/memory_cloud_store.py`
5. `apps/backend/services/memory_retention_service.py`
6. `apps/dashboard/components/memory-cloud-uploader.tsx`
7. `apps/backend/tests/test_memory_*.py` (6 test files)

### Modify (8 files):
1. `apps/backend/services/watcher_service_search.py` — Remove memory.db opens, OCR fallback, freshness checks
2. `apps/backend/services/watcher_service_local_db.py` — Remove `get_local_memory_db_path_impl()`
3. `apps/backend/api/memory.py` — Remove `_local_pipeline_snapshot()` memory.db queries, remove ingest endpoint
4. `apps/backend/main.py` — Remove background job registrations for deleted services
5. `apps/desktop/src-tauri/src/ritual_database.rs` — Remove memory.db init, outbox commands
6. `apps/desktop/src-tauri/crates/ritual-db/src/vector.rs` — Remove chunk rebuild/embed functions
7. `apps/desktop/src-tauri/crates/ritual-db/src/schema.rs` — Remove memory.db table definitions
8. `apps/desktop/src-tauri/src/recorder_disabled.rs` — Remove OCR frame cache

### Review before deleting (1 file):
1. `apps/backend/services/memory_cloud_query_service.py` — Verify no active callers remain after Phase 1

---

## Verification Checklist

Before each phase, verify:

- [ ] `session_embedding_service.py` is running and embedding new session docs → Turbopuffer
- [ ] `/api/memory/search-context` returns results using only activity.db/Turso data
- [ ] `/api/memory/query` returns results using only Turbopuffer + activity.db
- [ ] AI chat queries ("What did I work on yesterday?", "How much time on Chrome?") still return rich, accurate results
- [ ] No Python import errors after deleting services
- [ ] No Tauri build errors after removing commands
- [ ] Dashboard compiles without memory-cloud-uploader component

After all phases:

- [ ] Run full /chat test suite (60 tests, 10 suites)
- [ ] Test these queries manually:
  - "What did I work on yesterday?" (context memory path)
  - "How much time did I spend on Chrome?" (screen time path)
  - "Weekly habit recap" (fast-path, should be unaffected)
  - "What was I doing in Cursor last week?" (semantic search path)
- [ ] Verify Vercel timing logs show no memory.db-related latency
- [ ] Verify Railway backend logs show no memory.db file-not-found errors

---

## Risk Assessment

| Risk | Likelihood | Mitigation |
|---|---|---|
| Losing historical OCR data | **Expected** | Data is stale (recorder disabled). New accessibility pipeline captures richer data. If needed, memory.db can be backed up before deletion. |
| Breaking /chat for users without session_retrieval_docs | **Low** | All active users have been generating session docs since the accessibility pipeline shipped. |
| Breaking cloud memory queries | **Low** | Turbopuffer already serves as primary vector store. memory_cloud.db is a fallback that's redundant with Turbopuffer. |
| Rust build errors from removing commands | **Low** | Remove Tauri command registrations in main.rs alongside the implementations. |
| Breaking memory-cloud-uploader consumers | **None** | Component only uploads to a pipeline we're deleting. No other component depends on it. |

---

## Timeline Recommendation

- **Phase 1** (backend search paths): Do first — highest impact, directly reduces /chat latency
- **Phase 2** (delete dead services): Do alongside Phase 1 — low risk, high cleanup value
- **Phase 3** (dashboard uploader): Do after Phase 2 — removes background network churn
- **Phase 4** (desktop/Rust): Do last — requires Tauri rebuild and app re-release
- **Phase 5** (cleanup): Do anytime after Phase 4

Phases 1-3 can be deployed as a single backend + dashboard release. Phase 4 requires a desktop app update.
