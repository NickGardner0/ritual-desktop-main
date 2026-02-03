# Screen Recording Technical Guide

This document provides a comprehensive technical overview of the Ritual screen recording system, including data flow, storage, OCR processing, embedding generation, and search capabilities.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Data Flow](#data-flow)
3. [Screen Capture](#screen-capture)
4. [OCR Processing](#ocr-processing)
5. [Storage Layer](#storage-layer)
6. [Embedding & Vector Model](#embedding--vector-model)
7. [Search Capabilities](#search-capabilities)
8. [Performance Limitations & Bottlenecks](#performance-limitations--bottlenecks)
9. [Known Issues & Future Improvements](#known-issues--future-improvements)

---

## Architecture Overview

The screen recording system consists of several interconnected components:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Ritual Desktop App                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────────┐    ┌──────────────────┐    ┌───────────────┐ │
│  │  ritual-recorder │    │   ritual-db      │    │ Tauri Main    │ │
│  │  (sidecar)       │───▶│   (crate)        │◀───│ (commands)    │ │
│  │                  │    │                  │    │               │ │
│  │  • Screen Capture│    │  • libSQL DB     │    │ • Frontend    │ │
│  │  • OCR Engine    │    │  • Embeddings    │    │   hooks       │ │
│  │  • Deduplication │    │  • FTS/Vector    │    │ • Search API  │ │
│  │  • Thumbnails    │    │  • Segments      │    │               │ │
│  └──────────────────┘    └──────────────────┘    └───────────────┘ │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `ritual-recorder` | `src-tauri/bin/ritual-recorder/` | Sidecar binary for screen capture, OCR, thumbnails |
| `ritual-db` | `src-tauri/crates/ritual-db/` | Unified libSQL database with vector search |
| Tauri Commands | `src-tauri/src/ritual_database.rs` | Bridge between frontend and database |
| Frontend Hooks | `hooks/use-semantic-search.ts` | React hooks for search UI |

---

## Data Flow

### Complete Frame Processing Pipeline

```
1. CAPTURE (every ~1000ms)
   │
   ├─▶ xcap library captures screen
   │   └─▶ Returns DynamicImage + WindowInfo (app, title, PID)
   │
2. DEDUPLICATION (multi-signal)
   │
   ├─▶ Perceptual Hash (pHash) - 8x8 difference hash
   ├─▶ Window title comparison
   ├─▶ App bundle ID comparison
   └─▶ OCR text hash comparison
   │
   [If duplicate → skip frame]
   │
3. OCR PROCESSING
   │
   ├─▶ Save image to temp PNG file
   ├─▶ Execute AppleScript → Vision framework
   ├─▶ VNRecognizeTextRequest (Accurate level)
   └─▶ Return extracted text + confidence
   │
4. THUMBNAIL GENERATION
   │
   ├─▶ Resize to 320x180 (Triangle filter)
   ├─▶ Save as JPEG (quality=75)
   └─▶ Store in ~/.ritual/thumbnails/
   │
5. DATABASE INSERT
   │
   ├─▶ Insert into ocr_frames table
   ├─▶ Trigger FTS update (via SQLite trigger)
   └─▶ Link to activity_event if available
   │
6. EMBEDDING GENERATION (background worker)
   │
   ├─▶ Query frames without embeddings
   ├─▶ Generate embedding via fastembed (all-MiniLM-L6-v2)
   └─▶ Store 384-dim vector in ocr_embeddings table
```

### Database File Locations

| File | Path | Purpose |
|------|------|---------|
| Unified DB | `~/.ritual/ritual.db` | All data (activity, frames, embeddings, sync) |
| Legacy Watcher DB | `~/.ritual/watcher.db` | Activity events (migrated) |
| Legacy Frames DB | `~/.ritual/frames.db` | OCR frames (migrated) |
| Thumbnails | `~/.ritual/thumbnails/` | JPEG thumbnail images |

---

## Screen Capture

### Capture Module (`capture.rs`)

**Library**: `xcap` (cross-platform screen capture)

**Capture Resolution**: Native monitor resolution

**Default Interval**: 1000ms (configurable via `--capture-interval`)

### Captured Data Structure

```rust
pub struct CaptureResult {
    pub image: DynamicImage,        // Full screen image (RGBA)
    pub timestamp: i64,             // Unix milliseconds
    pub frame_number: u64,          // Sequential counter
    pub monitor_id: u32,            // Monitor being captured
    pub width: u32,
    pub height: u32,
    pub focused_window: Option<WindowInfo>,
}

pub struct WindowInfo {
    pub app_name: String,
    pub window_title: String,
    pub process_id: i32,
    pub bundle_id: Option<String>,  // macOS only
    pub is_focused: bool,
}
```

### Excluded System Apps (macOS)

The following apps are automatically skipped:
- Window Server, SystemUIServer, ControlCenter, Dock
- NotificationCenter, loginwindow, WindowManager
- Contexts, Screenshot, screencaptureui, Spotlight

---

## OCR Processing

### OCR Engine (`ocr.rs`)

**Platform**: macOS only (Vision framework)

**Method**: AppleScript → VNRecognizeTextRequest

**Recognition Level**: `VNRequestTextRecognitionLevelAccurate`

### OCR Flow

```
1. Save DynamicImage to temp PNG
   └─▶ /tmp/ritual_ocr_{pid}_{timestamp}.png

2. Execute AppleScript with Vision framework
   └─▶ osascript -l AppleScript -e <script>

3. Vision Framework Processing
   ├─▶ VNImageRequestHandler (from TIFF data)
   ├─▶ VNRecognizeTextRequest (Accurate level)
   └─▶ Extract topCandidates from observations

4. Parse results and cleanup temp file
```

### OCR Result Structure

```rust
pub struct OcrResult {
    pub text: String,           // All extracted text (newline-separated)
    pub confidence: f64,        // 0.0-1.0 (defaults to 0.8 if text found)
    pub elements: Vec<TextElement>,  // Individual text blocks (unused)
}
```

### Circuit Breaker Protection

The OCR processor includes a circuit breaker to prevent hangs:

| Parameter | Value | Description |
|-----------|-------|-------------|
| `DEFAULT_TIMEOUT_MS` | 5,000ms | Per-frame OCR timeout |
| `MAX_TIMEOUT_MS` | 10,000ms | Maximum timeout allowed |
| `FAILURE_THRESHOLD` | 5 | Failures before circuit opens |
| `CIRCUIT_RESET_SECS` | 60s | Cooldown before retry |

When the circuit opens, OCR is disabled temporarily and returns empty results.

---

## Storage Layer

### Database Schema (libSQL/SQLite)

#### `ocr_frames` Table

```sql
CREATE TABLE ocr_frames (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,           -- Unix ms when captured
    activity_event_id INTEGER,            -- Link to activity_events
    app_bundle_id TEXT,
    app_name TEXT,
    window_title TEXT,
    ocr_text TEXT,                        -- Extracted text
    ocr_confidence REAL DEFAULT 0.0,
    thumbnail_path TEXT,                  -- Path to JPEG thumbnail
    video_chunk_id INTEGER,               -- NULL (video removed)
    frame_offset INTEGER,                 -- NULL (video removed)
    image_hash TEXT,                      -- SHA256 of downsampled image
    storage_tier TEXT DEFAULT 'hot',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

#### `ocr_embeddings` Table

```sql
CREATE TABLE ocr_embeddings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    frame_id INTEGER NOT NULL UNIQUE,
    embedding F32_BLOB(384),              -- 384-dim vector (libSQL native)
    model_version TEXT DEFAULT 'all-MiniLM-L6-v2',
    status TEXT DEFAULT 'ok',             -- 'ok', 'failed', 'pending'
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL
);
```

#### FTS5 Virtual Table

```sql
CREATE VIRTUAL TABLE ocr_frames_fts USING fts5(
    ocr_text,
    app_name,
    window_title,
    content='ocr_frames',
    content_rowid='id'
);
```

Auto-sync triggers keep FTS in sync with `ocr_frames`.

### Thumbnail Storage

| Property | Value |
|----------|-------|
| Format | JPEG |
| Dimensions | 320x180 pixels |
| Quality | 75% |
| Naming | `thumb_YYYYMMDD_HHMMSS_{ms}.jpg` |
| Location | `~/.ritual/thumbnails/` |
| Typical Size | ~10-30 KB per thumbnail |

### Storage Limits

| Setting | Default | Description |
|---------|---------|-------------|
| `storage_limit_gb` | 20 GB | Maximum thumbnail storage |
| `retention_days` | 30 days | Auto-delete older frames |

Maintenance runs every hour to enforce limits.

---

## Embedding & Vector Model

### Model Details

| Property | Value |
|----------|-------|
| Model | `all-MiniLM-L6-v2` |
| Library | `fastembed` (Rust) |
| Dimensions | 384 |
| Download Size | ~30 MB (on first use) |
| Storage Format | `F32_BLOB(384)` (libSQL native) |

### Embedding Generation Process

```rust
// Text preparation
fn prepare_frame_text(frame: &OcrFrame) -> String {
    // Combines: app_name + window_title + ocr_text
    // Truncates to 8000 chars max
}

// Embedding generation
fn embed(&self, text: &str) -> Result<Vec<f32>> {
    // Uses fastembed TextEmbedding model
    // Returns 384-dimensional vector
}
```

### Background Embedding Worker

The embedding worker runs in a background thread:

1. Queries `ocr_frames` without matching `ocr_embeddings`
2. Processes in batches (default: 50 frames)
3. Stores embeddings with status tracking
4. Retries failed embeddings (max 3 retries)

**Worker State** tracked in `embedding_worker_state` table:
- `is_running` - Worker active status
- `last_run_at` - Last processing timestamp
- `frames_processed` - Total successful embeddings
- `frames_failed` - Total failures

---

## Search Capabilities

### 1. Full-Text Search (FTS)

**Method**: SQLite FTS5 with `MATCH` operator

**Indexed Fields**: `ocr_text`, `app_name`, `window_title`

**Query**: Standard FTS5 syntax (AND, OR, phrases, prefix)

```sql
SELECT f.* FROM ocr_frames f
JOIN ocr_frames_fts fts ON f.id = fts.rowid
WHERE ocr_frames_fts MATCH ?
ORDER BY f.timestamp DESC
LIMIT ?
```

**Pros**:
- Fast keyword matching
- Supports boolean operators
- Low latency (~1-10ms)

**Cons**:
- No semantic understanding
- Exact match only (no typo tolerance)

### 2. Semantic/Vector Search

**Method**: libSQL `vector_distance_cos()` function

**Query Embedding**: Same model used for frame embeddings

```sql
SELECT f.*, vector_distance_cos(e.embedding, ?) as distance
FROM ocr_frames f
JOIN ocr_embeddings e ON f.id = e.frame_id
ORDER BY distance ASC
LIMIT ?
```

**Scoring**: Distance converted to relevance: `relevance = 1.0 - distance`

**Pros**:
- Understands meaning, not just keywords
- Finds related content even with different words
- Good for natural language queries

**Cons**:
- Requires embeddings to exist
- Higher latency than FTS (~50-200ms)
- May return semantically similar but irrelevant results

### 3. Hybrid Search (Recommended)

**Method**: Combines FTS candidates with vector re-ranking

```
1. Get FTS candidates (3x limit)
2. Calculate vector distance for each candidate
3. Combined score = (fts_weight × 1.0) + (vector_weight × relevance)
4. Sort by combined score
5. Return top N results
```

**Default Weights**:
- FTS: 0.3 (30%)
- Vector: 0.7 (70%)

**Pros**:
- Best of both worlds
- FTS provides precision, vectors provide recall
- Faster than pure vector search (smaller candidate set)

### Search Options

```typescript
interface SemanticSearchOptions {
    query: string;
    limit?: number;           // Default: 20
    min_relevance?: number;   // 0.0-1.0 threshold
    start_time?: number;      // Unix ms filter
    end_time?: number;
    app_filter?: string[];    // Bundle IDs to include
}
```

---

## Performance Limitations & Bottlenecks

### 1. OCR Processing

**Bottleneck**: AppleScript → Vision framework invocation

| Issue | Impact | Current Mitigation |
|-------|--------|-------------------|
| Process spawn overhead | ~200-500ms per frame | Circuit breaker, timeout |
| AppleScript parsing | Additional ~50-100ms | None |
| Temp file I/O | ~10-50ms | Unique filenames, cleanup |
| No batching | Linear scaling | Frame deduplication |

**Root Cause**: Using `osascript` subprocess rather than native Vision bindings.

**Potential Fix**: Use Rust `cidre` or `objc2` crates for direct Vision framework access.

### 2. Embedding Generation

**Bottleneck**: CPU-bound embedding computation

| Issue | Impact | Current Mitigation |
|-------|--------|-------------------|
| Model inference | ~20-50ms per frame | Background worker |
| No GPU acceleration | CPU only | Batch processing |
| Backlog accumulation | Delayed search results | Worker status UI |

**Potential Fix**: 
- Use ONNX Runtime with Metal/GPU support
- Pre-filter frames that need embeddings (skip low-confidence OCR)

### 3. Vector Search

**Bottleneck**: Full table scan for similarity

| Issue | Impact | Current Mitigation |
|-------|--------|-------------------|
| No vector index | O(n) scan | Hybrid search (FTS pre-filter) |
| Large embedding table | Memory pressure | Pagination, limits |

**Potential Fix**: 
- Use libSQL's `vector_idx` when available
- Implement ANN (Approximate Nearest Neighbor) index

### 4. Frame Deduplication

**Current Signals**:
1. Perceptual hash (8x8 difference hash)
2. Window title changes
3. App bundle ID changes
4. OCR text hash

**Limitations**:
- pHash can miss subtle UI changes
- OCR text hash is coarse (any change = different)
- No motion detection

**Potential Improvements**:
- Use larger hash (16x16 or 32x32)
- Implement word-level OCR diff
- Add scroll detection

### 5. Storage

**Bottleneck**: Thumbnail directory size

| Issue | Impact | Mitigation |
|-------|--------|------------|
| Many small files | Filesystem overhead | JPEG compression |
| No compression | Higher disk usage | Quality=75% |
| Sequential access | Slow timeline load | Lazy loading in UI |

**Potential Fix**:
- Bundle thumbnails into archive files
- Use WebP format (smaller, better quality)
- Implement thumbnail tiling

---

## Known Issues & Future Improvements

### Current Issues

1. **OCR Latency**
   - Vision framework via AppleScript is slow (~300-800ms)
   - Can cause frame drops at high capture rates

2. **Embedding Backlog**
   - New installs have no embeddings
   - Background worker may take hours to catch up

3. **Memory Usage**
   - Embedding model loaded in memory (~100-200MB)
   - Large searches can spike memory

4. **No Incremental Index**
   - FTS and vector search scan full tables
   - Performance degrades with data volume

5. **Platform Limitation**
   - OCR only works on macOS
   - No Windows/Linux support

### Planned Improvements

1. **Native Vision Bindings**
   - Replace AppleScript with direct Objective-C calls
   - Expected 5-10x OCR speedup

2. **Vector Index**
   - Implement HNSW or IVF index for vectors
   - Expected 10-100x search speedup at scale

3. **Incremental Processing**
   - Stream embeddings as frames arrive
   - Eliminate embedding backlog

4. **Multi-Modal Search**
   - Add image similarity search
   - Combine OCR + visual features

5. **Cross-Platform OCR**
   - Tesseract as fallback for non-macOS
   - Windows: Win32 OCR API

---

## Configuration Reference

### Recorder CLI Arguments

```
ritual-recorder [OPTIONS]

OPTIONS:
    --database <PATH>           Frames database path [default: ~/.ritual/frames.db]
    --watcher-db <PATH>         Activity database path [default: ~/.ritual/watcher.db]
    --thumbnail-dir <PATH>      Thumbnail directory [default: ~/.ritual/thumbnails]
    --capture-interval <MS>     Capture interval [default: 1000]
    --monitor-id <ID>           Monitor to capture [default: 0]
    --disable-dedup             Disable frame deduplication
    --dedup-threshold <F64>     Dedup similarity threshold [default: 0.02]
    --max-frame-gap <SECS>      Force frame after gap [default: 60]
    --disable-ocr               Disable OCR extraction
    --ocr-language <CODE>       OCR language [default: en-US]
    --storage-limit-gb <GB>     Storage limit [default: 20]
    --excluded-apps <APPS>      Comma-separated bundle IDs to exclude
    --maintenance               Run maintenance only
    --list-monitors             List available monitors
    --status                    Show storage status
    -v, --verbose               Enable debug logging
```

### Database Configuration

```rust
pub struct DatabaseConfig {
    pub db_path: PathBuf,           // ~/.ritual/ritual.db
    pub data_dir: PathBuf,          // ~/.ritual
    pub auto_migrate: bool,         // true
    pub enable_embeddings: bool,    // true
    pub max_connections: u32,       // 1
}
```

---

## Appendix: Data Type Definitions

### OcrFrame

```rust
pub struct OcrFrame {
    pub id: Option<i64>,
    pub timestamp: i64,
    pub activity_event_id: Option<i64>,
    pub app_bundle_id: String,
    pub app_name: String,
    pub window_title: Option<String>,
    pub ocr_text: String,
    pub ocr_confidence: f64,
    pub thumbnail_path: Option<String>,
    pub video_chunk_id: Option<i64>,    // Always None (video removed)
    pub frame_offset: Option<i64>,      // Always None (video removed)
    pub image_hash: String,
    pub storage_tier: StorageTier,
    pub created_at: Option<i64>,
}
```

### SearchResult

```rust
pub struct SearchResult {
    pub frame: OcrFrame,
    pub distance: f32,          // Vector distance (0 = identical)
    pub relevance_score: f32,   // 1.0 - distance (1 = most relevant)
}
```

### HybridSearchResult

```rust
pub struct HybridSearchResult {
    pub frame: OcrFrame,
    pub fts_matched: bool,      // True if FTS found this frame
    pub vector_distance: f32,
    pub combined_score: f32,    // Weighted FTS + vector score
}
```

---

*Last updated: January 2026*
