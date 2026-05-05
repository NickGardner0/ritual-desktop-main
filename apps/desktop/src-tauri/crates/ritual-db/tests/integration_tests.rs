//! Integration tests for the ritual-db crate
//!
//! These tests verify the complete workflow from database creation
//! through all CRUD operations.

use ritual_db::{ActivityEvent, DatabaseConfig, OcrFrame, RitualDatabase, VideoChunk};
use tempfile::TempDir;

/// Create a test database in a temporary directory
async fn create_test_db() -> (RitualDatabase, TempDir) {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let config = DatabaseConfig::for_testing(temp_dir.path());

    let db = RitualDatabase::open(&config)
        .await
        .expect("Failed to open database");

    (db, temp_dir)
}

async fn insert_test_activity_event(
    db: &RitualDatabase,
    ts_start: i64,
    ts_end: i64,
) -> i64 {
    let event = ActivityEvent::new("device1", "user1", ts_start, ts_end, "com.test", "Test");
    db.insert_activity_event(&event)
        .await
        .expect("Failed to insert test activity event")
}

// ============================================================================
// DATABASE LIFECYCLE TESTS
// ============================================================================

#[tokio::test]
async fn test_database_creation() {
    let (db, _temp) = create_test_db().await;

    assert!(db.exists());

    let stats = db.get_stats().await.expect("Failed to get stats");
    assert_eq!(stats.activity_event_count, 0);
    assert_eq!(stats.ocr_frame_count, 0);
}

#[tokio::test]
async fn test_database_reopening() {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let config = DatabaseConfig::for_testing(temp_dir.path());

    // Create database and insert data
    {
        let db = RitualDatabase::open(&config).await.expect("Failed to open");

        let event = ActivityEvent::new("device1", "user1", 1000, 2000, "com.test", "Test");
        db.insert_activity_event(&event)
            .await
            .expect("Failed to insert");
    }

    // Reopen and verify data persisted
    {
        let db = RitualDatabase::open(&config)
            .await
            .expect("Failed to reopen");

        let stats = db.get_stats().await.expect("Failed to get stats");
        assert_eq!(stats.activity_event_count, 1);
    }
}

// ============================================================================
// ACTIVITY EVENT TESTS
// ============================================================================

#[tokio::test]
async fn test_activity_event_crud() {
    let (db, _temp) = create_test_db().await;

    // Create
    let event = ActivityEvent::new("device1", "user1", 1000, 2000, "com.apple.finder", "Finder");
    let id = db
        .insert_activity_event(&event)
        .await
        .expect("Insert failed");
    assert!(id > 0);

    // Read
    let retrieved = db.get_activity_event(id).await.expect("Get failed");
    assert!(retrieved.is_some());
    let retrieved = retrieved.unwrap();
    assert_eq!(retrieved.device_id, "device1");
    assert_eq!(retrieved.app_bundle_id, "com.apple.finder");

    // Update
    db.update_event_end_time(id, 3000)
        .await
        .expect("Update failed");
    let updated = db
        .get_activity_event(id)
        .await
        .expect("Get failed")
        .unwrap();
    assert_eq!(updated.ts_end, 3000);
}

#[tokio::test]
async fn test_activity_event_querying() {
    let (db, _temp) = create_test_db().await;

    // Insert multiple events
    for i in 0..10 {
        let event = ActivityEvent::new(
            "device1",
            "user1",
            i * 1000,
            (i + 1) * 1000,
            if i % 2 == 0 { "com.app.a" } else { "com.app.b" },
            if i % 2 == 0 { "App A" } else { "App B" },
        );
        db.insert_activity_event(&event)
            .await
            .expect("Insert failed");
    }

    // Test get_recent_events
    let recent = db
        .get_recent_events("device1", 5)
        .await
        .expect("Query failed");
    assert_eq!(recent.len(), 5);

    // Test get_events_in_range
    let range = db
        .get_events_in_range("device1", 2000, 6000)
        .await
        .expect("Query failed");
    assert_eq!(range.len(), 4); // Events starting at 2000, 3000, 4000, 5000

    // Test get_last_event
    let last = db.get_last_event("device1").await.expect("Query failed");
    assert!(last.is_some());
    assert_eq!(last.unwrap().ts_end, 10000);
}

#[tokio::test]
async fn test_app_summary() {
    let (db, _temp) = create_test_db().await;

    // Insert events with different apps
    let apps = [
        ("com.vscode", "VS Code", 5),
        ("com.slack", "Slack", 3),
        ("com.chrome", "Chrome", 2),
    ];

    let mut ts = 0i64;
    for (bundle, name, count) in apps {
        for _ in 0..count {
            let mut event = ActivityEvent::new("device1", "user1", ts, ts + 1000, bundle, name);
            event.is_afk = false;
            db.insert_activity_event(&event)
                .await
                .expect("Insert failed");
            ts += 1000;
        }
    }

    // Get summary
    let summary = db
        .get_app_summary("device1", 0, ts)
        .await
        .expect("Query failed");

    assert_eq!(summary.len(), 3);

    // Should be sorted by total time
    assert_eq!(summary[0].bundle_id, "com.vscode");
    assert_eq!(summary[0].event_count, 5);
    assert_eq!(summary[0].total_ms, 5000);
}

// ============================================================================
// RECORDER TESTS (OCR Frames, Video Chunks)
// ============================================================================

#[tokio::test]
async fn test_video_chunk_crud() {
    let (db, _temp) = create_test_db().await;

    // Create
    let chunk = VideoChunk::new("/path/to/video.mp4", 1000, 0);
    let id = db.insert_video_chunk(&chunk).await.expect("Insert failed");
    assert!(id > 0);

    // Read
    let retrieved = db.get_video_chunk(id).await.expect("Get failed");
    assert!(retrieved.is_some());
    let retrieved = retrieved.unwrap();
    assert_eq!(retrieved.file_path, "/path/to/video.mp4");

    // Update
    db.update_video_chunk(id, 5000, 100, Some(1024 * 1024))
        .await
        .expect("Update failed");

    let updated = db.get_video_chunk(id).await.expect("Get failed").unwrap();
    assert_eq!(updated.end_time, Some(5000));
    assert_eq!(updated.frame_count, 100);
    assert_eq!(updated.file_size_bytes, Some(1024 * 1024));
}

#[tokio::test]
async fn test_ocr_frame_crud() {
    let (db, _temp) = create_test_db().await;

    // Create
    let frame = OcrFrame::new(
        1000,
        "com.apple.finder",
        "Finder",
        "Some OCR text content that was extracted from the screen",
        "hash123",
    );
    let id = db.insert_ocr_frame(&frame).await.expect("Insert failed");
    assert!(id > 0);

    // Read
    let retrieved = db.get_ocr_frame(id).await.expect("Get failed");
    assert!(retrieved.is_some());
    let retrieved = retrieved.unwrap();
    assert_eq!(retrieved.app_bundle_id, "com.apple.finder");
    assert!(retrieved.ocr_text.contains("OCR text content"));
}

#[tokio::test]
async fn test_frames_in_range() {
    let (db, _temp) = create_test_db().await;

    // Insert frames
    for i in 0..10 {
        let frame = OcrFrame::new(
            i * 1000,
            "com.test",
            "Test",
            &format!("Frame content {}", i),
            &format!("hash{}", i),
        );
        db.insert_ocr_frame(&frame).await.expect("Insert failed");
    }

    // Query range
    let frames = db
        .get_frames_in_range(2000, 5000)
        .await
        .expect("Query failed");
    assert_eq!(frames.len(), 4); // 2000, 3000, 4000, 5000
}

#[tokio::test]
async fn test_fts_search() {
    let (db, _temp) = create_test_db().await;

    // Insert frames with searchable content
    let contents = [
        "Working on Rust code for the database layer",
        "Reading documentation about SQLite",
        "Writing tests for the new feature",
        "Debugging an issue with the API",
        "Reviewing pull request comments",
    ];

    for (i, content) in contents.iter().enumerate() {
        let frame = OcrFrame::new(
            i as i64 * 1000,
            "com.vscode",
            "VS Code",
            *content,
            &format!("hash{}", i),
        );
        db.insert_ocr_frame(&frame).await.expect("Insert failed");
    }

    // Search for specific terms
    let results = db.search_ocr_text("Rust", 10).await.expect("Search failed");
    assert!(!results.is_empty());
    assert!(results[0].ocr_text.contains("Rust"));

    let results = db
        .search_ocr_text("database", 10)
        .await
        .expect("Search failed");
    assert!(!results.is_empty());
}

#[tokio::test]
async fn test_last_frame_hash() {
    let (db, _temp) = create_test_db().await;

    // No frames initially
    let hash = db.get_last_frame_hash().await.expect("Query failed");
    assert!(hash.is_none());

    // Insert frame
    let frame = OcrFrame::new(1000, "com.test", "Test", "text", "unique_hash_xyz");
    db.insert_ocr_frame(&frame).await.expect("Insert failed");

    // Should return hash
    let hash = db.get_last_frame_hash().await.expect("Query failed");
    assert_eq!(hash, Some("unique_hash_xyz".to_string()));
}

#[tokio::test]
async fn test_recorder_stats() {
    let (db, _temp) = create_test_db().await;

    // Initial stats
    let stats = db.get_recorder_stats().await.expect("Query failed");
    assert_eq!(stats.total_frames, 0);
    assert_eq!(stats.total_video_chunks, 0);

    // Insert data
    let frame = OcrFrame::new(1000, "com.test", "Test", "text", "hash");
    db.insert_ocr_frame(&frame).await.expect("Insert failed");

    let chunk = VideoChunk::new("/path/video.mp4", 1000, 0);
    db.insert_video_chunk(&chunk).await.expect("Insert failed");

    // Stats should be updated
    let stats = db.get_recorder_stats().await.expect("Query failed");
    assert_eq!(stats.total_frames, 1);
    assert_eq!(stats.total_video_chunks, 1);
}

// ============================================================================
// SYNC QUEUE TESTS
// ============================================================================

#[tokio::test]
async fn test_sync_queue_basic() {
    let (db, _temp) = create_test_db().await;

    // Initially empty
    let count = db.pending_sync_count().await.expect("Query failed");
    assert_eq!(count, 0);

    let first_id = insert_test_activity_event(&db, 1000, 1500).await;
    let second_id = insert_test_activity_event(&db, 2000, 2500).await;

    let count = db.pending_sync_count().await.expect("Query failed");
    assert_eq!(count, 2);

    // Get pending
    let pending = db.get_pending_sync(10).await.expect("Query failed");
    assert_eq!(pending.len(), 2);
    assert_eq!(db.pending_sync_count().await.expect("Query failed"), 0);

    db.queue_activity_sync(first_id).await.expect("Queue failed");
    db.queue_activity_sync(second_id).await.expect("Queue failed");
    assert_eq!(db.pending_sync_count().await.expect("Query failed"), 2);

    // Mark as synced
    db.mark_synced(pending[0].id).await.expect("Mark failed");
    assert_eq!(db.pending_sync_count().await.expect("Query failed"), 1);
}

#[tokio::test]
async fn test_sync_queue_deduplication() {
    let (db, _temp) = create_test_db().await;

    let event_id = insert_test_activity_event(&db, 1000, 1500).await;
    assert_eq!(db.pending_sync_count().await.expect("Query failed"), 1);

    // Queue same event multiple times
    db.queue_activity_sync(event_id).await.expect("Queue failed");
    db.queue_activity_sync(event_id).await.expect("Queue failed");
    db.queue_activity_sync(event_id).await.expect("Queue failed");

    // Should only have one entry
    let count = db.pending_sync_count().await.expect("Query failed");
    assert_eq!(count, 1);
}

#[tokio::test]
async fn test_sync_queue_update_coalescing() {
    let (db, _temp) = create_test_db().await;

    let event_id = insert_test_activity_event(&db, 1000, 1500).await;

    db.update_event_end_time(event_id, 2000)
        .await
        .expect("Update failed");
    db.queue_activity_update(event_id, 2000)
        .await
        .expect("Queue failed");
    db.update_event_end_time(event_id, 3000)
        .await
        .expect("Update failed");
    db.queue_activity_update(event_id, 3000)
        .await
        .expect("Queue failed");

    // Should only have one entry with latest ts_end
    let count = db.pending_sync_count().await.expect("Query failed");
    assert_eq!(count, 1);

    let pending = db.get_pending_sync(10).await.expect("Query failed");
    assert_eq!(pending[0].ts_end, Some(3000));
}

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

#[tokio::test]
async fn test_activity_with_frames() {
    let (db, _temp) = create_test_db().await;

    // Create activity event
    let event = ActivityEvent::new("device1", "user1", 0, 5000, "com.vscode", "VS Code");
    let event_id = db
        .insert_activity_event(&event)
        .await
        .expect("Insert failed");

    // Create frames associated with the activity
    for i in 0..5 {
        let mut frame = OcrFrame::new(
            i * 1000,
            "com.vscode",
            "VS Code",
            &format!("Code content at time {}", i),
            &format!("hash{}", i),
        );
        frame.activity_event_id = Some(event_id);
        db.insert_ocr_frame(&frame).await.expect("Insert failed");
    }

    // Verify
    let stats = db.get_stats().await.expect("Query failed");
    assert_eq!(stats.activity_event_count, 1);
    assert_eq!(stats.ocr_frame_count, 5);
}

#[tokio::test]
async fn test_heartbeat_pattern() {
    let (db, _temp) = create_test_db().await;

    let device_id = "device1";

    // First heartbeat creates event
    let event = ActivityEvent::new(device_id, "user1", 0, 1000, "com.app", "App");
    let event_id = db
        .insert_activity_event(&event)
        .await
        .expect("Insert failed");

    // Subsequent heartbeats extend the event
    for ts in (2000..=5000).step_by(1000) {
        db.update_event_end_time(event_id, ts)
            .await
            .expect("Update failed");
    }

    // Verify final state
    let last = db
        .get_last_event(device_id)
        .await
        .expect("Query failed")
        .unwrap();
    assert_eq!(last.ts_end, 5000);
    assert_eq!(last.id, event_id);
}

#[tokio::test]
async fn test_complete_workflow() {
    let (db, _temp) = create_test_db().await;

    // Simulate a complete recording session
    let device_id = "device1";
    let user_id = "user1";

    // 1. Start activity tracking
    let activity = ActivityEvent::new(device_id, user_id, 0, 1000, "com.vscode", "VS Code");
    let activity_id = db.insert_activity_event(&activity).await.unwrap();

    // 2. Queue for sync
    db.queue_activity_sync(activity_id).await.unwrap();

    // 3. Start video chunk
    let chunk = VideoChunk::new("/path/chunk_001.mp4", 0, 0);
    let chunk_id = db.insert_video_chunk(&chunk).await.unwrap();

    // 4. Record frames with OCR
    for i in 0..5 {
        let ts = i * 1000;

        // Update activity end time
        db.update_event_end_time(activity_id, ts + 1000)
            .await
            .unwrap();
        db.queue_activity_update(activity_id, ts + 1000)
            .await
            .unwrap();

        // Insert frame
        let mut frame = OcrFrame::new(
            ts,
            "com.vscode",
            "VS Code",
            &format!("def function_{}():\n    pass", i),
            &format!("hash{}", i),
        );
        frame.activity_event_id = Some(activity_id);
        frame.video_chunk_id = Some(chunk_id);
        frame.frame_offset = Some(i);
        db.insert_ocr_frame(&frame).await.unwrap();
    }

    // 5. Update video chunk
    db.update_video_chunk(chunk_id, 5000, 5, Some(1024 * 100))
        .await
        .unwrap();

    // 6. Update heartbeat
    db.update_heartbeat(device_id, 5000).await.unwrap();

    // Verify final state
    let stats = db.get_stats().await.unwrap();
    assert_eq!(stats.activity_event_count, 1);
    assert_eq!(stats.ocr_frame_count, 5);
    assert_eq!(stats.video_chunk_count, 1);
    assert!(stats.sync_queue_pending > 0);

    // Verify activity
    let retrieved = db.get_activity_event(activity_id).await.unwrap().unwrap();
    assert_eq!(retrieved.ts_end, 5000);

    // Verify recorder stats
    let recorder_stats = db.get_recorder_stats().await.unwrap();
    assert_eq!(recorder_stats.total_frames, 5);
    assert_eq!(recorder_stats.total_video_chunks, 1);

    // Verify FTS works
    let search_results = db.search_ocr_text("function", 10).await.unwrap();
    assert_eq!(search_results.len(), 5);
}
