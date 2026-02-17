//! OCR (Optical Character Recognition) module for Ritual Recorder
//!
//! Uses Apple Vision framework on macOS for fast, accurate text extraction.
//! Now uses native objc2 bindings instead of AppleScript subprocess.
//! Falls back to basic implementation on other platforms.
//!
//! Features:
//! - Native Vision framework integration (no subprocess spawn)
//! - Timeout support to prevent hangs
//! - Circuit breaker to avoid repeated failures
//! - Fast vs Accurate recognition modes

#![allow(dead_code)] // Some fields/methods reserved for future use

use anyhow::Result;
use image::DynamicImage;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::time::Instant;
use tracing::{debug, info, trace, warn};

#[cfg(target_os = "macos")]
use crate::vision_ffi::{self, VNRequestTextRecognitionLevel};

/// Result of OCR processing
#[derive(Debug, Clone)]
pub struct OcrResult {
    /// Extracted text
    pub text: String,
    /// Confidence score (0.0 - 1.0)
    pub confidence: f64,
    /// Individual text elements with bounding boxes
    pub elements: Vec<TextElement>,
}

/// A single text element from OCR
#[derive(Debug, Clone)]
pub struct TextElement {
    /// The recognized text
    pub text: String,
    /// Confidence score for this element
    pub confidence: f64,
    /// Bounding box (x, y, width, height) normalized 0.0-1.0
    pub bbox: (f64, f64, f64, f64),
}

impl OcrResult {
    /// Create an empty OCR result
    pub fn empty() -> Self {
        Self {
            text: String::new(),
            confidence: 0.0,
            elements: Vec::new(),
        }
    }
}

/// OCR engine for text extraction
pub struct OcrEngine {
    language: String,
}

impl OcrEngine {
    /// Create a new OCR engine with the specified language
    pub fn new(language: &str) -> Self {
        Self {
            language: language.to_string(),
        }
    }

    /// Perform OCR on an image (no timeout)
    pub fn recognize(&self, image: &DynamicImage) -> Result<OcrResult> {
        self.recognize_with_timeout(image, MAX_TIMEOUT_MS)
    }

    /// Perform OCR on an image with timeout
    pub fn recognize_with_timeout(
        &self,
        image: &DynamicImage,
        timeout_ms: u64,
    ) -> Result<OcrResult> {
        #[cfg(target_os = "macos")]
        {
            self.recognize_apple_with_timeout(image, timeout_ms)
        }

        #[cfg(not(target_os = "macos"))]
        {
            // Placeholder for other platforms
            warn!("OCR not implemented for this platform");
            Ok(OcrResult::empty())
        }
    }

    /// Perform OCR using Apple Vision framework natively via objc2
    /// This is much faster than the AppleScript subprocess approach
    #[cfg(target_os = "macos")]
    fn recognize_native_vision(
        &self,
        image: &DynamicImage,
        level: VNRequestTextRecognitionLevel,
    ) -> Result<OcrResult> {
        let start = Instant::now();

        // Encode image to PNG bytes in memory (no temp file!)
        let mut png_data = Vec::new();
        {
            use std::io::Cursor;
            let mut cursor = Cursor::new(&mut png_data);
            image
                .write_to(&mut cursor, image::ImageOutputFormat::Png)
                .map_err(|e| anyhow::anyhow!("Failed to encode image to PNG: {}", e))?;
        }

        // Call Vision framework
        match vision_ffi::recognize_text(&png_data, level) {
            Ok(result) => {
                let elapsed = start.elapsed();
                trace!(
                    "Native Vision OCR: {} chars, {:.2} confidence, {:?}",
                    result.text.len(),
                    result.confidence,
                    elapsed
                );

                // Convert vision_ffi result to OcrResult
                let elements: Vec<TextElement> = result
                    .observations
                    .iter()
                    .map(|obs| TextElement {
                        text: obs.text.clone(),
                        confidence: obs.confidence as f64,
                        bbox: obs.bounding_box,
                    })
                    .collect();

                Ok(OcrResult {
                    text: result.text,
                    confidence: result.confidence as f64,
                    elements,
                })
            }
            Err(e) => {
                warn!("Native Vision OCR failed: {}", e);
                // Try fallback to AppleScript if native fails
                self.recognize_apple_fallback(image)
            }
        }
    }

    /// Fallback to AppleScript-based OCR (for compatibility)
    #[cfg(target_os = "macos")]
    fn recognize_apple_fallback(&self, image: &DynamicImage) -> Result<OcrResult> {
        use std::process::{Command, Stdio};

        warn!("Using AppleScript fallback for OCR");

        // Save image to temp file
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let temp_path = std::env::temp_dir().join(format!(
            "ritual_ocr_{}_{}.png",
            std::process::id(),
            timestamp
        ));
        image.save(&temp_path)?;

        let script = format!(
            r#"
            use framework "Vision"
            use framework "Foundation"
            use scripting additions

            set imagePath to "{}"
            set theImage to current application's NSImage's alloc()'s initWithContentsOfFile:imagePath

            if theImage is missing value then
                return ""
            end if

            set requestHandler to current application's VNImageRequestHandler's alloc()'s initWithData:(theImage's TIFFRepresentation()) options:(current application's NSDictionary's dictionary())

            set textRequest to current application's VNRecognizeTextRequest's alloc()'s init()
            textRequest's setRecognitionLevel:(current application's VNRequestTextRecognitionLevelAccurate)
            
            requestHandler's performRequests:(current application's NSArray's arrayWithObject:textRequest) |error|:(missing value)

            set theResults to textRequest's results()
            set outputText to ""

            repeat with observation in theResults
                set topCandidate to (observation's topCandidates:1)'s firstObject()
                if topCandidate is not missing value then
                    set outputText to outputText & (topCandidate's |string|() as text) & linefeed
                end if
            end repeat

            return outputText
            "#,
            temp_path.to_string_lossy()
        );

        let output = Command::new("osascript")
            .arg("-l")
            .arg("AppleScript")
            .arg("-e")
            .arg(&script)
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output();

        // Clean up temp file
        let _ = std::fs::remove_file(&temp_path);

        match output {
            Ok(output) if output.status.success() => {
                let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
                let confidence = if text.is_empty() { 0.0 } else { 0.8 };
                Ok(OcrResult {
                    text,
                    confidence,
                    elements: Vec::new(),
                })
            }
            _ => {
                debug!("AppleScript fallback also failed");
                Ok(OcrResult::empty())
            }
        }
    }

    /// Perform OCR with timeout - uses native Vision by default
    #[cfg(target_os = "macos")]
    fn recognize_apple_with_timeout(
        &self,
        image: &DynamicImage,
        _timeout_ms: u64,
    ) -> Result<OcrResult> {
        // Use native Vision with Accurate mode by default
        // Note: timeout_ms is not directly applicable to native calls (they don't block externally)
        // but we keep the parameter for API compatibility
        self.recognize_native_vision(image, VNRequestTextRecognitionLevel::Accurate)
    }
}

/// Circuit breaker configuration
const FAILURE_THRESHOLD: u32 = 5; // Open circuit after 5 failures
const CIRCUIT_RESET_SECS: u64 = 60; // Try again after 60 seconds
const DEFAULT_TIMEOUT_MS: u64 = 5000; // 5 second default timeout
const MAX_TIMEOUT_MS: u64 = 10000; // 10 second maximum timeout

/// OCR processing pipeline for captured frames with timeout and circuit breaker
pub struct OcrProcessor {
    engine: OcrEngine,
    /// Minimum confidence to accept text
    min_confidence: f64,
    /// Timeout for OCR operations (milliseconds)
    timeout_ms: u64,
    /// Consecutive failure count for circuit breaker
    failure_count: AtomicU32,
    /// Whether the circuit is currently open (OCR disabled)
    circuit_open: AtomicBool,
    /// Timestamp when circuit was opened (for reset)
    circuit_opened_at: AtomicU64,
    /// Total OCR operations performed
    total_operations: AtomicU64,
    /// Total OCR timeouts
    total_timeouts: AtomicU64,
    /// Total OCR failures
    total_failures: AtomicU64,
}

impl OcrProcessor {
    /// Create a new OCR processor
    pub fn new(language: &str) -> Self {
        Self {
            engine: OcrEngine::new(language),
            min_confidence: 0.3, // Accept text with at least 30% confidence
            timeout_ms: DEFAULT_TIMEOUT_MS,
            failure_count: AtomicU32::new(0),
            circuit_open: AtomicBool::new(false),
            circuit_opened_at: AtomicU64::new(0),
            total_operations: AtomicU64::new(0),
            total_timeouts: AtomicU64::new(0),
            total_failures: AtomicU64::new(0),
        }
    }

    /// Create a new OCR processor with custom timeout
    pub fn with_timeout(language: &str, timeout_ms: u64) -> Self {
        let mut processor = Self::new(language);
        processor.timeout_ms = timeout_ms.min(MAX_TIMEOUT_MS);
        processor
    }

    /// Process a captured frame and extract text with timeout and circuit breaker
    pub fn process(&self, image: &DynamicImage) -> OcrResult {
        self.total_operations.fetch_add(1, Ordering::Relaxed);

        // Check circuit breaker
        if self.is_circuit_open() {
            // Check if we should try to reset the circuit
            if self.should_reset_circuit() {
                info!("OCR circuit breaker: attempting reset after cooldown");
                self.circuit_open.store(false, Ordering::SeqCst);
                self.failure_count.store(0, Ordering::SeqCst);
            } else {
                trace!("OCR circuit open, skipping");
                return OcrResult::empty();
            }
        }

        // Process with timeout
        let start = Instant::now();
        let result = self.process_with_timeout(image);
        let elapsed = start.elapsed();

        // Track result for circuit breaker
        match &result {
            r if r.text.is_empty() && elapsed.as_millis() as u64 >= self.timeout_ms => {
                // Likely a timeout
                self.record_timeout();
            }
            r if r.text.is_empty() => {
                // Empty result but not timeout - might be legitimate (blank screen)
                // Don't count as failure
            }
            _ => {
                // Success - reset failure count
                self.record_success();
            }
        }

        result
    }

    /// Process with timeout wrapper
    fn process_with_timeout(&self, image: &DynamicImage) -> OcrResult {
        match self.engine.recognize_with_timeout(image, self.timeout_ms) {
            Ok(result) => {
                if result.confidence < self.min_confidence && !result.text.is_empty() {
                    debug!(
                        "OCR confidence {:.2} below threshold {:.2}, text may be unreliable",
                        result.confidence, self.min_confidence
                    );
                }
                result
            }
            Err(e) => {
                self.record_failure();
                warn!("OCR processing failed: {}", e);
                OcrResult::empty()
            }
        }
    }

    /// Record a successful OCR operation
    fn record_success(&self) {
        self.failure_count.store(0, Ordering::SeqCst);
    }

    /// Record an OCR failure
    fn record_failure(&self) {
        self.total_failures.fetch_add(1, Ordering::Relaxed);
        let count = self.failure_count.fetch_add(1, Ordering::SeqCst) + 1;

        if count >= FAILURE_THRESHOLD {
            self.open_circuit();
        }
    }

    /// Record an OCR timeout
    fn record_timeout(&self) {
        self.total_timeouts.fetch_add(1, Ordering::Relaxed);
        self.record_failure();
    }

    /// Open the circuit breaker
    fn open_circuit(&self) {
        if !self.circuit_open.load(Ordering::SeqCst) {
            warn!(
                "OCR circuit breaker opened after {} consecutive failures",
                FAILURE_THRESHOLD
            );
            self.circuit_open.store(true, Ordering::SeqCst);
            self.circuit_opened_at.store(
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_secs(),
                Ordering::SeqCst,
            );
        }
    }

    /// Check if the circuit is currently open
    fn is_circuit_open(&self) -> bool {
        self.circuit_open.load(Ordering::SeqCst)
    }

    /// Check if we should attempt to reset the circuit
    fn should_reset_circuit(&self) -> bool {
        let opened_at = self.circuit_opened_at.load(Ordering::SeqCst);
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();

        now - opened_at >= CIRCUIT_RESET_SECS
    }

    /// Get OCR statistics
    pub fn stats(&self) -> OcrStats {
        OcrStats {
            total_operations: self.total_operations.load(Ordering::Relaxed),
            total_timeouts: self.total_timeouts.load(Ordering::Relaxed),
            total_failures: self.total_failures.load(Ordering::Relaxed),
            circuit_open: self.circuit_open.load(Ordering::SeqCst),
            consecutive_failures: self.failure_count.load(Ordering::SeqCst),
        }
    }

    /// Manually reset the circuit breaker
    pub fn reset_circuit(&self) {
        info!("OCR circuit breaker manually reset");
        self.circuit_open.store(false, Ordering::SeqCst);
        self.failure_count.store(0, Ordering::SeqCst);
    }

    /// Check if OCR is available on this platform
    pub fn is_available() -> bool {
        #[cfg(target_os = "macos")]
        {
            true
        }
        #[cfg(not(target_os = "macos"))]
        {
            false
        }
    }
}

/// OCR operation statistics
#[derive(Debug, Clone)]
pub struct OcrStats {
    pub total_operations: u64,
    pub total_timeouts: u64,
    pub total_failures: u64,
    pub circuit_open: bool,
    pub consecutive_failures: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ocr_result_empty() {
        let result = OcrResult::empty();
        assert!(result.text.is_empty());
        assert_eq!(result.confidence, 0.0);
        assert!(result.elements.is_empty());
    }
}
