# Ritual Recorder & AI-Powered Search — System Architecture

> A deep dive into how Ritual captures screen activity, processes it with OCR, generates vector embeddings, and exposes it through FTS and semantic search.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [The Recording Pipeline (ritual-recorder)](#the-recording-pipeline)
3. [OCR Processing](#ocr-processing)
4. [The Local Database (libSQL)](#the-local-database)
5. [Full-Text Search (FTS5)](#full-text-search-fts5)
6. [Vector Embeddings & Semantic Search](#vector-embeddings--semantic-search)
7. [Hybrid Search](#hybrid-search)
8. [The Tauri IPC Bridge](#the-tauri-ipc-bridge)
9. [Frontend Search Components](#frontend-search-components)
10. [AI Chat Integration — Current State](#ai-chat-integration--current-state)
11. [AI Chat Integration — What's Missing](#ai-chat-integration--whats-missing)
12. [Data Flow Diagrams](#data-flow-diagrams)
13. [Key Files Reference](#key-files-reference)

---

## System Overview

Ritual Recorder is a background process that continuously captures screenshots of the user's screen, extracts text via Apple Vision OCR, deduplicates frames, and stores the results in a local libSQL database. A background embedding worker then generates 384-dimensional vector embeddings for each frame using the `all-MiniLM-L6-v2` model. This enables three search modes:

| Mode | Mechanism | Best For |
|------|-----------|----------|
| **Text Search** | FTS5 with BM25 ranking | Exact keyword matches ("Figma", "localhost:3000") |
| **Semantic Search** | Cosine distance on 384-dim vectors | Natural language questions ("When was I designing the settings page?") |
| **Hybrid Search** | Weighted combination (30% FTS + 70% vector) | General queries — best overall quality |

All processing happens **entirely on-device**. No data leaves the user's machine.

---

## The Recording Pipeline

**Binary:** `apps/desktop/src-tauri/bin/ritual-recorder/`

The recorder runs as a standalone Rust binary spawned by the Tauri app. It operates on a continuous loop:

### Pipeline Stages

```
┌─────────────┐    ┌──────────────┐    ┌─────────────┐    ┌──────────────┐    ┌──────────┐
│  1. Capture  │───▶│ 2. Dedup     │───▶│  3. OCR     │───▶│ 4. Thumbnail │───▶│ 5. Store │
│  (xcap)      │    │ (multi-sig)  │    │ (Apple Vis) │    │ (JPEG 320px) │    │ (libSQL) │
└─────────────┘    └──────────────┘    └─────────────┘    └──────────────┘    └──────────┘
                         │ duplicate
                         ▼
                      (skip frame)
```

### 1. Screen Capture (`capture.rs`)

- Uses the `xcap` crate to capture the primary monitor at ~1 FPS (configurable)
- Captures the full RGBA framebuffer via `monitor.capture_image()`
- Detects the currently focused window (app name, title, bundle ID, process ID)
- Filters out system apps and excluded applications (privacy)
- Caches bundle ID lookups to minimize AppleScript calls

**Output:** `CaptureResult` containing the image, timestamp, frame number, and window metadata.

### 2. Frame Deduplication (`dedup.rs`)

A multi-signal deduplication system avoids storing near-identical frames:

| Signal | Logic | Always Store? |
|--------|-------|---------------|
| **Max gap exceeded** | >60s since last stored frame | Yes |
| **App changed** | Bundle ID differs from last frame | Yes |
| **Window title changed** | Title differs meaningfully (string similarity check) | Yes |
| **OCR text changed** | OCR text hash differs significantly | Yes |
| **Visual similarity** | Perceptual hash (dHash) below threshold | No — skip frame |

**Perceptual Hash (dHash) Algorithm:**
1. Resize image to 9×8 pixels
2. Compare adjacent pixels horizontally → 64-bit hash
3. Compute SHA-256 + average luminance
4. Similarity = `(hash_similarity × 0.8) + (luminance_similarity × 0.2)`
5. Threshold: 0.02 (2% difference) — frames below this are considered duplicates

The deduplicator maintains a sliding window of the last 10 frame hashes for comparison.

### 3. OCR Processing (`ocr.rs`, `vision_ffi.rs`)

- Uses Apple's **Vision framework** via Objective-C FFI (`objc2` crate)
- Recognition level: **Accurate** (highest quality)
- Language correction: enabled
- Minimum confidence threshold: 0.5 per observation, 0.3 overall

**Pipeline:**
1. Encode captured image to PNG in memory (no temp files)
2. Create `VNImageRequestHandler` with PNG data
3. Execute `VNRecognizeTextRequest` synchronously
4. Extract text observations with bounding boxes (normalized 0.0–1.0)
5. Filter observations below confidence threshold
6. Return concatenated text + average confidence

**Resilience features:**
- Circuit breaker: opens after 5 consecutive failures, resets after 60s
- Timeout: 5s default, 10s maximum
- Fallback: AppleScript-based OCR if native Vision fails

### 4. Thumbnail Generation (`thumbnail.rs`)

- Resize to 320×180 pixels (Triangle filter, preserving aspect ratio)
- Encode as JPEG at 75% quality
- Filename: `thumb_YYYYMMDD_HHMMSS_<ms>.jpg`
- Stored in the user's app data directory

### 5. Database Storage (`database.rs`)

The final frame is inserted into the `ocr_frames` table with:
- `timestamp` (Unix ms)
- `ocr_text` (full extracted text)
- `ocr_confidence` (0.0–1.0)
- `app_name`, `app_bundle_id`, `window_title`
- `thumbnail_path`
- `image_hash` (for dedup reference)
- `activity_event_id` (links to watcher's activity events)

### Storage Efficiency

The recorder stores **only thumbnails + OCR text** (no video encoding). This reduces storage from ~400 MB/day to ~10 MB/day — a 97% reduction.

**Retention policy:**
- Default retention: 90 days
- Storage limit: 20 GB (configurable)
- Oldest frames are pruned first when limits are exceeded

---

## OCR Processing

### Apple Vision Framework Integration

The OCR system uses Apple's native Vision framework through Rust FFI bindings. This provides:

- **On-device processing** — no network calls
- **Hardware acceleration** — uses the Neural Engine on Apple Silicon
- **High accuracy** — VNRecognizeTextRequest with `.accurate` recognition level
- **Language correction** — automatically fixes common OCR errors

### Text Quality Scoring

After OCR, each frame's text is scored on a 0.0–1.0 scale based on:

| Factor | Weight | Ideal |
|--------|--------|-------|
| Average word length | High | 4–8 characters |
| Content density | Medium | High ratio of non-stop words |
| Length appropriateness | Medium | ≥20 words |
| Character variety | Low | Penalizes repetitive/garbage text |

Frames with quality < 0.2 are skipped during embedding generation to avoid polluting the vector index with low-quality data.

---

## The Local Database (libSQL)

**Technology:** [libSQL](https://turso.tech/libsql) — a fork of SQLite with native vector search support  
**Crate:** `libsql = "0.6"`  
**Location:** `~/Library/Application Support/com.ritual.apps/dashboard/app/ritual.db`

libSQL was chosen because it provides:
1. **Embedded operation** — no separate database server
2. **SQLite compatibility** — battle-tested, reliable
3. **Native vector functions** — `vector_distance_cos()` for similarity search
4. **F32_BLOB type** — efficient storage for float vectors
5. **FTS5 support** — full-text search with BM25 ranking

### Core Schema

#### `ocr_frames` — Screen capture data

```sql
CREATE TABLE ocr_frames (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp       INTEGER NOT NULL,           -- Unix ms
    activity_event_id INTEGER,                  -- FK to activity_events
    video_chunk_id  INTEGER,                    -- FK to video_chunks (legacy)
    frame_offset    INTEGER,                    -- Frame position (legacy)
    app_bundle_id   TEXT NOT NULL DEFAULT '',
    app_name        TEXT NOT NULL DEFAULT '',
    window_title    TEXT,
    ocr_text        TEXT NOT NULL DEFAULT '',
    ocr_confidence  REAL DEFAULT 0.0,
    thumbnail_path  TEXT,
    image_hash      TEXT,
    storage_tier    TEXT DEFAULT 'hot',
    
    -- Enrichment fields (populated by embedding worker)
    summary         TEXT,                       -- TF-IDF extractive summary
    activity_type   TEXT,                       -- coding, browsing, etc.
    keywords        TEXT,                       -- YAKE-extracted keywords
    text_quality    REAL,                       -- 0.0–1.0 quality score
    entities        TEXT,                       -- NER: emails, URLs, etc.
    
    created_at      TEXT DEFAULT (datetime('now'))
);
```

#### `ocr_embeddings` — Vector embeddings

```sql
CREATE TABLE ocr_embeddings (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    frame_id      INTEGER NOT NULL UNIQUE,      -- FK to ocr_frames
    embedding     F32_BLOB(384),                -- 384-dim float vector
    model_version TEXT DEFAULT 'all-MiniLM-L6-v2',
    status        TEXT DEFAULT 'completed',
    error_message TEXT,
    retry_count   INTEGER DEFAULT 0,
    created_at    TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (frame_id) REFERENCES ocr_frames(id)
);
```

#### `ocr_frames_fts` — Full-text search index

```sql
CREATE VIRTUAL TABLE ocr_frames_fts USING fts5(
    ocr_text,
    app_name,
    window_title,
    content='ocr_frames',
    content_rowid='id'
);
```

Kept in sync via triggers:
- `ocr_frames_ai` — After INSERT
- `ocr_frames_ad` — After DELETE  
- `ocr_frames_au` — After UPDATE

#### `activity_segments` — Sessionized activity periods

```sql
CREATE TABLE activity_segments (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id           TEXT NOT NULL,
    start_time          INTEGER NOT NULL,       -- Unix ms
    end_time            INTEGER NOT NULL,
    duration_seconds    REAL,
    primary_app         TEXT,
    primary_activity    TEXT,
    app_switches        INTEGER DEFAULT 0,
    frame_count         INTEGER DEFAULT 0,
    summary             TEXT,
    segment_embedding   F32_BLOB(384),          -- Segment-level vector
    created_at          TEXT DEFAULT (datetime('now'))
);
```

#### `embedding_worker_state` — Worker progress tracking

```sql
CREATE TABLE embedding_worker_state (
    id                INTEGER PRIMARY KEY,
    last_processed_id INTEGER DEFAULT 0,
    total_processed   INTEGER DEFAULT 0,
    last_run_at       TEXT,
    status            TEXT DEFAULT 'idle'
);
```

### Key Indexes

```sql
CREATE INDEX idx_ocr_frames_timestamp ON ocr_frames(timestamp);
CREATE INDEX idx_ocr_frames_app ON ocr_frames(app_bundle_id);
CREATE INDEX idx_ocr_frames_activity ON ocr_frames(activity_type);
CREATE INDEX idx_ocr_embeddings_frame ON ocr_embeddings(frame_id);
CREATE INDEX idx_activity_segments_time ON activity_segments(device_id, start_time, end_time);
```

---

## Full-Text Search (FTS5)

FTS5 provides **instant keyword search** across OCR text, app names, and window titles.

### How It Works

1. The `ocr_frames_fts` virtual table mirrors `ocr_frames` via triggers
2. FTS5 tokenizes and indexes the text fields
3. Queries use BM25 ranking (term frequency × inverse document frequency)
4. Special characters are escaped for safe querying

### Search Query

```sql
SELECT f.id, f.timestamp, f.app_name, f.window_title, f.ocr_text,
       f.thumbnail_path, f.ocr_confidence
FROM ocr_frames f
JOIN ocr_frames_fts ON f.id = ocr_frames_fts.rowid
WHERE ocr_frames_fts MATCH ?
ORDER BY bm25(ocr_frames_fts) ASC, f.timestamp DESC
LIMIT ?
```

### Characteristics

- **Instant availability** — indexed immediately on frame insertion
- **Fast** — BM25 ranking is highly optimized in SQLite/libSQL
- **Exact matching** — great for app names, URLs, code identifiers
- **Limitations** — no semantic understanding; "designing UI" won't match "working in Figma"

---

## Vector Embeddings & Semantic Search

### The Embedding Model

| Property | Value |
|----------|-------|
| **Model** | `all-MiniLM-L6-v2` |
| **Crate** | `fastembed = "4"` (Rust) |
| **Dimensions** | 384 |
| **Size** | ~30 MB (downloaded on first initialization) |
| **Speed** | ~1ms per embedding on Apple Silicon |
| **Runs** | Entirely on-device (no API calls) |

`all-MiniLM-L6-v2` is a sentence-transformer model optimized for semantic similarity. It maps text to a 384-dimensional dense vector space where semantically similar texts are close together (low cosine distance).

### Initialization

```rust
// apps/desktop/src-tauri/crates/ritual-db/src/vector.rs
let model = fastembed::TextEmbedding::try_new(
    fastembed::InitOptions::new(fastembed::EmbeddingModel::AllMiniLML6V2)
        .with_show_download_progress(true)
)?;
```

The model is lazily initialized — it downloads on first use and is cached locally thereafter.

### Text Preparation Pipeline

Before embedding, each frame's text is enriched and structured:

```
Raw OCR Text
     │
     ▼
┌─────────────────────┐
│ 1. Text Cleaning     │  Unicode NFKC normalization, control char removal,
│                      │  whitespace collapsing
├─────────────────────┤
│ 2. Summarization     │  TF-IDF extractive summarization (max 500 chars)
│                      │  Selects most informative sentences
├─────────────────────┤
│ 3. Keyword Extract   │  YAKE algorithm (unsupervised)
│                      │  Extracts key phrases without training data
├─────────────────────┤
│ 4. Activity Classify │  Rule-based classification into 13 categories
│                      │  (coding, browsing, communication, etc.)
├─────────────────────┤
│ 5. Quality Scoring   │  0.0–1.0 score based on word length,
│                      │  density, variety, length
├─────────────────────┤
│ 6. NER Extraction    │  Emails, URLs, file paths, dates,
│                      │  programming languages, frameworks
└─────────────────────┘
     │
     ▼
Structured Text for Embedding:
  "App: Visual Studio Code
   Window: main.rs — ritual-recorder
   Activity: coding
   Topics: rust, database, vector search
   Content: [summary or cleaned OCR text]"
```

### Activity Types

The classifier detects 13 activity types:

| Type | Detection Method |
|------|-----------------|
| Coding | IDE bundle IDs, code-related window titles |
| Browsing | Browser bundle IDs |
| Communication | Email/Slack/Teams bundle IDs |
| Messaging | Chat app bundle IDs |
| Documents | Word/Pages/Notion bundle IDs |
| VideoCall | Zoom/Meet/FaceTime bundle IDs |
| Terminal | Terminal/iTerm bundle IDs |
| Design | Figma/Sketch bundle IDs |
| Media | Media player bundle IDs |
| FileManagement | Finder/file manager bundle IDs |
| System | System preferences/settings |
| Reading | PDF viewers, eBook readers |
| Spreadsheets | Excel/Numbers/Sheets |

### Embedding Storage

Vectors are stored as `F32_BLOB(384)` — a contiguous array of 384 little-endian 32-bit floats (1,536 bytes per embedding):

```rust
fn embedding_to_blob(embedding: &[f32]) -> Vec<u8> {
    let mut blob = Vec::with_capacity(embedding.len() * 4);
    for &val in embedding {
        blob.extend_from_slice(&val.to_le_bytes());
    }
    blob
}
```

### Semantic Search Query

```sql
WITH scored AS (
    SELECT f.id, f.timestamp, f.app_name, f.window_title, f.ocr_text,
           f.thumbnail_path, f.summary, f.activity_type, f.keywords,
           vector_distance_cos(e.embedding, ?) as distance
    FROM ocr_frames f
    JOIN ocr_embeddings e ON f.id = e.frame_id
    WHERE 1=1
      AND f.timestamp BETWEEN ? AND ?        -- optional time filter
      AND f.app_bundle_id IN (?, ?, ...)     -- optional app filter
)
SELECT * FROM scored
WHERE distance <= ?                           -- min_relevance threshold
ORDER BY distance ASC
LIMIT ?
```

**Relevance score:** `1.0 - distance` (cosine distance → similarity)

### Background Embedding Worker

Embeddings are generated asynchronously by a background worker:

1. **Auto-start:** When the app launches, if frames without embeddings exist, the worker starts
2. **Batch processing:** Processes 50 frames per batch
3. **Sleep interval:** 30 seconds between batches
4. **Quality filter:** Skips frames with text quality < 0.2
5. **Retry logic:** Failed embeddings are retried up to 3 times
6. **Progress tracking:** State persisted in `embedding_worker_state` table

```
App Launch
    │
    ▼
Check: frames without embeddings?
    │ yes
    ▼
Start background worker
    │
    ├──▶ Batch: fetch 50 unprocessed frames
    │       │
    │       ▼
    │    Score text quality
    │       │
    │       ├── quality < 0.2 → skip
    │       │
    │       ▼
    │    Prepare structured text
    │       │
    │       ▼
    │    Generate embeddings (fastembed)
    │       │
    │       ▼
    │    Store in ocr_embeddings
    │       │
    │       ▼
    │    Sleep 30s ──────────────┘
    │
    ▼
All frames processed → worker idle
```

Users can also manually trigger batch processing via the UI ("Process 100 embeddings" button).

---

## Hybrid Search

Hybrid search combines FTS and vector search for the best overall quality.

### Algorithm

```
User Query: "When was I debugging the login issue?"
    │
    ├──────────────────────────────────────┐
    │                                      │
    ▼                                      ▼
┌─────────────────┐              ┌─────────────────────┐
│ FTS5 Search      │              │ Vector Search        │
│ (3× limit)       │              │ (3× limit)           │
│                  │              │                      │
│ MATCH "debug     │              │ Embed query → 384d   │
│ login issue"     │              │ Cosine similarity    │
│                  │              │                      │
│ BM25 ranking     │              │ Distance ranking     │
└────────┬────────┘              └──────────┬──────────┘
         │                                  │
         └──────────┬───────────────────────┘
                    │
                    ▼
         ┌──────────────────┐
         │ Score Combination │
         │                  │
         │ For each result: │
         │ score = (fts_weight × fts_hit) │
         │       + (vector_weight × relevance) │
         │                  │
         │ Default weights: │
         │   FTS:    0.30   │
         │   Vector: 0.70   │
         └────────┬─────────┘
                  │
                  ▼
         Sort by combined score (desc)
                  │
                  ▼
         Return top N results
```

### Score Combination Details

```rust
let combined_score = 
    (if fts_matched { fts_weight } else { 0.0 })
    + vector_weight * vector.relevance_score;
```

- FTS-only hits (frames without embeddings) are included with FTS score only
- Vector-only hits are included with vector score only
- Frames matching both get the combined score
- Over-fetching (3× limit) ensures good candidates for re-ranking

### Why Hybrid?

| Scenario | FTS | Vector | Hybrid |
|----------|-----|--------|--------|
| "Figma" (exact app name) | ✅ Excellent | ⚠️ Good | ✅ Excellent |
| "designing the settings page" | ❌ Poor | ✅ Excellent | ✅ Excellent |
| "debug localhost:3000" | ✅ Good | ✅ Good | ✅ Best |
| Frames not yet embedded | ✅ Works | ❌ No results | ✅ Falls back to FTS |

---

## The Tauri IPC Bridge

The frontend communicates with the Rust database through Tauri's IPC (Inter-Process Communication) system.

### Architecture

```
┌─────────────────────────────────────────────────┐
│  Frontend (React / Next.js)                     │
│                                                 │
│  apps/dashboard/hooks/use-semantic-search.ts                   │
│    invoke('hybrid_search', { options })          │
│              │                                  │
└──────────────┼──────────────────────────────────┘
               │ Tauri IPC (JSON serialization)
               ▼
┌─────────────────────────────────────────────────┐
│  Tauri Shell (apps/desktop/src-tauri/src/main.rs)            │
│                                                 │
│  #[tauri::command]                              │
│  fn hybrid_search(options) -> Result<Vec<...>>  │
│              │                                  │
└──────────────┼──────────────────────────────────┘
               │ Rust function call
               ▼
┌─────────────────────────────────────────────────┐
│  ritual-db (apps/desktop/src-tauri/crates/ritual-db/)        │
│                                                 │
│  RitualDatabase::hybrid_search()                │
│    ├── FTS query                                │
│    ├── EmbeddingService::embed() query          │
│    ├── Vector query (vector_distance_cos)       │
│    └── Score combination + re-ranking           │
│              │                                  │
└──────────────┼──────────────────────────────────┘
               │ libSQL
               ▼
┌─────────────────────────────────────────────────┐
│  ritual.db (libSQL file)                        │
│  ~/Library/Application Support/com.ritual.apps/dashboard/app/  │
│                                                 │
│  ocr_frames + ocr_frames_fts + ocr_embeddings  │
└─────────────────────────────────────────────────┘
```

### Complete IPC Command List

#### Database Lifecycle
| Command | Returns | Description |
|---------|---------|-------------|
| `init_ritual_database` | `String` | Initialize the libSQL database connection |
| `get_ritual_db_stats` | `RitualDbStats` | Database size, frame count, embedding count |
| `check_migration_status` | `MigrationStatus` | Whether migrations are complete |

#### Search
| Command | Arguments | Returns | Description |
|---------|-----------|---------|-------------|
| `text_search` | `query`, `limit?` | `Vec<TextSearchResult>` | FTS5 keyword search |
| `semantic_search` | `SemanticSearchOptions` | `Vec<SemanticSearchResult>` | Vector similarity search |
| `hybrid_search` | `HybridSearchOptions` | `Vec<HybridSearchResult>` | Combined FTS + vector search |

#### Embedding Management
| Command | Arguments | Returns | Description |
|---------|-----------|---------|-------------|
| `init_embedding_service` | — | `String` | Download and initialize the model |
| `get_embedding_stats` | — | `EmbeddingStatsResponse` | Pending count, total processed |
| `process_embeddings` | `batch_size?` | `ProcessEmbeddingsResult` | Generate a batch of embeddings |
| `start_embedding_worker` | — | `String` | Start background worker |
| `stop_embedding_worker` | — | `String` | Stop background worker |
| `is_embedding_worker_running` | — | `bool` | Check worker status |

#### Segments
| Command | Arguments | Returns | Description |
|---------|-----------|---------|-------------|
| `get_segments_in_range` | `device_id`, timestamps | `Vec<SegmentResponse>` | Activity segments in time range |
| `get_segment_at_time` | `device_id`, `timestamp` | `Option<SegmentResponse>` | Segment at specific time |
| `get_frames_for_segment` | `segment_id` | `Vec<TextSearchResult>` | All frames in a segment |
| `create_segments` | `device_id`, timestamps | `CreateSegmentsResult` | Build segments from frames |
| `get_segment_stats` | `device_id`, timestamps | `SegmentStatsResponse` | Segment summary statistics |

### Search Option Types

```typescript
// Semantic & Hybrid search options
interface SemanticSearchOptions {
  query: string;
  limit?: number;           // Default: 20
  min_relevance?: number;   // 0.0–1.0 threshold
  start_time?: number;      // Unix ms
  end_time?: number;        // Unix ms
  app_filter?: string[];    // Filter by app bundle IDs
}

interface HybridSearchOptions extends SemanticSearchOptions {
  fts_weight?: number;      // Default: 0.3
  vector_weight?: number;   // Default: 0.7
}
```

### Search Result Types

```typescript
interface SemanticSearchResult {
  frame_id: number;
  timestamp: number;          // Unix ms
  app_bundle_id: string;
  app_name: string;
  window_title: string | null;
  ocr_text: string;
  thumbnail_path: string | null;
  video_chunk_id: number | null;
  frame_offset: number | null;
  relevance_score: number;    // 0.0–1.0
}

interface HybridSearchResult extends SemanticSearchResult {
  fts_matched: boolean;
  vector_distance: number;
  combined_score: number;
}
```

---

## Frontend Search Components

### SemanticSearch UI (`apps/dashboard/components/screen-recorder/SemanticSearch.tsx`)

This is the dedicated search interface accessible from the "AI Search" tab in the Computer Activity panel.

**Features:**
- Search mode selector (Hybrid / Semantic / Text)
- Real-time database stats (DB size, frame count, embedding count, migration status)
- Embedding service status panel (initialization, progress bar, pending count)
- "Process 100 embeddings" manual trigger button
- Results with relevance scores, app icons, window titles, OCR text previews
- Time range filtering
- Click-to-select for viewing frame details

**User flow:**
1. Navigate to the Computer Activity panel → "AI Search" tab
2. (First time) Click "Enable AI Search" to download the embedding model
3. Embeddings generate automatically in the background
4. Type a query (e.g., "When did I debug the sync issue?")
5. Select search mode (Hybrid recommended)
6. View results ranked by relevance

### use-semantic-search Hook (`apps/dashboard/hooks/use-semantic-search.ts`)

The React hook that bridges the frontend to Tauri IPC:

```typescript
// Key exports:
const {
  // Search functions
  semanticSearch,    // Vector-only search
  hybridSearch,      // Combined search (recommended)
  textSearch,        // FTS-only search
  
  // Embedding management
  initEmbeddingService,
  processEmbeddings,
  getEmbeddingStats,
  
  // State
  results,
  isSearching,
  error,
  isInitialized,
  embeddingStats,
} = useSemanticSearch();
```

---

## AI Chat Integration — Current State

### Where Search Works Today

The **dedicated Chat page** (`apps/dashboard/app/(dashboard)/chat/chat-client.tsx`) has partial integration with screen recording search:

**Flow:**
1. User asks a question (e.g., "When did I start working on the browser extension?")
2. `isScreenRecordingQuery()` detects it's a screen-activity question
3. The frontend auto-initializes the embedding service if needed
4. Frontend **pre-fetches** results via `semanticSearch()` Tauri IPC call
5. Results are passed to the `/api/chat/stream` Next.js API route
6. The AI agent receives the results as context via a `searchScreenRecordings` tool
7. The AI formats and presents the results in natural language

### Where Search Does NOT Work Today

The **AI Habit Chat** component (`apps/dashboard/components/ai-habit-chat.tsx`) — the input bar on the main dashboard — currently has **no access** to screen recording search:

- **Log mode:** Uses Typesense for habit logging phrase matching
- **Chat mode:** Redirects to the `/chat` page — does not search inline
- No Tauri IPC calls for semantic/hybrid/text search
- No pre-fetching of screen recording results
- The component is not aware of the Rust vector database at all

### Architecture Gap

```
Current Architecture:

Dashboard Page (Overview)
  └─ AI Habit Chat (apps/dashboard/components/ai-habit-chat.tsx)
       ├─ Log Mode → Typesense (habit phrases)
       └─ Chat Mode → Redirects to /chat page ← ONLY place search works

Chat Page (/chat)
  └─ ChatClient (apps/dashboard/app/(dashboard)/chat/chat-client.tsx)
       ├─ Detects screen recording queries
       ├─ Pre-fetches from Tauri IPC (hybrid_search)
       └─ Passes results to AI streaming API

Missing Link:
  AI Habit Chat ──✗──▶ Tauri IPC (hybrid_search)
```

---

## AI Chat Integration — What's Missing

### Gap 1: No Search in the Dashboard Chat Component

The `ai-habit-chat.tsx` component on the main dashboard has no integration with the Tauri IPC search commands. When a user types a screen-activity question in the dashboard chat, it either:
- Treats it as a habit log attempt (Log mode), or
- Redirects to the `/chat` page (Chat mode)

**What's needed:** The dashboard chat component should be able to call `hybrid_search` via Tauri IPC directly, similar to how `chat-client.tsx` does it.

### Gap 2: AI Agent Cannot Search Dynamically

Even on the `/chat` page, the AI doesn't search dynamically. The frontend pre-fetches results and passes them as static context. If the AI needs to refine its search or do a follow-up query, it cannot.

**What's needed:** The AI streaming API should be able to trigger searches on behalf of the AI agent (via a tool/function call), not just rely on pre-fetched results.

### Gap 3: No Python Backend Access to Screen Data

The Python backend (`apps/backend/`) handles Typesense search for habits, logs, and conversations. It has no access to the Rust/libSQL screen recording database.

**What's needed (if server-side search is desired):**
- Expose an HTTP endpoint from Tauri or the recorder for search
- Or have the Python backend read from the libSQL file directly
- Or keep all search on the frontend via Tauri IPC (simpler)

### Gap 4: Embeddings May Not Be Ready

Users who have been recording for a while may have thousands of frames without embeddings. The background worker processes these, but it takes time. If a user asks a semantic question before embeddings are ready, they get no results.

**What's needed:** Better UX around embedding progress (status indicator in chat, graceful fallback to text-only search when embeddings are unavailable).

---

## Data Flow Diagrams

### End-to-End: From Screen Capture to Search Result

```
RECORDING (continuous, ~1 FPS)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Screen ──▶ xcap capture ──▶ Dedup check ──▶ Apple Vision OCR ──▶ Thumbnail
                                │                                    │
                             duplicate?                              │
                                │ yes                                │
                                ▼                                    ▼
                             (skip)                            Insert into
                                                               ocr_frames
                                                                    │
                                                          ┌─────────┴─────────┐
                                                          │                   │
                                                          ▼                   ▼
                                                    FTS5 Trigger        Background
                                                    (immediate)         Embedding
                                                          │             Worker
                                                          ▼             (async)
                                                    ocr_frames_fts        │
                                                                          ▼
                                                                    Text Processing:
                                                                    • Clean text
                                                                    • Summarize
                                                                    • Keywords
                                                                    • Classify
                                                                    • Score quality
                                                                          │
                                                                          ▼
                                                                    fastembed
                                                                    all-MiniLM-L6-v2
                                                                          │
                                                                          ▼
                                                                    ocr_embeddings
                                                                    (384-dim F32_BLOB)


SEARCH (on demand)
━━━━━━━━━━━━━━━━━━

User Query ──▶ Frontend (React)
                    │
                    ▼
              Tauri IPC invoke('hybrid_search', ...)
                    │
                    ▼
              ritual-db (Rust)
                    │
            ┌───────┴───────┐
            │               │
            ▼               ▼
       FTS5 Query      Embed Query
       (BM25 rank)     (fastembed)
            │               │
            │               ▼
            │         vector_distance_cos()
            │               │
            └───────┬───────┘
                    │
                    ▼
              Score Combination
              (30% FTS + 70% Vector)
                    │
                    ▼
              Re-rank & Limit
                    │
                    ▼
              Return to Frontend
                    │
                    ▼
              Display Results
              (relevance, thumbnails,
               app name, OCR preview)
```

### User-Facing Search Experience

```
┌──────────────────────────────────────────┐
│  Computer Activity Panel                 │
│                                          │
│  [Overview] [Apps] [Websites] [AI Search]│
│                                          │
│  ┌──────────────────────────────────┐    │
│  │ 🔍 "When did I debug the sync"  │    │
│  │    [Hybrid ▾]    [Search]       │    │
│  └──────────────────────────────────┘    │
│                                          │
│  Results:                                │
│  ┌──────────────────────────────────┐    │
│  │ 🟢 0.87  VS Code                │    │
│  │ main.rs — ritual-recorder       │    │
│  │ "sync_queue: fixed race cond.." │    │
│  │ Feb 12, 2:34 PM                 │    │
│  ├──────────────────────────────────┤    │
│  │ 🟡 0.72  Terminal               │    │
│  │ cargo test -- sync              │    │
│  │ "running 3 tests... FAILED..."  │    │
│  │ Feb 12, 2:15 PM                 │    │
│  └──────────────────────────────────┘    │
└──────────────────────────────────────────┘
```

---

## Key Files Reference

### Rust — Recording Pipeline
| File | Purpose |
|------|---------|
| `apps/desktop/src-tauri/bin/ritual-recorder/src/main.rs` | Recorder entry point, main loop |
| `apps/desktop/src-tauri/bin/ritual-recorder/src/capture.rs` | Screen capture via xcap |
| `apps/desktop/src-tauri/bin/ritual-recorder/src/ocr.rs` | OCR pipeline with circuit breaker |
| `apps/desktop/src-tauri/bin/ritual-recorder/src/vision_ffi.rs` | Apple Vision FFI bindings |
| `apps/desktop/src-tauri/bin/ritual-recorder/src/dedup.rs` | Multi-signal frame deduplication |
| `apps/desktop/src-tauri/bin/ritual-recorder/src/thumbnail.rs` | JPEG thumbnail generation |
| `apps/desktop/src-tauri/bin/ritual-recorder/src/storage.rs` | Storage management and cleanup |
| `apps/desktop/src-tauri/bin/ritual-recorder/src/database.rs` | Recorder-to-DB adapter |
| `apps/desktop/src-tauri/bin/ritual-recorder/src/config.rs` | Configuration management |
| `apps/desktop/src-tauri/bin/ritual-recorder/src/metrics.rs` | Performance instrumentation |

### Rust — Database & Search
| File | Purpose |
|------|---------|
| `apps/desktop/src-tauri/crates/ritual-db/src/schema.rs` | Database schema definitions |
| `apps/desktop/src-tauri/crates/ritual-db/src/migration.rs` | Schema migrations |
| `apps/desktop/src-tauri/crates/ritual-db/src/vector.rs` | Embedding service, vector/hybrid search |
| `apps/desktop/src-tauri/crates/ritual-db/src/recorder.rs` | Recorder CRUD operations |
| `apps/desktop/src-tauri/crates/ritual-db/src/lib.rs` | RitualDatabase public API |

### Rust — Tauri Bridge
| File | Purpose |
|------|---------|
| `apps/desktop/src-tauri/src/main.rs` | Tauri app entry, IPC command registration |
| `apps/desktop/src-tauri/src/ritual_database.rs` | IPC command handlers for search |

### Frontend — Search UI
| File | Purpose |
|------|---------|
| `apps/dashboard/components/screen-recorder/SemanticSearch.tsx` | Dedicated search interface |
| `apps/dashboard/hooks/use-semantic-search.ts` | Tauri IPC hook for search |
| `apps/dashboard/app/(dashboard)/chat/chat-client.tsx` | Chat page with search integration |

### Frontend — AI Chat (needs search integration)
| File | Purpose |
|------|---------|
| `apps/dashboard/components/ai-habit-chat.tsx` | Dashboard chat bar (no search today) |
| `apps/dashboard/app/api/chat/habits/route.ts` | Chat streaming API |

### Python Backend
| File | Purpose |
|------|---------|
| `apps/backend/main.py` | FastAPI entry point |
| `apps/backend/services/search_service.py` | Typesense search (habits only) |
| `apps/backend/services/conversation_service.py` | Conversation persistence |
