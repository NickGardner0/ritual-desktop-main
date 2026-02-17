//! Frame deduplication module for Ritual Recorder
//!
//! Uses multiple signals for intelligent deduplication:
//! 1. Perceptual hash (pHash) - visual similarity
//! 2. Window title changes - context switches
//! 3. App bundle ID changes - app switches
//! 4. OCR text changes - content changes
//!
//! This ensures we don't lose meaningful work transitions even when
//! the visual appearance is similar.

#![allow(dead_code)] // Some methods reserved for future use

use image::{DynamicImage, GenericImageView};
use sha2::{Digest, Sha256};
use std::collections::hash_map::DefaultHasher;
use std::collections::VecDeque;
use std::hash::{Hash, Hasher};
use tracing::{debug, trace};

/// Deduplication engine using multi-signal detection
pub struct FrameDeduplicator {
    /// Recent frame hashes for comparison
    recent_hashes: VecDeque<PerceptualHash>,
    /// Maximum number of recent hashes to keep
    max_history: usize,
    /// Threshold for considering frames similar (0.0 - 1.0)
    /// Lower = more strict (fewer duplicates detected)
    similarity_threshold: f64,
    /// Last frame timestamp
    last_frame_time: Option<i64>,
    /// Maximum time gap before forcing a frame (milliseconds)
    max_gap_ms: u64,
    /// Last window title (for context change detection)
    last_window_title: Option<String>,
    /// Last app bundle ID (for app change detection)
    last_app_bundle_id: Option<String>,
    /// Last OCR text hash (for content change detection)
    last_ocr_hash: Option<u64>,
}

/// Simple perceptual hash based on downsampled grayscale
#[derive(Clone)]
struct PerceptualHash {
    /// 8x8 = 64 bits of difference hash
    bits: u64,
    /// Average luminance (0-255) to catch brightness-only changes.
    avg_luma: u8,
    /// SHA256 of the full hash data for uniqueness
    sha: String,
}

impl PerceptualHash {
    /// Compute perceptual hash from an image
    fn from_image(image: &DynamicImage) -> Self {
        // Resize to 9x8 for difference hash computation
        let small = image.resize_exact(9, 8, image::imageops::FilterType::Triangle);
        let gray = small.to_luma8();

        // Compute difference hash (compare adjacent pixels)
        let mut bits: u64 = 0;
        for y in 0..8 {
            for x in 0..8 {
                let left = gray.get_pixel(x, y).0[0] as i32;
                let right = gray.get_pixel(x + 1, y).0[0] as i32;
                if left > right {
                    bits |= 1 << (y * 8 + x);
                }
            }
        }

        // Also compute SHA256 of downsampled image for the database
        let mut hasher = Sha256::new();
        hasher.update(&gray.as_raw());
        let sha = hex::encode(hasher.finalize());

        let avg_luma = (gray.as_raw().iter().map(|&v| v as u32).sum::<u32>()
            / gray.as_raw().len() as u32) as u8;

        Self {
            bits,
            avg_luma,
            sha,
        }
    }

    /// Compute Hamming distance between two hashes
    fn hamming_distance(&self, other: &PerceptualHash) -> u32 {
        (self.bits ^ other.bits).count_ones()
    }

    /// Get similarity score (0.0 - 1.0)
    fn similarity(&self, other: &PerceptualHash) -> f64 {
        let distance = self.hamming_distance(other);
        let hash_similarity = 1.0 - (distance as f64 / 64.0);
        let luma_delta = (self.avg_luma as i16 - other.avg_luma as i16).abs() as f64;
        let luma_similarity = 1.0 - (luma_delta / 255.0);
        // Weight dHash heavily, but include luminance to avoid false dedup on flat frames.
        (hash_similarity * 0.8) + (luma_similarity * 0.2)
    }

    /// Get the hash as a string
    fn to_string(&self) -> String {
        // Return SHA256 for database storage (more unique than difference hash)
        self.sha.clone()
    }
}

impl FrameDeduplicator {
    /// Create a new deduplicator
    ///
    /// # Arguments
    /// * `threshold` - Similarity threshold (0.0-1.0). 0.02 means 2% difference
    /// * `max_gap_secs` - Maximum seconds between stored frames
    pub fn new(threshold: f64, max_gap_secs: u64) -> Self {
        Self {
            recent_hashes: VecDeque::with_capacity(10),
            max_history: 10,
            similarity_threshold: threshold,
            last_frame_time: None,
            max_gap_ms: max_gap_secs * 1000,
            last_window_title: None,
            last_app_bundle_id: None,
            last_ocr_hash: None,
        }
    }

    /// Check if a frame should be stored based on similarity to recent frames
    /// (Legacy method for backward compatibility)
    ///
    /// Returns (should_store, hash_string)
    pub fn should_store(&mut self, image: &DynamicImage, timestamp: i64) -> (bool, String) {
        self.should_store_with_context(image, timestamp, None, None, None)
    }

    /// Check if a frame should be stored, considering multiple signals:
    /// 1. Visual similarity (pHash)
    /// 2. Window title changes
    /// 3. App bundle ID changes
    /// 4. OCR text changes
    ///
    /// Returns (should_store, hash_string, store_reason)
    pub fn should_store_with_context(
        &mut self,
        image: &DynamicImage,
        timestamp: i64,
        window_title: Option<&str>,
        app_bundle_id: Option<&str>,
        ocr_text: Option<&str>,
    ) -> (bool, String) {
        // Compute hash for current frame
        let current_hash = PerceptualHash::from_image(image);
        let hash_string = current_hash.to_string();

        // SIGNAL 1: Max gap exceeded - always store
        if let Some(last_time) = self.last_frame_time {
            let gap = timestamp - last_time;
            if gap as u64 >= self.max_gap_ms {
                debug!(
                    "Max frame gap exceeded ({:.1}s >= {:.1}s), forcing store",
                    gap as f64 / 1000.0,
                    self.max_gap_ms as f64 / 1000.0
                );
                self.update_context(
                    current_hash,
                    timestamp,
                    window_title,
                    app_bundle_id,
                    ocr_text,
                );
                return (true, hash_string);
            }
        } else {
            // First frame ever - always store
            debug!("First frame, storing");
            self.update_context(
                current_hash,
                timestamp,
                window_title,
                app_bundle_id,
                ocr_text,
            );
            return (true, hash_string);
        }

        // SIGNAL 2: App changed - always store
        if let Some(bundle_id) = app_bundle_id {
            if self.last_app_bundle_id.as_deref() != Some(bundle_id) {
                debug!(
                    "App changed: {:?} -> {}, forcing store",
                    self.last_app_bundle_id.as_deref(),
                    bundle_id
                );
                self.update_context(
                    current_hash,
                    timestamp,
                    window_title,
                    app_bundle_id,
                    ocr_text,
                );
                return (true, hash_string);
            }
        }

        // SIGNAL 3: Window title changed - always store
        if let Some(title) = window_title {
            if self.last_window_title.as_deref() != Some(title) {
                // Only trigger if title is meaningfully different (not just focus change)
                let is_meaningful_change = self.is_meaningful_title_change(title);
                if is_meaningful_change {
                    debug!(
                        "Window title changed: {:?} -> {}, forcing store",
                        self.last_window_title
                            .as_deref()
                            .map(|s| truncate_str(s, 50)),
                        truncate_str(title, 50)
                    );
                    self.update_context(
                        current_hash,
                        timestamp,
                        window_title,
                        app_bundle_id,
                        ocr_text,
                    );
                    return (true, hash_string);
                }
            }
        }

        // SIGNAL 4: OCR text changed significantly - always store
        if let Some(ocr) = ocr_text {
            if !ocr.is_empty() {
                let ocr_hash = hash_string_fast(ocr);
                if self.last_ocr_hash.is_some() && self.last_ocr_hash != Some(ocr_hash) {
                    // Check if the change is significant (not just minor text movement)
                    let is_significant = self.is_significant_ocr_change(ocr);
                    if is_significant {
                        debug!("OCR text changed significantly, forcing store");
                        self.update_context(
                            current_hash,
                            timestamp,
                            window_title,
                            app_bundle_id,
                            ocr_text,
                        );
                        return (true, hash_string);
                    }
                }
            }
        }

        // SIGNAL 5: Visual similarity check (pHash)
        let is_duplicate = self.recent_hashes.iter().any(|prev_hash| {
            let similarity = current_hash.similarity(prev_hash);

            trace!(
                "Frame comparison: similarity={:.4}, threshold={:.4}",
                similarity,
                1.0 - self.similarity_threshold
            );

            // If similarity is HIGH (above 1 - threshold), it's a duplicate
            // e.g., threshold=0.02 means frames must differ by at least 2%
            similarity > (1.0 - self.similarity_threshold)
        });

        if is_duplicate {
            trace!("Frame is visually similar, skipping");
            return (false, hash_string);
        }

        // Not a duplicate by any signal, store it
        debug!("Visual change detected, storing");
        self.update_context(
            current_hash,
            timestamp,
            window_title,
            app_bundle_id,
            ocr_text,
        );
        (true, hash_string)
    }

    /// Update all context tracking state
    fn update_context(
        &mut self,
        hash: PerceptualHash,
        timestamp: i64,
        window_title: Option<&str>,
        app_bundle_id: Option<&str>,
        ocr_text: Option<&str>,
    ) {
        self.add_to_history(hash);
        self.last_frame_time = Some(timestamp);

        if let Some(title) = window_title {
            self.last_window_title = Some(title.to_string());
        }

        if let Some(bundle_id) = app_bundle_id {
            self.last_app_bundle_id = Some(bundle_id.to_string());
        }

        if let Some(ocr) = ocr_text {
            if !ocr.is_empty() {
                self.last_ocr_hash = Some(hash_string_fast(ocr));
            }
        }
    }

    /// Check if a window title change is meaningful (not just focus flicker)
    fn is_meaningful_title_change(&self, new_title: &str) -> bool {
        match &self.last_window_title {
            None => true,
            Some(old_title) => {
                // Ignore if titles are very similar (e.g., just adding "- Focused")
                let similarity = string_similarity(old_title, new_title);
                // Consider meaningful if less than 90% similar
                similarity < 0.9
            }
        }
    }

    /// Check if OCR text change is significant
    fn is_significant_ocr_change(&self, _new_ocr: &str) -> bool {
        // For now, any OCR hash change is considered significant
        // Future: could compare word overlap or use edit distance
        true
    }

    /// Add hash to recent history
    fn add_to_history(&mut self, hash: PerceptualHash) {
        if self.recent_hashes.len() >= self.max_history {
            self.recent_hashes.pop_front();
        }
        self.recent_hashes.push_back(hash);
    }

    /// Reset the deduplicator state
    pub fn reset(&mut self) {
        self.recent_hashes.clear();
        self.last_frame_time = None;
        self.last_window_title = None;
        self.last_app_bundle_id = None;
        self.last_ocr_hash = None;
    }

    /// Get the hash of an image without checking duplicates
    pub fn compute_hash(&self, image: &DynamicImage) -> String {
        PerceptualHash::from_image(image).to_string()
    }

    /// Get the last stored app bundle ID
    pub fn last_app(&self) -> Option<&str> {
        self.last_app_bundle_id.as_deref()
    }

    /// Get the last stored window title
    pub fn last_title(&self) -> Option<&str> {
        self.last_window_title.as_deref()
    }
}

/// Fast string hashing for OCR text comparison
fn hash_string_fast(s: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    s.hash(&mut hasher);
    hasher.finish()
}

/// Truncate string for logging
fn truncate_str(s: &str, max_len: usize) -> String {
    if s.chars().count() <= max_len {
        s.to_string()
    } else {
        let mut truncated: String = s.chars().take(max_len).collect();
        truncated.push_str("...");
        truncated
    }
}

/// Simple string similarity based on character overlap
fn string_similarity(s1: &str, s2: &str) -> f64 {
    if s1 == s2 {
        return 1.0;
    }
    if s1.is_empty() || s2.is_empty() {
        return 0.0;
    }

    // Use Jaccard similarity on characters
    let chars1: std::collections::HashSet<char> = s1.chars().collect();
    let chars2: std::collections::HashSet<char> = s2.chars().collect();

    let intersection = chars1.intersection(&chars2).count();
    let union = chars1.union(&chars2).count();

    if union == 0 {
        0.0
    } else {
        intersection as f64 / union as f64
    }
}

/// Compare two images and return their similarity (0.0 - 1.0)
pub fn compare_images(image1: &DynamicImage, image2: &DynamicImage) -> f64 {
    let hash1 = PerceptualHash::from_image(image1);
    let hash2 = PerceptualHash::from_image(image2);
    hash1.similarity(&hash2)
}

/// Simple pixel-based comparison for exact match detection
/// Returns the percentage of pixels that differ
pub fn pixel_diff_percentage(image1: &DynamicImage, image2: &DynamicImage) -> f64 {
    if image1.dimensions() != image2.dimensions() {
        return 1.0; // Completely different if sizes don't match
    }

    let (width, height) = image1.dimensions();
    let total_pixels = (width * height) as f64;
    let mut diff_count = 0;

    for y in 0..height {
        for x in 0..width {
            let p1 = image1.get_pixel(x, y);
            let p2 = image2.get_pixel(x, y);

            // Compare RGB values (ignore alpha)
            if p1.0[0] != p2.0[0] || p1.0[1] != p2.0[1] || p1.0[2] != p2.0[2] {
                diff_count += 1;
            }
        }
    }

    diff_count as f64 / total_pixels
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgba};

    fn create_test_image(r: u8) -> DynamicImage {
        let img: ImageBuffer<Rgba<u8>, Vec<u8>> =
            ImageBuffer::from_fn(100, 100, |_, _| Rgba([r, 0, 0, 255]));
        DynamicImage::ImageRgba8(img)
    }

    #[test]
    fn test_identical_images_are_duplicates() {
        let mut dedup = FrameDeduplicator::new(0.02, 60);
        let image = create_test_image(100);

        // First frame should be stored
        let (should_store1, _) = dedup.should_store(&image, 0);
        assert!(should_store1);

        // Identical frame should not be stored
        let (should_store2, _) = dedup.should_store(&image, 1000);
        assert!(!should_store2);
    }

    #[test]
    fn test_different_images_are_not_duplicates() {
        let mut dedup = FrameDeduplicator::new(0.02, 60);

        let image1 = create_test_image(0);
        let image2 = create_test_image(255);

        let (should_store1, _) = dedup.should_store(&image1, 0);
        assert!(should_store1);

        let (should_store2, _) = dedup.should_store(&image2, 1000);
        assert!(should_store2);
    }

    #[test]
    fn test_max_gap_forces_storage() {
        let mut dedup = FrameDeduplicator::new(0.02, 2); // 2 second max gap
        let image = create_test_image(100);

        // First frame
        let (should_store1, _) = dedup.should_store(&image, 0);
        assert!(should_store1);

        // Same frame, within gap
        let (should_store2, _) = dedup.should_store(&image, 1000);
        assert!(!should_store2);

        // Same frame, after gap exceeded
        let (should_store3, _) = dedup.should_store(&image, 3000);
        assert!(should_store3);
    }

    #[test]
    fn test_rapid_app_switch_forces_storage_with_same_frame() {
        let mut dedup = FrameDeduplicator::new(0.02, 60);
        let image = create_test_image(100);

        let (store1, _) = dedup.should_store_with_context(
            &image,
            0,
            Some("Editor - file.rs"),
            Some("com.editor"),
            None,
        );
        assert!(store1);

        // Visually identical frame but app changed quickly.
        let (store2, _) = dedup.should_store_with_context(
            &image,
            500,
            Some("Browser - docs"),
            Some("com.browser"),
            None,
        );
        assert!(store2);
    }

    #[test]
    fn test_tab_churn_title_change_forces_storage() {
        let mut dedup = FrameDeduplicator::new(0.02, 60);
        let image = create_test_image(120);

        let (store1, _) = dedup.should_store_with_context(
            &image,
            0,
            Some("Example Domain"),
            Some("com.google.Chrome"),
            None,
        );
        assert!(store1);

        // Same app and same pixels, but active tab title changed.
        let (store2, _) = dedup.should_store_with_context(
            &image,
            700,
            Some("Ritual Documentation"),
            Some("com.google.Chrome"),
            None,
        );
        assert!(store2);
    }
}
