# Ritual Watcher v1 (macOS)

A privacy-focused computer activity tracker for macOS, inspired by [ActivityWatch](https://github.com/ActivityWatch/activitywatch).

## Features

- **Active Application Tracking**: Records which app is in focus (bundle ID, name, PID)
- **Window Title Tracking**: Captures window titles with privacy controls
- **Session Timing**: Tracks start/end timestamps for each activity segment
- **Privacy Controls**: 
  - Title modes: off, full, truncate, hash
  - Per-app exclusions
  - Local-only storage by default

## Architecture

```
┌─────────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Tauri Desktop App  │────▶│  ritual-watcher  │────▶│  SQLite (Local) │
│  (Frontend/Backend) │     │    (Sidecar)     │     │                 │
└─────────────────────┘     └──────────────────┘     └─────────────────┘
                                    │
                                    ▼
                            ┌──────────────────┐
                            │  FastAPI Backend │
                            │  (Daily Rollups) │
                            └──────────────────┘
                                    │
                            ┌───────┴───────┐
                            ▼               ▼
                      ┌──────────┐   ┌──────────────┐
                      │  Turso   │   │   Tinybird   │
                      │ (Cloud)  │   │ (Analytics)  │
                      └──────────┘   └──────────────┘
```

## Building

```bash
# Build the sidecar
cd apps/desktop/src-tauri/bin/ritual-watcher
chmod +x build.sh
./build.sh
```

## Usage

### From Tauri (recommended)

The watcher is managed by Tauri commands:

```typescript
// Start the watcher
await invoke('start_watcher', {
  config: {
    device_id: 'your-device-uuid',
    user_id: 'your-user-id',
    poll_interval_ms: 2000,
    title_mode: 'off',  // 'off' | 'full' | 'truncate' | 'hash'
    truncate_length: 80,
    excluded_bundle_ids: ['com.1password', 'com.apple.MobileSMS']
  }
});

// Stop the watcher
await invoke('stop_watcher');

// Check status
const status = await invoke<WatcherStatus>('get_watcher_status');
```

### Manual testing

```bash
~/.ritual/bin/ritual-watcher \
  --device-id test-device \
  --user-id test-user \
  --poll-interval 2000 \
  --title-mode off \
  --foreground
```

## Command Line Options

| Option | Description | Default |
|--------|-------------|---------|
| `-i, --device-id` | Unique device identifier | Required |
| `-u, --user-id` | User ID | Required |
| `-d, --database` | SQLite database path | `~/.ritual/watcher.db` |
| `-p, --poll-interval` | Polling interval in ms | `2000` |
| `-t, --title-mode` | Title privacy mode | `off` |
| `--truncate-length` | Chars for truncate mode | `80` |
| `-e, --excluded` | Excluded bundle IDs | `` |
| `--foreground` | Run in foreground | false |

## Title Modes

| Mode | Description | Privacy |
|------|-------------|---------|
| `off` | Don't track window titles | Maximum |
| `truncate` | Store first N characters | Medium |
| `hash` | Store SHA256 hash | High |
| `full` | Store complete title | Minimum |

## Permissions

### Accessibility Permission

Required to capture window titles. Without it:
- App tracking still works
- Window titles will be `null`

To grant permission:
1. Open System Preferences → Security & Privacy → Privacy → Accessibility
2. Add the Ritual app

## Data Model

### activity_events (append-only)

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| device_id | TEXT | Device UUID |
| user_id | TEXT | User ID |
| ts_start | INTEGER | Start timestamp (ms) |
| ts_end | INTEGER | End timestamp (ms) |
| app_bundle_id | TEXT | e.g., "com.apple.Safari" |
| app_name | TEXT | e.g., "Safari" |
| window_title | TEXT | Nullable |
| window_title_hash | TEXT | SHA256 if title_mode=hash |
| is_afk | INTEGER | 0=active, 1=AFK |

### daily_activity_rollups (aggregated)

| Column | Type | Description |
|--------|------|-------------|
| day | TEXT | YYYY-MM-DD |
| device_id | TEXT | Device UUID |
| app_bundle_id | TEXT | Bundle ID |
| app_name | TEXT | App name |
| active_ms | INTEGER | Total active time |
| events_count | INTEGER | Number of segments |

## Privacy Philosophy

Inspired by ActivityWatch's "local-first" approach:

1. **Raw data stays local** by default
2. **Only aggregated metrics** are synced to cloud (opt-in)
3. **User controls** what apps to exclude
4. **Title redaction** modes for sensitive content
5. **No screenshots** or content capture

## Development

### Debugging

Enable debug logging:

```bash
RUST_LOG=ritual_watcher=debug ~/.ritual/bin/ritual-watcher ...
```

### Running tests

```bash
cd apps/desktop/src-tauri/bin/ritual-watcher
cargo test
```

## License

MIT - See main repository LICENSE file.

