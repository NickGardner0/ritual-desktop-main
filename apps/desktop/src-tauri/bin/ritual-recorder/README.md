# Ritual Recorder

Screen recording with OCR for the Ritual self-tracking app.

## Features

- **Continuous Screen Capture**: Records your screen at configurable intervals (default 1 FPS)
- **OCR Text Extraction**: Uses Apple Vision framework to extract on-screen text
- **Frame Deduplication**: Intelligent detection of duplicate frames to save storage
- **Video Encoding**: H.265 video chunks via FFmpeg
- **Tiered Storage**: Hot/warm/cold storage tiers with automatic data migration
- **Privacy Controls**: Exclude sensitive apps and window titles

## Requirements

- macOS 12+ (for Apple Vision OCR)
- FFmpeg: `brew install ffmpeg`
- Rust 1.70+

## Building

```bash
./build.sh
```

Or manually:

```bash
cargo build --release
```

## Usage

### Basic Usage

```bash
# Start recording with defaults
ritual-recorder

# With custom paths
ritual-recorder \
  --database ~/.ritual/frames.db \
  --video-dir ~/.ritual/video \
  --thumbnail-dir ~/.ritual/thumbnails
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `--database` | `~/.ritual/frames.db` | Path to OCR/frames database |
| `--watcher-db` | `~/.ritual/watcher.db` | Path to watcher database (for activity correlation) |
| `--video-dir` | `~/.ritual/video` | Directory for video chunks |
| `--thumbnail-dir` | `~/.ritual/thumbnails` | Directory for thumbnails |
| `--capture-interval` | `1000` | Milliseconds between captures |
| `--thumbnail-interval` | `60000` | Milliseconds between thumbnail saves |
| `--video-quality` | `medium` | Quality preset: low, medium, high |
| `--video-chunk-duration` | `300` | Seconds per video chunk |
| `--monitor-id` | `0` | Monitor to capture (0 = primary) |
| `--disable-dedup` | false | Disable frame deduplication |
| `--dedup-threshold` | `0.02` | Dedup threshold (0.0-1.0) |
| `--max-frame-gap` | `60` | Max seconds between stored frames |
| `--disable-ocr` | false | Disable OCR text extraction |
| `--ocr-language` | `en-US` | OCR language code |
| `--storage-limit-gb` | `20` | Storage limit in GB (0 = unlimited) |
| `--excluded-apps` | | Comma-separated bundle IDs to exclude |
| `--verbose` | false | Enable debug logging |

### Commands

```bash
# List available monitors
ritual-recorder --list-monitors

# Show storage status
ritual-recorder --status

# Run storage maintenance only
ritual-recorder --maintenance
```

## Storage Tiers

| Tier | Age | Content |
|------|-----|---------|
| Hot | 0-7 days | Full video + OCR + thumbnails |
| Warm | 7-30 days | Compressed video + OCR + thumbnails |
| Cold | 30-90 days | OCR text + thumbnails only |

After 90 days, data is deleted (configurable).

## Video Quality Presets

| Preset | CRF | Max Height | Estimated Storage |
|--------|-----|------------|-------------------|
| low | 32 | 480p | ~3 GB/month |
| medium | 28 | 720p | ~8 GB/month |
| high | 23 | 1080p | ~15 GB/month |

## Database Schema

### ocr_frames
- `id`: Primary key
- `timestamp`: Unix milliseconds
- `activity_event_id`: Link to watcher activity
- `app_bundle_id`: App bundle identifier
- `app_name`: Application name
- `window_title`: Window title
- `ocr_text`: Extracted text
- `ocr_confidence`: OCR confidence (0-1)
- `thumbnail_path`: Path to thumbnail
- `video_chunk_id`: Link to video chunk
- `frame_offset`: Frame number in chunk
- `image_hash`: Perceptual hash for dedup
- `storage_tier`: hot/warm/cold

### video_chunks
- `id`: Primary key
- `file_path`: Path to MP4 file
- `start_time`: Chunk start timestamp
- `end_time`: Chunk end timestamp
- `frame_count`: Number of frames
- `file_size_bytes`: File size
- `monitor_id`: Monitor that was recorded
- `storage_tier`: hot/warm/cold

## Integration with Ritual

The recorder is designed to run as a sidecar process alongside the main Ritual app:

1. **Activity Correlation**: Links OCR frames to watcher activity events
2. **Shared Database**: Uses watcher.db for context, stores frames in frames.db
3. **Timeline UI**: Video chunks enable timeline scrubbing in the frontend

## License

MIT - See LICENSE in root directory.
