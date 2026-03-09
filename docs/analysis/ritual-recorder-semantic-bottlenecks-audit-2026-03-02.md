# Ritual Recorder + OCR + Embeddings + Vector Search Bottlenecks Audit

**Generated:** March 2, 2026 (America/New_York)  
**Purpose:** Provide a concrete, code-grounded bottleneck report you can hand to other LLMs for architecture recommendations and implementation planning.

## 1) Executive Summary

Your current stack has improved materially (intent routing, chunk schema, confidence/freshness signals, stricter semantic fallback policy), but there are still high-impact bottlenecks that explain why answers can feel inaccurate:

1. Freshness status can degrade from stale `video_chunks` timestamps even when OCR/activity are fresh.
2. Semantic retrieval quality is inconsistent when chunk embeddings are missing or sparse.
3. Legacy fallback paths still exist and can reintroduce activity-based “semantic” looking answers.
4. Capture is still loop-based with trigger heuristics, not truly event-driven, so evidence quality can drift.
5. Ground-truth systems are conceptually separated, but UI/tooling can still blur them in user interpretation.
6. Validation gates exist but are too thin by default (small fixture, opt-in execution).

---

## 2) Current Pipeline (As Implemented)

### Ingestion and storage
- Recorder writes to canonical `~/.ritual/ritual.db`:
  - `apps/desktop/src-tauri/src/recorder.rs:280-317`
- Schema v4 contains:
  - `capture_events_raw`, `search_chunks`, `search_chunk_frames`, `chunk_embeddings`, `pipeline_watermarks`
  - `apps/desktop/src-tauri/crates/ritual-db/src/schema.rs:16,46-126`

### Search and retrieval
- Backend route `POST /api/watcher/query-memory` (intent-routed):
  - `apps/backend/api/watcher_activity.py:260-285`
- Legacy route still available:
  - `GET /api/watcher/search-screen`
  - `apps/backend/api/watcher_activity.py:228-253`
- Query-memory route resolves relative date windows centrally:
  - `apps/backend/services/watcher_service_search.py:663-739`
- Semantic strict intents disable activity fallback:
  - `apps/backend/services/watcher_service_search.py:1562-1573`

### Hybrid/vector path
- Backend tries local bridge first; falls back to local FTS/lexical:
  - `apps/backend/services/watcher_service_search.py:270-289`
- Bridge emits warning when embeddings/pending backlog exists:
  - `apps/desktop/src-tauri/src/local_search_bridge.rs:239-243`
- Rust hybrid search uses chunk candidates first, frame vectors second:
  - `apps/desktop/src-tauri/crates/ritual-db/src/vector.rs:1076-1092`

---

## 3) Runtime Snapshot (Local DB Evidence)

Snapshot run around **March 2, 2026 ~20:52 ET** from `~/.ritual/ritual.db`.

### Recency / lag signals
- `ocr_max` ~= current time (lag ~15s)
- `activity_max` ~= current time (lag ~0s)
- `chunk_max` ~= current time (lag ~15s)
- `video_max` lag ~996s

### Coverage indicators
- `ocr_frames_total`: 30,330
- `ocr_frames_7d`: 1,414
- `ocr_embeddings_ok`: 23,569
- `search_chunks_total`: 491
- `search_chunk_frame_links`: 1,393
- `chunk_embeddings_rows`: 0 (at snapshot time)
- `chunk_embeddings_ok`: 0

### Worker state
- `embedding_worker_state.is_running`: 1
- `embedding_worker_state.last_run_at`: near current time
- `pipeline_watermarks.pending_chunks`: 494

Interpretation: frame pipeline is active, but chunk embedding coverage was effectively empty at snapshot. That forces semantic quality to lean on fallback behaviors.

---

## 4) Primary Bottlenecks

## A) Freshness misclassification due to capture timestamp source

`_compute_freshness()` uses:
- `last_capture_ts = MAX(COALESCE(end_time,start_time)) FROM video_chunks` first
- only falls back to OCR timestamp when capture timestamp is null
- `apps/backend/services/watcher_service_search.py:995-1003`

Then `degraded_semantic` triggers when `capture_lag > 120s`:
- `apps/backend/services/watcher_service_search.py:1140-1145`

### Why this is a bottleneck
- In your local snapshot, OCR/activity are fresh, but `video_chunks` lags heavily.
- Result: semantic mode can be degraded even when the usable OCR evidence is recent.
- This directly causes “semantic results may be missing” warnings and fallback mode behavior that does not match user perception of “I just used the app.”

---

## B) Chunk retrieval exists in code but chunk embedding coverage is operationally weak

Chunk-first retrieval is implemented:
- `apps/desktop/src-tauri/crates/ritual-db/src/vector.rs:1076-1092,1194-1303`

But runtime snapshot shows chunk embeddings absent/sparse.

### Why this is a bottleneck
- Without chunk vectors, hybrid retrieval falls back to frame vectors + FTS.
- Topic-level questions become noisier because frame-level snippets are shorter and more brittle than chunk context.
- You lose the main precision/recall benefit of chunk semantic indexing.

---

## C) Embedding worker throughput/cadence can lag under continuous capture

Worker config:
- Batch size 50, sleep 30s between batches
- `apps/desktop/src-tauri/src/ritual_database.rs:574,629`

### Why this is a bottleneck
- Fixed cadence can underperform when ingestion spikes.
- If queue growth > processing capacity, semantic freshness and confidence degrade.
- This is a key reason vectors can be “behind” even while capture/OCR continue.

---

## D) Fallback chain can still blur semantic truth vs activity truth in edge paths

`search_screen_recordings_impl()` includes:
- OCR FTS path
- OCR lexical fallback
- Activity fallback (if enabled)
- `apps/backend/services/watcher_service_search.py:319-611`

`query_memory` strict intents disable activity fallback:
- `apps/backend/services/watcher_service_search.py:1562-1573`

But orchestrator still has a legacy failover:
- If `/query-memory` fails, it calls `/search-screen`
- `apps/dashboard/lib/ai/chat-stream/orchestrator.ts:1586-1594`

### Why this is a bottleneck
- Failover can switch behavior models silently.
- Users can receive answers from different retrieval regimes for similar prompts.
- This is a trust killer when accuracy appears inconsistent.

---

## E) Capture is “trigger-aware polling,” not fully event-driven capture

Recorder loop still sleeps on capture interval:
- `apps/desktop/src-tauri/bin/ritual-recorder/src/main.rs:304-306`

It does trigger-based store decisions (focus/activity/content/idle):
- `apps/desktop/src-tauri/bin/ritual-recorder/src/main.rs:360-377`

### Why this is a bottleneck
- This is better than pure fixed snapshots, but still can miss short-lived context transitions.
- Event-to-evidence alignment is weaker than truly event-driven capture.
- Topic lookup quality suffers when OCR frames don’t coincide with decisive UI moments.

---

## F) Duplicate query-expansion logic across Rust and Python increases drift risk

Alias/expansion exists in:
- Python: `watcher_service_search_utils.py:55-124`
- Rust: `vector.rs:1382-1394` and token expansion helpers around `1353+`

### Why this is a bottleneck
- Two separate alias maps can diverge.
- Same query may score differently depending on which path handled it.
- Drift creates “non-deterministic” perceived behavior from the user standpoint.

---

## G) Bridge dependency can silently downgrade search quality

Hybrid bridge requires token and local endpoint availability:
- `apps/backend/services/watcher_service_search_utils.py:204-243`
- If unavailable, backend falls back to local FTS/lexical path.

### Why this is a bottleneck
- Quality can change due to operational state (token mismatch, bridge timeout, process restart), not user intent.
- User sees this as random search quality variance.

---

## H) Quality gate exists but is not strong enough by default

Golden gate test exists:
- `apps/backend/tests/test_memory_golden_gate.py`

Current constraints:
- Gate is opt-in (`RITUAL_RUN_GOLDEN_GATE=1`)
- fixture currently small (2 cases):
  - `apps/backend/tests/fixtures/memory_golden_queries.json`

### Why this is a bottleneck
- You can ship regressions without tripping CI/local checks.
- Small fixture size under-represents real-world semantic query diversity.

---

## 5) Why Users See “Wrong” Answers Even When Data Exists

Common failure pattern:
1. Query asks for specific topic evidence.
2. Chunk vectors unavailable or weak coverage.
3. System falls back to lexical/FTS (or worse in legacy path).
4. Hits on app/window context over-index general terms.
5. Response text sounds specific, but evidence is weak.

This explains cases like “you worked on landing page today” when the strongest signal was likely app presence or weak lexical overlap rather than grounded topic text.

---

## 6) Critical Contradiction to Resolve

You have two simultaneously true conditions:
- **Time truth looks healthy** (activity rows and totals are current).
- **Semantic truth can degrade** (chunk embedding coverage/freshness and retrieval path variance).

If product copy or response format doesn’t clearly separate these truths, users interpret semantic highlights as equivalent to hard activity totals, which creates perceived inaccuracy.

---

## 7) LLM Handoff: What External Models Should Diagnose/Design

Ask external LLMs to propose concrete designs for:

1. Freshness computation that uses the most reliable pipeline watermark source by intent (time vs semantic), without false degradation from stale `video_chunks`.
2. Guaranteed chunk embedding coverage target (e.g., >=95% of recent chunks within N minutes) with adaptive worker scheduling.
3. Single retrieval contract that eliminates behavior drift between `/query-memory` and `/search-screen`.
4. Unified query expansion dictionary (single source) shared across Rust/Python retrieval layers.
5. Event-driven capture strategy and when to persist OCR frames for semantic fidelity vs storage efficiency.
6. Confidence policy that hard-blocks topic claims when evidence is app-presence-only.
7. A meaningful golden eval suite (50-100 prompts) and release gate criteria.

---

## 8) Useful SQL Checks for Ongoing Diagnosis

```sql
-- 1) Freshness by source
SELECT MAX(timestamp) AS ocr_max FROM ocr_frames;
SELECT MAX(ts_end) AS activity_max FROM activity_events;
SELECT MAX(COALESCE(end_time,start_time)) AS capture_max FROM video_chunks;
SELECT MAX(chunk_end_ts) AS chunk_max FROM search_chunks;
SELECT MAX(updated_at) AS chunk_embedded_max FROM chunk_embeddings WHERE status='ok';

-- 2) Embedding coverage
SELECT COUNT(*) AS frames_total FROM ocr_frames;
SELECT COUNT(*) AS frames_emb_ok FROM ocr_embeddings WHERE COALESCE(status,'ok')='ok';
SELECT COUNT(*) AS chunks_total FROM search_chunks;
SELECT COUNT(*) AS chunks_emb_ok FROM chunk_embeddings WHERE status='ok';

-- 3) Chunk linkage quality
SELECT COUNT(*) AS chunk_frame_links FROM search_chunk_frames;
SELECT COUNT(*) AS chunks_without_embedding
FROM search_chunks s
LEFT JOIN chunk_embeddings e ON e.chunk_id = s.id
WHERE e.chunk_id IS NULL OR COALESCE(e.status,'pending') != 'ok';

-- 4) Worker health
SELECT * FROM embedding_worker_state WHERE id = 1;
SELECT * FROM pipeline_watermarks WHERE id = 1;
```

---

## 9) Bottom Line

The main issue is no longer just “bad prompts” or “weak OCR.” The dominant problem is **operational consistency of semantic indexing/retrieval**:
- freshness state can degrade for the wrong reason,
- chunk semantic path is not consistently hot,
- and fallback path diversity can produce answer variance that looks like hallucination.

Fixing those three areas will do more for perceived intelligence and trust than tuning response wording.

