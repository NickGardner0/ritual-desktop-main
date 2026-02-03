# Ritual Screen Recorder & Search Technical Guide

This document provides a comprehensive breakdown of how the Ritual screen recorder, OCR system, database layer, and search capabilities work.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Screen Capture System](#screen-capture-system)
3. [OCR Processing](#ocr-processing)
4. [Database Architecture](#database-architecture)
5. [Full-Text Search (FTS)](#full-text-search-fts)
6. [Vector/Semantic Search](#vectorsemantic-search)
7. [Current Limitations](#current-limitations)
8. [Query Capabilities](#query-capabilities)
9. [Future Improvements](#future-improvements)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            RITUAL SCREEN RECORDER                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                  │
│  │   xcap       │───▶│  Deduplicator│───▶│  OCR Engine  │                  │
│  │ (capture)    │    │ (perceptual) │    │(Apple Vision)│                  │
│  └──────────────┘    └──────────────┘    └──────────────┘                  │
│         │                                        │                          │
│         ▼                                        ▼                          │
│  ┌──────────────┐                      ┌──────────────┐                    │
│  │   FFmpeg     │                      │   libSQL     │                    │
│  │ (H.265 video)│                      │  Database    │                    │
│  └──────────────┘                      └──────────────┘                    │
│                                               │                             │
│                              ┌────────────────┴────────────────┐           │
│                              ▼                                 ▼           │
│                       ┌──────────────┐                ┌──────────────┐     │
│                       │    FTS5      │                │   Vector     │     │
│                       │  (keyword)   │                │  (semantic)  │     │
│                       └──────────────┘                └──────────────┘     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Component Summary

| Component | Technology | Purpose |
|-----------|------------|---------|
| Screen Capture | `xcap` crate | Cross-platform screen capture |
| Frame Deduplication | Perceptual hashing | Skip identical/similar frames |
| OCR | Apple Vision Framework | Extract text from screenshots |
| Video Storage | FFmpeg (H.265/HEVC) | Compressed video chunks |
| Database | libSQL (SQLite fork) | Metadata, OCR text, embeddings |
| Full-Text Search | FTS5 | Keyword-based search |
| Semantic Search | all-MiniLM-L6-v2 | Natural language search |

---

## Screen Capture System

### Capture Library

**Technology**: `xcap` crate (v0.8)

The recorder uses the `xcap` Rust crate for cross-platform screen capture:

```rust
// From src-tauri/bin/ritual-recorder/src/capture.rs
let buffer = self.monitor.capture_image()
    .context("Failed to capture screen")?;
let image = DynamicImage::ImageRgba8(
    ImageBuffer::from_raw(width, height, buffer.into_raw())
        .context("Failed to create image buffer")?
);
```

### Capture Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `capture-interval` | 1000ms | Time between captures (1 FPS) |
| `thumbnail-interval` | 60000ms | Time between thumbnail saves |
| `video-chunk-duration` | 300s | Length of each video file |
| `max-frame-gap` | 60s | Force capture even if frame identical |
| `monitor-id` | 0 | Which monitor to capture |

### Frame Deduplication

Deduplication prevents storing nearly-identical frames:

- **Algorithm**: Perceptual hashing (pHash)
- **Default threshold**: 2% difference required to store new frame
- **Max gap**: Forces a frame every 60 seconds regardless

```rust
// Deduplication decision
if deduplicator.should_store(&image) {
    // Process and store frame
} else {
    // Skip duplicate frame
}
```

### Window Detection

The recorder detects the active window using `xcap::Window::all()`:

- **App Bundle ID**: e.g., `com.apple.Safari`
- **App Name**: e.g., `Safari`
- **Window Title**: e.g., `GitHub - ritual-desktop`

### Video Encoding

Frames are encoded to H.265/HEVC video using FFmpeg:

| Quality | CRF | Max Resolution | ~Storage/Month |
|---------|-----|----------------|----------------|
| Low | 32 | 480p | ~3GB |
| Medium | 28 | 720p | ~8GB |
| High | 23 | 1080p | ~15GB |

---

## OCR Processing

### OCR Engine

**Technology**: Apple Vision Framework (macOS only)

OCR is performed using Apple's native Vision framework via AppleScript:

```rust
// From src-tauri/bin/ritual-recorder/src/ocr.rs
let script = format!(r#"
    use framework "Vision"
    set textRequest to current application's VNRecognizeTextRequest's alloc()'s init()
    textRequest's setRecognitionLevel:(current application's VNRequestTextRecognitionLevelAccurate)
    ...
"#);
```

### OCR Output

Each processed frame produces:

| Field | Type | Description |
|-------|------|-------------|
| `ocr_text` | String | Extracted text content |
| `ocr_confidence` | Float | Confidence score (0.0-1.0) |
| `ocr_elements` | Array | Individual text elements with bounding boxes |

### OCR Limitations

- **macOS only**: Uses Apple Vision Framework
- **Latin scripts optimized**: Default language is `en-US`
- **No real-time processing**: OCR runs after capture, ~100-500ms per frame
- **Accuracy varies**: Depends on text size, contrast, and font

---

## Database Architecture

### Database Technology

**Technology**: libSQL (SQLite-compatible with vector extensions)

**Location**: `~/.ritual/ritual.db`

libSQL was chosen for:
- Native vector type support (`F32_BLOB`)
- Built-in vector similarity functions
- SQLite compatibility (familiar SQL)
- Local-first, no network required

### Database Schema

#### `ocr_frames` - Screen Recording Data

```sql
CREATE TABLE ocr_frames (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,              -- Unix timestamp (ms)
    activity_event_id INTEGER,               -- Link to activity tracking
    app_bundle_id TEXT,                      -- com.apple.Safari
    app_name TEXT,                           -- Safari
    window_title TEXT,                       -- GitHub - ritual-desktop
    ocr_text TEXT,                           -- Extracted text content
    ocr_confidence REAL DEFAULT 0.0,         -- 0.0 to 1.0
    thumbnail_path TEXT,                     -- Path to thumbnail image
    video_chunk_id INTEGER,                  -- Link to video file
    frame_offset INTEGER,                    -- Frame number in video
    image_hash TEXT,                         -- Perceptual hash
    storage_tier TEXT DEFAULT 'hot',         -- hot/warm/cold
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (video_chunk_id) REFERENCES video_chunks(id),
    FOREIGN KEY (activity_event_id) REFERENCES activity_events(id)
);
```

#### `ocr_embeddings` - Vector Embeddings

```sql
CREATE TABLE ocr_embeddings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    frame_id INTEGER NOT NULL UNIQUE,
    embedding F32_BLOB(384),                 -- 384-dimensional vector
    model_version TEXT DEFAULT 'all-MiniLM-L6-v2',
    created_at INTEGER NOT NULL,
    
    FOREIGN KEY (frame_id) REFERENCES ocr_frames(id) ON DELETE CASCADE
);
```

#### `video_chunks` - Video File Metadata

```sql
CREATE TABLE video_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT NOT NULL UNIQUE,
    start_time INTEGER NOT NULL,
    end_time INTEGER,
    frame_count INTEGER DEFAULT 0,
    file_size_bytes INTEGER,
    monitor_id INTEGER DEFAULT 0,
    storage_tier TEXT DEFAULT 'hot',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

### Database Indexes

Optimized indexes for common query patterns:

```sql
-- Time-based queries
CREATE INDEX idx_ocr_frames_timestamp ON ocr_frames(timestamp);

-- App filtering
CREATE INDEX idx_ocr_frames_app ON ocr_frames(app_bundle_id);

-- Activity joins
CREATE INDEX idx_ocr_frames_activity ON ocr_frames(activity_event_id);

-- Storage tier management
CREATE INDEX idx_ocr_frames_tier ON ocr_frames(storage_tier);
```

### Storage Tiers

Automatic data lifecycle management:

| Tier | Age | Storage | Content |
|------|-----|---------|---------|
| Hot | 0-7 days | Full quality | Video + OCR + metadata |
| Warm | 7-30 days | Compressed | Reduced video + OCR + metadata |
| Cold | 30-90 days | Minimal | Thumbnails + OCR only |

---

## Full-Text Search (FTS)

### FTS5 Implementation

**Technology**: SQLite FTS5 (Full-Text Search 5)

A virtual table indexes OCR text for keyword search:

```sql
CREATE VIRTUAL TABLE ocr_frames_fts USING fts5(
    ocr_text,
    app_name,
    window_title,
    content='ocr_frames',
    content_rowid='id'
);
```

### Automatic Synchronization

Triggers keep the FTS index in sync with the main table:

```sql
-- Insert trigger
CREATE TRIGGER ocr_frames_ai AFTER INSERT ON ocr_frames BEGIN
    INSERT INTO ocr_frames_fts(rowid, ocr_text, app_name, window_title)
    VALUES (new.id, new.ocr_text, new.app_name, new.window_title);
END;

-- Delete trigger
CREATE TRIGGER ocr_frames_ad AFTER DELETE ON ocr_frames BEGIN
    INSERT INTO ocr_frames_fts(ocr_frames_fts, rowid, ocr_text, app_name, window_title)
    VALUES ('delete', old.id, old.ocr_text, old.app_name, old.window_title);
END;
```

### FTS Query Examples

```sql
-- Basic keyword search
SELECT f.* FROM ocr_frames f
JOIN ocr_frames_fts fts ON f.id = fts.rowid
WHERE ocr_frames_fts MATCH 'budget report'
ORDER BY f.timestamp DESC
LIMIT 50;

-- With time range
SELECT f.* FROM ocr_frames f
JOIN ocr_frames_fts fts ON f.id = fts.rowid
WHERE ocr_frames_fts MATCH 'React component'
  AND f.timestamp >= 1706600000000 
  AND f.timestamp <= 1706700000000
ORDER BY f.timestamp DESC;
```

### FTS Query Syntax

| Query | Matches |
|-------|---------|
| `budget` | Frames containing "budget" |
| `budget report` | Frames containing "budget" AND "report" |
| `"budget report"` | Frames containing exact phrase |
| `budget OR expense` | Frames containing either word |
| `budget*` | Prefix match (budget, budgets, budgeting) |

---

## Vector/Semantic Search

### Embedding Model

**Model**: `all-MiniLM-L6-v2`  
**Library**: `fastembed` Rust crate  
**Dimensions**: 384  
**Size**: ~30MB (downloaded on first use)

This model runs entirely on-device for privacy.

### Text Preparation

Before embedding, text is prepared by combining:

```rust
fn prepare_frame_text(frame: &OcrFrame) -> String {
    let mut text = String::new();
    if let Some(app) = &frame.app_name {
        text.push_str(app);
        text.push(' ');
    }
    if let Some(title) = &frame.window_title {
        text.push_str(title);
        text.push(' ');
    }
    if let Some(ocr) = &frame.ocr_text {
        text.push_str(ocr);
    }
    // Truncate to 8000 chars (model context limit)
    text.chars().take(8000).collect()
}
```

### Vector Storage

Embeddings are stored as native libSQL vectors:

```sql
-- Storage format: F32_BLOB(384)
-- 384 dimensions × 4 bytes = 1,536 bytes per embedding
INSERT INTO ocr_embeddings (frame_id, embedding, model_version, created_at)
VALUES (?, ?, 'all-MiniLM-L6-v2', ?);
```

### Semantic Search Query

```sql
SELECT 
    f.*,
    vector_distance_cos(e.embedding, ?) as distance
FROM ocr_frames f
JOIN ocr_embeddings e ON f.id = e.frame_id
WHERE f.timestamp >= ? AND f.timestamp <= ?
ORDER BY distance ASC
LIMIT ?;
```

**Similarity Calculation**:
- Uses `vector_distance_cos()` (cosine distance)
- Distance: 0 = identical, 1 = orthogonal
- Relevance score: `1.0 - distance`

### Current Embedding Status

> **⚠️ CRITICAL GAP**: Embeddings are NOT automatically generated.

The infrastructure exists, but:
1. `ritual-recorder` stores OCR frames
2. No background worker generates embeddings
3. `process_embeddings()` command is a stub

**Result**: Semantic search returns no results until embeddings are manually generated.

---

## Current Limitations

### 1. Embedding Generation Not Automated

| Issue | Impact |
|-------|--------|
| No background worker | Embeddings never created |
| Manual processing only | Users must trigger embedding manually |
| No incremental updates | New frames don't get embeddings |

### 2. Search Limitations

| Limitation | Description |
|------------|-------------|
| Single vector per frame | Can't distinguish multiple topics in one frame |
| 512 token context | Long OCR text truncated before embedding |
| No cross-frame reasoning | Can't answer "how long did I spend on X?" |
| No metadata understanding | Vectors don't encode time, duration, or counts |

### 3. OCR Limitations

| Limitation | Description |
|------------|-------------|
| macOS only | Apple Vision Framework required |
| Latin script optimized | Other scripts may have lower accuracy |
| No handwriting | Vision Framework focuses on printed text |
| UI elements | May capture button text, menus, etc. |

### 4. UI Limitations

| Missing Feature | Description |
|-----------------|-------------|
| App filter UI | Can filter by app in code, not exposed in UI |
| Relevance threshold | Fixed at 0.3, not user-adjustable |
| Result limit | Fixed limits, not user-adjustable |
| Date range picker | Only via props, no UI picker |

---

## Query Capabilities

### ✅ What Users CAN Ask

#### Semantic Search (AI Mode)
Natural language queries that find semantically similar content:

| Example Query | How It Works |
|---------------|--------------|
| "When was I working on the budget spreadsheet?" | Finds frames with budget/spreadsheet-related text |
| "Show me emails about the product launch" | Matches email content about launches |
| "Find my React debugging session" | Locates React error messages and debugging |
| "Looking at documentation yesterday" | Finds doc-related content (needs time filter) |
| "Meeting notes from Zoom" | Matches Zoom + meeting note content |

#### Text Search (FTS Mode)
Exact keyword matching:

| Example Query | How It Works |
|---------------|--------------|
| `"API endpoint"` | Exact phrase match |
| `React OR Vue` | Boolean OR |
| `function*` | Prefix wildcard |
| `"pull request"` | Finds exact phrase |

### ❌ What Users CANNOT Ask

#### Aggregation/Analytics Questions

| Query | Why It Fails | Alternative |
|-------|--------------|-------------|
| "How many hours did I spend coding?" | Requires time aggregation, not similarity | Use activity tracking analytics |
| "What was my most used app?" | Requires counting, not vector search | Query activity_events directly |
| "Total time in meetings this week" | Aggregation query | Use SQL on activity data |

#### Complex Reasoning Questions

| Query | Why It Fails |
|-------|--------------|
| "Did I finish the report before the meeting?" | Requires temporal reasoning |
| "Compare my Monday vs Tuesday productivity" | Requires multi-day comparison |
| "What task was I doing before the break?" | Requires sequence understanding |

#### Questions About Non-Text Content

| Query | Why It Fails |
|-------|--------------|
| "Show me when I was looking at images" | OCR doesn't capture image content |
| "Find videos I watched" | Only captures visible text, not video content |
| "What color scheme was I using?" | Visual features not captured |

#### Cross-Frame Relationships

| Query | Why It Fails |
|-------|--------------|
| "What project was this file part of?" | No project context stored |
| "Who sent me that email?" | Individual frame, no thread context |
| "Show the full conversation" | Frames are independent snapshots |

---

## Future Improvements

### Priority 1: Implement Background Embedding Worker

```rust
// Proposed: Auto-generate embeddings for new frames
async fn embedding_worker(db: &Database) {
    loop {
        let pending = db.get_frames_without_embeddings(100).await?;
        if !pending.is_empty() {
            let embeddings = embedding_service.embed_batch(&pending).await?;
            db.store_embeddings(embeddings).await?;
        }
        sleep(Duration::from_secs(30)).await;
    }
}
```

### Priority 2: Chunking Strategy

For frames with long OCR text, create multiple embeddings:

- **Current**: 1 embedding per frame (truncated at 8000 chars)
- **Proposed**: Multiple embeddings per frame, chunked by semantic units

### Priority 3: Hybrid Search

Combine vector and FTS for better results:

```sql
-- Combine FTS keyword matching with vector similarity
SELECT f.*, 
    fts_score + (1.0 - vector_distance) as combined_score
FROM ocr_frames f
JOIN ocr_frames_fts fts ON f.id = fts.rowid
JOIN ocr_embeddings e ON f.id = e.frame_id
WHERE ocr_frames_fts MATCH ?
ORDER BY combined_score DESC;
```

### Priority 4: Enhanced UI

- App filter dropdown
- Relevance threshold slider
- Date range picker
- Result limit selector
- Advanced query builder

### Priority 5: Activity Integration

Link semantic search results with activity tracking:

```sql
-- Find frames and their duration context
SELECT 
    f.*,
    a.ts_end - a.ts_start as activity_duration_ms
FROM ocr_frames f
JOIN ocr_embeddings e ON f.id = e.frame_id
LEFT JOIN activity_events a ON f.activity_event_id = a.id
WHERE vector_distance_cos(e.embedding, ?) < 0.5
ORDER BY vector_distance_cos(e.embedding, ?) ASC;
```

---

## Configuration Reference

### Environment Variables

None required - all configuration via CLI flags or defaults.

### CLI Flags

```bash
ritual-recorder \
  --capture-interval 1000 \      # ms between captures
  --thumbnail-interval 60000 \   # ms between thumbnails
  --video-quality medium \       # low/medium/high
  --video-chunk-duration 300 \   # seconds per video file
  --storage-limit-gb 20 \        # max storage
  --excluded-apps "com.apple.SecurityAgent,..." \
  --disable-dedup \              # skip deduplication
  --disable-ocr \                # skip OCR processing
  --verbose                      # debug logging
```

### Default Excluded Apps

Privacy-sensitive apps excluded by default:

- `com.apple.SecurityAgent` (password dialogs)
- `com.apple.keychainaccess` (Keychain)
- `com.1password.*` (1Password)
- `com.bitwarden.*` (Bitwarden)
- Windows with "Password", "Private", "Incognito" in title

---

## Summary

| Component | Status | Notes |
|-----------|--------|-------|
| Screen Capture | ✅ Working | 1 FPS with deduplication |
| OCR | ✅ Working | Apple Vision, macOS only |
| Video Storage | ✅ Working | H.265, tiered storage |
| Database | ✅ Working | libSQL with vectors |
| FTS Search | ✅ Working | Keyword search functional |
| Vector Search | ⚠️ Partial | Infrastructure ready, embeddings not generated |
| UI | ✅ Working | Basic search UI functional |

**Key Action Item**: Implement background embedding worker to make semantic search fully functional.
