# Ritual Architecture Analysis

Date: 2026-03-11
Scope: End-to-end analysis of the current Ritual recorder, watcher, local DB, cloud memory, retrieval, and AI summary stack in `/Users/nickgardner/Desktop/ritual-desktop-main`

## Purpose

This document explains how Ritual currently captures:

- native macOS app context
- browser activity and browser page text
- screen/OCR text
- app/activity sessions

It also explains how that data is:

- formatted
- stored
- sessionized
- chunked
- embedded
- indexed
- retrieved via lexical/vector/hybrid paths
- summarized into user-facing answers in the Ritual app

It also identifies the major architectural bottlenecks that currently keep Ritual below Littlebird in answer specificity, structure, and groundedness.

---

## Executive Summary

Ritual no longer has a single "screen recording search" system. It has two overlapping memory systems:

1. A legacy recorder/OCR/vector path centered on `ocr_frames`, `search_chunks`, and local embeddings in the desktop DB.
2. A newer context-memory path centered on watcher-owned `context_snapshots`, `context_sessions`, `session_retrieval_docs`, plus cloud `memory_chunks` and Turbopuffer retrieval.

The strongest parts of the system today are:

- browser DOM capture through the browser heartbeat extension
- app/activity session tracking
- deterministic query routing and story-plan scaffolding
- cloud hybrid retrieval infrastructure

The weakest parts are:

- native app text capture for Electron/editor surfaces, especially Cursor editor-body text
- cross-source evidence fusion between AX, OCR, browser, terminal, and git-like artifacts
- artifact/task/entity normalization
- cross-app workstream stitching for app-specific queries
- final narrative synthesis from evidence into a highly specific, chronological, claim-backed answer

The core parity gap vs Littlebird is no longer just "capture". It is the combined effect of:

- incomplete native evidence
- incomplete artifact extraction
- weaker cross-app clustering
- shallower story planning
- shallower answer rendering

Littlebird appears to reconstruct a higher-order task narrative from multiple signals. Ritual still often summarizes the top retrieved snippets and documents.

---

## High-Level Topology

Ritual currently has four major runtime layers:

1. Desktop capture layer
   - `ritual-watcher`
   - `ritual-recorder`
   - browser extension heartbeat ingestion

2. Local storage and search layer
   - `ritual-db`
   - `activity_events`
   - `context_snapshots`
   - `context_sessions`
   - `session_retrieval_docs`
   - legacy `ocr_frames`, `search_chunks`, `chunk_embeddings`, FTS tables

3. Backend memory layer
   - local query orchestration
   - cloud memory ingest
   - cloud embedding worker
   - Turbopuffer retrieval
   - rerank and confidence/freshness logic

4. Dashboard/chat orchestration layer
   - query routing
   - on-demand memory fetch
   - deterministic recap formatting
   - optional side-panel/canvas rendering for overview tools

---

## System Inventory

### Desktop capture

- Watcher runtime:
  - `apps/desktop/src-tauri/bin/ritual-watcher/src/main.rs`
  - `apps/desktop/src-tauri/bin/ritual-watcher/src/macos.rs`
  - `apps/desktop/src-tauri/bin/ritual-watcher/src/browser_heartbeat_server.rs`
  - `apps/desktop/src-tauri/bin/ritual-watcher/src/window_observer.rs`
  - `apps/desktop/src-tauri/bin/ritual-watcher/src/database.rs`

- Recorder runtime:
  - `apps/desktop/src-tauri/bin/ritual-recorder/src/main.rs`
  - `apps/desktop/src-tauri/bin/ritual-recorder/src/ocr.rs`
  - `apps/desktop/src-tauri/bin/ritual-recorder/src/spool.rs`

### Local DB and search

- Context/session DB logic:
  - `apps/desktop/src-tauri/crates/ritual-db/src/context.rs`
  - `apps/desktop/src-tauri/crates/ritual-db/src/types.rs`
  - `apps/desktop/src-tauri/crates/ritual-db/src/schema.rs`

- Legacy OCR/vector/chunk search:
  - `apps/desktop/src-tauri/crates/ritual-db/src/vector.rs`

### Backend retrieval and cloud memory

- Local and hybrid query orchestration:
  - `apps/backend/services/watcher_service_search.py`

- Story planning:
  - `apps/backend/services/memory_story_service.py`

- Cloud retrieval:
  - `apps/backend/services/memory_cloud_query_service.py`
  - `apps/backend/services/memory_turbopuffer_service.py`
  - `apps/backend/services/memory_query_expansion.py`

- Cloud ingest and embedding:
  - `apps/backend/services/memory_ingest_service.py`
  - `apps/backend/services/memory_embedding_service.py`

### Dashboard/chat

- Shared screen/context query path:
  - `apps/dashboard/lib/ai/chat-stream/screen-search.ts`

- Main chat orchestration and deterministic rendering:
  - `apps/dashboard/lib/ai/chat-stream/orchestrator.ts`

- Canvas/side-panel rendering:
  - `apps/dashboard/components/chat/habit-canvas.tsx`
  - `apps/dashboard/app/(dashboard)/chat/chat-client.tsx`

### Existing architecture and bottleneck docs

- `LITTLEBIRD_PARITY_PLAN.md`
- `docs/analysis/ritual-recorder-semantic-bottlenecks-audit-2026-03-02.md`
- `docs/analysis/ritual-vector-hybrid-architecture-status-2026-03-04.md`
- `docs/SCREEN-RECORDING-TECHNICAL-GUIDE.md`

---

## End-to-End Data Flow

There are three capture lanes that feed memory:

1. Native watcher AX/app/browser session lane
2. Browser heartbeat DOM/text lane
3. Recorder OCR lane

Those lanes are not symmetric:

- browser heartbeat is high-structure and text-rich
- native AX capture is medium-structure but app-dependent
- recorder OCR is text-rich but low-structure

That asymmetry is one of the root causes of quality variance.

---

## 1) Native App And AX Context Capture

### What `ritual-watcher` captures

The watcher tracks:

- active app
- active window title
- browser URL/domain when browser-specific APIs are available
- AFK state
- sleep/wake and screen-lock boundaries
- native context snapshots for the focused app/window

### How active app/session capture works

`ritual-watcher/src/main.rs` keeps an explicit current-session state machine:

- `ActivitySignature` is derived from:
  - bundle ID
  - normalized title
  - domain
  - AFK state

- session boundaries are created or merged based on:
  - signature changes
  - hard time gaps
  - AFK state changes
  - browser tab changes
  - exclusion/privacy decisions

This produces `activity_events`, which are still the source of truth for time-spent style queries.

### How native AX text is extracted

`ritual-watcher/src/macos.rs` is the core native context extractor.

The watcher:

- gets the active window/app
- probes the focused accessibility element
- traverses parents, siblings, window, and visible descendants
- scores candidate attributes and candidate text spans

Preferred attributes now include:

- `AXSelectedText`
- `AXValue`
- `AXDocument`
- `AXFilename`
- `AXTitle`
- `AXDescription`
- `AXLabel`
- `AXIdentifier`

Structural traversal includes:

- `AXVisibleChildren`
- `AXSelectedChildren`
- `AXSelectedRows`
- `AXChildren`
- `AXRows`
- `AXContents`
- `AXTabs`
- `AXGroups`
- `AXTabGroup`
- `AXOutlineRows`
- `AXSplitters`
- `AXScrollAreas`
- `AXColumns`
- `AXLists`

Candidate scoring combines:

- attribute weight
- source weight (`focused`, `parent`, `sibling`, `window`, `related_window`, `visible_descendant`)
- text richness weight

The output is a `FocusedTextInfo` object with:

- `text`
- `is_sensitive`
- `strategy`
- `quality_score`
- `capture_components`
- `ax_richness_score`
- `selected_text_present`
- `document_path`
- `ax_source`

### How native snapshots are composed

The new native composition order is effectively:

1. document/file identity
2. selected text
3. focused-node text
4. nearby structural text
5. window title
6. metadata fallback

That composed snapshot is written as a `ContextSnapshot` with fields such as:

- `source_type`
- `app_bundle_id`
- `app_name`
- `window_title`
- `document_title`
- `document_path`
- `visible_text_raw`
- `visible_text_norm`
- `capture_quality`
- `capture_components_json`
- `ax_richness_score`
- `selected_text_present`
- `ax_source`
- `capture_trigger`
- `trigger_to_snapshot_ms`
- `ui_elements_json`

### Eventing vs polling

This is improved but still mixed.

The watcher now has:

- polling-based capture loops
- `AXObserver`-based event subscriptions
- window/focused-element notifications

This is materially better than a pure poller, but not yet a full app-specific event model. It still depends on:

- whether the target app actually exposes useful AX notifications
- whether the focused element surface is meaningful
- whether the visible moment is sampled at the right time

### Current native AX strengths

- good file/document identity when apps expose `AXDocument` or similar
- Things/task text capture is reasonably strong
- native diagnostic metadata is now much better

### Current native AX weaknesses

- Cursor and Electron editors often expose sparse or partial AX trees
- editor-body text is still inconsistent
- custom-rendered UI surfaces often expose metadata and chrome, not the meaningful body text
- it is still possible to get file identity without actual task content

This is the single biggest capture-side reason Ritual still underperforms Littlebird.

---

## 2) Browser Activity And Browser Text Capture

### Browser activity session capture

The watcher hosts a local heartbeat server on `127.0.0.1:8766` in `browser_heartbeat_server.rs`.

The browser extension sends heartbeats with:

- `url`
- `domain`
- `title`
- `document_title`
- `visible_text_norm`
- `visible_text_raw`
- `headings`
- `capture_quality`
- `dedup_key`
- `is_sensitive_redacted`
- `audible`
- `incognito`
- `tab_count`
- browser name and focus state
- client timestamp

### Browser session merge logic

The heartbeat server performs merge/flush logic using:

- session timeout windows
- long-session forced rollover
- duplicate-create suppression
- pending-create guards
- throttled DB flushes

This keeps `activity_events` from fragmenting on every heartbeat.

### Browser context snapshots

The heartbeat server also sends `InsertContextSnapshot` DB commands containing:

- browser app identity
- tab title/document title
- raw and normalized visible page text
- capture quality
- dedup key
- sensitivity flags

This browser lane is currently the highest-quality text capture lane in Ritual because it comes from the DOM/page context rather than OCR or sparse AX text.

### Browser strengths

- rich visible text
- explicit domain and URL identity
- headings and page-document identity
- stronger semantic recall than OCR for web content

### Browser weaknesses

- still mostly flattened text, not deeply normalized into first-class tasks/entities/artifacts
- some noisy pages still enter retrieval unless downranked
- browser capture quality is much better than native app capture, which creates uneven summaries

---

## 3) Recorder OCR And Screen Activity Capture

### What `ritual-recorder` does

The recorder is a separate sidecar for:

- screen capture
- OCR
- thumbnail generation
- deduplication
- spooling OCR frames to disk for watcher ingestion

Video encoding has been removed. The recorder is now focused on OCR-plus-thumbnail capture.

### Recorder flow

The recorder loop:

1. captures the screen
2. deduplicates frames
3. runs OCR
4. generates thumbnails
5. builds `OcrFrame`
6. writes that frame into a spool directory as JSON

The spool writer exists so the recorder is not directly competing in the same write path as the watcher. The watcher ingests those spooled files later.

### OCR implementation

`ritual-recorder/src/ocr.rs` uses:

- native Apple Vision first
- AppleScript/Vision fallback if native Vision fails

OCR returns:

- extracted text
- confidence
- individual OCR text elements with bounding boxes

Important nuance:

The OCR engine does capture `elements`, but Ritual does not yet use those OCR element boxes as the main retrieval substrate. In practice, most downstream search still uses flattened OCR text rather than a structured UI map.

### Recorder strengths

- can recover text from pixels when AX is weak
- useful for custom-rendered apps and Electron surfaces
- useful for terminal output and visible editor body text if it is on-screen

### Recorder weaknesses

- low structure compared with DOM or good AX
- cannot inherently tell selected text from unselected text
- cannot reliably infer document/file identity without visual parsing heuristics
- currently underused in the new context-memory summarization path

This is why moving "fully back" to recorder/OCR would help recall but not solve structure.

---

## 4) Local Data Model

Ritual now stores multiple layers of memory locally.

### Activity layer

- `activity_events`
- AFK and activity summaries

Used mainly for:

- time-spent queries
- continuity
- session timing

### Context memory layer

- `context_snapshots`
- `context_sessions`
- `session_retrieval_docs`

Used mainly for:

- app/browser/native context search
- richer story planning
- session-level retrieval

### Legacy OCR/vector layer

- `ocr_frames`
- `ocr_embeddings`
- `ocr_frames_fts`
- `search_chunks`
- `search_chunk_frames`
- `chunk_embeddings`
- `pipeline_watermarks`

Used mainly for:

- local OCR/vector search
- chunk-based semantic retrieval
- bridge and fallback behavior

### Important architectural consequence

Ritual does not yet have one single canonical semantic substrate. It has:

- context snapshots and session retrieval docs for the newer watcher-owned path
- OCR frames and search chunks for the legacy recorder-owned path
- cloud `memory_chunks` for the cloud semantic path

That duplication increases power, but also creates drift, mismatch, and operational complexity.

---

## 5) Sessionization And Formatting

### Context snapshots -> context sessions

`ritual-db/src/context.rs` sessionizes `ContextSnapshot` rows into `ContextSession` rows using rules like:

- max time gap
- app changes
- domain changes
- title changes
- max session duration

This produces sessions with:

- `primary_app_name`
- `primary_domain`
- `dominant_title`
- `representative_text`
- `coverage_score`
- `snapshot_count`

### Context sessions -> session retrieval docs

`session_retrieval_docs` are the text-ready retrieval documents built from contiguous snapshot sessions.

These are important because they bridge raw snapshots and search:

- raw snapshot text is too fragmented
- session docs aggregate a period of contiguous work into a more retrievable unit

These docs are currently the best local semantic substrate in the newer architecture.

### Legacy OCR frames -> search chunks

The older vector path chunks `ocr_frames` into `search_chunks`.

Chunk breaks are driven by:

- time gaps
- app changes
- window-title changes
- max span

Chunk metadata includes:

- start/end timestamps
- app identity
- normalized window title
- browser/domain hints
- raw compact text
- contextual compact text
- quality score
- session key
- session position and session chunk count

### Contextual chunk text generation

`build_contextual_chunk_text()` in `vector.rs` builds a contextualized chunk body like:

- session label/workstream
- primary app
- primary window/topic
- time window
- session position
- capture summary
- neighboring activity
- observed content

This is much better than a raw OCR snippet because it adds scaffolding and neighboring context.

However, it is still generated from OCR-frame clusters, not from a true multimodal or entity-first representation.

---

## 6) Embeddings And Indexing

Ritual has two embedding/index stacks.

### A. Local desktop embeddings

Local desktop search uses:

- `all-MiniLM-L6-v2`
- 384-dimensional vectors

Stored in:

- `ocr_embeddings`
- `chunk_embeddings`

The local worker:

- rebuilds recent chunks
- backfills oldest missing chunks
- seeds pending chunk embedding rows
- embeds pending chunks first
- only then continues with frame embeddings

This chunk-first strategy is correct, because chunk-level retrieval is more useful than raw frame-level retrieval for semantic queries.

### B. Cloud embeddings

The backend cloud worker uses:

- OpenAI embeddings
- default model: `text-embedding-3-small`

The cloud ingest path writes:

- `memory_chunks`
- `memory_embedding_jobs`

The embedding worker:

- fetches pending jobs
- batches contextual chunk text
- requests OpenAI embeddings
- upserts rows into Turbopuffer
- writes provider doc IDs back to the local cloud DB

### Cloud schema in Turbopuffer

Upserted attributes include:

- `contextual_text_compact`
- `raw_text_compact`
- timestamps
- `source_kind`
- `session_id`
- `app_name`
- `window_title`
- `document_title`
- `browser_domain`
- `content_hash`
- `session_key`
- `session_position`
- `session_chunk_count`
- `context_version`
- `capture_quality`
- `raw_visible_text`
- `contextual_retrieval_text`
- `parent_context`

This is a fairly strong retrieval schema, but it is still mostly text-plus-metadata. It is not yet a deeply normalized graph of tasks, documents, entities, commands, commits, failures, and work items.

---

## 7) Local Search, Vector Search, And Hybrid Search

### Legacy local hybrid search

The local vector path in `ritual-db/src/vector.rs` performs:

1. FTS candidate retrieval from OCR text
2. chunk-vector retrieval if chunk embeddings exist
3. frame-vector fallback if chunk candidates are absent
4. weighted hybrid combination of FTS and vector scores
5. inclusion of FTS-only hits for rows without embeddings

Chunk candidate scoring includes:

- vector score
- lexical token overlap
- recency score
- quality weighting

The representative result shown to the system is the representative frame for the winning chunk.

### New local context search

`search_context_memory_impl()` in `watcher_service_search.py` is the newer search path.

It searches:

1. `session_retrieval_docs`
2. `context_snapshots`
3. legacy fallback only if needed and allowed

It applies:

- query intent detection
- query window resolution
- query expansion
- lexical overlap scoring
- exact match scoring
- semantic overlap scoring using extracted documents/tasks/entities
- recency boost
- capture-quality weighting
- app-specific scoping for drilldown queries
- downranking of low-signal overview rows

This is the right direction architecturally. It is closer to what a task-memory system should do than raw OCR frame search.

### Cloud retrieval

`query_semantic_cloud()` does:

1. query embedding
2. expanded query generation
3. Turbopuffer candidate retrieval across multiple lanes
4. active-document filtering
5. RRF-style score fusion
6. reranking
7. citation construction
8. confidence and debug payload generation

This is a strong retrieval architecture on paper.

### Why retrieval still underdelivers

The main issue is not "there is no hybrid search". The issue is that the evidence going into hybrid search is still uneven:

- browser evidence is rich
- native app evidence is partial
- OCR evidence is flat
- task/entity/artifact extraction is not yet strong enough

So the retrieval stack is often forced to rank imperfect evidence rather than richly structured evidence.

---

## 8) Query Routing And Answer Generation

### Main user query flow

When the user asks a question in the Ritual app:

1. the dashboard/orchestrator classifies the question
2. if it looks like a context-memory question, it calls `searchContextMemory`
3. backend `query_memory_impl()` resolves:
   - intent
   - time window
   - freshness state
   - whether to include time truth
   - whether to include semantic truth
4. local context retrieval and/or cloud semantic retrieval are executed
5. citations are assembled
6. story planning builds a deterministic recap scaffold
7. the orchestrator renders that plan into user-facing prose

### Freshness and readiness gates

`query_memory_impl()` uses freshness guards to decide whether semantic lookup is allowed.

Freshness depends on:

- capture recency
- OCR recency
- semantic readiness or cloud state

This is necessary, but it also means answers can shift depending on operational state.

### Story planning

`memory_story_service.py` builds a deterministic plan from evidence:

- detects renderer kind:
  - `broad_overview`
  - `daypart_overview`
  - `app_drilldown`
  - `time_breakdown`
  - `topic_lookup`

- extracts:
  - document refs
  - artifact refs
  - task phrases
  - entities
  - work items
  - claim cards

- ranks a `main_event`
- produces `specific_tasks`, `document_items`, `apps_and_tools_used`, `strongest_evidence`, and uncertainty metrics

This is much better than ad hoc summarization, but still not deep enough to match Littlebird.

### Final rendering

The dashboard renderer converts the story plan into prose and sections.

For app drilldowns, it now uses a dedicated layout. For broad overviews, it uses a broader recap structure.

This fixes earlier routing mistakes, but the renderer still depends entirely on the quality and completeness of the plan it receives.

---

## 9) Where Bottlenecks Actually Are

The current parity gap can be separated into six layers.

### Bottleneck 1: Native evidence is still incomplete

This is the biggest capture bottleneck.

Symptoms:

- Cursor file identity may be present, but not the meaningful body text
- the system may know the app and file, but not the exact task progression
- editor and custom-rendered surfaces still expose sparse AX trees

Impact:

- summaries default to document name plus generic implementation language
- task detail falls back to whatever text happened to be visible and captured

### Bottleneck 2: OCR is available but not deeply fused

OCR exists, but the newer context-memory summary path is not built around OCR element-level evidence.

Symptoms:

- OCR text is flattened rather than converted into structured UI evidence
- OCR is not consistently fused with AX into a unified artifact/task representation
- screenshot-only surfaces still produce raw snippets, not strong objects

Impact:

- OCR helps recall but not structured summary quality

### Bottleneck 3: Too little first-class artifact extraction

Ritual is still too text-centric.

It does extract some:

- document refs
- task phrases
- entities
- artifact refs

But compared with Littlebird, it still under-models:

- repo
- file
- command
- commit
- branch
- error/failure event
- task-doc title
- route/component/system name
- execution sequence

Impact:

- the answer generator says "you worked on backend" instead of:
  - "you implemented Phase 1 context capture upgrades in `macos.rs`, `window_observer.rs`, and `watcher_service_search.py`"

### Bottleneck 4: Weak cross-app stitching

Littlebird's better answers strongly suggest it stitches a central workstream across:

- Cursor
- Terminal
- browser docs
- markdown task docs
- git activity
- failures and restarts

Ritual currently improves app scoping by hard-filtering to the requested app, but that can remove useful corroboration.

Impact:

- a Cursor query becomes too narrow
- supporting evidence from Terminal/docs/git is not woven into the answer
- the answer remains app-local rather than task-local

### Bottleneck 5: Story planning is deterministic but still shallow

Current story planning is better than before, but it still mostly organizes evidence rather than inferring a stronger work narrative.

What is missing:

- stronger chronological sequencing
- stronger "main thread then sub-threads" derivation
- stronger evidence-backed claim composition
- better detection of execution vs browsing vs planning
- stronger use of repeated cross-app continuity as a confidence source

Impact:

- answers are cleaner than before, but still do not feel like a high-confidence reconstruction of the session

### Bottleneck 6: Operational drift across memory substrates

Ritual still has several overlapping semantic systems:

- context snapshots and session retrieval docs
- OCR frames and local search chunks
- cloud `memory_chunks` and Turbopuffer

Impact:

- data freshness can differ by substrate
- one lane may know something another does not
- summaries can vary depending on which lane won

This is an architecture tax that Littlebird may simply not be paying, or may be hiding better behind stronger fusion.

---

## 10) Why Littlebird Still Looks Better

Based on the observed behavior, Littlebird is likely doing several things better at the same time:

1. Better raw evidence capture for native apps
2. Better structured artifact extraction
3. Better cross-app clustering around a main workstream
4. Better event sequencing
5. Better answer rendering from grounded claims

The screenshots strongly imply that Littlebird is not just "searching snippets". It is building a richer task narrative like:

- main project
- numbered workstreams
- files/docs involved
- commands/errors/commits
- chronological evidence

Ritual now has parts of that stack, but not the whole thing.

---

## 11) Specific Current Failure Modes

### Failure mode: correct app, generic answer

Cause:

- app scope identified
- file captured
- task detail incomplete

Output pattern:

- "you spent time in Cursor making changes"

instead of:

- "you implemented the native accessibility capture upgrade and patched `macos.rs`, `window_observer.rs`, and `watcher_service_search.py`"

### Failure mode: wrong main event

Cause:

- noisy snippets overranked
- workstream clustering too weak
- artifact density not used strongly enough

### Failure mode: accurate evidence exists but is not synthesized

Cause:

- facts exist across different citations
- no strong cross-citation merge into one narrative object

### Failure mode: OCR-rich but structure-poor summary

Cause:

- raw text captured
- no element/task/entity normalization

---

## 12) What Would Help Most

### Highest leverage improvements

1. Better native app body-text capture for Cursor/Electron
2. OCR fallback fused into context-memory docs when AX richness is low
3. First-class artifact extraction:
   - repo
   - file
   - task-doc
   - command
   - commit
   - error/event
4. Cursor-centered but cross-app corroboration:
   - allow Terminal/docs/git/browser evidence into a Cursor recap without losing Cursor focus
5. Stronger workstream sequencing in `memory_story_service.py`
6. Unify or more aggressively fuse the multiple semantic substrates

### What would not help much by itself

- swapping one text embedding model for another without improving evidence quality
- switching fully back to OCR-only capture
- purely cosmetic answer template changes

---

## 13) Bottom Line

Ritual already has most of the infrastructure that a strong memory system needs:

- native watcher
- browser capture
- OCR capture
- local session docs
- local vector search
- cloud chunk ingest
- cloud vector/hybrid retrieval
- rerank
- deterministic recap planning

The current gap vs Littlebird is not that the stack is missing one major subsystem. The gap is that the stack still does not convert raw evidence into a sufficiently rich, unified, task-centric representation before summarization.

In practical terms, Ritual still behaves too often like:

- "retrieve the strongest snippets and summarize them"

when it needs to behave more like:

- "reconstruct the dominant workstream from multi-source evidence, normalize its artifacts, sequence its substeps, then render the grounded narrative"

That is the main architectural reason Littlebird still feels much more specific and structured.

