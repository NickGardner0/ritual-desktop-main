//! Text Processing Module for Screen Recording Data
//!
//! This module provides text processing utilities to improve data quality:
//! - Extractive summarization - picks the most informative sentences
//! - Keyword extraction - identifies key terms for better search (YAKE algorithm)
//! - Named Entity Recognition (NER) - extracts entities like emails, URLs, dates
//! - Text quality scoring - filters out low-quality frames
//!
//! These are lightweight, fast algorithms that run locally without ML models.

use once_cell::sync::Lazy;
use regex::Regex;
use std::collections::{HashMap, HashSet};
use tracing::debug;

/// Maximum summary length in characters
pub const MAX_SUMMARY_LENGTH: usize = 500;

/// Minimum text length to attempt summarization
pub const MIN_TEXT_FOR_SUMMARY: usize = 100;

/// Extractive summarization result
#[derive(Debug, Clone)]
pub struct SummaryResult {
    /// The extracted summary text
    pub summary: String,
    /// Key phrases extracted from the text
    pub keywords: Vec<String>,
    /// Quality score (0.0-1.0)
    pub quality_score: f64,
}

/// Perform extractive summarization on OCR text
///
/// This uses a TF-IDF-like approach to score sentences and pick the most informative ones.
/// Much faster than ML-based summarization but still effective for search.
pub fn summarize_text(text: &str, max_length: usize) -> SummaryResult {
    let text = text.trim();

    // If text is short enough, return as-is
    if text.len() <= max_length {
        let keywords = extract_keywords(text, 5);
        let quality = calculate_text_quality(text);
        return SummaryResult {
            summary: text.to_string(),
            keywords,
            quality_score: quality,
        };
    }

    // Split into sentences
    let sentences = split_into_sentences(text);

    if sentences.is_empty() {
        return SummaryResult {
            summary: String::new(),
            keywords: Vec::new(),
            quality_score: 0.0,
        };
    }

    // Score sentences based on importance
    let scored_sentences = score_sentences(&sentences);

    // Select best sentences up to max_length
    let summary = select_best_sentences(&scored_sentences, max_length);

    // Extract keywords from original text
    let keywords = extract_keywords(text, 5);

    // Calculate quality score
    let quality = calculate_text_quality(&summary);

    SummaryResult {
        summary,
        keywords,
        quality_score: quality,
    }
}

/// Split text into sentences
fn split_into_sentences(text: &str) -> Vec<String> {
    let mut sentences = Vec::new();
    let mut current = String::new();

    for c in text.chars() {
        current.push(c);

        // Check for sentence ending
        if matches!(c, '.' | '!' | '?') {
            let trimmed = current.trim().to_string();
            if !trimmed.is_empty() && trimmed.split_whitespace().count() >= 3 {
                sentences.push(trimmed);
            }
            current = String::new();
        }
    }

    // Add remaining text as a sentence if it's meaningful
    let trimmed = current.trim().to_string();
    if !trimmed.is_empty() && trimmed.split_whitespace().count() >= 3 {
        sentences.push(trimmed);
    }

    sentences
}

/// Score sentences based on importance factors
fn score_sentences(sentences: &[String]) -> Vec<(String, f64)> {
    // Build term frequency across all sentences
    let mut term_freq: HashMap<String, usize> = HashMap::new();
    let mut doc_freq: HashMap<String, usize> = HashMap::new();

    for sentence in sentences {
        let words: HashSet<String> = sentence
            .to_lowercase()
            .split_whitespace()
            .filter(|w| w.len() > 2)
            .map(|w| w.trim_matches(|c: char| !c.is_alphanumeric()).to_string())
            .filter(|w| !w.is_empty() && !is_stop_word(w))
            .collect();

        // Update document frequency (how many sentences contain each word)
        for word in &words {
            *doc_freq.entry(word.clone()).or_insert(0) += 1;
        }

        // Update term frequency
        for word in sentence.to_lowercase().split_whitespace() {
            let clean = word
                .trim_matches(|c: char| !c.is_alphanumeric())
                .to_string();
            if !clean.is_empty() && !is_stop_word(&clean) {
                *term_freq.entry(clean).or_insert(0) += 1;
            }
        }
    }

    let num_sentences = sentences.len() as f64;

    // Score each sentence
    sentences
        .iter()
        .enumerate()
        .map(|(idx, sentence)| {
            let mut score = 0.0;

            // TF-IDF-like scoring
            let words: Vec<String> = sentence
                .to_lowercase()
                .split_whitespace()
                .filter(|w| w.len() > 2)
                .map(|w| w.trim_matches(|c: char| !c.is_alphanumeric()).to_string())
                .filter(|w| !w.is_empty() && !is_stop_word(w))
                .collect();

            for word in &words {
                let tf = *term_freq.get(word).unwrap_or(&0) as f64;
                let df = *doc_freq.get(word).unwrap_or(&1) as f64;
                let idf = (num_sentences / df).ln() + 1.0;
                score += tf * idf;
            }

            // Normalize by sentence length
            if !words.is_empty() {
                score /= words.len() as f64;
            }

            // Position bonus - first and last sentences often more important
            if idx == 0 {
                score *= 1.2;
            } else if idx == sentences.len() - 1 {
                score *= 1.1;
            }

            // Length bonus - prefer medium-length sentences
            let word_count = sentence.split_whitespace().count();
            if (8..=25).contains(&word_count) {
                score *= 1.1;
            }

            (sentence.clone(), score)
        })
        .collect()
}

/// Select best sentences up to max_length
fn select_best_sentences(scored: &[(String, f64)], max_length: usize) -> String {
    // Sort by score descending
    let mut sorted: Vec<_> = scored.iter().collect();
    sorted.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    // Select sentences until we hit the limit
    let mut selected = Vec::new();
    let mut current_length = 0;

    for (sentence, _score) in sorted {
        if current_length + sentence.len() + 1 <= max_length {
            selected.push(sentence.clone());
            current_length += sentence.len() + 1;
        }

        // Stop if we have enough content
        if current_length >= max_length * 3 / 4 {
            break;
        }
    }

    // Sort selected sentences by original order for readability
    // We'll use the order from the input
    let original_order: Vec<_> = scored.iter().map(|(s, _)| s.clone()).collect();
    selected.sort_by_key(|s| {
        original_order
            .iter()
            .position(|x| x == s)
            .unwrap_or(usize::MAX)
    });

    selected.join(" ")
}

/// Extract key phrases/keywords from text
pub fn extract_keywords(text: &str, max_keywords: usize) -> Vec<String> {
    let mut word_freq: HashMap<String, usize> = HashMap::new();

    // Count word frequencies
    for word in text.to_lowercase().split_whitespace() {
        let clean = word
            .trim_matches(|c: char| !c.is_alphanumeric())
            .to_string();
        if clean.len() > 3 && !is_stop_word(&clean) {
            *word_freq.entry(clean).or_insert(0) += 1;
        }
    }

    // Sort by frequency
    let mut sorted: Vec<_> = word_freq.into_iter().collect();
    sorted.sort_by(|a, b| b.1.cmp(&a.1));

    // Return top keywords
    sorted
        .into_iter()
        .take(max_keywords)
        .map(|(word, _)| word)
        .collect()
}

/// Calculate text quality score (0.0-1.0)
///
/// Considers:
/// - Word length distribution
/// - Sentence structure
/// - Content density
pub fn calculate_text_quality(text: &str) -> f64 {
    if text.is_empty() {
        return 0.0;
    }

    let words: Vec<&str> = text.split_whitespace().collect();
    let word_count = words.len();

    if word_count < 3 {
        return 0.1;
    }

    // Factor 1: Average word length (good text has 4-8 char average)
    let total_chars: usize = words.iter().map(|w| w.len()).sum();
    let avg_word_len = total_chars as f64 / word_count as f64;
    let word_len_score = if (4.0..=8.0).contains(&avg_word_len) {
        1.0
    } else if (3.0..=10.0).contains(&avg_word_len) {
        0.7
    } else {
        0.3
    };

    // Factor 2: Content density (ratio of non-stop words)
    let content_words = words
        .iter()
        .filter(|w| {
            let clean = w.to_lowercase();
            let clean = clean.trim_matches(|c: char| !c.is_alphanumeric());
            clean.len() > 2 && !is_stop_word(clean)
        })
        .count();
    let density_score = (content_words as f64 / word_count as f64).min(1.0);

    // Factor 3: Length appropriateness
    let length_score = if word_count >= 20 {
        1.0
    } else if word_count >= 10 {
        0.8
    } else if word_count >= 5 {
        0.5
    } else {
        0.2
    };

    // Factor 4: Character variety (penalize repetitive text)
    let unique_chars: HashSet<char> = text.chars().filter(|c| c.is_alphanumeric()).collect();
    let variety_score = (unique_chars.len() as f64 / 26.0).min(1.0);

    // Combine factors
    let score =
        (word_len_score * 0.25 + density_score * 0.35 + length_score * 0.25 + variety_score * 0.15)
            .min(1.0);

    debug!(
        word_len_score = word_len_score,
        density_score = density_score,
        length_score = length_score,
        variety_score = variety_score,
        final_score = score,
        "Text quality calculated"
    );

    score
}

/// Check if a word is a common stop word
fn is_stop_word(word: &str) -> bool {
    const STOP_WORDS: &[&str] = &[
        "the",
        "a",
        "an",
        "and",
        "or",
        "but",
        "in",
        "on",
        "at",
        "to",
        "for",
        "of",
        "with",
        "by",
        "from",
        "as",
        "is",
        "was",
        "are",
        "were",
        "been",
        "be",
        "have",
        "has",
        "had",
        "do",
        "does",
        "did",
        "will",
        "would",
        "could",
        "should",
        "may",
        "might",
        "must",
        "can",
        "this",
        "that",
        "these",
        "those",
        "it",
        "its",
        "he",
        "she",
        "they",
        "them",
        "their",
        "we",
        "us",
        "our",
        "you",
        "your",
        "i",
        "my",
        "me",
        "not",
        "no",
        "yes",
        "all",
        "any",
        "some",
        "such",
        "than",
        "too",
        "very",
        "just",
        "about",
        "into",
        "over",
        "after",
        "before",
        "between",
        "under",
        "above",
        "below",
        "up",
        "down",
        "out",
        "off",
        "through",
        "during",
        "here",
        "there",
        "where",
        "when",
        "how",
        "what",
        "which",
        "who",
        "whom",
        "why",
        "if",
        "then",
        "else",
        "so",
        "because",
        "while",
        "although",
        "though",
        "unless",
        "until",
        "whether",
        // UI-related stop words (common in OCR)
        "file",
        "edit",
        "view",
        "window",
        "help",
        "menu",
        "new",
        "open",
        "save",
        "close",
        "copy",
        "paste",
        "cut",
        "undo",
        "redo",
        "find",
        "replace",
        "settings",
        "preferences",
        "options",
        "tools",
        "format",
        "insert",
    ];

    STOP_WORDS.contains(&word.to_lowercase().as_str())
}

/// Prepare enhanced text for embedding by combining summary and keywords
pub fn prepare_enhanced_text(
    app_name: &str,
    window_title: Option<&str>,
    ocr_text: &str,
) -> (String, SummaryResult) {
    // First, summarize the OCR text
    let summary_result = summarize_text(ocr_text, MAX_SUMMARY_LENGTH);

    // Build enhanced text
    let mut parts = Vec::new();

    if !app_name.is_empty() {
        parts.push(format!("App: {}", app_name));
    }

    if let Some(title) = window_title {
        if !title.is_empty() {
            parts.push(format!("Window: {}", title));
        }
    }

    // Add keywords if we have them
    if !summary_result.keywords.is_empty() {
        parts.push(format!("Topics: {}", summary_result.keywords.join(", ")));
    }

    // Add the summary as main content
    if !summary_result.summary.is_empty() {
        parts.push(format!("Content: {}", summary_result.summary));
    }

    let enhanced_text = parts.join("\n");

    (enhanced_text, summary_result)
}

// ============================================================================
// YAKE KEYWORD EXTRACTION
// ============================================================================
//
// YAKE (Yet Another Keyword Extractor) is an unsupervised, corpus-independent
// keyword extraction algorithm. It uses statistical text features to identify
// relevant keywords without requiring ML models.
//
// Features used:
// - Term frequency (capped to avoid common words dominating)
// - Term position (words at beginning are often more important)
// - Word casing (ALL CAPS or TitleCase may indicate importance)
// - Term relatedness to context (co-occurrence with other terms)
// - Word length normalization

/// YAKE keyword extraction result
#[derive(Debug, Clone)]
pub struct YakeKeyword {
    /// The keyword or keyphrase
    pub keyword: String,
    /// YAKE score (lower is better - more relevant)
    pub score: f64,
}

/// Configuration for YAKE extraction
#[derive(Debug, Clone)]
pub struct YakeConfig {
    /// Maximum number of keywords to return
    pub max_keywords: usize,
    /// Maximum n-gram size (1 = single words, 2 = two-word phrases, etc.)
    pub max_ngram_size: usize,
    /// Deduplication threshold (0.0-1.0) - higher removes more duplicates
    pub dedup_threshold: f64,
    /// Window size for co-occurrence
    pub window_size: usize,
}

impl Default for YakeConfig {
    fn default() -> Self {
        Self {
            max_keywords: 10,
            max_ngram_size: 2,
            dedup_threshold: 0.9,
            window_size: 2,
        }
    }
}

/// Extract keywords using YAKE algorithm
pub fn extract_yake_keywords(text: &str, config: &YakeConfig) -> Vec<YakeKeyword> {
    let text = text.trim();
    if text.is_empty() {
        return Vec::new();
    }

    // Tokenize into words with position tracking
    let words = tokenize_with_positions(text);
    if words.is_empty() {
        return Vec::new();
    }

    // Calculate word statistics
    let word_stats = calculate_word_stats(&words);

    // Calculate co-occurrence for context relevance
    let cooccurrence = calculate_cooccurrence(&words, config.window_size);

    // Score individual words
    let word_scores = score_words(&word_stats, &cooccurrence, words.len());

    // Generate n-grams and score them
    let mut candidates: Vec<YakeKeyword> = Vec::new();

    // Single words (1-grams)
    for (word, score) in &word_scores {
        if !is_stop_word(word) && word.len() > 2 {
            candidates.push(YakeKeyword {
                keyword: word.clone(),
                score: *score,
            });
        }
    }

    // N-grams (2+)
    if config.max_ngram_size > 1 {
        let ngrams = generate_ngrams(&words, config.max_ngram_size, &word_scores);
        candidates.extend(ngrams);
    }

    // Sort by score (lower is better in YAKE)
    candidates.sort_by(|a, b| {
        a.score
            .partial_cmp(&b.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    // Deduplicate overlapping keywords
    let deduped = deduplicate_keywords(candidates, config.dedup_threshold);

    // Return top keywords
    deduped.into_iter().take(config.max_keywords).collect()
}

/// Word with position information
#[derive(Debug, Clone)]
struct WordPosition {
    word: String,
    original: String, // Original casing
    position: usize,
    sentence_idx: usize,
}

/// Statistics for a word
#[derive(Debug, Clone, Default)]
struct WordStats {
    frequency: usize,
    positions: Vec<usize>,
    sentence_indices: Vec<usize>,
    uppercase_count: usize,
    titlecase_count: usize,
}

fn tokenize_with_positions(text: &str) -> Vec<WordPosition> {
    let mut words = Vec::new();
    let mut position = 0;
    let mut sentence_idx = 0;

    for sentence in text.split(|c| matches!(c, '.' | '!' | '?')) {
        for word in sentence.split_whitespace() {
            let cleaned = word.trim_matches(|c: char| !c.is_alphanumeric());
            if !cleaned.is_empty() && cleaned.len() > 1 {
                words.push(WordPosition {
                    word: cleaned.to_lowercase(),
                    original: cleaned.to_string(),
                    position,
                    sentence_idx,
                });
                position += 1;
            }
        }
        sentence_idx += 1;
    }

    words
}

fn calculate_word_stats(words: &[WordPosition]) -> HashMap<String, WordStats> {
    let mut stats: HashMap<String, WordStats> = HashMap::new();

    for wp in words {
        let entry = stats.entry(wp.word.clone()).or_default();
        entry.frequency += 1;
        entry.positions.push(wp.position);
        entry.sentence_indices.push(wp.sentence_idx);

        // Track casing
        if wp
            .original
            .chars()
            .all(|c| c.is_uppercase() || !c.is_alphabetic())
            && wp.original.chars().any(|c| c.is_alphabetic())
        {
            entry.uppercase_count += 1;
        } else if wp
            .original
            .chars()
            .next()
            .map(|c| c.is_uppercase())
            .unwrap_or(false)
            && wp
                .original
                .chars()
                .skip(1)
                .all(|c| c.is_lowercase() || !c.is_alphabetic())
        {
            entry.titlecase_count += 1;
        }
    }

    stats
}

fn calculate_cooccurrence(
    words: &[WordPosition],
    window_size: usize,
) -> HashMap<String, HashSet<String>> {
    let mut cooccur: HashMap<String, HashSet<String>> = HashMap::new();

    for (i, wp) in words.iter().enumerate() {
        let start = i.saturating_sub(window_size);
        let end = (i + window_size + 1).min(words.len());

        let neighbors: HashSet<String> = words[start..end]
            .iter()
            .filter(|w| w.word != wp.word)
            .map(|w| w.word.clone())
            .collect();

        cooccur
            .entry(wp.word.clone())
            .or_default()
            .extend(neighbors);
    }

    cooccur
}

fn score_words(
    stats: &HashMap<String, WordStats>,
    cooccurrence: &HashMap<String, HashSet<String>>,
    total_words: usize,
) -> HashMap<String, f64> {
    let max_freq = stats.values().map(|s| s.frequency).max().unwrap_or(1) as f64;
    let total_words_f = total_words as f64;

    stats
        .iter()
        .map(|(word, stat)| {
            // Term frequency component (capped)
            let tf = (stat.frequency as f64).min(max_freq * 0.5);
            let tf_score = tf / max_freq;

            // Position component (earlier words get lower score = better)
            let avg_position =
                stat.positions.iter().sum::<usize>() as f64 / stat.positions.len() as f64;
            let position_score = avg_position / total_words_f;

            // Spread component (appearing in multiple sentences is good)
            let unique_sentences: HashSet<_> = stat.sentence_indices.iter().collect();
            let spread_score = 1.0 / (unique_sentences.len() as f64 + 1.0);

            // Case component (UPPERCASE or TitleCase may indicate importance)
            let case_boost = if stat.uppercase_count > 0 {
                0.8
            } else if stat.titlecase_count > stat.frequency / 2 {
                0.9
            } else {
                1.0
            };

            // Co-occurrence diversity (words that appear with many different words are less specific)
            let cooccur_count = cooccurrence.get(word).map(|s| s.len()).unwrap_or(0);
            let cooccur_score = (cooccur_count as f64 / (total_words_f + 1.0)).min(1.0);

            // Word length normalization (very short or very long words penalized)
            let len = word.len() as f64;
            let len_score = if (4.0..=15.0).contains(&len) {
                1.0
            } else if (3.0..=20.0).contains(&len) {
                1.2
            } else {
                1.5
            };

            // Final YAKE score (lower is better)
            let score =
                (tf_score * 0.3 + position_score * 0.2 + spread_score * 0.2 + cooccur_score * 0.3)
                    * case_boost
                    * len_score;

            (word.clone(), score)
        })
        .collect()
}

fn generate_ngrams(
    words: &[WordPosition],
    max_n: usize,
    word_scores: &HashMap<String, f64>,
) -> Vec<YakeKeyword> {
    let mut ngrams = Vec::new();

    for n in 2..=max_n {
        for window in words.windows(n) {
            // Skip if any word is a stop word
            if window.iter().any(|w| is_stop_word(&w.word)) {
                continue;
            }

            // Skip if words are from different sentences
            if window.first().map(|w| w.sentence_idx) != window.last().map(|w| w.sentence_idx) {
                continue;
            }

            let phrase: String = window
                .iter()
                .map(|w| w.word.as_str())
                .collect::<Vec<_>>()
                .join(" ");

            // Score n-gram as product of individual word scores (with adjustment)
            let score: f64 = window
                .iter()
                .map(|w| word_scores.get(&w.word).copied().unwrap_or(1.0))
                .product::<f64>()
                .powf(1.0 / n as f64); // Geometric mean

            ngrams.push(YakeKeyword {
                keyword: phrase,
                score: score * 0.9, // Slight boost for phrases
            });
        }
    }

    ngrams
}

fn deduplicate_keywords(keywords: Vec<YakeKeyword>, threshold: f64) -> Vec<YakeKeyword> {
    let mut result: Vec<YakeKeyword> = Vec::new();

    for kw in keywords {
        let is_duplicate = result.iter().any(|existing| {
            let similarity = jaccard_similarity(&kw.keyword, &existing.keyword);
            similarity > threshold
        });

        if !is_duplicate {
            result.push(kw);
        }
    }

    result
}

fn jaccard_similarity(a: &str, b: &str) -> f64 {
    let set_a: HashSet<&str> = a.split_whitespace().collect();
    let set_b: HashSet<&str> = b.split_whitespace().collect();

    if set_a.is_empty() && set_b.is_empty() {
        return 1.0;
    }

    let intersection = set_a.intersection(&set_b).count();
    let union = set_a.union(&set_b).count();

    if union == 0 {
        0.0
    } else {
        intersection as f64 / union as f64
    }
}

// ============================================================================
// NAMED ENTITY RECOGNITION (NER)
// ============================================================================
//
// Rule-based NER extraction using regex patterns. Extracts:
// - Email addresses
// - URLs and domains
// - File paths (Unix and Windows)
// - Dates (various formats)
// - Times
// - Programming languages/frameworks
// - GitHub repositories
// - Version numbers
// - IP addresses
// - Money amounts

/// Types of named entities that can be extracted
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum EntityType {
    Email,
    Url,
    FilePath,
    Date,
    Time,
    ProgrammingLanguage,
    Framework,
    GitHubRepo,
    Version,
    IpAddress,
    Money,
    Person,
    Organization,
    TechTerm,
}

impl EntityType {
    pub fn as_str(&self) -> &'static str {
        match self {
            EntityType::Email => "email",
            EntityType::Url => "url",
            EntityType::FilePath => "file_path",
            EntityType::Date => "date",
            EntityType::Time => "time",
            EntityType::ProgrammingLanguage => "programming_language",
            EntityType::Framework => "framework",
            EntityType::GitHubRepo => "github_repo",
            EntityType::Version => "version",
            EntityType::IpAddress => "ip_address",
            EntityType::Money => "money",
            EntityType::Person => "person",
            EntityType::Organization => "organization",
            EntityType::TechTerm => "tech_term",
        }
    }
}

/// An extracted named entity
#[derive(Debug, Clone)]
pub struct NamedEntity {
    /// The entity type
    pub entity_type: EntityType,
    /// The extracted value
    pub value: String,
    /// Normalized/canonical form (e.g., lowercase email)
    pub normalized: String,
    /// Start position in original text
    pub start: usize,
    /// End position in original text
    pub end: usize,
    /// Confidence score (0.0-1.0)
    pub confidence: f64,
}

/// NER extraction result
#[derive(Debug, Clone, Default)]
pub struct NerResult {
    /// All extracted entities
    pub entities: Vec<NamedEntity>,
    /// Entities grouped by type
    pub by_type: HashMap<EntityType, Vec<NamedEntity>>,
}

impl NerResult {
    /// Get entities of a specific type
    pub fn get(&self, entity_type: EntityType) -> &[NamedEntity] {
        self.by_type
            .get(&entity_type)
            .map(|v| v.as_slice())
            .unwrap_or(&[])
    }

    /// Check if any entities were found
    pub fn is_empty(&self) -> bool {
        self.entities.is_empty()
    }

    /// Get count of all entities
    pub fn len(&self) -> usize {
        self.entities.len()
    }

    /// Get unique entity values for a type
    pub fn unique_values(&self, entity_type: EntityType) -> Vec<String> {
        self.by_type
            .get(&entity_type)
            .map(|entities| {
                let mut values: Vec<String> =
                    entities.iter().map(|e| e.normalized.clone()).collect();
                values.sort();
                values.dedup();
                values
            })
            .unwrap_or_default()
    }
}

// Compiled regex patterns (lazy initialized)
static EMAIL_REGEX: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}").unwrap());

static URL_REGEX: Lazy<Regex> = Lazy::new(|| {
    // Match URLs - simplified to avoid quote escaping issues
    Regex::new(r"https?://[^\s<>]+|www\.[^\s<>]+").unwrap()
});

static UNIX_PATH_REGEX: Lazy<Regex> = Lazy::new(|| {
    // Match Unix file paths like /Users/nick/file.txt
    Regex::new(r"(?:^|[\s(])(/(?:[a-zA-Z0-9._-]+/)+[a-zA-Z0-9._-]+(?:\.[a-zA-Z0-9]+)?)").unwrap()
});

static WINDOWS_PATH_REGEX: Lazy<Regex> = Lazy::new(|| {
    // Match Windows file paths like C:\Users\file.txt
    // Using non-raw string for proper backslash escaping
    Regex::new("[A-Z]:\\\\(?:[^\\s\\\\/:*?<>|]+\\\\)*[^\\s\\\\/:*?<>|]+").unwrap()
});

static DATE_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\b(\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{4}[-/]\d{1,2}[-/]\d{1,2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,?\s+\d{4})?|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?(?:,?\s+\d{4})?)\b").unwrap()
});

static TIME_REGEX: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\b(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)\b").unwrap());

static VERSION_REGEX: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\b[vV]?\d+\.\d+(?:\.\d+)?(?:-[a-zA-Z0-9.]+)?\b").unwrap());

static IP_REGEX: Lazy<Regex> = Lazy::new(|| Regex::new(r"\b(?:\d{1,3}\.){3}\d{1,3}\b").unwrap());

static MONEY_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"[$€£¥]\s*\d+(?:,\d{3})*(?:\.\d{2})?|\d+(?:,\d{3})*(?:\.\d{2})?\s*(?:USD|EUR|GBP|JPY)\b",
    )
    .unwrap()
});

static GITHUB_REPO_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\b([a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?/[a-zA-Z0-9._-]+)\b").unwrap()
});

/// Extract named entities from text
pub fn extract_entities(text: &str) -> NerResult {
    let mut result = NerResult::default();

    // Extract emails
    for cap in EMAIL_REGEX.find_iter(text) {
        let entity = NamedEntity {
            entity_type: EntityType::Email,
            value: cap.as_str().to_string(),
            normalized: cap.as_str().to_lowercase(),
            start: cap.start(),
            end: cap.end(),
            confidence: 0.95,
        };
        result.entities.push(entity.clone());
        result
            .by_type
            .entry(EntityType::Email)
            .or_default()
            .push(entity);
    }

    // Extract URLs
    for cap in URL_REGEX.find_iter(text) {
        let entity = NamedEntity {
            entity_type: EntityType::Url,
            value: cap.as_str().to_string(),
            normalized: cap.as_str().to_lowercase(),
            start: cap.start(),
            end: cap.end(),
            confidence: 0.95,
        };
        result.entities.push(entity.clone());
        result
            .by_type
            .entry(EntityType::Url)
            .or_default()
            .push(entity);
    }

    // Extract Unix file paths
    for cap in UNIX_PATH_REGEX.captures_iter(text) {
        if let Some(m) = cap.get(1) {
            let path = m.as_str();
            // Validate it looks like a real path
            if path.contains('/') && !path.starts_with("//") {
                let entity = NamedEntity {
                    entity_type: EntityType::FilePath,
                    value: path.to_string(),
                    normalized: path.to_string(),
                    start: m.start(),
                    end: m.end(),
                    confidence: 0.85,
                };
                result.entities.push(entity.clone());
                result
                    .by_type
                    .entry(EntityType::FilePath)
                    .or_default()
                    .push(entity);
            }
        }
    }

    // Extract Windows file paths
    for cap in WINDOWS_PATH_REGEX.find_iter(text) {
        let entity = NamedEntity {
            entity_type: EntityType::FilePath,
            value: cap.as_str().to_string(),
            normalized: cap.as_str().to_string(),
            start: cap.start(),
            end: cap.end(),
            confidence: 0.9,
        };
        result.entities.push(entity.clone());
        result
            .by_type
            .entry(EntityType::FilePath)
            .or_default()
            .push(entity);
    }

    // Extract dates
    for cap in DATE_REGEX.captures_iter(text) {
        if let Some(m) = cap.get(1) {
            let entity = NamedEntity {
                entity_type: EntityType::Date,
                value: m.as_str().to_string(),
                normalized: m.as_str().to_string(),
                start: m.start(),
                end: m.end(),
                confidence: 0.85,
            };
            result.entities.push(entity.clone());
            result
                .by_type
                .entry(EntityType::Date)
                .or_default()
                .push(entity);
        }
    }

    // Extract times
    for cap in TIME_REGEX.captures_iter(text) {
        if let Some(m) = cap.get(1) {
            let entity = NamedEntity {
                entity_type: EntityType::Time,
                value: m.as_str().to_string(),
                normalized: m.as_str().to_uppercase(),
                start: m.start(),
                end: m.end(),
                confidence: 0.9,
            };
            result.entities.push(entity.clone());
            result
                .by_type
                .entry(EntityType::Time)
                .or_default()
                .push(entity);
        }
    }

    // Extract versions
    for cap in VERSION_REGEX.find_iter(text) {
        let entity = NamedEntity {
            entity_type: EntityType::Version,
            value: cap.as_str().to_string(),
            normalized: cap.as_str().to_lowercase(),
            start: cap.start(),
            end: cap.end(),
            confidence: 0.85,
        };
        result.entities.push(entity.clone());
        result
            .by_type
            .entry(EntityType::Version)
            .or_default()
            .push(entity);
    }

    // Extract IP addresses
    for cap in IP_REGEX.find_iter(text) {
        // Validate IP address parts are 0-255
        let valid = cap
            .as_str()
            .split('.')
            .all(|part| part.parse::<u8>().is_ok());

        if valid {
            let entity = NamedEntity {
                entity_type: EntityType::IpAddress,
                value: cap.as_str().to_string(),
                normalized: cap.as_str().to_string(),
                start: cap.start(),
                end: cap.end(),
                confidence: 0.9,
            };
            result.entities.push(entity.clone());
            result
                .by_type
                .entry(EntityType::IpAddress)
                .or_default()
                .push(entity);
        }
    }

    // Extract money amounts
    for cap in MONEY_REGEX.find_iter(text) {
        let entity = NamedEntity {
            entity_type: EntityType::Money,
            value: cap.as_str().to_string(),
            normalized: cap.as_str().replace([',', ' '], ""),
            start: cap.start(),
            end: cap.end(),
            confidence: 0.9,
        };
        result.entities.push(entity.clone());
        result
            .by_type
            .entry(EntityType::Money)
            .or_default()
            .push(entity);
    }

    // Extract programming languages and frameworks
    extract_tech_entities(text, &mut result);

    // Extract potential GitHub repos (must have exactly one slash)
    for cap in GITHUB_REPO_REGEX.captures_iter(text) {
        if let Some(m) = cap.get(1) {
            let value = m.as_str();
            // Validate it looks like a repo (owner/repo pattern)
            let parts: Vec<&str> = value.split('/').collect();
            if parts.len() == 2
                && parts[0].len() >= 2
                && parts[1].len() >= 2
                && !parts[0].chars().all(|c| c.is_numeric())
                && !is_common_path_segment(parts[0])
            {
                let entity = NamedEntity {
                    entity_type: EntityType::GitHubRepo,
                    value: value.to_string(),
                    normalized: value.to_lowercase(),
                    start: m.start(),
                    end: m.end(),
                    confidence: 0.7, // Lower confidence as this pattern can match non-repos
                };
                result.entities.push(entity.clone());
                result
                    .by_type
                    .entry(EntityType::GitHubRepo)
                    .or_default()
                    .push(entity);
            }
        }
    }

    // Sort entities by position
    result.entities.sort_by_key(|e| e.start);

    result
}

fn is_common_path_segment(s: &str) -> bool {
    const COMMON_SEGMENTS: &[&str] = &[
        "src",
        "lib",
        "bin",
        "usr",
        "var",
        "etc",
        "home",
        "tmp",
        "opt",
        "api",
        "app",
        "web",
        "dist",
        "build",
        "node_modules",
        "packages",
    ];
    COMMON_SEGMENTS.contains(&s.to_lowercase().as_str())
}

fn extract_tech_entities(text: &str, result: &mut NerResult) {
    let text_lower = text.to_lowercase();

    // Programming languages
    const LANGUAGES: &[(&str, &[&str])] = &[
        ("Rust", &["rust", "rustc", "cargo"]),
        ("TypeScript", &["typescript", "tsx", ".ts"]),
        ("JavaScript", &["javascript", "nodejs", "node.js", ".js"]),
        ("Python", &["python", "python3", "pip", ".py"]),
        ("Go", &["golang", " go ", "go build"]),
        ("Java", &["java", "javac", ".java"]),
        ("C++", &["c++", "cpp", "g++"]),
        ("C#", &["c#", "csharp", ".cs"]),
        ("Swift", &["swift", "swiftui", ".swift"]),
        ("Kotlin", &["kotlin", ".kt"]),
        ("Ruby", &["ruby", "rails", ".rb"]),
        ("PHP", &["php", ".php"]),
        ("SQL", &["sql", "mysql", "postgresql", "sqlite"]),
    ];

    for (lang, patterns) in LANGUAGES {
        for pattern in *patterns {
            if text_lower.contains(pattern) {
                let entity = NamedEntity {
                    entity_type: EntityType::ProgrammingLanguage,
                    value: lang.to_string(),
                    normalized: lang.to_lowercase(),
                    start: 0,
                    end: 0,
                    confidence: 0.8,
                };
                // Only add if not already present
                if !result
                    .by_type
                    .get(&EntityType::ProgrammingLanguage)
                    .map(|v| v.iter().any(|e| e.normalized == entity.normalized))
                    .unwrap_or(false)
                {
                    result.entities.push(entity.clone());
                    result
                        .by_type
                        .entry(EntityType::ProgrammingLanguage)
                        .or_default()
                        .push(entity);
                }
                break;
            }
        }
    }

    // Frameworks and tools
    const FRAMEWORKS: &[(&str, &[&str])] = &[
        ("React", &["react", "reactjs", "react.js", "jsx"]),
        ("Vue", &["vue", "vuejs", "vue.js"]),
        ("Angular", &["angular", "@angular"]),
        ("Svelte", &["svelte", "sveltekit"]),
        ("Next.js", &["next.js", "nextjs", "next/"]),
        ("Express", &["express", "expressjs"]),
        ("Django", &["django"]),
        ("Flask", &["flask"]),
        ("FastAPI", &["fastapi"]),
        ("Spring", &["spring", "springboot"]),
        ("Rails", &["rails", "ruby on rails"]),
        ("Laravel", &["laravel"]),
        ("Docker", &["docker", "dockerfile", "docker-compose"]),
        ("Kubernetes", &["kubernetes", "k8s", "kubectl"]),
        (
            "AWS",
            &["aws", "amazon web services", "s3", "ec2", "lambda"],
        ),
        ("GCP", &["gcp", "google cloud", "gke"]),
        ("Azure", &["azure", "microsoft azure"]),
        ("Git", &["git", "github", "gitlab", "gitignore"]),
        ("Postgres", &["postgres", "postgresql", "psql"]),
        ("MongoDB", &["mongodb", "mongo"]),
        ("Redis", &["redis"]),
        ("Elasticsearch", &["elasticsearch", "elastic"]),
        ("Terraform", &["terraform", ".tf"]),
        ("Webpack", &["webpack"]),
        ("Vite", &["vite"]),
        ("Tailwind", &["tailwind", "tailwindcss"]),
    ];

    for (framework, patterns) in FRAMEWORKS {
        for pattern in *patterns {
            if text_lower.contains(pattern) {
                let entity = NamedEntity {
                    entity_type: EntityType::Framework,
                    value: framework.to_string(),
                    normalized: framework.to_lowercase(),
                    start: 0,
                    end: 0,
                    confidence: 0.8,
                };
                // Only add if not already present
                if !result
                    .by_type
                    .get(&EntityType::Framework)
                    .map(|v| v.iter().any(|e| e.normalized == entity.normalized))
                    .unwrap_or(false)
                {
                    result.entities.push(entity.clone());
                    result
                        .by_type
                        .entry(EntityType::Framework)
                        .or_default()
                        .push(entity);
                }
                break;
            }
        }
    }
}

/// Enhanced text preparation that includes NER and YAKE keywords
pub fn prepare_enhanced_text_v2(
    app_name: &str,
    window_title: Option<&str>,
    ocr_text: &str,
) -> EnhancedTextResult {
    // First, get basic summary
    let summary_result = summarize_text(ocr_text, MAX_SUMMARY_LENGTH);

    // Extract YAKE keywords
    let yake_config = YakeConfig::default();
    let yake_keywords = extract_yake_keywords(ocr_text, &yake_config);

    // Extract named entities
    let combined_text = format!("{} {} {}", app_name, window_title.unwrap_or(""), ocr_text);
    let ner_result = extract_entities(&combined_text);

    // Build enhanced text
    let mut parts = Vec::new();

    if !app_name.is_empty() {
        parts.push(format!("App: {}", app_name));
    }

    if let Some(title) = window_title {
        if !title.is_empty() {
            parts.push(format!("Window: {}", title));
        }
    }

    // Add YAKE keywords (top 5)
    let top_keywords: Vec<String> = yake_keywords
        .iter()
        .take(5)
        .map(|k| k.keyword.clone())
        .collect();
    if !top_keywords.is_empty() {
        parts.push(format!("Keywords: {}", top_keywords.join(", ")));
    }

    // Add programming languages
    let langs = ner_result.unique_values(EntityType::ProgrammingLanguage);
    if !langs.is_empty() {
        parts.push(format!("Languages: {}", langs.join(", ")));
    }

    // Add frameworks
    let frameworks = ner_result.unique_values(EntityType::Framework);
    if !frameworks.is_empty() {
        parts.push(format!("Frameworks: {}", frameworks.join(", ")));
    }

    // Add file paths (for context)
    let paths = ner_result.unique_values(EntityType::FilePath);
    if !paths.is_empty() {
        let paths_str: Vec<String> = paths.iter().take(3).cloned().collect();
        parts.push(format!("Files: {}", paths_str.join(", ")));
    }

    // Add the summary as main content
    if !summary_result.summary.is_empty() {
        parts.push(format!("Content: {}", summary_result.summary));
    }

    let enhanced_text = parts.join("\n");

    EnhancedTextResult {
        enhanced_text,
        summary: summary_result,
        keywords: yake_keywords,
        entities: ner_result,
    }
}

/// Result from enhanced text preparation v2
#[derive(Debug, Clone)]
pub struct EnhancedTextResult {
    /// The enhanced text ready for embedding
    pub enhanced_text: String,
    /// Summary result
    pub summary: SummaryResult,
    /// YAKE keywords with scores
    pub keywords: Vec<YakeKeyword>,
    /// Extracted named entities
    pub entities: NerResult,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_summarize_short_text() {
        let text = "This is a short text.";
        let result = summarize_text(text, 500);
        assert_eq!(result.summary, text);
    }

    #[test]
    fn test_summarize_long_text() {
        let text = "The quick brown fox jumps over the lazy dog. \
                    This sentence contains every letter of the alphabet. \
                    Pack my box with five dozen liquor jugs. \
                    How vexingly quick daft zebras jump. \
                    The five boxing wizards jump quickly. \
                    Sphinx of black quartz, judge my vow.";

        let result = summarize_text(text, 100);
        assert!(result.summary.len() <= 150); // Allow some flexibility
        assert!(!result.summary.is_empty());
    }

    #[test]
    fn test_extract_keywords() {
        let text = "React components and React hooks are fundamental to React development. \
                    JavaScript programming with TypeScript provides type safety.";

        let keywords = extract_keywords(text, 3);
        assert!(!keywords.is_empty());
        // "react" should be a top keyword
        assert!(keywords.iter().any(|k| k == "react"));
    }

    #[test]
    fn test_calculate_text_quality() {
        let good_text = "This is a well-formed sentence with meaningful content about programming.";
        let poor_text = "x x x x x";

        let good_score = calculate_text_quality(good_text);
        let poor_score = calculate_text_quality(poor_text);

        assert!(good_score > poor_score);
        assert!(good_score > 0.5);
    }

    #[test]
    fn test_is_stop_word() {
        assert!(is_stop_word("the"));
        assert!(is_stop_word("and"));
        assert!(is_stop_word("file")); // UI stop word
        assert!(!is_stop_word("programming"));
        assert!(!is_stop_word("react"));
    }

    #[test]
    fn test_prepare_enhanced_text() {
        let (enhanced, result) = prepare_enhanced_text(
            "Cursor",
            Some("main.rs - ritual-desktop"),
            "This is some code about Rust programming. The function handles database operations.",
        );

        assert!(enhanced.contains("App: Cursor"));
        assert!(enhanced.contains("Window:"));
        assert!(!result.summary.is_empty());
    }

    // ==== YAKE Keyword Extraction Tests ====

    #[test]
    fn test_yake_basic_extraction() {
        let text = "Machine learning algorithms are transforming artificial intelligence. \
                    Deep learning neural networks achieve state-of-the-art results in image recognition. \
                    Natural language processing enables machines to understand human language.";

        let config = YakeConfig::default();
        let keywords = extract_yake_keywords(text, &config);

        assert!(!keywords.is_empty());
        // Should extract relevant technical terms
        let keyword_strings: Vec<&str> = keywords.iter().map(|k| k.keyword.as_str()).collect();
        assert!(keyword_strings
            .iter()
            .any(|k| k.contains("learning") || k.contains("neural") || k.contains("language")));
    }

    #[test]
    fn test_yake_scores_meaningful_words_higher() {
        let text = "Rust programming language provides memory safety without garbage collection. \
                    Rust achieves this through its ownership system and borrow checker.";

        let config = YakeConfig::default();
        let keywords = extract_yake_keywords(text, &config);

        // Should extract meaningful technical terms
        assert!(!keywords.is_empty());
        let keyword_strings: Vec<&str> = keywords.iter().map(|k| k.keyword.as_str()).collect();
        // Should have some relevant words (rust, memory, ownership, etc.)
        assert!(keyword_strings.iter().any(|k| k.contains("rust")
            || k.contains("memory")
            || k.contains("ownership")
            || k.contains("programming")));
    }

    #[test]
    fn test_yake_ngrams() {
        let text = "React hooks provide a way to use state and other React features. \
                    React components can be functional or class-based.";

        let config = YakeConfig {
            max_ngram_size: 2,
            ..Default::default()
        };
        let keywords = extract_yake_keywords(text, &config);

        // Should have some single words
        assert!(keywords.iter().any(|k| !k.keyword.contains(' ')));
    }

    #[test]
    fn test_yake_empty_text() {
        let keywords = extract_yake_keywords("", &YakeConfig::default());
        assert!(keywords.is_empty());
    }

    #[test]
    fn test_yake_deduplication() {
        let text = "TypeScript TypeScript TypeScript is a typed superset of JavaScript. \
                    TypeScript adds optional static typing to JavaScript.";

        let config = YakeConfig {
            max_keywords: 10,
            dedup_threshold: 0.9,
            ..Default::default()
        };
        let keywords = extract_yake_keywords(text, &config);

        // Should not have duplicate entries for the same word
        let mut seen: HashSet<String> = HashSet::new();
        for kw in &keywords {
            // Each single-word keyword should appear at most once
            if !kw.keyword.contains(' ') {
                assert!(
                    seen.insert(kw.keyword.clone()),
                    "Duplicate keyword found: {}",
                    kw.keyword
                );
            }
        }
    }

    // ==== NER Extraction Tests ====

    #[test]
    fn test_ner_extract_email() {
        let text = "Contact us at support@example.com or sales@company.org for more info.";
        let result = extract_entities(text);

        let emails = result.get(EntityType::Email);
        assert_eq!(emails.len(), 2);
        assert!(emails.iter().any(|e| e.normalized == "support@example.com"));
        assert!(emails.iter().any(|e| e.normalized == "sales@company.org"));
    }

    #[test]
    fn test_ner_extract_url() {
        let text = "Visit https://www.example.com or http://api.test.org/v1 for documentation.";
        let result = extract_entities(text);

        let urls = result.get(EntityType::Url);
        assert_eq!(urls.len(), 2);
    }

    #[test]
    fn test_ner_extract_file_path_unix() {
        let text =
            "The config is at /Users/nick/projects/ritual/config.toml and logs at /var/log/app.log";
        let result = extract_entities(text);

        let paths = result.get(EntityType::FilePath);
        assert!(!paths.is_empty());
        assert!(paths.iter().any(|e| e.value.contains("config.toml")));
    }

    #[test]
    fn test_ner_extract_file_path_windows() {
        let text = "File located at C:\\Users\\nick\\Documents\\report.pdf";
        let result = extract_entities(text);

        let paths = result.get(EntityType::FilePath);
        assert!(!paths.is_empty());
        assert!(paths.iter().any(|e| e.value.contains("report.pdf")));
    }

    #[test]
    fn test_ner_extract_date() {
        let text = "Meeting on 2024-01-15, deadline is 12/25/2024, and Jan 1, 2025 is a holiday.";
        let result = extract_entities(text);

        let dates = result.get(EntityType::Date);
        assert!(dates.len() >= 2);
    }

    #[test]
    fn test_ner_extract_time() {
        let text = "Call at 10:30 AM or 14:00 for the standup.";
        let result = extract_entities(text);

        let times = result.get(EntityType::Time);
        assert!(!times.is_empty());
    }

    #[test]
    fn test_ner_extract_version() {
        let text = "Upgrade to v2.1.0 or version 3.0.0-beta.1 for new features.";
        let result = extract_entities(text);

        let versions = result.get(EntityType::Version);
        assert!(versions.len() >= 2);
    }

    #[test]
    fn test_ner_extract_ip_address() {
        let text = "Server at 192.168.1.100, backup at 10.0.0.1";
        let result = extract_entities(text);

        let ips = result.get(EntityType::IpAddress);
        assert_eq!(ips.len(), 2);
    }

    #[test]
    fn test_ner_extract_money() {
        let text = "Total cost: $1,250.00 or €500 EUR";
        let result = extract_entities(text);

        let money = result.get(EntityType::Money);
        assert!(!money.is_empty());
    }

    #[test]
    fn test_ner_extract_programming_languages() {
        let text = "This project uses Rust and TypeScript. Python scripts for automation.";
        let result = extract_entities(text);

        let langs = result.get(EntityType::ProgrammingLanguage);
        assert!(langs.len() >= 2);

        let lang_names: Vec<&str> = langs.iter().map(|e| e.normalized.as_str()).collect();
        assert!(lang_names.contains(&"rust"));
        assert!(lang_names.contains(&"typescript") || lang_names.contains(&"python"));
    }

    #[test]
    fn test_ner_extract_frameworks() {
        let text = "Frontend built with React and Next.js. Backend uses FastAPI with Docker.";
        let result = extract_entities(text);

        let frameworks = result.get(EntityType::Framework);
        assert!(frameworks.len() >= 2);

        let fw_names: Vec<&str> = frameworks.iter().map(|e| e.normalized.as_str()).collect();
        assert!(fw_names.contains(&"react"));
        assert!(
            fw_names.contains(&"docker")
                || fw_names.contains(&"fastapi")
                || fw_names.contains(&"next.js")
        );
    }

    #[test]
    fn test_ner_extract_github_repo() {
        let text = "Check out facebook/react and vercel/next.js repositories.";
        let result = extract_entities(text);

        let repos = result.get(EntityType::GitHubRepo);
        assert!(!repos.is_empty());
    }

    #[test]
    fn test_ner_empty_text() {
        let result = extract_entities("");
        assert!(result.is_empty());
    }

    #[test]
    fn test_ner_unique_values() {
        let text = "Using React and react-native, both from the React ecosystem.";
        let result = extract_entities(text);

        let unique = result.unique_values(EntityType::Framework);
        // Should deduplicate "react" even if mentioned multiple times
        let react_count = unique.iter().filter(|v| v.as_str() == "react").count();
        assert!(react_count <= 1);
    }

    // ==== Enhanced Text v2 Tests ====

    #[test]
    fn test_prepare_enhanced_text_v2() {
        let result = prepare_enhanced_text_v2(
            "Cursor",
            Some("vector.rs - ritual-db"),
            "This Rust code implements vector similarity search. \
             The function uses FastAPI for embeddings at https://api.example.com. \
             Contact dev@ritual.com for support.",
        );

        assert!(result.enhanced_text.contains("App: Cursor"));
        assert!(result.enhanced_text.contains("Window:"));

        // Should have extracted entities
        assert!(!result.entities.is_empty());

        // Should have YAKE keywords
        assert!(!result.keywords.is_empty());

        // Should detect Rust as a language
        let langs = result
            .entities
            .unique_values(EntityType::ProgrammingLanguage);
        assert!(langs.contains(&"rust".to_string()));
    }

    #[test]
    fn test_enhanced_text_v2_includes_entities() {
        let result = prepare_enhanced_text_v2(
            "VSCode",
            Some("main.py"),
            "Python Django application with PostgreSQL database.",
        );

        // Should include languages in the enhanced text
        assert!(
            result.enhanced_text.contains("Languages:") || result.enhanced_text.contains("python")
        );

        // Should include frameworks
        assert!(
            result.enhanced_text.contains("Frameworks:")
                || result.enhanced_text.contains("django")
                || result.enhanced_text.contains("postgres")
        );
    }
}
