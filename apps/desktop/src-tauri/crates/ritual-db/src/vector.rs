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
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};

use libsql::{Connection, Value};
use tracing::{debug, info, warn};
use unicode_normalization::UnicodeNormalization;

use crate::error::{DatabaseError, Result};
use crate::types::{OcrEmbedding, OcrFrame, SearchOptions, SearchResult};

/// Embedding dimension for all-MiniLM-L6-v2 model
pub const EMBEDDING_DIM: usize = 384;

/// Model version string for tracking
pub const MODEL_VERSION: &str = "all-MiniLM-L6-v2";
const CHUNK_MODEL_VERSION: &str = "all-MiniLM-L6-v2";
const CHUNK_BUILD_VERSION: i64 = 3;
const CHUNK_CONTEXT_VERSION: i64 = 3;
const CHUNK_BREAK_GAP_MS: i64 = 90_000;
const CHUNK_MAX_SPAN_MS: i64 = 120_000;
const CHUNK_TEXT_MAX_LEN: usize = 2500;
const CHUNK_NEIGHBOR_SUMMARY_MAX_LEN: usize = 1500;
const CHUNK_DEVICE_ID: &str = "local-device";
const CHUNK_USER_ID: &str = "local-user";
const SESSION_BREAK_GAP_MS: i64 = 10 * 60 * 1000;
const SESSION_BREAK_APP_CHANGE_GAP_MS: i64 = 2 * 60 * 1000;
const SESSION_BREAK_BROWSER_DOMAIN_GAP_MS: i64 = 90_000;
/// Full 7-day lookback used for periodic background reconciliation.
pub const CHUNK_REBUILD_LOOKBACK_MS: i64 = 7 * 24 * 60 * 60 * 1000;
const CHUNK_INCREMENTAL_LOOKBACK_MS: i64 = 30 * 60 * 1000;
const CHUNK_INCREMENTAL_MIN_INTERVAL_MS: i64 = 10_000;
const CHUNK_FULL_REBUILD_INTERVAL_MS: i64 = 5 * 60 * 1000;
const HISTORICAL_CHUNK_BACKFILL_INTERVAL_MS: i64 = 30_000;
const SQLITE_LOCK_RETRY_ATTEMPTS: u32 = 5;
const CHUNK_EMBED_BATCH_SIZE: usize = 64;
const CHUNK_EMBED_MAX_RETRIES: i64 = 5;
const CHUNK_REBUILD_DELETE_BATCH_SIZE: i64 = 250;
const HISTORICAL_CHUNK_BACKFILL_FRAME_BATCH: usize = 250;
const FRAME_EMBED_ACTIVE_WINDOW_MS: i64 = 24 * 60 * 60 * 1000;
static LAST_FULL_CHUNK_REBUILD_MS: AtomicI64 = AtomicI64::new(0);
static LAST_INCREMENTAL_CHUNK_REBUILD_MS: AtomicI64 = AtomicI64::new(0);
static LAST_HISTORICAL_CHUNK_BACKFILL_MS: AtomicI64 = AtomicI64::new(0);
static CHUNK_REBUILD_RUNNING: AtomicBool = AtomicBool::new(false);

fn should_run_full_chunk_rebuild(now_ms: i64) -> bool {
    let last = LAST_FULL_CHUNK_REBUILD_MS.load(Ordering::Relaxed);
    if last > 0 && now_ms.saturating_sub(last) < CHUNK_FULL_REBUILD_INTERVAL_MS {
        return false;
    }
    LAST_FULL_CHUNK_REBUILD_MS
        .compare_exchange(last, now_ms, Ordering::SeqCst, Ordering::Relaxed)
        .is_ok()
}

fn should_run_incremental_chunk_rebuild(now_ms: i64) -> bool {
    let last = LAST_INCREMENTAL_CHUNK_REBUILD_MS.load(Ordering::Relaxed);
    if last > 0 && now_ms.saturating_sub(last) < CHUNK_INCREMENTAL_MIN_INTERVAL_MS {
        return false;
    }
    LAST_INCREMENTAL_CHUNK_REBUILD_MS
        .compare_exchange(last, now_ms, Ordering::SeqCst, Ordering::Relaxed)
        .is_ok()
}

fn should_run_historical_chunk_backfill(now_ms: i64) -> bool {
    let last = LAST_HISTORICAL_CHUNK_BACKFILL_MS.load(Ordering::Relaxed);
    if last > 0 && now_ms.saturating_sub(last) < HISTORICAL_CHUNK_BACKFILL_INTERVAL_MS {
        return false;
    }
    LAST_HISTORICAL_CHUNK_BACKFILL_MS
        .compare_exchange(last, now_ms, Ordering::SeqCst, Ordering::Relaxed)
        .is_ok()
}

fn is_sqlite_lock_error(error_message: &str) -> bool {
    let normalized = error_message.to_ascii_lowercase();
    normalized.contains("database is locked")
        || normalized.contains("database busy")
        || normalized.contains("sql_busy")
}

fn is_foreign_key_error(error_message: &str) -> bool {
    let normalized = error_message.to_ascii_lowercase();
    normalized.contains("foreign key constraint failed")
        || normalized.contains("sql_constraint_foreignkey")
}

fn frame_has_searchable_context_sql(alias: &str) -> String {
    format!(
        "(
            COALESCE(NULLIF(TRIM({alias}.ocr_text), ''), '') != ''
            OR COALESCE(NULLIF(TRIM({alias}.app_name), ''), '') != ''
            OR COALESCE(NULLIF(TRIM({alias}.window_title), ''), '') != ''
        )"
    )
}

#[derive(Debug, Clone)]
struct FrameLite {
    id: i64,
    timestamp: i64,
    app_bundle_id: String,
    app_name: String,
    window_title: String,
    ocr_text: String,
    text_quality: f64,
    ocr_confidence: f64,
}

#[derive(Debug, Clone)]
struct PendingChunk {
    chunk_id: i64,
    contextual_text_compact: String,
    raw_text_compact: String,
    app_name: String,
    window_title: String,
    retry_count: i64,
}

impl PendingChunk {
    fn text_for_embedding(&self) -> String {
        if !self.contextual_text_compact.trim().is_empty() {
            return self.contextual_text_compact.clone();
        }
        if !self.raw_text_compact.trim().is_empty() {
            return self.raw_text_compact.clone();
        }
        format!("App: {}\nWindow: {}", self.app_name, self.window_title)
    }
}

#[derive(Debug, Clone)]
struct ChunkDraft {
    frames: Vec<FrameLite>,
    frame_count: i64,
    chunk_start_ts: i64,
    chunk_end_ts: i64,
    app_bundle_id: String,
    app_name: String,
    window_norm: String,
    browser_domain: String,
    raw_text_compact: String,
    quality_score: f64,
    workstream_label: String,
    primary_topic: String,
    session_key: String,
    session_position: i64,
    session_chunk_count: i64,
}

fn format_chunk_timestamp(ts: i64) -> String {
    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(ts)
        .map(|dt| dt.format("%Y-%m-%d %H:%M UTC").to_string())
        .unwrap_or_else(|| ts.to_string())
}

fn collect_unique_ocr_lines(frames: &[FrameLite]) -> Vec<String> {
    let mut seen_text = HashSet::new();
    let mut unique_ocr_lines: Vec<String> = Vec::new();
    for frame in frames {
        let cleaned = clean_text(&frame.ocr_text);
        if cleaned.is_empty() {
            continue;
        }
        if seen_text.insert(cleaned.clone()) {
            unique_ocr_lines.push(cleaned);
        }
    }
    unique_ocr_lines
}

fn build_raw_chunk_text(frames: &[FrameLite]) -> String {
    let raw_text = collect_unique_ocr_lines(frames).join("\n");
    if raw_text.len() > CHUNK_TEXT_MAX_LEN {
        return smart_truncate(&raw_text, CHUNK_TEXT_MAX_LEN);
    }
    raw_text
}

fn extract_domain_hint(values: &[&str]) -> String {
    for value in values {
        for token in value
            .split(|ch: char| !(ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-')))
            .filter(|token| token.contains('.') && token.chars().any(|ch| ch.is_ascii_alphabetic()))
        {
            let normalized = token
                .trim_matches('.')
                .trim()
                .to_ascii_lowercase();
            if normalized.len() >= 4 && !normalized.starts_with("www.") {
                return normalized;
            }
            if normalized.starts_with("www.") && normalized.len() > 4 {
                return normalized.trim_start_matches("www.").to_string();
            }
        }
    }
    String::new()
}

fn infer_primary_topic(window_norm: &str, browser_domain: &str, raw_text_compact: &str) -> String {
    if !browser_domain.trim().is_empty() {
        return browser_domain.trim().to_string();
    }

    if !window_norm.trim().is_empty() && window_norm != "unknown" {
        return smart_truncate(window_norm.trim(), 96);
    }

    if let Some(line) = raw_text_compact.lines().find(|line| !line.trim().is_empty()) {
        return smart_truncate(line.trim(), 96);
    }

    "unknown topic".to_string()
}

fn infer_workstream_label(app_name: &str, browser_domain: &str, window_norm: &str, raw_text_compact: &str) -> String {
    let app = if app_name.trim().is_empty() { "Unknown" } else { app_name.trim() };
    let haystack = format!(
        "{} {} {} {}",
        app.to_lowercase(),
        browser_domain.to_lowercase(),
        window_norm.to_lowercase(),
        raw_text_compact.to_lowercase()
    );

    if haystack.contains("cursor")
        || haystack.contains("vscode")
        || haystack.contains("github")
        || haystack.contains("pull request")
        || haystack.contains("rust")
        || haystack.contains("typescript")
    {
        return format!("software development session in {}", app);
    }
    if haystack.contains("things")
        || haystack.contains("todo")
        || haystack.contains("calendar")
        || haystack.contains("linear")
        || haystack.contains("notion")
    {
        return format!("task planning session in {}", app);
    }
    if haystack.contains("anthropic")
        || haystack.contains("documentation")
        || haystack.contains("guide")
        || haystack.contains("docs")
        || haystack.contains("reference")
        || haystack.contains("article")
    {
        return if browser_domain.trim().is_empty() {
            format!("research and documentation review in {}", app)
        } else {
            format!("research session on {}", browser_domain)
        };
    }
    if haystack.contains("figma")
        || haystack.contains("design")
        || haystack.contains("css")
        || haystack.contains("ui")
        || haystack.contains("ux")
    {
        return format!("design and interface work in {}", app);
    }
    if !browser_domain.trim().is_empty() {
        return format!("browser work session on {}", browser_domain.trim());
    }
    format!("{} work session", app)
}

fn summarize_neighboring_activity(drafts: &[ChunkDraft], index: usize) -> String {
    let session_key = drafts[index].session_key.clone();
    let mut parts: Vec<String> = Vec::new();
    let mut remaining_chars = CHUNK_NEIGHBOR_SUMMARY_MAX_LEN;

    let build_neighbor_label = |prefix: &str, draft: &ChunkDraft| {
        let snippet = smart_truncate(draft.raw_text_compact.trim(), 120);
        if snippet.is_empty() {
            format!("{prefix}: {} in {}", draft.workstream_label, draft.primary_topic)
        } else {
            format!(
                "{prefix}: {} in {} ({})",
                draft.workstream_label, draft.primary_topic, snippet
            )
        }
    };

    let mut push_neighbor = |label: String| {
        if label.is_empty() || remaining_chars == 0 {
            return;
        }
        let clipped = if label.len() > remaining_chars {
            smart_truncate(&label, remaining_chars)
        } else {
            label
        };
        remaining_chars = remaining_chars.saturating_sub(clipped.len());
        parts.push(clipped);
    };

    let start = index.saturating_sub(2);
    for draft in drafts[start..index].iter().filter(|draft| draft.session_key == session_key) {
        push_neighbor(build_neighbor_label("Before", draft));
    }
    for draft in drafts
        .iter()
        .skip(index + 1)
        .take(2)
        .filter(|draft| draft.session_key == session_key)
    {
        push_neighbor(build_neighbor_label("After", draft));
    }

    if parts.is_empty() {
        "No neighboring chunk context available.".to_string()
    } else {
        parts.join(" | ")
    }
}

fn build_contextual_chunk_text(drafts: &[ChunkDraft], index: usize) -> String {
    let draft = &drafts[index];
    let app_name = if draft.app_name.trim().is_empty() {
        "Unknown"
    } else {
        draft.app_name.trim()
    };
    let window_title = if draft.window_norm.is_empty() {
        "Unknown"
    } else {
        draft.window_norm.as_str()
    };
    let duration_seconds = ((draft.chunk_end_ts.saturating_sub(draft.chunk_start_ts)).max(0) / 1000).max(1);
    let neighboring_activity = summarize_neighboring_activity(drafts, index);
    let mut text_parts = vec![
        format!("Session: {}", draft.workstream_label),
        format!("Primary app: {}", app_name),
        format!("Primary window/topic: {}", if !draft.browser_domain.is_empty() { draft.browser_domain.as_str() } else { window_title }),
        format!(
            "Time: {} to {}",
            format_chunk_timestamp(draft.chunk_start_ts),
            format_chunk_timestamp(draft.chunk_end_ts)
        ),
        format!(
            "Session position: chunk {} of {}",
            draft.session_position + 1,
            draft.session_chunk_count
        ),
        format!(
            "Capture summary: {} frames over {} seconds.",
            draft.frame_count,
            duration_seconds
        ),
        format!("Neighboring activity: {}", neighboring_activity),
    ];

    if !draft.raw_text_compact.trim().is_empty() {
        text_parts.push("Observed content:".to_string());
        text_parts.push(draft.raw_text_compact.clone());
    }

    let mut contextual_text = text_parts.join("\n");
    if contextual_text.len() > CHUNK_TEXT_MAX_LEN {
        contextual_text = smart_truncate(&contextual_text, CHUNK_TEXT_MAX_LEN);
    }
    contextual_text
}

fn build_chunk_draft(frames: Vec<FrameLite>) -> Option<ChunkDraft> {
    if frames.is_empty() {
        return None;
    }

    let frame_count = frames.len() as i64;
    let first_timestamp = frames.first()?.timestamp;
    let last_timestamp = frames.last()?.timestamp;
    let first_app_bundle_id = frames.first()?.app_bundle_id.clone();
    let first_app_name = frames.first()?.app_name.clone();
    let first_window_title = frames.first()?.window_title.clone();
    let window_norm = normalize_window_title(&first_window_title);
    let raw_text_compact = build_raw_chunk_text(&frames);
    let browser_domain = extract_domain_hint(&[
        &window_norm,
        &first_window_title,
        raw_text_compact.lines().next().unwrap_or_default(),
    ]);
    let quality_sum: f64 = frames
        .iter()
        .map(|f| if f.text_quality > 0.0 { f.text_quality } else { f.ocr_confidence })
        .sum();
    let quality_avg = (quality_sum / (frames.len() as f64)).clamp(0.0, 1.0);
    let primary_topic = infer_primary_topic(&window_norm, &browser_domain, &raw_text_compact);
    let workstream_label = infer_workstream_label(
        &first_app_name,
        &browser_domain,
        &window_norm,
        &raw_text_compact,
    );

    Some(ChunkDraft {
        frames,
        frame_count,
        chunk_start_ts: first_timestamp,
        chunk_end_ts: last_timestamp,
        app_bundle_id: first_app_bundle_id,
        app_name: first_app_name,
        window_norm,
        browser_domain,
        raw_text_compact,
        quality_score: quality_avg,
        workstream_label,
        primary_topic,
        session_key: String::new(),
        session_position: 0,
        session_chunk_count: 1,
    })
}

fn stable_hash64(input: &str) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in input.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn assign_session_metadata(drafts: &mut [ChunkDraft]) {
    if drafts.is_empty() {
        return;
    }

    let mut session_start = 0usize;
    for index in 0..drafts.len() {
        let new_session = if index == 0 {
            true
        } else {
            let prev = &drafts[index - 1];
            let current = &drafts[index];
            let gap_ms = current.chunk_start_ts.saturating_sub(prev.chunk_end_ts);
            let app_changed = !prev.app_name.trim().is_empty()
                && !current.app_name.trim().is_empty()
                && normalize_window_title(&prev.app_name) != normalize_window_title(&current.app_name);
            let browser_changed = !prev.browser_domain.trim().is_empty()
                && !current.browser_domain.trim().is_empty()
                && prev.browser_domain != current.browser_domain;
            gap_ms > SESSION_BREAK_GAP_MS
                || (app_changed && gap_ms > SESSION_BREAK_APP_CHANGE_GAP_MS)
                || (browser_changed && gap_ms > SESSION_BREAK_BROWSER_DOMAIN_GAP_MS)
        };

        if new_session {
            session_start = index;
            let seed = format!(
                "ctxv{}|{}|{}|{}|{}",
                CHUNK_CONTEXT_VERSION,
                drafts[index].chunk_start_ts,
                drafts[index].chunk_end_ts,
                normalize_window_title(&drafts[index].app_name),
                normalize_window_title(&drafts[index].primary_topic),
            );
            drafts[index].session_key = format!("scx_{:016x}", stable_hash64(&seed));
        } else {
            drafts[index].session_key = drafts[session_start].session_key.clone();
        }
    }

    let mut session_counts: HashMap<String, i64> = HashMap::new();
    for draft in drafts.iter() {
        *session_counts.entry(draft.session_key.clone()).or_insert(0) += 1;
    }
    let mut session_positions: HashMap<String, i64> = HashMap::new();
    for draft in drafts.iter_mut() {
        let position = session_positions.entry(draft.session_key.clone()).or_insert(0);
        draft.session_position = *position;
        draft.session_chunk_count = *session_counts.get(&draft.session_key).unwrap_or(&1);
        *position += 1;
    }
}

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

fn compute_chunk_identity(
    first: &FrameLite,
    last: &FrameLite,
    window_norm: &str,
    text_compact: &str,
) -> (String, String) {
    let app_bundle = clean_text(&first.app_bundle_id).to_lowercase();
    let app_name = clean_text(&first.app_name).to_lowercase();
    let window = clean_text(window_norm).to_lowercase();
    let text = clean_text(text_compact).to_lowercase();
    let logical_seed = format!(
        "v1|{}|{}|{}|{}|{}|{}|{}",
        CHUNK_DEVICE_ID,
        CHUNK_USER_ID,
        first.timestamp,
        last.timestamp,
        app_bundle,
        app_name,
        window
    );
    let content_seed = format!("{}|{}", logical_seed, text);
    (
        format!("lch_{:016x}", stable_hash64(&logical_seed)),
        format!("ch_{:016x}", stable_hash64(&content_seed)),
    )
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
        let recent_cutoff = chrono::Utc::now()
            .timestamp_millis()
            .saturating_sub(FRAME_EMBED_ACTIVE_WINDOW_MS);
        let context_filter = frame_has_searchable_context_sql("f");
        let mut rows = self.conn.query(
            &format!(
                r#"
                SELECT COUNT(*) FROM ocr_frames f
                LEFT JOIN ocr_embeddings e ON f.id = e.frame_id
                WHERE e.id IS NULL
                  AND f.timestamp >= ?
                  AND {}
                "#,
                context_filter
            ),
            libsql::params![recent_cutoff]
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
        let recent_cutoff = now_ms.saturating_sub(FRAME_EMBED_ACTIVE_WINDOW_MS);
        let context_filter = frame_has_searchable_context_sql("f");
        
        let mut rows = self.conn.query(
            &format!(
                r#"
                SELECT MIN(f.timestamp) as oldest_ts FROM ocr_frames f
                LEFT JOIN ocr_embeddings e ON f.id = e.frame_id
                WHERE e.id IS NULL
                  AND f.timestamp >= ?
                  AND {}
                "#,
                context_filter
            ),
            libsql::params![recent_cutoff]
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

    async fn table_exists(&self, table_name: &str) -> Result<bool> {
        let mut rows = self.conn.query(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1",
            libsql::params![table_name],
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;

        Ok(rows.next().await.map_err(|e| DatabaseError::Query(e.to_string()))?.is_some())
    }

    async fn load_frame_lites(
        &self,
        sql: &str,
        params: impl libsql::params::IntoParams,
    ) -> Result<Vec<FrameLite>> {
        let mut rows = self
            .conn
            .query(sql, params)
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;

        let mut frames = Vec::new();
        while let Some(row) = rows
            .next()
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
        {
            let id: i64 = match row.get(0) {
                Ok(v) => v,
                Err(_) => continue,
            };
            frames.push(FrameLite {
                id,
                timestamp: row.get(1).unwrap_or(0),
                app_bundle_id: row.get::<String>(2).unwrap_or_default(),
                app_name: row.get::<String>(3).unwrap_or_default(),
                window_title: row.get::<String>(4).unwrap_or_default(),
                ocr_text: row.get::<String>(5).unwrap_or_default(),
                text_quality: row.get::<f64>(6).unwrap_or(0.0),
                ocr_confidence: row.get::<f64>(7).unwrap_or(0.0),
            });
        }

        Ok(frames)
    }

    async fn build_chunks_from_frames(&self, frames: Vec<FrameLite>) -> Result<usize> {
        if frames.is_empty() {
            self.refresh_chunk_watermarks().await?;
            return Ok(0);
        }

        let mut drafts: Vec<ChunkDraft> = Vec::new();
        let mut current_chunk: Vec<FrameLite> = Vec::new();

        for frame in frames {
            let should_break = if let Some(prev) = current_chunk.last() {
                let gap_break = frame.timestamp.saturating_sub(prev.timestamp) > CHUNK_BREAK_GAP_MS;
                let app_break = !frame.app_bundle_id.is_empty()
                    && !prev.app_bundle_id.is_empty()
                    && frame.app_bundle_id != prev.app_bundle_id;
                let window_break = normalize_window_title(&frame.window_title)
                    != normalize_window_title(&prev.window_title);
                let span_break = current_chunk
                    .first()
                    .map(|first| frame.timestamp.saturating_sub(first.timestamp) > CHUNK_MAX_SPAN_MS)
                    .unwrap_or(false);
                gap_break || app_break || window_break || span_break
            } else {
                false
            };

            if should_break && !current_chunk.is_empty() {
                if let Some(draft) = build_chunk_draft(std::mem::take(&mut current_chunk)) {
                    drafts.push(draft);
                }
            }

            current_chunk.push(frame);
        }

        if !current_chunk.is_empty() {
            if let Some(draft) = build_chunk_draft(current_chunk) {
                drafts.push(draft);
            }
        }

        assign_session_metadata(&mut drafts);
        let contextual_texts: Vec<String> = (0..drafts.len())
            .map(|index| build_contextual_chunk_text(&drafts, index))
            .collect();

        let mut inserted = 0usize;
        for (draft, contextual_text_compact) in drafts.into_iter().zip(contextual_texts.into_iter()) {
            inserted += self.insert_search_chunk(draft, contextual_text_compact).await?;
        }

        self.refresh_chunk_watermarks().await?;
        Ok(inserted)
    }

    async fn with_chunk_rebuild_guard<F, Fut>(&self, op: F) -> Result<usize>
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = Result<usize>>,
    {
        if CHUNK_REBUILD_RUNNING
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return Ok(0);
        }

        let result = op().await;
        CHUNK_REBUILD_RUNNING.store(false, Ordering::SeqCst);
        result
    }

    /// Rebuild recent semantic chunks from OCR frames.
    ///
    /// This keeps chunk-based retrieval populated without relying on one-time migrations.
    pub async fn rebuild_recent_search_chunks(&self, lookback_ms: i64) -> Result<usize> {
        if !self.table_exists("search_chunks").await?
            || !self.table_exists("search_chunk_frames").await?
        {
            return Ok(0);
        }

        self.with_chunk_rebuild_guard(|| async move {
            let now = chrono::Utc::now().timestamp_millis();
            let cutoff = now.saturating_sub(lookback_ms.max(60_000));

            // Delete in smaller batches so writer lock spans stay short while watcher is active.
            loop {
                let mut attempt = 0u32;
                let deleted = loop {
                    match self.conn.execute(
                        r#"
                        DELETE FROM search_chunks
                        WHERE id IN (
                            SELECT id
                            FROM search_chunks
                            WHERE chunk_end_ts >= ?
                            ORDER BY chunk_end_ts ASC
                            LIMIT ?
                        )
                        "#,
                        libsql::params![cutoff, CHUNK_REBUILD_DELETE_BATCH_SIZE],
                    ).await {
                        Ok(changes) => break changes,
                        Err(err) => {
                            let err_text = err.to_string();
                            if attempt + 1 < SQLITE_LOCK_RETRY_ATTEMPTS
                                && is_sqlite_lock_error(&err_text)
                            {
                                attempt += 1;
                                let backoff_ms = 40u64.saturating_mul(1u64 << attempt);
                                tokio::time::sleep(std::time::Duration::from_millis(backoff_ms)).await;
                                continue;
                            }
                            return Err(DatabaseError::Query(err_text));
                        }
                    }
                };
                if deleted <= 0 || deleted < CHUNK_REBUILD_DELETE_BATCH_SIZE as u64 {
                    break;
                }
                tokio::task::yield_now().await;
            }

            let frames = self
                .load_frame_lites(
                    r#"
                    SELECT id, timestamp, COALESCE(app_bundle_id, ''), COALESCE(app_name, ''),
                           COALESCE(window_title, ''), COALESCE(ocr_text, ''),
                           COALESCE(text_quality, 0.0), COALESCE(ocr_confidence, 0.0)
                    FROM ocr_frames
                    WHERE timestamp >= ?
                    ORDER BY timestamp ASC
                    "#,
                    libsql::params![cutoff],
                )
                .await?;

            self.build_chunks_from_frames(frames).await
        }).await
    }

    /// Rebuild the oldest still-unchunked OCR frames first so historical vector
    /// coverage can catch up without waiting for frame embeddings.
    pub async fn rebuild_oldest_missing_search_chunks(&self, max_frames: usize) -> Result<usize> {
        if !self.table_exists("search_chunks").await?
            || !self.table_exists("search_chunk_frames").await?
        {
            return Ok(0);
        }

        let safe_limit = max_frames.clamp(1, HISTORICAL_CHUNK_BACKFILL_FRAME_BATCH.max(1));
        let context_filter = frame_has_searchable_context_sql("f");

        self.with_chunk_rebuild_guard(|| async move {
            let frames = self
                .load_frame_lites(
                    &format!(
                        r#"
                        SELECT f.id, f.timestamp, COALESCE(f.app_bundle_id, ''), COALESCE(f.app_name, ''),
                               COALESCE(f.window_title, ''), COALESCE(f.ocr_text, ''),
                               COALESCE(f.text_quality, 0.0), COALESCE(f.ocr_confidence, 0.0)
                        FROM ocr_frames f
                        LEFT JOIN search_chunk_frames scf ON scf.frame_id = f.id
                        WHERE scf.frame_id IS NULL
                          AND {}
                        ORDER BY f.timestamp ASC
                        LIMIT ?
                        "#,
                        context_filter
                    ),
                    libsql::params![safe_limit as i64],
                )
                .await?;

            self.build_chunks_from_frames(frames).await
        }).await
    }

    /// Fast incremental chunk rebuild covering only the last 30 minutes.
    ///
    /// Use this on every embedding tick to keep fresh OCR quickly chunked.
    /// The full 7-day `rebuild_recent_search_chunks` should still run
    /// periodically (e.g. every 5 minutes) for reconciliation.
    pub async fn rebuild_incremental_search_chunks(&self) -> Result<usize> {
        let now = chrono::Utc::now().timestamp_millis();
        if !should_run_incremental_chunk_rebuild(now) {
            return Ok(0);
        }
        self.rebuild_recent_search_chunks(CHUNK_INCREMENTAL_LOOKBACK_MS).await
    }

    async fn insert_search_chunk(&self, draft: ChunkDraft, contextual_text_compact: String) -> Result<usize> {
        if draft.frames.is_empty() {
            return Ok(0);
        }

        let first = &draft.frames[0];
        let last = &draft.frames[draft.frames.len() - 1];
        let (logical_chunk_id, content_hash) =
            compute_chunk_identity(first, last, &draft.window_norm, &contextual_text_compact);
        let now = chrono::Utc::now().timestamp_millis();

        self.conn.execute(
            r#"
            INSERT INTO search_chunks
            (device_id, user_id, logical_chunk_id, chunk_start_ts, chunk_end_ts, app_bundle_id, app_name,
             window_title_norm, browser_domain, raw_text_compact, contextual_text_compact, text_compact,
             content_hash, keywords_json, quality_score, frame_count, build_version, context_version,
             session_key, session_position, session_chunk_count, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
            libsql::params![
                CHUNK_DEVICE_ID,
                CHUNK_USER_ID,
                logical_chunk_id,
                draft.chunk_start_ts,
                draft.chunk_end_ts,
                if draft.app_bundle_id.trim().is_empty() { None::<String> } else { Some(draft.app_bundle_id.clone()) },
                if draft.app_name.trim().is_empty() { None::<String> } else { Some(draft.app_name.clone()) },
                if draft.window_norm.is_empty() { None::<String> } else { Some(draft.window_norm.clone()) },
                if draft.browser_domain.trim().is_empty() { None::<String> } else { Some(draft.browser_domain.clone()) },
                draft.raw_text_compact,
                contextual_text_compact.clone(),
                contextual_text_compact,
                content_hash,
                draft.quality_score,
                draft.frame_count,
                CHUNK_BUILD_VERSION,
                CHUNK_CONTEXT_VERSION,
                draft.session_key,
                draft.session_position,
                draft.session_chunk_count,
                now,
                now,
            ],
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;

        let mut id_rows = self.conn.query("SELECT last_insert_rowid()", ())
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;
        let chunk_id = id_rows.next()
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
            .map(|row| row.get::<i64>(0).unwrap_or(0))
            .unwrap_or(0);
        if chunk_id <= 0 {
            return Ok(0);
        }

        for frame in &draft.frames {
            self.conn.execute(
                r#"
                INSERT OR IGNORE INTO search_chunk_frames (chunk_id, frame_id)
                SELECT ?, id
                FROM ocr_frames
                WHERE id = ?
                "#,
                libsql::params![chunk_id, frame.id],
            ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        }

        self.upsert_chunk_pending_embedding_row(chunk_id).await?;

        Ok(1)
    }

    async fn upsert_chunk_pending_embedding_row(&self, chunk_id: i64) -> Result<()> {
        let now = chrono::Utc::now().timestamp_millis();
        let mut attempt = 0u32;
        loop {
            match self.conn.execute(
                r#"
                INSERT INTO chunk_embeddings
                (chunk_id, embedding, model_version, status, error_message, retry_count, created_at, updated_at)
                VALUES (?, NULL, ?, 'pending', NULL, 0, ?, ?)
                ON CONFLICT(chunk_id) DO UPDATE SET
                  embedding = NULL,
                  model_version = excluded.model_version,
                  status = 'pending',
                  error_message = NULL,
                  retry_count = 0,
                  updated_at = excluded.updated_at
                "#,
                libsql::params![chunk_id, CHUNK_MODEL_VERSION, now, now],
            ).await {
                Ok(_) => return Ok(()),
                Err(err) => {
                    let err_text = err.to_string();
                    if attempt + 1 < SQLITE_LOCK_RETRY_ATTEMPTS && is_sqlite_lock_error(&err_text) {
                        attempt += 1;
                        let backoff_ms = 40u64.saturating_mul(1u64 << attempt);
                        tokio::time::sleep(std::time::Duration::from_millis(backoff_ms)).await;
                        continue;
                    }
                    if is_foreign_key_error(&err_text) {
                        debug!(
                            chunk_id,
                            "Skipping pending chunk queue insert because chunk no longer exists"
                        );
                        return Ok(());
                    }
                    return Err(DatabaseError::Query(err_text));
                }
            }
        }
    }

    async fn upgrade_contextual_chunk_texts(&self, limit: usize) -> Result<usize> {
        if !self.table_exists("search_chunks").await?
            || !self.table_exists("search_chunk_frames").await?
            || !self.table_exists("chunk_embeddings").await?
        {
            return Ok(0);
        }

        let safe_limit = limit.clamp(1, 64);
        let mut rows = self.conn.query(
            r#"
            SELECT id
            FROM search_chunks
            WHERE COALESCE(build_version, 1) < ?
               OR COALESCE(context_version, 1) < ?
               OR COALESCE(NULLIF(raw_text_compact, ''), '') = ''
               OR COALESCE(NULLIF(contextual_text_compact, ''), '') = ''
            ORDER BY chunk_end_ts DESC
            LIMIT ?
            "#,
            libsql::params![CHUNK_BUILD_VERSION, CHUNK_CONTEXT_VERSION, safe_limit as i64],
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;

        let mut chunk_ids = Vec::new();
        while let Some(row) = rows.next().await.map_err(|e| DatabaseError::Query(e.to_string()))? {
            let chunk_id = row.get::<i64>(0).unwrap_or(0);
            if chunk_id > 0 {
                chunk_ids.push(chunk_id);
            }
        }

        let mut upgraded = 0usize;
        for chunk_id in chunk_ids {
            let frames = self.load_frame_lites(
                r#"
                SELECT f.id, f.timestamp, COALESCE(f.app_bundle_id, ''), COALESCE(f.app_name, ''),
                       COALESCE(f.window_title, ''), COALESCE(f.ocr_text, ''),
                       COALESCE(f.text_quality, 0.0), COALESCE(f.ocr_confidence, 0.0)
                FROM search_chunk_frames scf
                JOIN ocr_frames f ON f.id = scf.frame_id
                WHERE scf.chunk_id = ?
                ORDER BY f.timestamp ASC
                "#,
                libsql::params![chunk_id],
            ).await?;

            if frames.is_empty() {
                continue;
            }

            let mut drafts = build_chunk_draft(frames).into_iter().collect::<Vec<_>>();
            assign_session_metadata(&mut drafts);
            let draft = match drafts.into_iter().next() {
                Some(value) => value,
                None => continue,
            };
            let contextual_text_compact =
                build_contextual_chunk_text(std::slice::from_ref(&draft), 0);
            let first = &draft.frames[0];
            let last = &draft.frames[draft.frames.len() - 1];
            let (_, content_hash) = compute_chunk_identity(
                first,
                last,
                &draft.window_norm,
                &contextual_text_compact,
            );
            let now = chrono::Utc::now().timestamp_millis();

            self.conn.execute(
                r#"
                UPDATE search_chunks
                SET raw_text_compact = ?,
                    contextual_text_compact = ?,
                    text_compact = ?,
                    content_hash = ?,
                    build_version = ?,
                    context_version = ?,
                    browser_domain = ?,
                    session_key = ?,
                    session_position = ?,
                    session_chunk_count = ?,
                    updated_at = ?
                WHERE id = ?
                "#,
                libsql::params![
                    draft.raw_text_compact,
                    contextual_text_compact.clone(),
                    contextual_text_compact,
                    content_hash,
                    CHUNK_BUILD_VERSION,
                    CHUNK_CONTEXT_VERSION,
                    if draft.browser_domain.trim().is_empty() { None::<String> } else { Some(draft.browser_domain) },
                    draft.session_key,
                    draft.session_position,
                    draft.session_chunk_count,
                    now,
                    chunk_id
                ],
            ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;

            self.upsert_chunk_pending_embedding_row(chunk_id).await?;
            upgraded += 1;
        }

        Ok(upgraded)
    }

    /// Ensure every search chunk has an explicit row in chunk_embeddings (durable queue).
    pub async fn ensure_chunk_embedding_queue(&self) -> Result<usize> {
        if !self.table_exists("search_chunks").await?
            || !self.table_exists("chunk_embeddings").await?
        {
            return Ok(0);
        }

        let now = chrono::Utc::now().timestamp_millis();
        let mut attempt = 0u32;
        loop {
            match self.conn.execute(
                r#"
                INSERT INTO chunk_embeddings
                (chunk_id, embedding, model_version, status, error_message, retry_count, created_at, updated_at)
                SELECT s.id, NULL, ?, 'pending', NULL, 0, ?, ?
                FROM search_chunks s
                LEFT JOIN chunk_embeddings e ON e.chunk_id = s.id
                WHERE e.chunk_id IS NULL
                "#,
                libsql::params![CHUNK_MODEL_VERSION, now, now],
            ).await {
                Ok(changes) => return Ok(changes as usize),
                Err(err) => {
                    let err_text = err.to_string();
                    if attempt + 1 < SQLITE_LOCK_RETRY_ATTEMPTS && is_sqlite_lock_error(&err_text) {
                        attempt += 1;
                        let backoff_ms = 40u64.saturating_mul(1u64 << attempt);
                        tokio::time::sleep(std::time::Duration::from_millis(backoff_ms)).await;
                        continue;
                    }
                    if is_foreign_key_error(&err_text) {
                        debug!("Skipping ensure_chunk_embedding_queue pass due FK race");
                        return Ok(0);
                    }
                    return Err(DatabaseError::Query(err_text));
                }
            }
        }
    }

    async fn mark_chunk_embedding_ok(&self, chunk_id: i64, embedding_blob: &[u8], now: i64) -> Result<()> {
        let mut attempt = 0u32;
        loop {
            match self.conn.execute(
                r#"
                INSERT INTO chunk_embeddings
                (chunk_id, embedding, model_version, status, error_message, retry_count, created_at, updated_at)
                VALUES (?, ?, ?, 'ok', NULL, 0, ?, ?)
                ON CONFLICT(chunk_id) DO UPDATE SET
                  embedding = excluded.embedding,
                  model_version = excluded.model_version,
                  status = 'ok',
                  error_message = NULL,
                  retry_count = 0,
                  updated_at = excluded.updated_at
                "#,
                libsql::params![chunk_id, embedding_blob.to_vec(), CHUNK_MODEL_VERSION, now, now],
            ).await {
                Ok(_) => return Ok(()),
                Err(err) => {
                    let err_text = err.to_string();
                    if attempt + 1 < SQLITE_LOCK_RETRY_ATTEMPTS && is_sqlite_lock_error(&err_text) {
                        attempt += 1;
                        let backoff_ms = 40u64.saturating_mul(1u64 << attempt);
                        tokio::time::sleep(std::time::Duration::from_millis(backoff_ms)).await;
                        continue;
                    }
                    if is_foreign_key_error(&err_text) {
                        debug!(
                            chunk_id,
                            "Skipping chunk embedding ok write because chunk no longer exists"
                        );
                        return Ok(());
                    }
                    return Err(DatabaseError::Query(err_text));
                }
            }
        }
    }

    async fn mark_chunk_embedding_failed(
        &self,
        chunk_id: i64,
        retry_count: i64,
        error_message: &str,
        now: i64,
    ) -> Result<()> {
        let mut attempt = 0u32;
        loop {
            match self.conn.execute(
                r#"
                INSERT INTO chunk_embeddings
                (chunk_id, embedding, model_version, status, error_message, retry_count, created_at, updated_at)
                VALUES (?, NULL, ?, 'failed', ?, ?, ?, ?)
                ON CONFLICT(chunk_id) DO UPDATE SET
                  status = 'failed',
                  error_message = excluded.error_message,
                  retry_count = excluded.retry_count,
                  updated_at = excluded.updated_at
                "#,
                libsql::params![
                    chunk_id,
                    CHUNK_MODEL_VERSION,
                    error_message.to_string(),
                    retry_count,
                    now,
                    now
                ],
            ).await {
                Ok(_) => return Ok(()),
                Err(err) => {
                    let err_text = err.to_string();
                    if attempt + 1 < SQLITE_LOCK_RETRY_ATTEMPTS && is_sqlite_lock_error(&err_text) {
                        attempt += 1;
                        let backoff_ms = 40u64.saturating_mul(1u64 << attempt);
                        tokio::time::sleep(std::time::Duration::from_millis(backoff_ms)).await;
                        continue;
                    }
                    if is_foreign_key_error(&err_text) {
                        debug!(
                            chunk_id,
                            "Skipping failed chunk embedding write because chunk no longer exists"
                        );
                        return Ok(());
                    }
                    return Err(DatabaseError::Query(err_text));
                }
            }
        }
    }

    /// Embed pending chunks so chunk-based semantic retrieval can stay current.
    pub async fn embed_pending_chunks(
        &self,
        embedding_service: &EmbeddingService,
        limit: usize,
    ) -> Result<(usize, usize, usize)> {
        if !self.table_exists("search_chunks").await?
            || !self.table_exists("chunk_embeddings").await?
        {
            return Ok((0, 0, 0));
        }

        // Seed durable queue rows for any chunk that still lacks a tracking record.
        let _ = self.ensure_chunk_embedding_queue().await?;
        let _ = self.upgrade_contextual_chunk_texts(CHUNK_EMBED_BATCH_SIZE / 2).await?;

        let mut query_attempt = 0u32;
        let mut rows = loop {
            match self.conn.query(
                r#"
                SELECT s.id,
                       COALESCE(NULLIF(s.contextual_text_compact, ''), COALESCE(s.text_compact, '')),
                       COALESCE(NULLIF(s.raw_text_compact, ''), ''),
                       COALESCE(s.app_name, ''),
                       COALESCE(s.window_title_norm, ''),
                       COALESCE(e.retry_count, 0)
                FROM search_chunks s
                LEFT JOIN chunk_embeddings e ON e.chunk_id = s.id
                WHERE COALESCE(s.build_version, 1) < ?
                   OR COALESCE(s.context_version, 1) < ?
                   OR e.chunk_id IS NULL
                   OR COALESCE(e.status, 'pending') = 'pending'
                   OR (COALESCE(e.status, 'pending') = 'failed' AND COALESCE(e.retry_count, 0) < ?)
                ORDER BY s.chunk_end_ts DESC
                LIMIT ?
                "#,
                libsql::params![CHUNK_BUILD_VERSION, CHUNK_CONTEXT_VERSION, CHUNK_EMBED_MAX_RETRIES, limit as i64],
            ).await {
                Ok(rows) => break rows,
                Err(err) => {
                    let err_text = err.to_string();
                    if query_attempt + 1 < SQLITE_LOCK_RETRY_ATTEMPTS && is_sqlite_lock_error(&err_text) {
                        query_attempt += 1;
                        let backoff_ms = 40u64.saturating_mul(1u64 << query_attempt);
                        tokio::time::sleep(std::time::Duration::from_millis(backoff_ms)).await;
                        continue;
                    }
                    return Err(DatabaseError::Query(err_text));
                }
            }
        };

        let mut processed = 0usize;
        let mut failed = 0usize;
        let mut skipped = 0usize;
        let mut pending_chunks = Vec::new();
        while let Some(row) = rows.next().await.map_err(|e| DatabaseError::Query(e.to_string()))? {
            let chunk_id: i64 = match row.get(0) {
                Ok(v) => v,
                Err(_) => continue,
            };
            pending_chunks.push(PendingChunk {
                chunk_id,
                contextual_text_compact: row.get(1).unwrap_or_default(),
                raw_text_compact: row.get(2).unwrap_or_default(),
                app_name: row.get(3).unwrap_or_default(),
                window_title: row.get(4).unwrap_or_default(),
                retry_count: row.get(5).unwrap_or(0),
            });
        }

        if pending_chunks.is_empty() {
            self.refresh_chunk_watermarks().await?;
            return Ok((0, 0, 0));
        }

        for chunk_batch in pending_chunks.chunks(CHUNK_EMBED_BATCH_SIZE.max(1)) {
            let texts: Vec<String> = chunk_batch.iter().map(|chunk| chunk.text_for_embedding()).collect();
            let now = chrono::Utc::now().timestamp_millis();

            let batch_embeddings = match embedding_service.embed_batch(texts.clone()) {
                Ok(embeddings) => embeddings,
                Err(err) => {
                    let batch_error = format!("Batch embedding failed: {}", err);
                    for chunk in chunk_batch {
                        let next_retry = chunk.retry_count.saturating_add(1);
                        self.mark_chunk_embedding_failed(
                            chunk.chunk_id,
                            next_retry,
                            &batch_error,
                            now,
                        ).await?;
                        failed += 1;
                    }
                    continue;
                }
            };

            for (index, chunk) in chunk_batch.iter().enumerate() {
                let text = texts.get(index).cloned().unwrap_or_default();
                if text.trim().is_empty() {
                    skipped += 1;
                    continue;
                }

                let embedding = batch_embeddings.get(index).cloned().unwrap_or_default();
                if embedding.len() != EMBEDDING_DIM {
                    let next_retry = chunk.retry_count.saturating_add(1);
                    self.mark_chunk_embedding_failed(
                        chunk.chunk_id,
                        next_retry,
                        &format!(
                            "Invalid embedding dimensions for chunk {}: expected {}, got {}",
                            chunk.chunk_id,
                            EMBEDDING_DIM,
                            embedding.len()
                        ),
                        now,
                    ).await?;
                    failed += 1;
                    continue;
                }

                let blob = embedding_to_blob(&embedding);
                self.mark_chunk_embedding_ok(chunk.chunk_id, &blob, now).await?;
                processed += 1;
            }
        }

        self.refresh_chunk_watermarks().await?;
        Ok((processed, failed, skipped))
    }

    async fn refresh_chunk_watermarks(&self) -> Result<()> {
        if !self.table_exists("pipeline_watermarks").await? {
            return Ok(());
        }

        let now = chrono::Utc::now().timestamp_millis();
        let mut built_rows = self.conn.query(
            "SELECT MAX(chunk_end_ts) FROM search_chunks",
            (),
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        let last_chunk_built_ts = built_rows
            .next()
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
            .and_then(|row| row.get::<i64>(0).ok());

        let mut embed_rows = self.conn.query(
            "SELECT MAX(updated_at) FROM chunk_embeddings WHERE status='ok'",
            (),
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        let last_chunk_embedded_ts = embed_rows
            .next()
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
            .and_then(|row| row.get::<i64>(0).ok());

        let mut pending_rows = self.conn.query(
            r#"
            SELECT COUNT(*), MIN(s.chunk_start_ts)
            FROM search_chunks s
            LEFT JOIN chunk_embeddings e ON e.chunk_id = s.id
            WHERE e.chunk_id IS NULL OR COALESCE(e.status, 'pending') != 'ok'
            "#,
            (),
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        let (pending_chunks, oldest_pending_chunk_ts) = if let Some(row) = pending_rows
            .next()
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
        {
            (row.get::<i64>(0).unwrap_or(0), row.get::<i64>(1).ok())
        } else {
            (0, None)
        };

        self.conn.execute(
            "INSERT OR IGNORE INTO pipeline_watermarks (id, updated_at) VALUES (1, ?)",
            libsql::params![now],
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;

        self.conn.execute(
            r#"
            UPDATE pipeline_watermarks
            SET last_chunk_built_ts = ?,
                last_chunk_embedded_ts = ?,
                pending_chunks = ?,
                oldest_pending_chunk_ts = ?,
                updated_at = ?
            WHERE id = 1
            "#,
            libsql::params![
                last_chunk_built_ts,
                last_chunk_embedded_ts,
                pending_chunks,
                oldest_pending_chunk_ts,
                now
            ],
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;

        Ok(())
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
        let mut pending_chunks = 0_i64;
        if self.table_exists("search_chunks").await? && self.table_exists("chunk_embeddings").await? {
            let mut pending_rows = self.conn.query(
                r#"
                SELECT COUNT(*)
                FROM search_chunks s
                LEFT JOIN chunk_embeddings e ON e.chunk_id = s.id
                WHERE e.chunk_id IS NULL OR COALESCE(e.status, 'pending') != 'ok'
                "#,
                (),
            ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
            if let Some(row) = pending_rows.next().await.map_err(|e| DatabaseError::Query(e.to_string()))? {
                pending_chunks = row.get::<i64>(0).unwrap_or(0);
            }
        } else if self.table_exists("pipeline_watermarks").await? {
            let mut pending_rows = self.conn.query(
                "SELECT COALESCE(pending_chunks, 0) FROM pipeline_watermarks WHERE id = 1",
                (),
            ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
            if let Some(row) = pending_rows.next().await.map_err(|e| DatabaseError::Query(e.to_string()))? {
                pending_chunks = row.get::<i64>(0).unwrap_or(0);
            }
        }
        
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
            pending_chunks,
            model_versions,
            embedding_dimension: EMBEDDING_DIM as i64,
            current_model: MODEL_VERSION.to_string(),
            failed_embeddings: failed,
            worker_running,
            last_worker_run: last_run,
        })
    }

    /// Get total/embedded/pending counts for chunk embeddings.
    pub async fn get_chunk_embedding_counts(&self) -> Result<(i64, i64, i64)> {
        if !self.table_exists("search_chunks").await? || !self.table_exists("chunk_embeddings").await? {
            return Ok((0, 0, 0));
        }

        let mut total_rows = self.conn.query(
            "SELECT COUNT(*) FROM search_chunks",
            (),
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        let total_chunks = total_rows
            .next()
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
            .and_then(|row| row.get::<i64>(0).ok())
            .unwrap_or(0);

        let mut embedded_rows = self.conn.query(
            "SELECT COUNT(*) FROM chunk_embeddings WHERE COALESCE(status, 'pending') = 'ok'",
            (),
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        let embedded_chunks = embedded_rows
            .next()
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
            .and_then(|row| row.get::<i64>(0).ok())
            .unwrap_or(0);

        let mut pending_rows = self.conn.query(
            r#"
            SELECT COUNT(*)
            FROM search_chunks s
            LEFT JOIN chunk_embeddings e ON e.chunk_id = s.id
            WHERE e.chunk_id IS NULL OR COALESCE(e.status, 'pending') != 'ok'
            "#,
            (),
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        let pending_chunks = pending_rows
            .next()
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
            .and_then(|row| row.get::<i64>(0).ok())
            .unwrap_or(0);

        Ok((total_chunks, embedded_chunks, pending_chunks))
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

        // Step 2: Prefer chunk-based semantic candidates; fall back to frame vectors when unavailable.
        let vector_start = std::time::Instant::now();
        let mut vector_options = options.clone();
        vector_options.limit = options.limit.saturating_mul(3);
        // Apply threshold after combining with FTS boost.
        vector_options.min_relevance = None;
        let mut vector_candidates = self
            .chunk_hybrid_candidates(
                query,
                query_embedding,
                &vector_options,
                options.limit.saturating_mul(4),
            )
            .await?;
        if vector_candidates.is_empty() {
            vector_candidates = self.semantic_search(query_embedding, &vector_options).await?;
        }
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

    async fn chunk_hybrid_candidates(
        &self,
        query: &str,
        query_embedding: &[f32],
        options: &SearchOptions,
        candidate_limit: usize,
    ) -> Result<Vec<SearchResult>> {
        if !self.table_exists("search_chunks").await?
            || !self.table_exists("chunk_embeddings").await?
            || !self.table_exists("search_chunk_frames").await?
        {
            return Ok(Vec::new());
        }

        let embedding_blob = embedding_to_blob(query_embedding);
        let mut conditions = Vec::new();
        let mut params: Vec<Value> = vec![Value::from(embedding_blob)];

        if let Some((start, end)) = options.time_range {
            conditions.push("s.chunk_end_ts >= ?".to_string());
            params.push(Value::from(start));
            conditions.push("s.chunk_start_ts <= ?".to_string());
            params.push(Value::from(end));
        }

        if let Some(ref apps) = options.app_filter {
            if !apps.is_empty() {
                let placeholders = vec!["?"; apps.len()].join(",");
                conditions.push(format!("COALESCE(s.app_bundle_id, '') IN ({})", placeholders));
                for app in apps {
                    params.push(Value::from(app.clone()));
                }
            }
        }

        conditions.push(
            "COALESCE(NULLIF(TRIM(s.contextual_text_compact), ''), COALESCE(NULLIF(TRIM(s.text_compact), ''), '')) != ''"
                .to_string(),
        );
        let where_clause = if conditions.is_empty() {
            String::new()
        } else {
            format!("AND {}", conditions.join(" AND "))
        };

        let sql = format!(
            r#"
            SELECT s.id, s.chunk_start_ts, s.chunk_end_ts,
                   COALESCE(NULLIF(s.contextual_text_compact, ''), COALESCE(s.text_compact, '')),
                   COALESCE(s.quality_score, 0.0), vector_distance_cos(e.embedding, ?) as distance
            FROM search_chunks s
            JOIN chunk_embeddings e ON e.chunk_id = s.id
            WHERE COALESCE(e.status, 'pending') = 'ok'
              {}
            ORDER BY distance ASC
            LIMIT ?
            "#,
            where_clause
        );
        params.push(Value::from(candidate_limit as i64));

        let mut rows = self
            .conn
            .query(&sql, libsql::params_from_iter(params))
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;

        let now_ms = chrono::Utc::now().timestamp_millis();
        let horizon_ms = options
            .time_range
            .map(|(start, end)| (end - start).max(1))
            .unwrap_or(30 * 24 * 60 * 60 * 1000);
        let expanded_tokens = expand_query_tokens(query);

        let mut candidates = Vec::new();
        while let Some(row) = rows.next().await.map_err(|e| DatabaseError::Query(e.to_string()))? {
            let chunk_id: i64 = match row.get(0) {
                Ok(v) => v,
                Err(_) => continue,
            };
            let chunk_end_ts: i64 = row.get(2).unwrap_or(0);
            let text_compact: String = row.get(3).unwrap_or_default();
            let quality_score: f32 = row.get::<f64>(4).unwrap_or(0.0) as f32;
            let distance: f32 = row.get::<f64>(5).unwrap_or(1.0) as f32;

            let vector_score = 1.0 - distance.min(1.0);
            let lexical_score = lexical_token_overlap(&text_compact, &expanded_tokens);
            let age = now_ms.saturating_sub(chunk_end_ts).max(0) as f32;
            let recency_score = 1.0 - (age / horizon_ms as f32).clamp(0.0, 1.0);
            let quality_weight = quality_score.clamp(0.2, 1.0);
            let combined = ((0.55 * vector_score) + (0.35 * lexical_score) + (0.10 * recency_score))
                * quality_weight;

            if let Some(min) = options.min_relevance {
                if combined < min {
                    continue;
                }
            }

            if let Some(frame) = self.get_chunk_representative_frame(chunk_id).await? {
                if !matches_search_filters(&frame, options) {
                    continue;
                }
                candidates.push(SearchResult {
                    frame,
                    distance,
                    relevance_score: combined.clamp(0.0, 1.0),
                });
            }
        }

        candidates.sort_by(|a, b| b.relevance_score.partial_cmp(&a.relevance_score).unwrap());
        Ok(candidates)
    }

    async fn get_chunk_representative_frame(&self, chunk_id: i64) -> Result<Option<OcrFrame>> {
        let mut rows = self.conn.query(
            r#"
            SELECT f.id, f.timestamp, f.activity_event_id, f.app_bundle_id, f.app_name,
                   f.window_title, f.ocr_text, f.ocr_confidence, f.thumbnail_path,
                   f.video_chunk_id, f.frame_offset, f.image_hash, f.storage_tier, f.created_at,
                   f.summary, f.activity_type, f.keywords, f.text_quality
            FROM search_chunk_frames scf
            JOIN ocr_frames f ON f.id = scf.frame_id
            WHERE scf.chunk_id = ?
            ORDER BY f.timestamp DESC
            LIMIT 1
            "#,
            libsql::params![chunk_id],
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;

        if let Some(row) = rows.next().await.map_err(|e| DatabaseError::Query(e.to_string()))? {
            let tier_str: String = row.get(12).unwrap_or_else(|_| "hot".to_string());
            return Ok(Some(OcrFrame {
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
                summary: row.get(14).ok(),
                activity_type: row.get(15).ok(),
                keywords: row.get(16).ok(),
                text_quality: row.get(17).ok(),
            }));
        }

        Ok(None)
    }
}

fn normalize_window_title(value: &str) -> String {
    clean_text(value).to_ascii_lowercase()
}

fn split_compound_for_search(token: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    let mut prev_is_alpha = false;
    let mut prev_is_lower = false;
    let mut prev_is_digit = false;

    for ch in token.chars() {
        let is_alpha = ch.is_ascii_alphabetic();
        let is_digit = ch.is_ascii_digit();
        let boundary = (!current.is_empty())
            && ((prev_is_lower && ch.is_ascii_uppercase()) || (prev_is_digit && is_alpha) || (prev_is_alpha && is_digit));

        if boundary {
            out.push(current.to_ascii_lowercase());
            current.clear();
        }
        current.push(ch);
        prev_is_alpha = is_alpha;
        prev_is_lower = ch.is_ascii_lowercase();
        prev_is_digit = is_digit;
    }

    if !current.is_empty() {
        out.push(current.to_ascii_lowercase());
    }
    out
}

fn aliases_for_query_token(token: &str) -> &'static [&'static str] {
    match token {
        "auth" => &["authentication", "login", "signin", "token", "oauth"],
        "authentication" => &["auth", "login", "signin", "token", "oauth"],
        "login" => &["signin", "auth", "authentication"],
        "signin" | "sign-in" => &["login", "auth", "authentication"],
        "bug" => &["issue", "error", "fix"],
        "issue" => &["bug", "error", "fix"],
        "landing" => &["homepage", "home", "marketing"],
        "homepage" => &["landing", "home", "marketing"],
        "repo" => &["repository", "github", "git"],
        "repository" => &["repo", "github", "git"],
        _ => &[],
    }
}

fn expand_query_tokens(query: &str) -> Vec<String> {
    let mut normalized = String::with_capacity(query.len());
    for ch in query.chars() {
        if ch.is_ascii_alphanumeric() || ch == '.' || ch == '-' || ch.is_whitespace() {
            normalized.push(ch);
        } else {
            normalized.push(' ');
        }
    }

    let mut tokens = Vec::new();
    let mut seen = HashSet::new();
    for raw in normalized.split_whitespace() {
        let token = raw.to_ascii_lowercase();
        if token.len() < 3 {
            continue;
        }
        for split in split_compound_for_search(&token) {
            if split.len() >= 3 && seen.insert(split.clone()) {
                tokens.push(split);
            }
        }
        for alias in aliases_for_query_token(&token) {
            let alias_clean = alias
                .chars()
                .filter(|c| c.is_ascii_alphanumeric() || *c == '.')
                .collect::<String>()
                .to_ascii_lowercase();
            if alias_clean.len() >= 3 && seen.insert(alias_clean.clone()) {
                tokens.push(alias_clean);
            }
        }
    }
    tokens
}

fn lexical_token_overlap(haystack: &str, tokens: &[String]) -> f32 {
    if tokens.is_empty() {
        return 0.0;
    }
    let normalized = haystack.to_ascii_lowercase();
    let mut hits = 0f32;
    for token in tokens {
        if normalized.contains(token) {
            hits += 1.0;
        }
    }
    (hits / tokens.len() as f32).clamp(0.0, 1.0)
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
    pub pending_chunks: i64,
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
        
        // Semantic readiness is chunk-first. Keep recent reconciliation alive and
        // continuously backfill the oldest unchunked history before touching frame embeddings.
        let _ = vector_ops.rebuild_incremental_search_chunks().await;
        let historical_rebuilt = if should_run_historical_chunk_backfill(chrono::Utc::now().timestamp_millis()) {
            match vector_ops
                .rebuild_oldest_missing_search_chunks(HISTORICAL_CHUNK_BACKFILL_FRAME_BATCH)
                .await
            {
                Ok(inserted) => inserted,
                Err(err) if is_sqlite_lock_error(&err.to_string()) => 0,
                Err(err) => {
                    warn!(error = %err, "Historical chunk backfill pass failed");
                    0
                }
            }
        } else {
            0
        };
        let _ = vector_ops.ensure_chunk_embedding_queue().await;
        let _ = vector_ops
            .embed_pending_chunks(embedding_service, self.batch_size.saturating_mul(4))
            .await;

        let (_, _, pending_chunks_after_chunk_pass) = vector_ops.get_chunk_embedding_counts().await?;
        if historical_rebuilt > 0 || pending_chunks_after_chunk_pass > 0 {
            let now_ms = chrono::Utc::now().timestamp_millis();
            if should_run_full_chunk_rebuild(now_ms) {
                match vector_ops
                    .rebuild_recent_search_chunks(CHUNK_REBUILD_LOOKBACK_MS)
                    .await
                {
                    Ok(inserted) => {
                        let _ = vector_ops.ensure_chunk_embedding_queue().await;
                        let _ = vector_ops
                            .embed_pending_chunks(embedding_service, self.batch_size.saturating_mul(4))
                            .await;
                        info!(
                            rebuilt = inserted,
                            oldest_backfill = historical_rebuilt,
                            pending_chunks = pending_chunks_after_chunk_pass,
                            lookback_ms = CHUNK_REBUILD_LOOKBACK_MS,
                            "Chunk-first pass completed before frame embeddings"
                        );
                    }
                    Err(err) => {
                        warn!(error = %err, "Full chunk reconciliation pass failed");
                    }
                }
            }
            let _ = vector_ops.update_worker_state(false, 0, 0).await;
            return Ok(BatchProcessResult { processed: 0, failed: 0, skipped: 0 });
        }

        let frames = recorder_ops.get_frames_without_embeddings(self.batch_size).await?;
        if frames.is_empty() {
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
            
            let mut text = EmbeddingService::prepare_frame_text(&processed_frame);
            if text.trim().is_empty() {
                // Never hard-drop a row when app/window context exists.
                let mut fallback_parts = Vec::new();
                if !processed_frame.app_name.trim().is_empty() {
                    fallback_parts.push(format!("App: {}", processed_frame.app_name.trim()));
                }
                if let Some(window) = processed_frame.window_title.as_ref() {
                    if !window.trim().is_empty() {
                        fallback_parts.push(format!("Window: {}", window.trim()));
                    }
                }
                if let Some(summary) = processed_frame.summary.as_ref() {
                    if !summary.trim().is_empty() {
                        fallback_parts.push(format!("Summary: {}", summary.trim()));
                    }
                }
                text = fallback_parts.join("\n");
            }
            
            if text.trim().is_empty() {
                // Skip only when no OCR and no contextual fallback can be built.
                skipped += 1;
                debug!("Skipping frame {} - no text content", id);
                continue;
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

        // Fast 30-min incremental rebuild on every tick; the full 7-day reconciliation
        // runs on the empty-frames path or can be triggered externally.
        let (mut chunk_built, mut chunk_embed_failed, mut chunk_embed_skipped) = match vector_ops
            .rebuild_incremental_search_chunks()
            .await
        {
            Ok(inserted) => {
                if let Err(err) = vector_ops.ensure_chunk_embedding_queue().await {
                    warn!(error = %err, "Failed to seed chunk embedding queue");
                }

                match vector_ops
                    .embed_pending_chunks(embedding_service, self.batch_size.saturating_mul(2))
                    .await
                {
                    Ok((embedded, failed_embed, skipped_embed)) => {
                        (inserted + embedded, failed_embed, skipped_embed)
                    }
                    Err(err) => {
                        warn!(error = %err, "Chunk embedding pass failed");
                        (inserted, 0, 0)
                    }
                }
            }
            Err(err) => {
                warn!(error = %err, "Chunk rebuild pass failed");
                (0, 0, 0)
            }
        };

        let now_ms = chrono::Utc::now().timestamp_millis();
        if should_run_full_chunk_rebuild(now_ms) {
            match vector_ops
                .rebuild_recent_search_chunks(CHUNK_REBUILD_LOOKBACK_MS)
                .await
            {
                Ok(inserted) => {
                    if let Err(err) = vector_ops.ensure_chunk_embedding_queue().await {
                        warn!(error = %err, "Failed to seed chunk embedding queue for full reconciliation");
                    }
                    match vector_ops
                        .embed_pending_chunks(embedding_service, self.batch_size.saturating_mul(2))
                        .await
                    {
                        Ok((embedded, failed_embed, skipped_embed)) => {
                            chunk_built = chunk_built.saturating_add(inserted + embedded);
                            chunk_embed_failed = chunk_embed_failed.saturating_add(failed_embed);
                            chunk_embed_skipped = chunk_embed_skipped.saturating_add(skipped_embed);
                            info!(
                                rebuilt = inserted,
                                embedded = embedded,
                                lookback_ms = CHUNK_REBUILD_LOOKBACK_MS,
                                "Completed periodic full chunk reconciliation"
                            );
                        }
                        Err(err) => {
                            warn!(error = %err, "Full chunk reconciliation embedding pass failed");
                            chunk_built = chunk_built.saturating_add(inserted);
                        }
                    }
                }
                Err(err) => {
                    warn!(error = %err, "Full chunk reconciliation rebuild pass failed");
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
            chunk_processed = chunk_built,
            chunk_failed = chunk_embed_failed,
            chunk_skipped = chunk_embed_skipped,
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
    fn make_frame(timestamp: i64, app_name: &str, window_title: &str, ocr_text: &str) -> FrameLite {
        FrameLite {
            id: timestamp,
            timestamp,
            app_bundle_id: format!("bundle.{}", app_name.replace(' ', ".").to_lowercase()),
            app_name: app_name.to_string(),
            window_title: window_title.to_string(),
            ocr_text: ocr_text.to_string(),
            text_quality: 0.9,
            ocr_confidence: 0.9,
        }
    }

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

    #[test]
    fn test_assign_session_metadata_splits_on_time_gap() {
        let base = 1_700_000_000_000i64;
        let mut drafts = vec![
            build_chunk_draft(vec![make_frame(base, "Cursor", "main.rs", "editing app startup")]).unwrap(),
            build_chunk_draft(vec![make_frame(base + 30_000, "Cursor", "main.rs", "more app startup work")]).unwrap(),
            build_chunk_draft(vec![make_frame(
                base + 30_000 + SESSION_BREAK_GAP_MS + 1,
                "Cursor",
                "main.rs",
                "resumed later",
            )])
            .unwrap(),
        ];

        assign_session_metadata(&mut drafts);

        assert_eq!(drafts[0].session_key, drafts[1].session_key);
        assert_ne!(drafts[1].session_key, drafts[2].session_key);
        assert_eq!(drafts[0].session_position, 0);
        assert_eq!(drafts[1].session_position, 1);
        assert_eq!(drafts[2].session_position, 0);
    }

    #[test]
    fn test_assign_session_metadata_splits_on_app_change_with_gap() {
        let base = 1_700_000_000_000i64;
        let mut drafts = vec![
            build_chunk_draft(vec![make_frame(base, "Cursor", "feature.tsx", "coding feature work")]).unwrap(),
            build_chunk_draft(vec![make_frame(
                base + SESSION_BREAK_APP_CHANGE_GAP_MS + 1,
                "Things 3",
                "Inbox",
                "planning follow-up tasks",
            )])
            .unwrap(),
        ];

        assign_session_metadata(&mut drafts);

        assert_ne!(drafts[0].session_key, drafts[1].session_key);
    }

    #[test]
    fn test_assign_session_metadata_splits_browser_domain_change() {
        let base = 1_700_000_000_000i64;
        let mut drafts = vec![
            build_chunk_draft(vec![make_frame(base, "Google Chrome", "github.com pull request", "repo diff review")]).unwrap(),
            build_chunk_draft(vec![make_frame(
                base + SESSION_BREAK_BROWSER_DOMAIN_GAP_MS + 1,
                "Google Chrome",
                "docs.python.org guide",
                "documentation page content",
            )])
            .unwrap(),
        ];

        assign_session_metadata(&mut drafts);

        assert_eq!(drafts[0].browser_domain, "github.com");
        assert_eq!(drafts[1].browser_domain, "docs.python.org");
        assert_ne!(drafts[0].session_key, drafts[1].session_key);
    }

    #[test]
    fn test_contextual_chunk_text_includes_headers_and_neighboring_activity() {
        let base = 1_700_000_000_000i64;
        let mut drafts = vec![
            build_chunk_draft(vec![make_frame(base, "Cursor", "api route", "implemented memory ingest contract")]).unwrap(),
            build_chunk_draft(vec![make_frame(base + 30_000, "Cursor", "query planner", "improved retrieval depth and reranking")]).unwrap(),
            build_chunk_draft(vec![make_frame(base + 60_000, "Things 3", "Inbox", "captured follow-up tasks for search quality")]).unwrap(),
        ];

        assign_session_metadata(&mut drafts);
        let contextual = build_contextual_chunk_text(&drafts, 1);

        assert!(contextual.contains("Session:"));
        assert!(contextual.contains("Primary app: Cursor"));
        assert!(contextual.contains("Primary window/topic:"));
        assert!(contextual.contains("Time:"));
        assert!(contextual.contains("Neighboring activity:"));
        assert!(contextual.contains("Observed content:"));
        assert!(contextual.contains("implemented memory ingest contract"));
        assert!(contextual.contains("captured follow-up tasks for search quality"));
        assert!(contextual.contains("improved retrieval depth and reranking"));
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
