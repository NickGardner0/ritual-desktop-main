# ritual-db

Unified libSQL database layer for the Ritual desktop application with vector search support.

## Overview

This crate provides a consolidated database layer that replaces the previous separate SQLite databases:
- `watcher.db` → Activity tracking
- `frames.db` → Screen recording metadata and OCR
- `sync_queue.db` → Backend sync queue

All data is now stored in a single `ritual.db` file using [libSQL](https://github.com/tursodatabase/libsql), a SQLite fork with native vector search support.

## Features

- **Unified Schema**: All data in one database with proper foreign keys
- **Automatic Migration**: Seamlessly migrates existing SQLite databases
- **Vector Search**: Semantic search using embeddings (all-MiniLM-L6-v2)
- **Full-Text Search**: FTS5 for keyword search on OCR text
- **Type Safety**: Rust types for all database records
- **Async API**: Built on tokio for async operations
- **Thread Safe**: Can be shared across threads

## Usage

### Basic Setup

```rust
use ritual_db::{RitualDatabase, DatabaseConfig};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Use default config (~/.ritual/ritual.db)
    let config = DatabaseConfig::default();
    
    // Or specify a custom path
    let config = DatabaseConfig::with_path("/path/to/ritual.db");
    
    // Open the database
    let db = RitualDatabase::open(&config).await?;
    
    // Check stats
    let stats = db.get_stats().await?;
    println!("Activity events: {}", stats.activity_event_count);
    println!("OCR frames: {}", stats.ocr_frame_count);
    
    Ok(())
}
```

### Activity Tracking

```rust
use ritual_db::{ActivityEvent, RitualDatabase};

async fn track_activity(db: &RitualDatabase) -> Result<(), Box<dyn std::error::Error>> {
    // Create a new activity event
    let event = ActivityEvent::new(
        "device-123",
        "user-456",
        1706400000000,  // ts_start (ms since epoch)
        1706400001000,  // ts_end
        "com.apple.finder",
        "Finder",
    );
    
    let event_id = db.insert_activity_event(&event).await?;
    
    // Extend event with heartbeat pattern
    db.update_event_end_time(event_id, 1706400005000).await?;
    
    // Get last event for device
    if let Some(last) = db.get_last_event("device-123").await? {
        println!("Last app: {}", last.app_bundle_id);
    }
    
    // Get daily summary
    let summary = db.get_app_summary("device-123", start_of_day, end_of_day).await?;
    for app in summary {
        println!("{}: {} ms", app.app_name, app.total_ms);
    }
    
    Ok(())
}
```

### Screen Recording

```rust
use ritual_db::{OcrFrame, VideoChunk, RitualDatabase};

async fn record_screen(db: &RitualDatabase) -> Result<(), Box<dyn std::error::Error>> {
    // Create video chunk
    let chunk = VideoChunk::new("/path/to/video.mp4", timestamp, monitor_id);
    let chunk_id = db.insert_video_chunk(&chunk).await?;
    
    // Insert OCR frame
    let mut frame = OcrFrame::new(
        timestamp,
        "com.vscode",
        "VS Code",
        "fn main() { println!(\"Hello\"); }",
        "frame_hash_123",
    );
    frame.video_chunk_id = Some(chunk_id);
    
    let frame_id = db.insert_ocr_frame(&frame).await?;
    
    // Search OCR text
    let results = db.search_ocr_text("println", 10).await?;
    
    Ok(())
}
```

### Semantic Search

```rust
use ritual_db::{RitualDatabase, SearchOptions};

async fn semantic_search(db: &RitualDatabase) -> Result<(), Box<dyn std::error::Error>> {
    // Initialize embedding service (downloads model on first use)
    db.init_embedding_service().await?;
    
    // Search by meaning
    let options = SearchOptions::new(10)
        .with_time_range(start_ts, end_ts)
        .with_min_relevance(0.5);
    
    let results = db.search_semantic("debugging authentication issues", options).await?;
    
    for result in results {
        println!("Score: {:.2} - {}", result.relevance_score, result.frame.ocr_text);
    }
    
    Ok(())
}
```

### Sync Queue

```rust
use ritual_db::RitualDatabase;

async fn sync_to_backend(db: &RitualDatabase) -> Result<(), Box<dyn std::error::Error>> {
    // Queue events for sync
    db.queue_activity_sync(event_id).await?;
    db.queue_activity_update(event_id, new_ts_end).await?;
    
    // Get pending sync items
    let pending = db.get_pending_sync(100).await?;
    
    for item in pending {
        // Attempt to sync to backend...
        if sync_succeeded {
            db.mark_synced(item.id).await?;
        } else {
            db.mark_sync_failed(item.id).await?;
        }
    }
    
    Ok(())
}
```

## Migration from Legacy Databases

The database automatically migrates data from existing SQLite databases on first open:

1. Detects `watcher.db`, `frames.db`, `sync_queue.db` in the data directory
2. Creates the new unified schema in `ritual.db`
3. Copies all data preserving IDs and relationships
4. Renames legacy databases to `.migrated` suffix as backup
5. Marks migration as complete

Migration is idempotent - if interrupted, it will resume on next open.

## Schema

### Core Tables

- `activity_events` - App usage tracking with window titles, URLs
- `afk_events` - Away-from-keyboard periods
- `watcher_heartbeat` - Device liveness tracking
- `video_chunks` - Video file metadata
- `ocr_frames` - OCR text with thumbnails and video references
- `ocr_embeddings` - Vector embeddings for semantic search
- `sync_queue` - Backend sync queue with retry support
- `daily_rollup_cache` - Cached daily summaries

### Key Indexes

All tables have indexes optimized for common query patterns:
- Time-range queries (device + timestamp)
- App/domain grouping
- Full-text search on OCR content
- Vector similarity search on embeddings

## Testing

```bash
# Run unit tests
cd src-tauri/crates/ritual-db
cargo test

# Run integration tests
cargo test --test integration_tests

# Run with logging
RUST_LOG=debug cargo test
```

## Architecture

```
ritual-db/
├── src/
│   ├── lib.rs          # Main API and RitualDatabase struct
│   ├── schema.rs       # Table definitions and indexes
│   ├── migration.rs    # SQLite → libSQL migration
│   ├── activity.rs     # Activity event operations
│   ├── recorder.rs     # OCR/video operations
│   ├── sync.rs         # Sync queue operations
│   ├── vector.rs       # Embedding and vector search
│   ├── types.rs        # Shared data types
│   └── error.rs        # Error types
└── tests/
    └── integration_tests.rs
```

## Dependencies

- `libsql` - Database engine with vector support
- `rusqlite` - For reading legacy databases during migration
- `fastembed` - Local embedding generation (all-MiniLM-L6-v2)
- `tokio` - Async runtime
- `serde` - Serialization
- `chrono` - Date/time handling

## License

MIT
