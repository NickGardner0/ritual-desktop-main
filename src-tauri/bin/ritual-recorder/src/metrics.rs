//! Performance metrics and instrumentation for Ritual Recorder
//!
//! Provides per-stage timing and counters to measure pipeline performance.
//! Uses tracing for structured logging with metrics fields.

#![allow(dead_code)] // Some methods reserved for future use

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tracing::info;

/// Atomic counters for tracking frame processing statistics
#[derive(Debug, Default)]
pub struct RecorderMetrics {
    // Frame counters
    pub frames_captured: AtomicU64,
    pub frames_stored: AtomicU64,
    pub frames_deduped: AtomicU64,
    
    // OCR counters
    pub ocr_success: AtomicU64,
    pub ocr_timeout: AtomicU64,
    pub ocr_fail: AtomicU64,
    pub ocr_skipped: AtomicU64,
    
    // Timing accumulators (in microseconds for precision)
    pub capture_time_us: AtomicU64,
    pub dedup_time_us: AtomicU64,
    pub ocr_time_us: AtomicU64,
    pub thumbnail_time_us: AtomicU64,
    pub db_insert_time_us: AtomicU64,
    
    // Stage call counts (for averaging)
    pub capture_count: AtomicU64,
    pub dedup_count: AtomicU64,
    pub ocr_count: AtomicU64,
    pub thumbnail_count: AtomicU64,
    pub db_insert_count: AtomicU64,
}

impl RecorderMetrics {
    pub fn new() -> Self {
        Self::default()
    }
    
    /// Increment frames captured counter
    pub fn inc_captured(&self) {
        self.frames_captured.fetch_add(1, Ordering::Relaxed);
    }
    
    /// Increment frames stored counter
    pub fn inc_stored(&self) {
        self.frames_stored.fetch_add(1, Ordering::Relaxed);
    }
    
    /// Increment frames deduped counter
    pub fn inc_deduped(&self) {
        self.frames_deduped.fetch_add(1, Ordering::Relaxed);
    }
    
    /// Record OCR success
    pub fn inc_ocr_success(&self) {
        self.ocr_success.fetch_add(1, Ordering::Relaxed);
    }
    
    /// Record OCR timeout
    pub fn inc_ocr_timeout(&self) {
        self.ocr_timeout.fetch_add(1, Ordering::Relaxed);
    }
    
    /// Record OCR failure
    pub fn inc_ocr_fail(&self) {
        self.ocr_fail.fetch_add(1, Ordering::Relaxed);
    }
    
    /// Record OCR skipped (circuit breaker open or disabled)
    pub fn inc_ocr_skipped(&self) {
        self.ocr_skipped.fetch_add(1, Ordering::Relaxed);
    }
    
    /// Record capture timing
    pub fn record_capture_time(&self, duration: Duration) {
        self.capture_time_us.fetch_add(duration.as_micros() as u64, Ordering::Relaxed);
        self.capture_count.fetch_add(1, Ordering::Relaxed);
    }
    
    /// Record dedup timing
    pub fn record_dedup_time(&self, duration: Duration) {
        self.dedup_time_us.fetch_add(duration.as_micros() as u64, Ordering::Relaxed);
        self.dedup_count.fetch_add(1, Ordering::Relaxed);
    }
    
    /// Record OCR timing
    pub fn record_ocr_time(&self, duration: Duration) {
        self.ocr_time_us.fetch_add(duration.as_micros() as u64, Ordering::Relaxed);
        self.ocr_count.fetch_add(1, Ordering::Relaxed);
    }
    
    /// Record thumbnail generation timing
    pub fn record_thumbnail_time(&self, duration: Duration) {
        self.thumbnail_time_us.fetch_add(duration.as_micros() as u64, Ordering::Relaxed);
        self.thumbnail_count.fetch_add(1, Ordering::Relaxed);
    }
    
    /// Record database insert timing
    pub fn record_db_insert_time(&self, duration: Duration) {
        self.db_insert_time_us.fetch_add(duration.as_micros() as u64, Ordering::Relaxed);
        self.db_insert_count.fetch_add(1, Ordering::Relaxed);
    }
    
    /// Get average capture time in milliseconds
    pub fn avg_capture_ms(&self) -> f64 {
        let count = self.capture_count.load(Ordering::Relaxed);
        if count == 0 {
            return 0.0;
        }
        let total_us = self.capture_time_us.load(Ordering::Relaxed);
        (total_us as f64 / count as f64) / 1000.0
    }
    
    /// Get average dedup time in milliseconds
    pub fn avg_dedup_ms(&self) -> f64 {
        let count = self.dedup_count.load(Ordering::Relaxed);
        if count == 0 {
            return 0.0;
        }
        let total_us = self.dedup_time_us.load(Ordering::Relaxed);
        (total_us as f64 / count as f64) / 1000.0
    }
    
    /// Get average OCR time in milliseconds
    pub fn avg_ocr_ms(&self) -> f64 {
        let count = self.ocr_count.load(Ordering::Relaxed);
        if count == 0 {
            return 0.0;
        }
        let total_us = self.ocr_time_us.load(Ordering::Relaxed);
        (total_us as f64 / count as f64) / 1000.0
    }
    
    /// Get average thumbnail time in milliseconds
    pub fn avg_thumbnail_ms(&self) -> f64 {
        let count = self.thumbnail_count.load(Ordering::Relaxed);
        if count == 0 {
            return 0.0;
        }
        let total_us = self.thumbnail_time_us.load(Ordering::Relaxed);
        (total_us as f64 / count as f64) / 1000.0
    }
    
    /// Get average DB insert time in milliseconds
    pub fn avg_db_insert_ms(&self) -> f64 {
        let count = self.db_insert_count.load(Ordering::Relaxed);
        if count == 0 {
            return 0.0;
        }
        let total_us = self.db_insert_time_us.load(Ordering::Relaxed);
        (total_us as f64 / count as f64) / 1000.0
    }
    
    /// Log current metrics summary
    pub fn log_summary(&self, elapsed_secs: f64) {
        let captured = self.frames_captured.load(Ordering::Relaxed);
        let stored = self.frames_stored.load(Ordering::Relaxed);
        let deduped = self.frames_deduped.load(Ordering::Relaxed);
        
        let fps = if elapsed_secs > 0.0 {
            captured as f64 / elapsed_secs
        } else {
            0.0
        };
        
        let dedup_pct = if captured > 0 {
            (deduped as f64 / captured as f64) * 100.0
        } else {
            0.0
        };
        
        let ocr_success = self.ocr_success.load(Ordering::Relaxed);
        let ocr_timeout = self.ocr_timeout.load(Ordering::Relaxed);
        let ocr_fail = self.ocr_fail.load(Ordering::Relaxed);
        let ocr_skipped = self.ocr_skipped.load(Ordering::Relaxed);
        
        // Log frame stats with structured fields
        info!(
            frames_captured = captured,
            frames_stored = stored,
            frames_deduped = deduped,
            dedup_pct = format!("{:.1}", dedup_pct),
            fps_avg = format!("{:.2}", fps),
            "Frame stats"
        );
        
        // Log OCR stats
        info!(
            ocr_success = ocr_success,
            ocr_timeout = ocr_timeout,
            ocr_fail = ocr_fail,
            ocr_skipped = ocr_skipped,
            "OCR stats"
        );
        
        // Log timing breakdown
        info!(
            capture_ms = format!("{:.2}", self.avg_capture_ms()),
            dedup_ms = format!("{:.2}", self.avg_dedup_ms()),
            ocr_ms = format!("{:.2}", self.avg_ocr_ms()),
            thumbnail_ms = format!("{:.2}", self.avg_thumbnail_ms()),
            db_insert_ms = format!("{:.2}", self.avg_db_insert_ms()),
            "Stage timing (avg)"
        );
    }
    
    /// Log final session summary
    pub fn log_final_summary(&self, elapsed_secs: f64) {
        let captured = self.frames_captured.load(Ordering::Relaxed);
        let stored = self.frames_stored.load(Ordering::Relaxed);
        let deduped = self.frames_deduped.load(Ordering::Relaxed);
        
        let ocr_success = self.ocr_success.load(Ordering::Relaxed);
        let ocr_timeout = self.ocr_timeout.load(Ordering::Relaxed);
        let ocr_fail = self.ocr_fail.load(Ordering::Relaxed);
        
        info!(
            "Session complete: {} captured, {} stored, {} deduped in {:.1}s",
            captured, stored, deduped, elapsed_secs
        );
        
        info!(
            "OCR totals: {} success, {} timeout, {} fail",
            ocr_success, ocr_timeout, ocr_fail
        );
        
        info!(
            "Avg timing: capture={:.1}ms, dedup={:.1}ms, ocr={:.1}ms, thumb={:.1}ms, db={:.1}ms",
            self.avg_capture_ms(),
            self.avg_dedup_ms(),
            self.avg_ocr_ms(),
            self.avg_thumbnail_ms(),
            self.avg_db_insert_ms()
        );
    }
}

/// RAII timer that records duration to a closure when dropped
pub struct PerfSpan<F: FnOnce(Duration)> {
    start: Instant,
    on_drop: Option<F>,
}

impl<F: FnOnce(Duration)> PerfSpan<F> {
    /// Create a new performance span with a callback
    pub fn new(on_drop: F) -> Self {
        Self {
            start: Instant::now(),
            on_drop: Some(on_drop),
        }
    }
    
    /// Get elapsed time without stopping the span
    pub fn elapsed(&self) -> Duration {
        self.start.elapsed()
    }
}

impl<F: FnOnce(Duration)> Drop for PerfSpan<F> {
    fn drop(&mut self) {
        if let Some(f) = self.on_drop.take() {
            f(self.start.elapsed());
        }
    }
}

/// Stage identifier for PerfSpan
#[derive(Debug, Clone, Copy)]
pub enum Stage {
    Capture,
    Dedup,
    Ocr,
    Thumbnail,
    DbInsert,
}

impl RecorderMetrics {
    /// Record timing for a specific stage
    pub fn record_stage_time(&self, stage: Stage, duration: Duration) {
        match stage {
            Stage::Capture => self.record_capture_time(duration),
            Stage::Dedup => self.record_dedup_time(duration),
            Stage::Ocr => self.record_ocr_time(duration),
            Stage::Thumbnail => self.record_thumbnail_time(duration),
            Stage::DbInsert => self.record_db_insert_time(duration),
        }
    }
}

/// Create a PerfSpan for a specific stage
pub fn timed_stage(metrics: std::sync::Arc<RecorderMetrics>, stage: Stage) -> PerfSpan<impl FnOnce(Duration)> {
    PerfSpan::new(move |duration| {
        metrics.record_stage_time(stage, duration);
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;
    
    #[test]
    fn test_metrics_counters() {
        let metrics = RecorderMetrics::new();
        
        metrics.inc_captured();
        metrics.inc_captured();
        metrics.inc_stored();
        metrics.inc_deduped();
        
        assert_eq!(metrics.frames_captured.load(Ordering::Relaxed), 2);
        assert_eq!(metrics.frames_stored.load(Ordering::Relaxed), 1);
        assert_eq!(metrics.frames_deduped.load(Ordering::Relaxed), 1);
    }
    
    #[test]
    fn test_timing_averages() {
        let metrics = RecorderMetrics::new();
        
        metrics.record_ocr_time(Duration::from_millis(100));
        metrics.record_ocr_time(Duration::from_millis(200));
        
        // Average should be 150ms
        let avg = metrics.avg_ocr_ms();
        assert!(avg > 140.0 && avg < 160.0, "Expected ~150ms, got {}", avg);
    }
    
    #[test]
    fn test_perf_span() {
        let metrics = std::sync::Arc::new(RecorderMetrics::new());
        
        {
            let m = metrics.clone();
            let _span = PerfSpan::new(move |d| m.record_capture_time(d));
            thread::sleep(Duration::from_millis(10));
        }
        
        let avg = metrics.avg_capture_ms();
        assert!(avg >= 10.0, "Expected >= 10ms, got {}", avg);
    }
}
