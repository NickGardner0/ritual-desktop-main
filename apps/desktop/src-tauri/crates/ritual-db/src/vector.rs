//! Vector embedding operations for semantic search
//!
//! This module handles:
//! - Generating embeddings from OCR text using local models
//! - Storing embeddings in the database
//! - Semantic search using vector similarity
//! - Text cleaning and normalization for better embedding quality
//!
//! Uses fastembed for local embedding generation with the all-MiniLM-L6-v2 model.

use std::collections::{HashMap, HashSet};

use libsql::{Connection, Value};
use tracing::{debug, info, warn};
use unicode_normalization::UnicodeNormalization;

use crate::error::{DatabaseError, Result};
use crate::types::{OcrEmbedding, OcrFrame, SearchOptions, SearchResult};

/// Embedding dimension for all-MiniLM-L6-v2 model
pub const EMBEDDING_DIM: usize = 384;

/// Model version string for tracking
pub const MODEL_VERSION: &str = "all-MiniLM-L6-v2";

/// Service for generating text embeddings
pub struct EmbeddingService {
    model: fastembed::TextEmbedding,
}

impl EmbeddingService {
    /// Create a new embedding service
    /// 
    /// This will download the model on first use (~30MB)
    pub fn new() -> Result<Self> {
        info!("Initializing embedding model: {}", MODEL_VERSION);
        
        let model = fastembed::TextEmbedding::try_new(
            fastembed::InitOptions::new(fastembed::EmbeddingModel::AllMiniLML6V2)
                .with_show_download_progress(true)
        ).map_err(|e| DatabaseError::Embedding(e.to_string()))?;
        
        info!("Embedding model initialized successfully");
        
        Ok(Self { model })
    }
    
    /// Generate an embedding for a single text
    pub fn embed(&self, text: &str) -> Result<Vec<f32>> {
        if text.trim().is_empty() {
            return Err(DatabaseError::Embedding("Cannot embed empty text".to_string()));
        }
        
        let embeddings = self.model
            .embed(vec![text], None)
            .map_err(|e| DatabaseError::Embedding(e.to_string()))?;
        
        embeddings
            .into_iter()
            .next()
            .ok_or_else(|| DatabaseError::Embedding("No embedding returned".to_string()))
    }
    
    /// Generate embeddings for multiple texts (batched for efficiency)
    pub fn embed_batch(&self, texts: Vec<String>) -> Result<Vec<Vec<f32>>> {
        if texts.is_empty() {
            return Ok(Vec::new());
        }
        
        // Filter out empty texts and track their positions
        let (non_empty_texts, positions): (Vec<_>, Vec<_>) = texts
            .iter()
            .enumerate()
            .filter(|(_, t)| !t.trim().is_empty())
            .map(|(i, t)| (t.clone(), i))
            .unzip();
        
        if non_empty_texts.is_empty() {
            return Ok(vec![Vec::new(); texts.len()]);
        }
        
        let embeddings = self.model
            .embed(non_empty_texts, None)
            .map_err(|e| DatabaseError::Embedding(e.to_string()))?;
        
        // Reconstruct full result with empty vectors for empty texts
        let mut result = vec![Vec::new(); texts.len()];
        for (embedding, pos) in embeddings.into_iter().zip(positions) {
            result[pos] = embedding;
        }
        
        Ok(result)
    }
    
    /// Prepare text from an OCR frame for embedding
    /// 
    /// This function:
    /// 1. Uses pre-computed summary if available
    /// 2. Otherwise, cleans and normalizes text
    /// 3. Structures text with labeled sections for better embedding quality
    /// 4. Smart truncates at sentence boundaries
    pub fn prepare_frame_text(frame: &OcrFrame) -> String {
        let mut parts = Vec::new();
        
        // Include app name with label for context
        if !frame.app_name.is_empty() {
            parts.push(format!("App: {}", frame.app_name));
        }
        
        // Include window title with label (cleaned)
        if let Some(ref title) = frame.window_title {
            let cleaned = clean_text(title);
            if !cleaned.is_empty() {
                parts.push(format!("Window: {}", cleaned));
            }
        }
        
        // Include activity type if available (helps with semantic matching)
        if let Some(ref activity_type) = frame.activity_type {
            parts.push(format!("Activity: {}", activity_type));
        }
        
        // Include keywords if available
        if let Some(ref keywords_json) = frame.keywords {
            if let Ok(keywords) = serde_json::from_str::<Vec<String>>(keywords_json) {
                if !keywords.is_empty() {
                    parts.push(format!("Topics: {}", keywords.join(", ")));
                }
            }
        }
        
        // Use summary if available, otherwise clean the OCR text
        if let Some(ref summary) = frame.summary {
            if !summary.is_empty() {
                parts.push(format!("Content: {}", summary));
            }
        } else if !frame.ocr_text.is_empty() {
            let cleaned = clean_text(&frame.ocr_text);
            if !cleaned.is_empty() {
                parts.push(format!("Content: {}", cleaned));
            }
        }
        
        let text = parts.join("\n");
        
        // Smart truncate at sentence boundary if too long
        smart_truncate(&text, 8000)
    }
    
    /// Process a frame with text summarization and activity classification
    /// 
    /// This enriches the frame with:
    /// - Extractive summary
    /// - Activity type classification
    /// - Keywords
    /// - Text quality score
    /// 
    /// Returns the updated frame.
    pub fn process_frame_text(frame: &mut OcrFrame) {
        use crate::text_processing::{summarize_text, MAX_SUMMARY_LENGTH};
        use crate::activity_classifier::classify_activity;
        
        // Skip if already processed
        if frame.summary.is_some() {
            return;
        }
        
        // Summarize OCR text
        let summary_result = summarize_text(&frame.ocr_text, MAX_SUMMARY_LENGTH);
        
        // Set summary
        if !summary_result.summary.is_empty() {
            frame.summary = Some(summary_result.summary);
        }
        
        // Set keywords as JSON
        if !summary_result.keywords.is_empty() {
            frame.keywords = Some(serde_json::to_string(&summary_result.keywords).unwrap_or_default());
        }
        
        // Set text quality
        frame.text_quality = Some(summary_result.quality_score);
        
        // Classify activity
        let classification = classify_activity(
            &frame.app_bundle_id,
            &frame.app_name,
            frame.window_title.as_deref(),
            Some(&frame.ocr_text),
        );
        
        frame.activity_type = Some(classification.activity_type.as_str().to_string());
    }
}

/// Minimum confidence threshold for including text observations
pub const MIN_OBSERVATION_CONFIDENCE: f32 = 0.5;

/// Clean and normalize text for better embedding quality
/// 
/// This function:
/// - Applies Unicode NFKC normalization (normalizes characters like "ﬁ" → "fi")
/// - Removes control characters (except newlines and spaces)
/// - Collapses multiple whitespace to single space
/// - Trims leading/trailing whitespace
pub fn clean_text(text: &str) -> String {
    // Step 1: Unicode NFKC normalization
    // This normalizes characters like ligatures (ﬁ → fi), 
    // full-width chars (ａ → a), and compatibility chars
    let normalized: String = text.nfkc().collect();
    
    // Step 2: Remove control characters except newline and space
    // Also filter out zero-width characters and other problematic Unicode
    let filtered: String = normalized
        .chars()
        .filter(|c| {
            // Keep printable characters, spaces, and newlines
            !c.is_control() || *c == '\n' || *c == '\t'
        })
        .collect();
    
    // Step 3: Collapse multiple whitespace (including newlines) to single space
    // This removes excessive formatting from OCR output
    let collapsed: String = filtered
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    
    // Step 4: Trim any remaining leading/trailing whitespace
    collapsed.trim().to_string()
}

/// Smart truncate text at sentence or word boundary
/// 
/// Instead of cutting at arbitrary byte positions, this finds
/// a natural break point (sentence end, then word boundary)
pub fn smart_truncate(text: &str, max_len: usize) -> String {
    if text.len() <= max_len {
        return text.to_string();
    }
    
    // Clamp to a valid UTF-8 boundary so we never panic on multi-byte chars.
    let truncate_at = text
        .char_indices()
        .take_while(|(idx, _)| *idx < max_len)
        .map(|(idx, ch)| idx + ch.len_utf8())
        .last()
        .unwrap_or(0);
    let truncated = &text[..truncate_at];
    
    // Try to find the last sentence boundary (. ! ?)
    // Look for sentence-ending punctuation followed by space or end
    if let Some(pos) = truncated.rfind(|c| c == '.' || c == '!' || c == '?') {
        // Make sure there's content after truncation point check
        let candidate = &truncated[..=pos];
        // Only use sentence boundary if it's at least 50% of max length
        // (avoid truncating to just "App: Safari." when there's much more content)
        if candidate.len() >= max_len / 2 {
            return candidate.to_string();
        }
    }
    
    // Fall back to word boundary
    if let Some(pos) = truncated.rfind(' ') {
        return truncated[..pos].to_string();
    }
    
    // Last resort: just truncate (shouldn't happen with normal text)
    truncated.to_string()
}

/// Vector operations for the database
pub struct VectorOps<'a> {
    conn: &'a Connection,
}

impl<'a> VectorOps<'a> {
    /// Create a new VectorOps with a connection reference
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }
    
    /// Insert an embedding for an OCR frame
    pub async fn insert_embedding(&self, frame_id: i64, embedding: &[f32]) -> Result<i64> {
        if embedding.len() != EMBEDDING_DIM {
            return Err(DatabaseError::Embedding(
                format!("Expected {} dimensions, got {}", EMBEDDING_DIM, embedding.len())
            ));
        }
        
        let now = chrono::Utc::now().timestamp_millis();
        
        // Convert embedding to blob format for libSQL
        let embedding_blob = embedding_to_blob(embedding);
        
        self.conn.execute(
            "INSERT OR REPLACE INTO ocr_embeddings (frame_id, embedding, model_version, created_at) VALUES (?, ?, ?, ?)",
            libsql::params![frame_id, embedding_blob, MODEL_VERSION, now]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        let mut rows = self.conn.query("SELECT last_insert_rowid()", ())
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        let id = rows.next()
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
            .map(|row| row.get::<i64>(0).unwrap_or(0))
            .unwrap_or(0);
        
        debug!("Inserted embedding for frame {}", frame_id);
        Ok(id)
    }
    
    /// Check if a frame has an embedding
    pub async fn has_embedding(&self, frame_id: i64) -> Result<bool> {
        let mut rows = self.conn.query(
            "SELECT 1 FROM ocr_embeddings WHERE frame_id = ?",
            libsql::params![frame_id]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        Ok(rows.next().await.map_err(|e| DatabaseError::Query(e.to_string()))?.is_some())
    }
    
    /// Get embedding for a frame
    pub async fn get_embedding(&self, frame_id: i64) -> Result<Option<OcrEmbedding>> {
        let mut rows = self.conn.query(
            "SELECT id, frame_id, embedding, model_version, created_at FROM ocr_embeddings WHERE frame_id = ?",
            libsql::params![frame_id]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        if let Some(row) = rows.next().await.map_err(|e| DatabaseError::Query(e.to_string()))? {
            let embedding_blob: Option<Vec<u8>> = row.get(2).ok();
            let Some(embedding_blob) = embedding_blob else {
                return Ok(None);
            };
            let embedding = blob_to_embedding(&embedding_blob)?;
            
            Ok(Some(OcrEmbedding {
                id: Some(row.get(0).map_err(|e| DatabaseError::Query(e.to_string()))?),
                frame_id: row.get(1).map_err(|e| DatabaseError::Query(e.to_string()))?,
                embedding,
                model_version: row.get(3).unwrap_or_else(|_| MODEL_VERSION.to_string()),
                created_at: row.get(4).unwrap_or(0),
            }))
        } else {
            Ok(None)
        }
    }

    /// Get current retry count for a frame's embedding record.
    pub async fn get_retry_count(&self, frame_id: i64) -> Result<i32> {
        let mut rows = self.conn.query(
            "SELECT COALESCE(retry_count, 0) FROM ocr_embeddings WHERE frame_id = ?",
            libsql::params![frame_id]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;

        let retry_count = rows.next()
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
            .map(|row| row.get::<i64>(0).unwrap_or(0) as i32)
            .unwrap_or(0);

        Ok(retry_count)
    }
    
    /// Delete embedding for a frame
    pub async fn delete_embedding(&self, frame_id: i64) -> Result<()> {
        self.conn.execute(
            "DELETE FROM ocr_embeddings WHERE frame_id = ?",
            libsql::params![frame_id]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        Ok(())
    }
    
    /// Get count of frames without embeddings
    pub async fn count_frames_without_embeddings(&self) -> Result<i64> {
        let mut rows = self.conn.query(
            r#"
            SELECT COUNT(*) FROM ocr_frames f
            LEFT JOIN ocr_embeddings e ON f.id = e.frame_id
            WHERE e.id IS NULL AND f.ocr_text IS NOT NULL AND f.ocr_text != ''
            "#,
            ()
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        let count = rows.next()
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
            .map(|row| row.get::<i64>(0).unwrap_or(0))
            .unwrap_or(0);
        
        Ok(count)
    }
    
    /// Get the age of the oldest frame without an embedding (in seconds)
    /// Returns None if there are no pending embeddings
    pub async fn oldest_pending_embedding_age_seconds(&self) -> Result<Option<i64>> {
        let now_ms = chrono::Utc::now().timestamp_millis();
        
        let mut rows = self.conn.query(
            r#"
            SELECT MIN(f.timestamp) as oldest_ts FROM ocr_frames f
            LEFT JOIN ocr_embeddings e ON f.id = e.frame_id
            WHERE e.id IS NULL AND f.ocr_text IS NOT NULL AND f.ocr_text != ''
            "#,
            ()
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        if let Some(row) = rows.next().await.map_err(|e| DatabaseError::Query(e.to_string()))? {
            let oldest_ts: Option<i64> = row.get(0).ok();
            if let Some(ts) = oldest_ts {
                let age_ms = now_ms - ts;
                return Ok(Some(age_ms / 1000)); // Convert to seconds
            }
        }
        
        Ok(None)
    }
    
    /// Get embedding backlog summary for monitoring
    pub async fn get_embedding_backlog(&self) -> Result<EmbeddingBacklog> {
        let pending_count = self.count_frames_without_embeddings().await?;
        let oldest_age_secs = self.oldest_pending_embedding_age_seconds().await?;
        
        Ok(EmbeddingBacklog {
            pending_count,
            oldest_age_seconds: oldest_age_secs,
        })
    }
    
    /// Semantic search using vector similarity
    /// 
    /// Note: libSQL's vector_distance_cos function returns distance (0 = identical),
    /// so we convert to relevance score (1 = identical) for the results.
    pub async fn semantic_search(
        &self,
        query_embedding: &[f32],
        options: &SearchOptions,
    ) -> Result<Vec<SearchResult>> {
        let search_start = std::time::Instant::now();
        
        if query_embedding.len() != EMBEDDING_DIM {
            return Err(DatabaseError::Embedding(
                format!("Expected {} dimensions, got {}", EMBEDDING_DIM, query_embedding.len())
            ));
        }
        
        let embedding_blob = embedding_to_blob(query_embedding);
        let built_query = build_search_query(options, embedding_blob)?;
        
        let query_start = std::time::Instant::now();
        let mut rows = self.conn
            .query(&built_query.sql, libsql::params_from_iter(built_query.params))
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;
        let query_time_ms = query_start.elapsed().as_millis() as u64;
        
        let mut results = Vec::new();
        
        while let Some(row) = rows.next().await.map_err(|e| DatabaseError::Query(e.to_string()))? {
            // Distance is now at index 18 (after the 4 new text processing columns)
            let distance: f64 = row.get(18).unwrap_or(1.0);
            let distance = distance as f32;
            let relevance_score = 1.0 - distance.min(1.0);
            
            let tier_str: String = row.get(12).unwrap_or_else(|_| "hot".to_string());
            
            results.push(SearchResult {
                frame: OcrFrame {
                    id: Some(row.get(0).map_err(|e| DatabaseError::Query(e.to_string()))?),
                    timestamp: row.get(1).map_err(|e| DatabaseError::Query(e.to_string()))?,
                    activity_event_id: row.get(2).ok(),
                    app_bundle_id: row.get(3).unwrap_or_default(),
                    app_name: row.get(4).unwrap_or_default(),
                    window_title: row.get(5).ok(),
                    ocr_text: row.get(6).unwrap_or_default(),
                    ocr_confidence: row.get(7).unwrap_or(0.0),
                    thumbnail_path: row.get(8).ok(),
                    video_chunk_id: row.get(9).ok(),
                    frame_offset: row.get(10).ok(),
                    image_hash: row.get(11).unwrap_or_default(),
                    storage_tier: crate::types::StorageTier::from_str(&tier_str),
                    created_at: row.get(13).ok(),
                    // New text processing fields
                    summary: row.get(14).ok(),
                    activity_type: row.get(15).ok(),
                    keywords: row.get(16).ok(),
                    text_quality: row.get(17).ok(),
                },
                distance,
                relevance_score,
            });
        }
        
        let total_time_ms = search_start.elapsed().as_millis() as u64;
        
        info!(
            search_type = "vector",
            vector_query_ms = query_time_ms,
            total_ms = total_time_ms,
            results_count = results.len(),
            limit = options.limit,
            "Semantic search complete"
        );
        
        Ok(results)
    }
    
    /// Get embedding statistics
    pub async fn get_embedding_stats(&self) -> Result<EmbeddingStats> {
        let mut rows = self.conn.query(
            r#"
            SELECT 
                COUNT(*) as total,
                COUNT(DISTINCT model_version) as model_versions,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
            FROM ocr_embeddings
            "#,
            ()
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        let (total, model_versions, failed) = if let Some(row) = rows.next().await.map_err(|e| DatabaseError::Query(e.to_string()))? {
            (row.get(0).unwrap_or(0), row.get(1).unwrap_or(0), row.get(2).unwrap_or(0))
        } else {
            (0, 0, 0)
        };
        
        let frames_without = self.count_frames_without_embeddings().await?;
        
        // Get worker state
        let mut worker_rows = self.conn.query(
            "SELECT is_running, last_run_at FROM embedding_worker_state WHERE id = 1",
            ()
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        let (worker_running, last_run) = if let Some(row) = worker_rows.next().await.map_err(|e| DatabaseError::Query(e.to_string()))? {
            let running: i64 = row.get(0).unwrap_or(0);
            let last: Option<i64> = row.get(1).ok();
            (running == 1, last)
        } else {
            (false, None)
        };
        
        Ok(EmbeddingStats {
            total_embeddings: total,
            frames_without_embeddings: frames_without,
            model_versions,
            embedding_dimension: EMBEDDING_DIM as i64,
            current_model: MODEL_VERSION.to_string(),
            failed_embeddings: failed,
            worker_running,
            last_worker_run: last_run,
        })
    }
    
    /// Insert a failed embedding record
    pub async fn insert_failed_embedding(&self, frame_id: i64, error: &str, retry_count: i32) -> Result<()> {
        let now = chrono::Utc::now().timestamp_millis();
        
        self.conn.execute(
            r#"
            INSERT OR REPLACE INTO ocr_embeddings 
            (frame_id, embedding, model_version, status, error_message, retry_count, created_at) 
            VALUES (?, NULL, ?, 'failed', ?, ?, ?)
            "#,
            libsql::params![frame_id, MODEL_VERSION, error, retry_count, now]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        Ok(())
    }
    
    /// Update worker state
    pub async fn update_worker_state(&self, is_running: bool, frames_processed: i64, frames_failed: i64) -> Result<()> {
        let now = chrono::Utc::now().timestamp_millis();
        
        self.conn.execute(
            r#"
            UPDATE embedding_worker_state 
            SET is_running = ?, last_run_at = ?, frames_processed = frames_processed + ?, 
                frames_failed = frames_failed + ?, updated_at = ?
            WHERE id = 1
            "#,
            libsql::params![if is_running { 1 } else { 0 }, now, frames_processed, frames_failed, now]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        Ok(())
    }
    
    /// Get frames that failed embedding but can be retried
    pub async fn get_retryable_failed_frames(&self, max_retries: i32, limit: usize) -> Result<Vec<i64>> {
        let mut rows = self.conn.query(
            r#"
            SELECT frame_id FROM ocr_embeddings 
            WHERE status = 'failed' AND retry_count < ?
            ORDER BY retry_count ASC, created_at ASC
            LIMIT ?
            "#,
            libsql::params![max_retries, limit as i64]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        let mut frame_ids = Vec::new();
        while let Some(row) = rows.next().await.map_err(|e| DatabaseError::Query(e.to_string()))? {
            let id: i64 = row.get(0).map_err(|e| DatabaseError::Query(e.to_string()))?;
            frame_ids.push(id);
        }
        
        Ok(frame_ids)
    }
}

/// Hybrid search result combining FTS and vector scores
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct HybridSearchResult {
    pub frame: OcrFrame,
    pub fts_matched: bool,
    pub vector_distance: f32,
    pub combined_score: f32,
}

impl<'a> VectorOps<'a> {
    /// Hybrid search combining FTS and vector similarity
    /// 
    /// Strategy:
    /// 1. Get FTS candidates (fast, precise keyword matching)
    /// 2. Re-rank with vector similarity scores
    /// 3. Return combined scored results
    pub async fn hybrid_search(
        &self,
        query: &str,
        query_embedding: &[f32],
        options: &SearchOptions,
        fts_weight: f32,  // e.g., 0.3
        vector_weight: f32, // e.g., 0.7
    ) -> Result<Vec<HybridSearchResult>> {
        use crate::recorder::RecorderOps;
        
        let search_start = std::time::Instant::now();
        
        if query_embedding.len() != EMBEDDING_DIM {
            return Err(DatabaseError::Embedding(
                format!("Expected {} dimensions, got {}", EMBEDDING_DIM, query_embedding.len())
            ));
        }
        
        // Step 1: Get FTS candidates (3x limit for re-ranking)
        let fts_start = std::time::Instant::now();
        let recorder_ops = RecorderOps::new(self.conn);
        let fts_limit = options.limit * 3;
        let fts_candidates = recorder_ops.search_ocr_text(query, fts_limit).await?;
        let fts_time_ms = fts_start.elapsed().as_millis() as u64;
        let fts_candidate_count = fts_candidates.len();

        let embedding_blob = embedding_to_blob(query_embedding);

        // Step 2: Pull vector candidates as well so non-keyword semantic hits are preserved.
        let vector_start = std::time::Instant::now();
        let mut vector_options = options.clone();
        vector_options.limit = options.limit.saturating_mul(3);
        // Apply threshold after combining with FTS boost.
        vector_options.min_relevance = None;
        let vector_candidates = self.semantic_search(query_embedding, &vector_options).await?;
        let vector_candidate_count = vector_candidates.len();

        let mut fts_frames_by_id: HashMap<i64, OcrFrame> = HashMap::new();
        let mut fts_ids = HashSet::new();
        for frame in fts_candidates {
            if let Some(id) = frame.id {
                fts_ids.insert(id);
                fts_frames_by_id.insert(id, frame);
            }
        }

        let mut results = Vec::new();
        let mut seen_ids = HashSet::new();

        for vector in vector_candidates {
            let Some(id) = vector.frame.id else { continue };
            seen_ids.insert(id);

            let fts_matched = fts_ids.contains(&id);
            let combined_score = (if fts_matched { fts_weight } else { 0.0 })
                + vector_weight * vector.relevance_score;

            if let Some(min) = options.min_relevance {
                if combined_score < min {
                    continue;
                }
            }

            results.push(HybridSearchResult {
                frame: vector.frame,
                fts_matched,
                vector_distance: vector.distance,
                combined_score,
            });
        }

        // Include FTS-only hits (typically rows without embeddings yet).
        for (frame_id, frame) in fts_frames_by_id {
            if seen_ids.contains(&frame_id) || !matches_search_filters(&frame, options) {
                continue;
            }

            let distance = self.get_frame_distance(frame_id, &embedding_blob).await?
                .unwrap_or(1.0);
            let vector_score = 1.0 - distance.min(1.0);
            let combined_score = fts_weight + vector_weight * vector_score;

            if let Some(min) = options.min_relevance {
                if combined_score < min {
                    continue;
                }
            }

            results.push(HybridSearchResult {
                frame,
                fts_matched: true,
                vector_distance: distance,
                combined_score,
            });
        }

        let vector_time_ms = vector_start.elapsed().as_millis() as u64;
        
        // Step 3: Sort by combined score (descending)
        results.sort_by(|a, b| b.combined_score.partial_cmp(&a.combined_score).unwrap());
        
        // Limit results
        results.truncate(options.limit);
        
        let total_time_ms = search_start.elapsed().as_millis() as u64;
        
        info!(
            search_type = "hybrid",
            fts_ms = fts_time_ms,
            vector_rerank_ms = vector_time_ms,
            total_ms = total_time_ms,
            fts_candidates = fts_candidate_count,
            vector_candidates = vector_candidate_count,
            results_count = results.len(),
            limit = options.limit,
            "Hybrid search complete"
        );
        
        Ok(results)
    }
    
    /// Get vector distance for a specific frame
    async fn get_frame_distance(&self, frame_id: i64, query_blob: &[u8]) -> Result<Option<f32>> {
        let mut rows = self.conn.query(
            "SELECT vector_distance_cos(embedding, ?) FROM ocr_embeddings WHERE frame_id = ?",
            libsql::params![query_blob.to_vec(), frame_id]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        if let Some(row) = rows.next().await.map_err(|e| DatabaseError::Query(e.to_string()))? {
            let distance: f64 = row.get(0).unwrap_or(1.0);
            Ok(Some(distance as f32))
        } else {
            Ok(None)
        }
    }
}

fn matches_search_filters(frame: &OcrFrame, options: &SearchOptions) -> bool {
    if let Some((start, end)) = options.time_range {
        if frame.timestamp < start || frame.timestamp > end {
            return false;
        }
    }

    if let Some(ref apps) = options.app_filter {
        if !apps.is_empty() && !apps.contains(&frame.app_bundle_id) {
            return false;
        }
    }

    if let Some(min_quality) = options.min_text_quality {
        if frame.text_quality.map(|q| q < min_quality).unwrap_or(false) {
            return false;
        }
    }

    if let Some(ref activity_types) = options.activity_type_filter {
        if !activity_types.is_empty() {
            if let Some(ref activity_type) = frame.activity_type {
                if !activity_types.contains(activity_type) {
                    return false;
                }
            }
        }
    }

    true
}

/// Build the search query based on options
struct BuiltSearchQuery {
    sql: String,
    params: Vec<Value>,
}

fn build_search_query(options: &SearchOptions, embedding_blob: Vec<u8>) -> Result<BuiltSearchQuery> {
    let mut base_conditions = Vec::new();
    let mut post_conditions = Vec::new();
    let mut params = vec![Value::from(embedding_blob)];

    if let Some((start, end)) = options.time_range {
        base_conditions.push("f.timestamp >= ?".to_string());
        params.push(Value::from(start));
        base_conditions.push("f.timestamp <= ?".to_string());
        params.push(Value::from(end));
    }

    if let Some(ref apps) = options.app_filter {
        if !apps.is_empty() {
            let apps_json = serde_json::to_string(apps)?;
            base_conditions.push("f.app_bundle_id IN (SELECT value FROM json_each(?))".to_string());
            params.push(Value::from(apps_json));
        }
    }

    if let Some(min) = options.min_relevance {
        post_conditions.push("(CASE WHEN distance > 1.0 THEN 0.0 ELSE 1.0 - distance END) >= ?".to_string());
        params.push(Value::from(min as f64));
    }

    if let Some(min_quality) = options.min_text_quality {
        // Keep legacy behavior: unknown quality rows are still allowed through.
        post_conditions.push("(text_quality IS NULL OR text_quality >= ?)".to_string());
        params.push(Value::from(min_quality));
    }

    if let Some(ref activity_types) = options.activity_type_filter {
        if !activity_types.is_empty() {
            let types_json = serde_json::to_string(activity_types)?;
            // Keep legacy behavior: unknown activity rows are still allowed through.
            post_conditions.push("(activity_type IS NULL OR activity_type IN (SELECT value FROM json_each(?)))".to_string());
            params.push(Value::from(types_json));
        }
    }

    let base_clause = if base_conditions.is_empty() {
        String::new()
    } else {
        format!("AND {}", base_conditions.join(" AND "))
    };
    let post_clause = if post_conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", post_conditions.join(" AND "))
    };

    params.push(Value::from(options.limit as i64));

    let sql = format!(
        r#"
        WITH scored AS (
            SELECT f.id, f.timestamp, f.activity_event_id, f.app_bundle_id, f.app_name,
                   f.window_title, f.ocr_text, f.ocr_confidence, f.thumbnail_path,
                   f.video_chunk_id, f.frame_offset, f.image_hash, f.storage_tier, f.created_at,
                   f.summary, f.activity_type, f.keywords, f.text_quality,
                   vector_distance_cos(e.embedding, ?) as distance
            FROM ocr_frames f
            JOIN ocr_embeddings e ON f.id = e.frame_id
            WHERE 1=1 {}
        )
        SELECT * FROM scored
        {}
        ORDER BY distance ASC
        LIMIT ?
        "#,
        base_clause, post_clause
    );

    Ok(BuiltSearchQuery { sql, params })
}

/// Convert embedding vector to blob format for libSQL storage
pub fn embedding_to_blob(embedding: &[f32]) -> Vec<u8> {
    let mut blob = Vec::with_capacity(embedding.len() * 4);
    for &val in embedding {
        blob.extend_from_slice(&val.to_le_bytes());
    }
    blob
}

/// Convert blob back to embedding vector
pub fn blob_to_embedding(blob: &[u8]) -> Result<Vec<f32>> {
    if blob.len() % 4 != 0 {
        return Err(DatabaseError::Embedding("Invalid blob size".to_string()));
    }
    
    let mut embedding = Vec::with_capacity(blob.len() / 4);
    for chunk in blob.chunks(4) {
        let bytes: [u8; 4] = chunk.try_into()
            .map_err(|_| DatabaseError::Embedding("Invalid chunk size".to_string()))?;
        embedding.push(f32::from_le_bytes(bytes));
    }
    
    Ok(embedding)
}

/// Embedding statistics
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct EmbeddingStats {
    pub total_embeddings: i64,
    pub frames_without_embeddings: i64,
    pub model_versions: i64,
    pub embedding_dimension: i64,
    pub current_model: String,
    pub failed_embeddings: i64,
    pub worker_running: bool,
    pub last_worker_run: Option<i64>,
}

/// Embedding backlog summary for monitoring
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct EmbeddingBacklog {
    /// Number of frames waiting for embeddings
    pub pending_count: i64,
    /// Age of oldest pending frame in seconds (None if no pending)
    pub oldest_age_seconds: Option<i64>,
}

/// Embedding status for tracking
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EmbeddingStatus {
    Ok,
    Pending,
    Failed,
}

impl EmbeddingStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            EmbeddingStatus::Ok => "ok",
            EmbeddingStatus::Pending => "pending",
            EmbeddingStatus::Failed => "failed",
        }
    }
    
    pub fn from_str(s: &str) -> Self {
        match s {
            "ok" => EmbeddingStatus::Ok,
            "pending" => EmbeddingStatus::Pending,
            "failed" => EmbeddingStatus::Failed,
            _ => EmbeddingStatus::Pending,
        }
    }
}

/// Background worker for generating embeddings
/// 
/// This can be spawned as a separate task to process frames without embeddings.
pub struct EmbeddingWorker {
    batch_size: usize,
    sleep_duration: std::time::Duration,
    max_retries: i32,
}

/// Result of processing a batch of embeddings
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct BatchProcessResult {
    pub processed: usize,
    pub failed: usize,
    pub skipped: usize,
}

impl EmbeddingWorker {
    /// Create a new embedding worker
    pub fn new(batch_size: usize, sleep_duration_secs: u64) -> Self {
        Self {
            batch_size,
            sleep_duration: std::time::Duration::from_secs(sleep_duration_secs),
            max_retries: 3,
        }
    }
    
    /// Create a worker with custom max retries
    pub fn with_max_retries(mut self, max_retries: i32) -> Self {
        self.max_retries = max_retries;
        self
    }
    
    /// Process a batch of frames and generate embeddings
    /// 
    /// Returns the result containing processed, failed, and skipped counts.
    pub async fn process_batch(
        &self,
        conn: &Connection,
        embedding_service: &EmbeddingService,
    ) -> Result<BatchProcessResult> {
        use crate::recorder::RecorderOps;
        
        let recorder_ops = RecorderOps::new(conn);
        let vector_ops = VectorOps::new(conn);
        
        // Mark worker as running
        let _ = vector_ops.update_worker_state(true, 0, 0).await;
        
        // Get frames without embeddings
        let frames = recorder_ops.get_frames_without_embeddings(self.batch_size).await?;
        
        if frames.is_empty() {
            // Mark worker as not running
            let _ = vector_ops.update_worker_state(false, 0, 0).await;
            return Ok(BatchProcessResult { processed: 0, failed: 0, skipped: 0 });
        }
        
        let batch_start = std::time::Instant::now();
        info!(batch_size = frames.len(), "Processing frames for embeddings");
        
        let mut processed = 0;
        let mut failed = 0;
        let mut skipped = 0;
        let mut total_embed_time_ms = 0u64;
        
        // Process frames one by one for better error isolation
        for frame in &frames {
            let Some(id) = frame.id else {
                skipped += 1;
                continue;
            };
            
            // Process frame text (summarize, classify, extract keywords)
            let mut processed_frame = frame.clone();
            EmbeddingService::process_frame_text(&mut processed_frame);
            
            let text = EmbeddingService::prepare_frame_text(&processed_frame);
            
            if text.trim().is_empty() {
                // Skip frames with no meaningful text
                skipped += 1;
                debug!("Skipping frame {} - no text content", id);
                continue;
            }
            
            // Skip very low quality frames
            if let Some(quality) = processed_frame.text_quality {
                if quality < 0.2 {
                    skipped += 1;
                    debug!("Skipping frame {} - text quality too low ({:.2})", id, quality);
                    continue;
                }
            }
            
            let embed_start = std::time::Instant::now();
            match embedding_service.embed(&text) {
                Ok(embedding) => {
                    total_embed_time_ms += embed_start.elapsed().as_millis() as u64;
                    
                    // Update the frame with processed text data
                    if processed_frame.summary.is_some() || processed_frame.activity_type.is_some() {
                        let _ = recorder_ops.update_frame_text_data(
                            id,
                            processed_frame.summary.as_deref(),
                            processed_frame.activity_type.as_deref(),
                            processed_frame.keywords.as_deref(),
                            processed_frame.text_quality,
                        ).await;
                    }
                    
                    if let Err(e) = vector_ops.insert_embedding(id, &embedding).await {
                        warn!(frame_id = id, error = %e, "Failed to insert embedding");
                        let _ = vector_ops.insert_failed_embedding(id, &e.to_string(), 1).await;
                        failed += 1;
                    } else {
                        processed += 1;
                    }
                }
                Err(e) => {
                    total_embed_time_ms += embed_start.elapsed().as_millis() as u64;
                    warn!(frame_id = id, error = %e, "Failed to generate embedding");
                    let _ = vector_ops.insert_failed_embedding(id, &e.to_string(), 1).await;
                    failed += 1;
                }
            }
        }
        
        // Update worker state
        let _ = vector_ops.update_worker_state(false, processed as i64, failed as i64).await;
        
        let batch_elapsed_ms = batch_start.elapsed().as_millis() as u64;
        let avg_embed_ms = if processed + failed > 0 {
            total_embed_time_ms / (processed + failed) as u64
        } else {
            0
        };
        
        // Get backlog info for monitoring
        let backlog = vector_ops.get_embedding_backlog().await.ok();
        let pending_count = backlog.as_ref().map(|b| b.pending_count).unwrap_or(0);
        let oldest_age_secs = backlog.as_ref().and_then(|b| b.oldest_age_seconds).unwrap_or(0);
        
        info!(
            embed_processed = processed,
            embed_failed = failed,
            embed_skipped = skipped,
            batch_time_ms = batch_elapsed_ms,
            avg_embed_ms = avg_embed_ms,
            pending_embeddings = pending_count,
            oldest_pending_age_secs = oldest_age_secs,
            "Embedding batch complete"
        );
        Ok(BatchProcessResult { processed, failed, skipped })
    }
    
    /// Process failed frames that can be retried
    pub async fn retry_failed(
        &self,
        conn: &Connection,
        embedding_service: &EmbeddingService,
    ) -> Result<BatchProcessResult> {
        use crate::recorder::RecorderOps;
        
        let recorder_ops = RecorderOps::new(conn);
        let vector_ops = VectorOps::new(conn);
        
        // Get retryable failed frames
        let frame_ids = vector_ops.get_retryable_failed_frames(self.max_retries, self.batch_size).await?;
        
        if frame_ids.is_empty() {
            return Ok(BatchProcessResult { processed: 0, failed: 0, skipped: 0 });
        }
        
        info!("Retrying {} failed frames", frame_ids.len());
        
        let mut processed = 0;
        let mut failed = 0;
        let mut skipped = 0;
        
        for frame_id in frame_ids {
            // Get the frame
            let frame = match recorder_ops.get_ocr_frame(frame_id).await? {
                Some(f) => f,
                None => {
                    skipped += 1;
                    continue;
                }
            };
            
            let text = EmbeddingService::prepare_frame_text(&frame);
            
            if text.trim().is_empty() {
                skipped += 1;
                continue;
            }
            
            let current_retry = vector_ops.get_retry_count(frame_id).await?;
            
            match embedding_service.embed(&text) {
                Ok(embedding) => {
                    // Delete failed record first
                    let _ = vector_ops.delete_embedding(frame_id).await;
                    
                    if let Err(e) = vector_ops.insert_embedding(frame_id, &embedding).await {
                        warn!("Retry failed for frame {}: {}", frame_id, e);
                        let _ = vector_ops.insert_failed_embedding(frame_id, &e.to_string(), current_retry + 1).await;
                        failed += 1;
                    } else {
                        processed += 1;
                    }
                }
                Err(e) => {
                    warn!("Retry embedding failed for frame {}: {}", frame_id, e);
                    let _ = vector_ops.insert_failed_embedding(frame_id, &e.to_string(), current_retry + 1).await;
                    failed += 1;
                }
            }
        }
        
        info!("Retry batch complete: {} processed, {} failed, {} skipped", processed, failed, skipped);
        Ok(BatchProcessResult { processed, failed, skipped })
    }
    
    /// Get the sleep duration between batches
    pub fn sleep_duration(&self) -> std::time::Duration {
        self.sleep_duration
    }
    
    /// Get the batch size
    pub fn batch_size(&self) -> usize {
        self.batch_size
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_embedding_to_blob_roundtrip() {
        let embedding = vec![0.1f32, 0.2, 0.3, -0.5, 1.0];
        let blob = embedding_to_blob(&embedding);
        let recovered = blob_to_embedding(&blob).unwrap();
        
        assert_eq!(embedding.len(), recovered.len());
        for (a, b) in embedding.iter().zip(recovered.iter()) {
            assert!((a - b).abs() < 1e-6);
        }
    }
    
    #[test]
    fn test_prepare_frame_text() {
        let mut frame = OcrFrame::new(
            1000,
            "com.apple.finder",
            "Finder",
            "Some OCR text from the screen",
            "hash123",
        );
        frame.window_title = Some("Documents".to_string());
        
        let text = EmbeddingService::prepare_frame_text(&frame);
        
        // Should have structured format with labels
        assert!(text.contains("App: Finder"));
        assert!(text.contains("Window: Documents"));
        assert!(text.contains("Content: Some OCR text"));
    }
    
    #[test]
    fn test_prepare_frame_text_truncates() {
        let frame = OcrFrame::new(
            1000,
            "com.test",
            "Test",
            &"x".repeat(10000),  // Very long text
            "hash",
        );
        
        let text = EmbeddingService::prepare_frame_text(&frame);
        
        assert!(text.len() <= 8000);
    }
    
    #[test]
    fn test_clean_text_normalizes_whitespace() {
        let input = "Hello    world\n\n\ntest   text";
        let cleaned = super::clean_text(input);
        assert_eq!(cleaned, "Hello world test text");
    }
    
    #[test]
    fn test_clean_text_removes_control_chars() {
        let input = "Hello\x00world\x01test";
        let cleaned = super::clean_text(input);
        assert_eq!(cleaned, "Helloworldtest");
    }
    
    #[test]
    fn test_clean_text_unicode_normalization() {
        // Test that ligatures get normalized (ﬁ → fi)
        let input = "ﬁle oﬃce";
        let cleaned = super::clean_text(input);
        assert_eq!(cleaned, "file office");
    }
    
    #[test]
    fn test_smart_truncate_at_sentence() {
        let input = "First sentence. Second sentence. Third sentence here.";
        let truncated = super::smart_truncate(input, 35);
        // Should truncate at a sentence boundary
        assert!(truncated.ends_with('.'));
        assert!(truncated.len() <= 35);
    }
    
    #[test]
    fn test_smart_truncate_at_word() {
        let input = "Hello world this is a test without periods";
        let truncated = super::smart_truncate(input, 20);
        // Should truncate at a word boundary
        assert!(!truncated.ends_with(' '));
        assert!(truncated.len() <= 20);
    }
    
    #[test]
    fn test_smart_truncate_no_change() {
        let input = "Short text";
        let truncated = super::smart_truncate(input, 100);
        assert_eq!(truncated, input);
    }

    #[test]
    fn test_smart_truncate_handles_unicode_boundaries() {
        let input = "hello 🧠 world";
        // 7 bytes lands in the middle of the emoji and used to panic.
        let truncated = super::smart_truncate(input, 7);
        assert_eq!(truncated, "hello");
    }

    #[test]
    fn test_build_search_query_uses_bound_params_for_filters() {
        let options = SearchOptions::new(10)
            .with_time_range(1_000, 2_000)
            .with_apps(vec!["com.test.app') OR 1=1 --".to_string()]);
        let built = super::build_search_query(&options, vec![0u8; EMBEDDING_DIM * 4]).unwrap();

        // Embedding + start + end + apps_json + limit
        assert_eq!(built.params.len(), 5);
        assert!(built.sql.contains("json_each(?)"));
        assert!(!built.sql.contains("OR 1=1"));
    }
    
    // Note: Testing actual embedding generation requires the model to be downloaded,
    // which is slow. These tests are for the basic functionality.
    
    #[tokio::test]
    async fn test_vector_ops_without_embeddings() {
        use libsql::Builder;
        use tempfile::TempDir;
        
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        
        let db = Builder::new_local(db_path.to_str().unwrap())
            .build()
            .await
            .unwrap();
        
        let conn = db.connect().unwrap();
        crate::schema::initialize_schema(&conn).await.unwrap();
        
        let ops = VectorOps::new(&conn);
        
        // No embeddings initially
        let stats = ops.get_embedding_stats().await.unwrap();
        assert_eq!(stats.total_embeddings, 0);
        assert_eq!(stats.current_model, MODEL_VERSION);
    }

    #[tokio::test]
    async fn test_get_embedding_handles_failed_row_without_blob() {
        use libsql::Builder;
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let db = Builder::new_local(db_path.to_str().unwrap()).build().await.unwrap();
        let conn = db.connect().unwrap();
        crate::schema::initialize_schema(&conn).await.unwrap();

        let recorder_ops = crate::recorder::RecorderOps::new(&conn);
        let vector_ops = VectorOps::new(&conn);

        let frame = OcrFrame::new(1_000, "com.test.app", "Test App", "text", "hash-embed-failed");
        let frame_id = recorder_ops.insert_ocr_frame(&frame).await.unwrap();
        vector_ops.insert_failed_embedding(frame_id, "mock error", 2).await.unwrap();

        // Failed records have no embedding blob and should not cause query errors.
        let embedding = vector_ops.get_embedding(frame_id).await.unwrap();
        assert!(embedding.is_none());
        assert_eq!(vector_ops.get_retry_count(frame_id).await.unwrap(), 2);
    }

    #[tokio::test]
    #[ignore = "requires libSQL vector_distance_cos support in test runtime"]
    async fn test_semantic_search_respects_bound_app_filter() {
        use libsql::Builder;
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let db = Builder::new_local(db_path.to_str().unwrap()).build().await.unwrap();
        let conn = db.connect().unwrap();
        crate::schema::initialize_schema(&conn).await.unwrap();

        let recorder_ops = crate::recorder::RecorderOps::new(&conn);
        let vector_ops = VectorOps::new(&conn);

        let frame_a = OcrFrame::new(1_000, "com.test.a", "App A", "alpha task", "hash-a");
        let frame_b = OcrFrame::new(2_000, "com.test.b", "App B", "beta task", "hash-b");
        let frame_a_id = recorder_ops.insert_ocr_frame(&frame_a).await.unwrap();
        let frame_b_id = recorder_ops.insert_ocr_frame(&frame_b).await.unwrap();

        let mut emb_a = vec![0.0f32; EMBEDDING_DIM];
        let mut emb_b = vec![0.0f32; EMBEDDING_DIM];
        emb_a[0] = 1.0;
        emb_b[1] = 1.0;
        vector_ops.insert_embedding(frame_a_id, &emb_a).await.unwrap();
        vector_ops.insert_embedding(frame_b_id, &emb_b).await.unwrap();

        let options = SearchOptions::new(10).with_apps(vec!["com.test.a".to_string()]);
        let results = vector_ops.semantic_search(&emb_a, &options).await.unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].frame.id, Some(frame_a_id));
    }

    #[tokio::test]
    #[ignore = "requires libSQL vector_distance_cos support in test runtime"]
    async fn test_hybrid_search_includes_vector_only_candidates() {
        use libsql::Builder;
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let db = Builder::new_local(db_path.to_str().unwrap()).build().await.unwrap();
        let conn = db.connect().unwrap();
        crate::schema::initialize_schema(&conn).await.unwrap();

        let recorder_ops = crate::recorder::RecorderOps::new(&conn);
        let vector_ops = VectorOps::new(&conn);

        let frame_vector = OcrFrame::new(1_000, "com.test.vector", "Vector App", "deep work", "hash-v");
        let frame_fts = OcrFrame::new(2_000, "com.test.fts", "FTS App", "keyword hit", "hash-f");
        let frame_vector_id = recorder_ops.insert_ocr_frame(&frame_vector).await.unwrap();
        let _frame_fts_id = recorder_ops.insert_ocr_frame(&frame_fts).await.unwrap();

        let mut emb_vector = vec![0.0f32; EMBEDDING_DIM];
        let mut emb_fts = vec![0.0f32; EMBEDDING_DIM];
        emb_vector[0] = 1.0;
        emb_fts[1] = 1.0;
        vector_ops.insert_embedding(frame_vector_id, &emb_vector).await.unwrap();
        vector_ops.insert_embedding(_frame_fts_id, &emb_fts).await.unwrap();

        let results = vector_ops
            .hybrid_search("keyword", &emb_vector, &SearchOptions::new(10), 0.3, 0.7)
            .await
            .unwrap();

        assert!(results.iter().any(|r| r.frame.id == Some(frame_vector_id) && !r.fts_matched));
    }
    
    #[test]
    fn test_prepare_empty_frame_text() {
        let frame = OcrFrame::new(
            1000,
            "com.test",
            "Test",
            "",
            "hash",
        );
        
        let text = EmbeddingService::prepare_frame_text(&frame);
        // Should have app name even if OCR is empty
        assert!(text.contains("App: Test"));
    }
}
