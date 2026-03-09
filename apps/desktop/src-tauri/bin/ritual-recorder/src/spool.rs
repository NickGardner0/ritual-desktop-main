//! Recorder spool writer for single-writer architecture.
//!
//! Recorder writes OCR frame payloads to disk, and watcher ingests them into
//! memory.db. This keeps recorder out of the watcher write path.

use std::fs::File;
use std::io::Write;
use std::path::PathBuf;

use anyhow::{Context, Result};
use serde::Serialize;

use crate::config::StorageTier;
use crate::database::OcrFrame;

#[derive(Debug, Serialize)]
pub struct SpoolOcrFrame {
    pub timestamp: i64,
    pub activity_event_id: Option<i64>,
    pub app_bundle_id: String,
    pub app_name: String,
    pub window_title: Option<String>,
    pub ocr_text: String,
    pub ocr_confidence: f64,
    pub thumbnail_path: Option<String>,
    pub video_chunk_id: Option<i64>,
    pub frame_offset: Option<i64>,
    pub image_hash: String,
    pub storage_tier: String,
}

impl SpoolOcrFrame {
    pub fn from_ocr_frame(frame: &OcrFrame) -> Self {
        let storage_tier = match frame.storage_tier {
            StorageTier::Hot => "hot",
            StorageTier::Warm => "warm",
            StorageTier::Cold => "cold",
        }
        .to_string();

        Self {
            timestamp: frame.timestamp,
            activity_event_id: frame.activity_event_id,
            app_bundle_id: frame.app_bundle_id.clone(),
            app_name: frame.app_name.clone(),
            window_title: frame.window_title.clone(),
            ocr_text: frame.ocr_text.clone(),
            ocr_confidence: frame.ocr_confidence,
            thumbnail_path: frame.thumbnail_path.clone(),
            video_chunk_id: frame.video_chunk_id,
            frame_offset: frame.frame_offset,
            image_hash: frame.image_hash.clone(),
            storage_tier,
        }
    }
}

pub struct OcrSpoolWriter {
    spool_dir: PathBuf,
    sequence: u64,
}

impl OcrSpoolWriter {
    pub fn new(spool_dir: PathBuf) -> Result<Self> {
        std::fs::create_dir_all(&spool_dir).with_context(|| {
            format!("Failed to create spool directory: {}", spool_dir.display())
        })?;
        Ok(Self {
            spool_dir,
            sequence: 0,
        })
    }

    pub fn enqueue_frame(&mut self, frame: &OcrFrame) -> Result<PathBuf> {
        self.sequence = self.sequence.saturating_add(1);
        let ts = frame.timestamp.max(0);
        let file_name = format!("{:013}_{}_{}.json", ts, std::process::id(), self.sequence);
        let tmp_name = format!(".{}.tmp", file_name);

        let final_path = self.spool_dir.join(file_name);
        let tmp_path = self.spool_dir.join(tmp_name);

        let payload = SpoolOcrFrame::from_ocr_frame(frame);
        let json =
            serde_json::to_vec(&payload).context("Failed to serialize OCR frame spool payload")?;

        let mut file = File::create(&tmp_path)
            .with_context(|| format!("Failed to create spool temp file: {}", tmp_path.display()))?;
        file.write_all(&json)
            .with_context(|| format!("Failed to write spool temp file: {}", tmp_path.display()))?;
        file.sync_all()
            .with_context(|| format!("Failed to sync spool temp file: {}", tmp_path.display()))?;

        std::fs::rename(&tmp_path, &final_path).with_context(|| {
            format!(
                "Failed to finalize spool file {} -> {}",
                tmp_path.display(),
                final_path.display()
            )
        })?;

        Ok(final_path)
    }
}
