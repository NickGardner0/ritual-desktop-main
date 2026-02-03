//! Thumbnail generation module for Ritual Recorder
//!
//! Creates smaller preview images for the timeline UI.
//! Thumbnails are stored separately and can be kept longer
//! than full video chunks (cold tier storage).

#![allow(dead_code)] // Some methods reserved for future use

use anyhow::{Context, Result};
use chrono::Utc;
use image::{imageops::FilterType, DynamicImage};
use std::path::PathBuf;
use tracing::{debug, trace};

/// Default thumbnail dimensions
const DEFAULT_WIDTH: u32 = 320;
const DEFAULT_HEIGHT: u32 = 180;

/// Thumbnail generator
pub struct ThumbnailGenerator {
    /// Output directory
    output_dir: PathBuf,
    /// Target width
    width: u32,
    /// Target height  
    height: u32,
    /// JPEG quality (1-100)
    quality: u8,
}

impl ThumbnailGenerator {
    /// Create a new thumbnail generator
    pub fn new(output_dir: PathBuf) -> Self {
        Self {
            output_dir,
            width: DEFAULT_WIDTH,
            height: DEFAULT_HEIGHT,
            quality: 75,
        }
    }

    /// Create with custom dimensions
    pub fn with_dimensions(mut self, width: u32, height: u32) -> Self {
        self.width = width;
        self.height = height;
        self
    }

    /// Create with custom JPEG quality
    pub fn with_quality(mut self, quality: u8) -> Self {
        self.quality = quality.min(100);
        self
    }

    /// Ensure output directory exists
    pub fn ensure_directory(&self) -> Result<()> {
        std::fs::create_dir_all(&self.output_dir)
            .context("Failed to create thumbnail directory")
    }

    /// Generate a thumbnail from an image
    pub fn generate(&self, image: &DynamicImage, timestamp: i64) -> Result<ThumbnailResult> {
        // Resize maintaining aspect ratio
        let thumbnail = image.resize(
            self.width,
            self.height,
            FilterType::Triangle, // Good balance of quality and speed
        );

        // Generate filename based on timestamp
        let dt = chrono::DateTime::from_timestamp_millis(timestamp)
            .unwrap_or_else(|| Utc::now());
        let filename = format!(
            "thumb_{}_{}.jpg",
            dt.format("%Y%m%d_%H%M%S"),
            timestamp % 1000 // Add milliseconds for uniqueness
        );
        let path = self.output_dir.join(&filename);

        // Save as JPEG
        let rgb_image = thumbnail.to_rgb8();
        let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(
            std::fs::File::create(&path)
                .context("Failed to create thumbnail file")?,
            self.quality,
        );
        encoder.encode_image(&rgb_image)
            .context("Failed to encode thumbnail")?;

        let file_size = std::fs::metadata(&path)?.len();
        let path_str = path.to_string_lossy().to_string();

        trace!(
            "Generated thumbnail: {} ({}x{}, {} bytes)",
            path_str,
            thumbnail.width(),
            thumbnail.height(),
            file_size
        );

        Ok(ThumbnailResult {
            path: path_str,
            width: thumbnail.width(),
            height: thumbnail.height(),
            file_size,
        })
    }

    /// Generate thumbnail and return as bytes (for in-memory use)
    pub fn generate_bytes(&self, image: &DynamicImage) -> Result<Vec<u8>> {
        let thumbnail = image.resize(
            self.width,
            self.height,
            FilterType::Triangle,
        );

        let rgb_image = thumbnail.to_rgb8();
        let mut buffer = Vec::new();
        let mut cursor = std::io::Cursor::new(&mut buffer);
        
        let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(
            &mut cursor,
            self.quality,
        );
        encoder.encode_image(&rgb_image)
            .context("Failed to encode thumbnail to bytes")?;

        Ok(buffer)
    }

    /// Delete old thumbnails beyond retention period
    pub fn cleanup_old_thumbnails(&self, max_age_days: u64) -> Result<CleanupResult> {
        let now = std::time::SystemTime::now();
        let max_age = std::time::Duration::from_secs(max_age_days * 24 * 60 * 60);
        let mut deleted_count = 0;
        let mut freed_bytes = 0u64;

        let entries = std::fs::read_dir(&self.output_dir)
            .context("Failed to read thumbnail directory")?;

        for entry in entries.flatten() {
            let path = entry.path();
            if !path.extension().map_or(false, |e| e == "jpg") {
                continue;
            }

            if let Ok(metadata) = entry.metadata() {
                if let Ok(modified) = metadata.modified() {
                    if let Ok(age) = now.duration_since(modified) {
                        if age > max_age {
                            freed_bytes += metadata.len();
                            if std::fs::remove_file(&path).is_ok() {
                                deleted_count += 1;
                                debug!("Deleted old thumbnail: {:?}", path);
                            }
                        }
                    }
                }
            }
        }

        Ok(CleanupResult {
            deleted_count,
            freed_bytes,
        })
    }
}

/// Result of thumbnail generation
#[derive(Debug, Clone)]
pub struct ThumbnailResult {
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub file_size: u64,
}

/// Result of cleanup operation
#[derive(Debug)]
pub struct CleanupResult {
    pub deleted_count: usize,
    pub freed_bytes: u64,
}

impl std::fmt::Display for CleanupResult {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let mb = self.freed_bytes as f64 / (1024.0 * 1024.0);
        write!(
            f,
            "Deleted {} thumbnails, freed {:.2} MB",
            self.deleted_count, mb
        )
    }
}

/// Get the total size of the thumbnail directory in bytes
pub fn get_thumbnail_dir_size(dir: &PathBuf) -> Result<u64> {
    let mut total = 0u64;
    
    if dir.exists() {
        for entry in std::fs::read_dir(dir)? {
            if let Ok(entry) = entry {
                if let Ok(metadata) = entry.metadata() {
                    total += metadata.len();
                }
            }
        }
    }
    
    Ok(total)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgba};

    fn create_test_image() -> DynamicImage {
        let img: ImageBuffer<Rgba<u8>, Vec<u8>> = ImageBuffer::from_fn(1920, 1080, |x, y| {
            Rgba([
                (x % 256) as u8,
                (y % 256) as u8,
                ((x + y) % 256) as u8,
                255,
            ])
        });
        DynamicImage::ImageRgba8(img)
    }

    #[test]
    fn test_generate_bytes() {
        let temp_dir = std::env::temp_dir().join("ritual_thumb_test");
        std::fs::create_dir_all(&temp_dir).unwrap();
        
        let generator = ThumbnailGenerator::new(temp_dir);
        let image = create_test_image();
        
        let bytes = generator.generate_bytes(&image).unwrap();
        assert!(!bytes.is_empty());
        
        // Verify it's a valid JPEG
        assert_eq!(&bytes[0..2], &[0xFF, 0xD8]); // JPEG magic bytes
    }
}
