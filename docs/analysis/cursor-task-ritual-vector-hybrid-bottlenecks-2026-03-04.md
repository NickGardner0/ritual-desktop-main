# Cursor Task: Fix Ritual Recorder/OCR/Embeddings/Vector+Hybrid Search Bottlenecks

## Goal
Audit and fix the current end-to-end retrieval pipeline so queries like:

- "What was I working on in the last 2 hours?"

return **high-accuracy, grounded semantic answers** from recent screen activity, with reliable hybrid retrieval (vector + lexical) and efficient indexing.

---

## Current Known Failures (Confirmed in Logs)

### 1) Query path falls back to non-semantic modes
Recent backend logs show:

- `retrieval_tier=activity_only`
- `mode=fts_only`
- `fallback_reason=freshness_degraded_semantic`
- `pending_chunks=1958`
- `embedding_lag_seconds=18773`
- `cloud_candidates=0`
- `embed_ok=True`

Interpretation:

- Query embeddings are being generated (OpenAI embed call succeeds).
- Cloud retrieval returns zero candidates in query window.
- System is forced into lexical/activity fallback.

### 2) Local hybrid bridge is often unavailable
Logs show:

- `Hybrid bridge unavailable (http://127.0.0.1:3031/v1/hybrid-search): All connection attempts failed`

Even after patches for retry/health, we need a full reliability audit for bridge lifecycle, readiness, auth token path, and startup ordering.

### 3) OCR is fresh but semantic chunk pipeline is stale
Observed in local `~/.ritual/ritual.db`:

- `ocr_frames` max timestamp is fresh/current.
- `search_chunks` max `chunk_end_ts` lags significantly.
- `chunk_embeddings` has large unembedded backlog (matches `pending_chunks`).

Interpretation:

- Capture is working.
- Text is being collected.
- Chunk build + embedding flow is not keeping pace with ingestion.

### 4) Cloud index freshness mismatch
Observed in backend `.memory_cloud.db`:

- `memory_chunks` embedded data is significantly older than the active query window.
- `memory_pipeline_watermarks` can report newer upsert times than the newest queryable `chunk_end_ts`, which implies watermark movement does not guarantee usable candidate freshness.

### 5) Upload/outbox backlog is large
Observed in local outbox:

- `memory_upload_outbox` has large `pending` and `uploading` counts.

Interpretation:

- Ingestion-to-cloud path is backpressured.
- Fresh local chunks are not reaching cloud quickly enough to support semantic search.

### 6) Rerank provider is not invoked in practice
Logs show:

- `rerank_provider=none`

because candidate set is empty (`candidates_raw=0`), so Cohere/OpenAI rerank stages are effectively bypassed.

---

## Biggest Bottlenecks to Accuracy and Efficient Hybrid Search

1. **Pipeline freshness gap (capture -> chunk -> embedding -> cloud index)**
- Most damaging issue for user-visible quality.
- If fresh chunks are missing or unembedded, semantic query quality collapses.

2. **Bridge reliability and local fallback behavior**
- Hybrid bridge unavailability forces degraded lexical-only paths.
- Reduces semantic recall for recent context.

3. **Queue/backpressure management**
- Outbox and embedding backlogs are too high.
- No strict SLOs currently enforced for lag and queue drain.

4. **Data consistency / source-of-truth drift**
- OCR timestamps, chunk timestamps, watermark timestamps, and cloud candidate freshness are not aligned.
- Freshness checks rely on metrics that can look healthy while retrieval is still stale.

5. **Weak observability for root-cause isolation**
- Some new logs exist, but still missing unified per-stage latency/throughput + per-query retrieval diagnostics tied to query window.

6. **Potential schema/type friction in cloud upserts**
- Need hard validation of payload schema (`quality_score` type and all fields) to avoid silent retry loops/failure churn.

---

## What I Want You (Cursor) To Deliver

For **each bottleneck above**, provide:

1. **Root-cause analysis**
- Exact code paths involved.
- Why current behavior occurs.
- How often it can occur and under what load/data shape.

2. **Concrete fix plan**
- Specific files/functions to modify.
- Proposed algorithmic or architectural changes.
- Migration/backfill strategy if schema changes are needed.

3. **Code-level implementation**
- PR-quality patches, not pseudocode.
- Include feature flags for risky behavior changes.

4. **Observability additions**
- Metrics + logs + health endpoints that prove the fix.
- Query-level debug payload indicating:
  - query window
  - local OCR max ts
  - local chunk max ts
  - local pending chunks
  - outbox pending/uploading/failed
  - cloud max ts in namespace
  - candidates_raw / candidates_active
  - rerank provider used
  - fallback reason

5. **Validation plan**
- Deterministic test cases for:
  - fresh data query in last 2h
  - bridge unavailable scenario
  - high backlog scenario
  - cloud unavailable/fail-closed behavior
- Include success thresholds.

6. **Performance/SLO targets**
- Propose realistic SLOs and enforcement points, e.g.:
  - P95 embedding lag <= 300s
  - pending local chunk embeddings <= 200 under normal load
  - outbox pending drain time <= 10 min under expected workload
  - cloud candidate count > 0 for common recency queries when OCR exists

---

## Constraints

- Preserve privacy model: local-first behavior should remain intact.
- Do not degrade capture throughput or UI responsiveness.
- Maintain graceful degradation paths when cloud or bridge is unavailable.
- Keep backward compatibility with existing local DBs and current API contracts where possible.

---

## Acceptance Criteria

1. Repeated query "What was I working on in the last 2 hours?" returns grounded semantic results with real citations when recent OCR exists.
2. Backend log for that query no longer shows `cloud_candidates=0` in normal operation.
3. Rerank provider usage is visible (`cohere` or `openai`) on non-empty candidate sets.
4. Bridge health/startup is reliable across app restarts.
5. Backlog drains automatically to steady-state without manual intervention.
6. New diagnostics endpoint and dashboards make bottlenecks immediately obvious.

---

## Priority Order

1. Freshness and backlog drain (chunk/embedding/outbox)
2. Bridge reliability hardening
3. Candidate generation quality in Turbopuffer query path
4. Rerank reliability and instrumentation
5. Final tuning for answer quality and latency

