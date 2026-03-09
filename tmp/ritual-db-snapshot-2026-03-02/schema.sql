CREATE TABLE schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at INTEGER NOT NULL,
            description TEXT
        );
CREATE TABLE activity_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            ts_start INTEGER NOT NULL,
            ts_end INTEGER NOT NULL,
            app_bundle_id TEXT NOT NULL,
            app_name TEXT NOT NULL,
            window_title TEXT,
            window_title_hash TEXT,
            window_owner_pid INTEGER,
            is_afk INTEGER NOT NULL DEFAULT 0,
            browser_url TEXT,
            browser_domain TEXT,
            is_incognito INTEGER NOT NULL DEFAULT 0,
            source TEXT NOT NULL DEFAULT 'ritual_watcher_v2',
            created_at INTEGER NOT NULL
        );
CREATE TABLE sqlite_sequence(name,seq);
CREATE TABLE afk_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            ts_start INTEGER NOT NULL,
            ts_end INTEGER NOT NULL,
            status TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
CREATE TABLE watcher_heartbeat (
            device_id TEXT PRIMARY KEY,
            last_seen_ts INTEGER NOT NULL
        );
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
CREATE TABLE ocr_frames (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp INTEGER NOT NULL,
            activity_event_id INTEGER,
            app_bundle_id TEXT,
            app_name TEXT,
            window_title TEXT,
            ocr_text TEXT,
            ocr_confidence REAL DEFAULT 0.0,
            thumbnail_path TEXT,
            video_chunk_id INTEGER,
            frame_offset INTEGER,
            image_hash TEXT,
            storage_tier TEXT DEFAULT 'hot',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP, summary TEXT, activity_type TEXT, keywords TEXT, text_quality REAL DEFAULT 0.0,
            FOREIGN KEY (video_chunk_id) REFERENCES video_chunks(id),
            FOREIGN KEY (activity_event_id) REFERENCES activity_events(id)
        );
CREATE TABLE recorder_stats (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            total_frames INTEGER DEFAULT 0,
            total_video_chunks INTEGER DEFAULT 0,
            total_storage_bytes INTEGER DEFAULT 0,
            last_capture_time INTEGER,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
CREATE TABLE sync_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entry_type TEXT NOT NULL,
            event_id INTEGER NOT NULL,
            ts_end INTEGER,
            status TEXT NOT NULL DEFAULT 'pending',
            retry_count INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
CREATE TABLE daily_rollup_cache (
            date TEXT NOT NULL,
            device_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            total_active_ms INTEGER NOT NULL DEFAULT 0,
            total_afk_ms INTEGER NOT NULL DEFAULT 0,
            app_summaries TEXT,
            domain_summaries TEXT,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (date, device_id)
        );
CREATE TABLE ocr_embeddings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            frame_id INTEGER NOT NULL UNIQUE,
            embedding F32_BLOB(384),
            model_version TEXT DEFAULT 'all-MiniLM-L6-v2',
            created_at INTEGER NOT NULL, status TEXT DEFAULT 'ok', error_message TEXT, retry_count INTEGER DEFAULT 0,
            FOREIGN KEY (frame_id) REFERENCES ocr_frames(id) ON DELETE CASCADE
        );
CREATE INDEX idx_activity_events_ts_start 
            ON activity_events(ts_start);
CREATE INDEX idx_activity_events_ts_end 
            ON activity_events(ts_end);
CREATE INDEX idx_activity_events_device_ts 
            ON activity_events(device_id, ts_start);
CREATE INDEX idx_activity_events_device_ts_end 
            ON activity_events(device_id, ts_end DESC);
CREATE INDEX idx_activity_events_user_device_ts 
            ON activity_events(user_id, device_id, ts_start);
CREATE INDEX idx_activity_events_user_device_ts_end 
            ON activity_events(user_id, device_id, ts_end);
CREATE INDEX idx_activity_events_app_ts 
            ON activity_events(user_id, device_id, app_bundle_id, ts_start);
CREATE INDEX idx_activity_events_domain 
            ON activity_events(browser_domain);
CREATE INDEX idx_activity_events_summary 
            ON activity_events(device_id, ts_start, ts_end, is_afk);
CREATE INDEX idx_afk_events_device_ts 
            ON afk_events(device_id, ts_start);
CREATE INDEX idx_afk_events_user_device_ts 
            ON afk_events(user_id, device_id, ts_start);
CREATE INDEX idx_ocr_frames_timestamp 
            ON ocr_frames(timestamp);
CREATE INDEX idx_ocr_frames_activity 
            ON ocr_frames(activity_event_id);
CREATE INDEX idx_ocr_frames_app 
            ON ocr_frames(app_bundle_id);
CREATE INDEX idx_ocr_frames_tier 
            ON ocr_frames(storage_tier);
CREATE INDEX idx_video_chunks_time 
            ON video_chunks(start_time);
CREATE INDEX idx_video_chunks_tier 
            ON video_chunks(storage_tier);
CREATE INDEX idx_sync_queue_status 
            ON sync_queue(status, created_at);
CREATE INDEX idx_sync_queue_event 
            ON sync_queue(event_id, entry_type);
CREATE INDEX idx_ocr_embeddings_frame 
            ON ocr_embeddings(frame_id);
CREATE VIRTUAL TABLE ocr_frames_fts USING fts5(
            ocr_text,
            app_name,
            window_title,
            content='ocr_frames',
            content_rowid='id'
        )
/* ocr_frames_fts(ocr_text,app_name,window_title) */;
CREATE TABLE IF NOT EXISTS 'ocr_frames_fts_data'(id INTEGER PRIMARY KEY, block BLOB);
CREATE TABLE IF NOT EXISTS 'ocr_frames_fts_idx'(segid, term, pgno, PRIMARY KEY(segid, term)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS 'ocr_frames_fts_docsize'(id INTEGER PRIMARY KEY, sz BLOB);
CREATE TABLE IF NOT EXISTS 'ocr_frames_fts_config'(k PRIMARY KEY, v) WITHOUT ROWID;
CREATE TRIGGER ocr_frames_ai AFTER INSERT ON ocr_frames BEGIN
            INSERT INTO ocr_frames_fts(rowid, ocr_text, app_name, window_title)
            VALUES (new.id, new.ocr_text, new.app_name, new.window_title);
        END;
CREATE TRIGGER ocr_frames_ad AFTER DELETE ON ocr_frames BEGIN
            INSERT INTO ocr_frames_fts(ocr_frames_fts, rowid, ocr_text, app_name, window_title)
            VALUES ('delete', old.id, old.ocr_text, old.app_name, old.window_title);
        END;
CREATE TRIGGER ocr_frames_au AFTER UPDATE ON ocr_frames BEGIN
            INSERT INTO ocr_frames_fts(ocr_frames_fts, rowid, ocr_text, app_name, window_title)
            VALUES ('delete', old.id, old.ocr_text, old.app_name, old.window_title);
            INSERT INTO ocr_frames_fts(rowid, ocr_text, app_name, window_title)
            VALUES (new.id, new.ocr_text, new.app_name, new.window_title);
        END;
CREATE TABLE activity_segments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            ts_start INTEGER NOT NULL,
            ts_end INTEGER NOT NULL,
            app_bundle_id TEXT,
            app_name TEXT,
            window_title_normalized TEXT,
            browser_domain TEXT,
            segment_kind TEXT DEFAULT 'work',
            duration_ms INTEGER NOT NULL,
            frame_count INTEGER DEFAULT 0,
            key_topics TEXT,
            segment_embedding F32_BLOB(384),
            created_at INTEGER NOT NULL
        );
CREATE TABLE segment_frames (
            segment_id INTEGER NOT NULL,
            frame_id INTEGER NOT NULL,
            PRIMARY KEY (segment_id, frame_id),
            FOREIGN KEY (segment_id) REFERENCES activity_segments(id) ON DELETE CASCADE,
            FOREIGN KEY (frame_id) REFERENCES ocr_frames(id) ON DELETE CASCADE
        );
CREATE TABLE embedding_worker_state (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            is_running INTEGER DEFAULT 0,
            last_run_at INTEGER,
            frames_processed INTEGER DEFAULT 0,
            frames_failed INTEGER DEFAULT 0,
            updated_at INTEGER NOT NULL
        );
CREATE INDEX idx_segments_device_ts 
            ON activity_segments(device_id, ts_start);
CREATE INDEX idx_segments_user_device_ts 
            ON activity_segments(user_id, device_id, ts_start);
CREATE INDEX idx_segments_kind 
            ON activity_segments(segment_kind);
CREATE INDEX idx_segments_app 
            ON activity_segments(app_bundle_id);
CREATE INDEX idx_segment_frames_segment 
            ON segment_frames(segment_id);
CREATE INDEX idx_segment_frames_frame 
            ON segment_frames(frame_id);
CREATE INDEX idx_ocr_frames_activity_type ON ocr_frames(activity_type);
CREATE INDEX idx_activity_events_domain_ts 
                ON activity_events(user_id, device_id, browser_domain, ts_start);
