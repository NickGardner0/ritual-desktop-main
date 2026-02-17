//! Video encoding module for Ritual Recorder
//!
//! Uses FFmpeg to encode captured frames into H.265 video chunks.
//! Features:
//! - Chunked output for easy timeline navigation
//! - Configurable quality settings
//! - Async I/O for performance
//! - Auto-downloads FFmpeg if not installed

#![allow(dead_code)] // Some methods reserved for future use

use anyhow::{Context, Result};
use chrono::Utc;
use image::{DynamicImage, ImageFormat};
use std::io::Cursor;
use std::path::PathBuf;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tracing::{debug, error, info, warn};

use crate::config::{RecorderConfig, VideoQuality};
use crate::ffmpeg;

/// Maximum frames per second
const MAX_FPS: f64 = 30.0;

/// Video encoder using FFmpeg
pub struct VideoEncoder {
    /// Output directory for video chunks
    output_dir: PathBuf,
    /// FFmpeg child process
    ffmpeg: Option<Child>,
    /// FFmpeg stdin for frame input
    stdin: Option<ChildStdin>,
    /// Current video chunk path
    current_chunk_path: Option<String>,
    /// Current chunk ID in database
    current_chunk_id: Option<i64>,
    /// Frame count in current chunk
    frame_count: u64,
    /// Frames per video chunk
    frames_per_chunk: u64,
    /// Target FPS
    fps: f64,
    /// Video quality settings
    quality: VideoQuality,
    /// Monitor ID being recorded
    monitor_id: u32,
}

impl VideoEncoder {
    /// Create a new video encoder
    pub fn new(config: &RecorderConfig) -> Self {
        let fps = config.fps.min(MAX_FPS);
        let frames_per_chunk = (fps * config.video_chunk_duration_secs as f64).ceil() as u64;

        info!(
            "Initializing video encoder: {}fps, {} frames/chunk, {:?} quality",
            fps, frames_per_chunk, config.video_quality
        );

        Self {
            output_dir: config.video_dir.clone(),
            ffmpeg: None,
            stdin: None,
            current_chunk_path: None,
            current_chunk_id: None,
            frame_count: 0,
            frames_per_chunk,
            fps,
            quality: config.video_quality,
            monitor_id: config.monitor_id,
        }
    }

    /// Start a new video chunk
    pub async fn start_chunk(&mut self) -> Result<(String, i64)> {
        // Close existing chunk if any
        if self.ffmpeg.is_some() {
            self.finish_chunk().await?;
        }

        // Generate new chunk path
        let timestamp = Utc::now().format("%Y-%m-%d_%H-%M-%S");
        let filename = format!("monitor_{}_{}.mp4", self.monitor_id, timestamp);
        let chunk_path = self.output_dir.join(&filename);
        let chunk_path_str = chunk_path.to_string_lossy().to_string();

        info!("Starting new video chunk: {}", chunk_path_str);

        // Start FFmpeg process
        let ffmpeg = self.spawn_ffmpeg(&chunk_path_str).await?;
        
        self.current_chunk_path = Some(chunk_path_str.clone());
        self.frame_count = 0;
        self.ffmpeg = Some(ffmpeg.0);
        self.stdin = ffmpeg.1;

        // Chunk ID will be set by caller after DB insertion
        Ok((chunk_path_str, 0))
    }

    /// Set the database chunk ID for the current chunk
    pub fn set_chunk_id(&mut self, chunk_id: i64) {
        self.current_chunk_id = Some(chunk_id);
    }

    /// Write a frame to the current video chunk
    pub async fn write_frame(&mut self, image: &DynamicImage) -> Result<u64> {
        // Check if we need a new chunk
        if self.frame_count >= self.frames_per_chunk || self.stdin.is_none() {
            let (path, _) = self.start_chunk().await?;
            debug!("Started new chunk at frame {}: {}", self.frame_count, path);
        }

        // Encode frame as PNG
        let buffer = encode_frame_png(image)?;

        // Write to FFmpeg stdin
        if let Some(ref mut stdin) = self.stdin {
            stdin.write_all(&buffer).await
                .context("Failed to write frame to FFmpeg")?;
            
            self.frame_count += 1;

            // Flush periodically
            if self.frame_count % (self.fps.max(1.0) as u64) == 0 {
                stdin.flush().await?;
            }
        }

        Ok(self.frame_count)
    }

    /// Finish the current video chunk
    pub async fn finish_chunk(&mut self) -> Result<Option<(String, u64)>> {
        let stdin = self.stdin.take();
        let ffmpeg = self.ffmpeg.take();
        let chunk_path = self.current_chunk_path.take();
        let frame_count = self.frame_count;

        if let Some(mut child) = ffmpeg {
            // Close stdin to signal end of input
            drop(stdin);

            info!(
                "Finishing video chunk: {} ({} frames)",
                chunk_path.as_deref().unwrap_or("unknown"),
                frame_count
            );

            // Wait for FFmpeg to finish
            match child.wait().await {
                Ok(status) => {
                    if !status.success() {
                        error!("FFmpeg exited with status: {}", status);
                    } else {
                        debug!("FFmpeg finished successfully");
                    }
                }
                Err(e) => {
                    error!("Failed to wait for FFmpeg: {}", e);
                }
            }
        }

        self.current_chunk_id = None;
        self.frame_count = 0;

        if let Some(path) = chunk_path {
            Ok(Some((path, frame_count)))
        } else {
            Ok(None)
        }
    }

    /// Get the current chunk path
    pub fn current_chunk_path(&self) -> Option<&str> {
        self.current_chunk_path.as_deref()
    }

    /// Get the current chunk ID
    pub fn current_chunk_id(&self) -> Option<i64> {
        self.current_chunk_id
    }

    /// Get current frame count in chunk
    pub fn frame_count(&self) -> u64 {
        self.frame_count
    }

    /// Check if a chunk is currently being recorded
    pub fn is_recording(&self) -> bool {
        self.ffmpeg.is_some()
    }

    /// Spawn FFmpeg process with appropriate settings
    async fn spawn_ffmpeg(&self, output_path: &str) -> Result<(Child, Option<ChildStdin>)> {
        let ffmpeg_path = find_ffmpeg()?;
        let fps_str = self.fps.to_string();

        let mut command = Command::new(&ffmpeg_path);
        
        command
            // Input settings
            .arg("-f").arg("image2pipe")
            .arg("-vcodec").arg("png")
            .arg("-r").arg(&fps_str)
            .arg("-i").arg("-")
            // Video filter to ensure even dimensions (required for H.265)
            .arg("-vf").arg("pad=width=ceil(iw/2)*2:height=ceil(ih/2)*2")
            // Output codec settings
            .arg("-vcodec").arg("libx265")
            .arg("-tag:v").arg("hvc1")
            .arg("-preset").arg(self.quality.ffmpeg_preset())
            .arg("-crf").arg(self.quality.crf().to_string())
            // Enable fragmented MP4 for streaming/incomplete file reading
            .arg("-movflags").arg("frag_keyframe+empty_moov+default_base_moof")
            // Pixel format
            .arg("-pix_fmt").arg("yuv420p")
            // Output file
            .arg(output_path)
            // I/O settings
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());

        debug!("Spawning FFmpeg: {:?}", command);

        let mut child = command.spawn()
            .context("Failed to spawn FFmpeg")?;

        // Spawn stderr logger
        if let Some(stderr) = child.stderr.take() {
            tokio::spawn(async move {
                let reader = BufReader::new(stderr);
                let mut lines = reader.lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    debug!("FFmpeg: {}", line);
                }
            });
        }

        let stdin = child.stdin.take();
        
        Ok((child, stdin))
    }
}

impl Drop for VideoEncoder {
    fn drop(&mut self) {
        // Try to gracefully close FFmpeg
        if self.ffmpeg.is_some() {
            warn!("VideoEncoder dropped with active FFmpeg process");
        }
    }
}

/// Find FFmpeg binary path (auto-downloads if not found)
fn find_ffmpeg() -> Result<String> {
    // Use the ffmpeg module which handles auto-download
    let path = ffmpeg::ensure_ffmpeg()
        .context("FFmpeg is required for video encoding")?;
    
    Ok(path.to_string_lossy().to_string())
}

/// Encode an image frame as PNG bytes
fn encode_frame_png(image: &DynamicImage) -> Result<Vec<u8>> {
    let mut buffer = Vec::new();
    image.write_to(&mut Cursor::new(&mut buffer), ImageFormat::Png)
        .context("Failed to encode frame as PNG")?;
    Ok(buffer)
}

/// Video chunk metadata for database
#[derive(Debug, Clone)]
pub struct VideoChunkMeta {
    pub path: String,
    pub start_time: i64,
    pub end_time: i64,
    pub frame_count: u64,
    pub monitor_id: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_find_ffmpeg() {
        // This test will pass if FFmpeg is installed
        let result = find_ffmpeg();
        if result.is_ok() {
            println!("FFmpeg found at: {}", result.unwrap());
        } else {
            println!("FFmpeg not found (expected on some systems)");
        }
    }
}
