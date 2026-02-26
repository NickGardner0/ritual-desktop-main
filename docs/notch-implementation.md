# Ritual Notch Timer — Implementation Deep Dive

This document provides a complete technical breakdown of the macOS notch timer feature in the Ritual desktop app. The notch timer is a native Swift UI that renders inside the MacBook's notch area, allowing users to start/pause/log focus sessions without leaving their current workflow.

---

## Architecture Overview

The notch timer is a **separate native Swift process** launched and managed by the main Tauri (Rust) app. It communicates with the Rust side via **file-based IPC** and talks directly to the **backend API** (`localhost:8000`) for habit data and logging.

```
┌─────────────────────────────────────────────────┐
│  Tauri App (Rust)                               │
│  apps/desktop/src-tauri/src/main.rs             │
│  apps/desktop/src-tauri/src/native_widget.rs    │
│                                                 │
│  - Launches NativeTimerWidget as child process  │
│  - Writes auth token to temp file               │
│  - Polls for refresh triggers from Swift side   │
│  - Exposes Tauri commands to frontend           │
│  - Builds FFI static lib for speech recognition │
└────────────┬────────────────────────────────────┘
             │
             │  1. Process launch (sets RITUAL_PARENT_PID env var)
             │  2. File-based IPC (temp directory):
             │     Rust → Swift: ritual_auth_token.txt
             │     Swift → Rust: ritual_timer_updated.txt
             │     Swift → Rust: ritual_refresh_token_request.txt
             │
┌────────────▼────────────────────────────────────┐
│  NativeTimerWidget (Swift executable)           │
│  apps/desktop/src-tauri/native-timer/           │
│                                                 │
│  - Renders UI in macOS notch via DynamicNotchKit│
│  - Manages timer state (start/pause/log/discard)│
│  - Fetches habits from backend API              │
│  - Creates habit log entries via POST           │
│  - Persists session state in UserDefaults       │
│  - Monitors parent Rust process health          │
└────────────┬────────────────────────────────────┘
             │
             │  HTTP (localhost:8000)
             │
┌────────────▼────────────────────────────────────┐
│  Backend API (Python)                           │
│  apps/backend/main.py                           │
│                                                 │
│  GET  /api/habits          → list habits        │
│  POST /api/habits/{id}/logs → create log entry  │
└─────────────────────────────────────────────────┘
```

---

## File & Folder Map

### Swift Native Widget — `apps/desktop/src-tauri/native-timer/`

| File / Folder | Purpose |
|---|---|
| `Package.swift` | Swift Package Manager manifest. Declares macOS 13+ platform, depends on `DynamicNotchKit` (v1.0.0+). Defines the `NativeTimerWidget` executable target. |
| `Package.resolved` | Locked dependency versions for reproducible builds. |
| `build_widget.sh` | Shell script that builds the Swift package in release mode and copies the binary to `../target/release/NativeTimerWidget`. |
| `TimerWidgetApp.swift` | **Entry point.** Creates an `NSApplication` with `.accessory` activation policy (no dock icon). Checks if notch timer is enabled. Reads `RITUAL_PARENT_PID` env var and installs a watchdog timer that terminates the widget if the parent Tauri process dies (checked every 2s via `kill(pid, 0)`). Creates and starts `NotchController`. |
| `MicrophonePermission.swift` | **FFI functions** called from Rust via C ABI (`@_cdecl`). Exports `show_microphone_permission_dialog()` and `check_microphone_permission()`. Uses `AVCaptureDevice` to request mic access and shows an `NSAlert` dialog guiding users to System Settings if denied. |
| `SpeechRecognition.swift` | **FFI functions** for speech recognition. Exports `start_speech_recognition()` and `stop_speech_recognition()`. Uses `SFSpeechRecognizer` (en-US) + `AVAudioEngine` for continuous recognition. Emits results via `UserDefaults` keys (`speech_transcript`, `speech_event`, `speech_timestamp`) that the Rust side can poll. |
| `Resources/eclipse.svg` | Ritual logo SVG (dark variant). |
| `Resources/eclipse_white.svg` | Ritual logo SVG (light/white variant, used in the notch). |

#### `Notch/` subfolder — UI layer

| File | Purpose |
|---|---|
| `Notch/NotchController.swift` | **Core controller.** Manages the three visual states (`hidden`, `compact`, `expanded`). Creates a `DynamicNotch` instance from DynamicNotchKit. Implements pointer polling (every 60ms), hover detection with hot zones, click handling, and delayed state transitions. Calculates notch geometry using `screen.auxiliaryTopLeftArea`/`auxiliaryTopRightArea` (macOS 12+). Subscribes to `TimerSessionStore` to auto-show/hide the notch when sessions start/end. |
| `Notch/NotchTimerView.swift` | **SwiftUI views.** Contains: `NotchCompactLeadingView` (habit icon + name, or Ritual logo when idle), `NotchCompactTrailingView` (elapsed time + running indicator), `NotchExpandedView` (habit picker + large timer + progress bar + start/pause/log/discard buttons), `RitualLogoMark` (loads SVG from bundle), `TimerProgressBar` (capsule progress with gradient), `NotchPillButtonStyle` (custom button style with pressed/disabled states). |
| `Notch/NotchHabitPicker.swift` | **Dropdown habit selector.** Shows the selected habit with icon + name + chevron. Opens a scrollable dropdown list of all habits with hover states, checkmark for selection, and a retry button when empty. |

#### `Stores/` subfolder — State management

| File | Purpose |
|---|---|
| `Stores/TimerSessionStore.swift` | **Central state store** (`ObservableObject`). Manages all timer state: `habits`, `activeHabitID`, `isRunning`, `startedAt`, `accumulated`, `now`. Key methods: `startOrResume()`, `pause()`, `discard()`, `toggleRunning()`, `stopAndLog()`, `loadHabits()`, `selectHabit()`. Persists session and habits to `UserDefaults`. Fetches habits from backend API with auth token (read from temp file). Logs sessions via POST. Auto-refreshes habits every 8s if sync failed. Maps habit names to SF Symbols for icons. |

### Rust Integration — `apps/desktop/src-tauri/src/`

| File | Purpose |
|---|---|
| `native_widget.rs` | **Rust bridge.** Manages widget process lifecycle: `launch_native_timer_widget()` (checks if binary exists, builds if needed or stale, spawns process with `RITUAL_PARENT_PID`), `terminate_native_widget_processes()` (pkill), `native_widget_needs_rebuild()` (compares source mtimes to binary). Exposes Tauri commands: `create_native_timer_widget`, `close_native_timer_widget`, `write_auth_token_to_file`, `check_dashboard_refresh_trigger`, `check_token_refresh_request`. Also declares FFI extern bindings for the speech recognition static lib and exposes them as Tauri commands: `show_native_microphone_permission_dialog`, `check_native_microphone_permission`, `start_native_speech_recognition`, `stop_native_speech_recognition`. |
| `main.rs` | **App entry point.** Imports `native_widget` module. Registers all native widget Tauri commands. Auto-launches the widget on app startup (unless `RITUAL_DISABLE_NOTCH_AUTOSTART=1` env var is set). Launches widget on system tray left-click and "Show Focus Timer" menu item click. |

### Build System — `apps/desktop/src-tauri/`

| File | Purpose |
|---|---|
| `build.rs` | **Cargo build script.** Compiles `MicrophonePermission.swift` and `SpeechRecognition.swift` into object files using `swiftc`, then creates a static library `libspeech_native.a` via `ar`. Links against `AVFoundation`, `Speech`, and `Cocoa` frameworks. This is separate from the widget build — it creates the FFI library so Rust can call Swift speech functions directly. |
| `native-timer/build_widget.sh` | Builds the full `NativeTimerWidget` executable via Swift Package Manager (`swift build -c release`). Output goes to `target/release/NativeTimerWidget`. |

---

## Key Concepts & Design Decisions

### 1. Separate Process Architecture
The notch widget runs as its own process (`NativeTimerWidget`), not embedded in the Tauri app. This allows:
- Independent lifecycle (can restart without restarting the whole app)
- Full native Swift/AppKit/SwiftUI access without Tauri constraints
- Clean separation of concerns

### 2. DynamicNotchKit
Uses the third-party [DynamicNotchKit](https://github.com/MrKai77/DynamicNotchKit) library (v1.0.0) for rendering content in the macOS notch area. The library provides a `DynamicNotch` component that supports three display modes: hidden, compact (small content flanking the notch), and expanded (full panel below the notch).

### 3. File-Based IPC
Communication between Rust and Swift uses temp files:
- **Auth token**: Rust writes `ritual_auth_token.txt` → Swift reads it for API calls
- **Dashboard refresh**: Swift writes `ritual_timer_updated.txt` → Rust/frontend polls it to know when to refresh
- **Token refresh request**: Swift writes `ritual_refresh_token_request.txt` → Rust reads + deletes it, then writes a fresh token

### 4. Parent Process Watchdog
The Swift app reads `RITUAL_PARENT_PID` on launch and checks every 2 seconds if the parent Rust process is still alive using `kill(pid, 0)`. If the parent dies, the widget terminates itself to prevent orphaned processes.

### 5. Hover & Click Geometry
`NotchController` defines three geometric zones:
- **`notchHotZone`**: The actual notch dimensions (calculated from `auxiliaryTopLeftArea`/`auxiliaryTopRightArea`)
- **`compactTriggerZone`**: Notch width + 80px padding, height + 14px — triggers compact mode on hover
- **`expandedInteractionZone`**: 420px wide × 180px tall — keeps expanded mode open while pointer is inside

State transitions use `DispatchWorkItem` with configurable delays (e.g., 0.02s to show compact, 0.25s to expand, 0.35s to collapse).

### 6. Timer State Persistence
`TimerSessionStore` persists to `UserDefaults`:
- Session state: `ritual.notch.timer.session.v1` (active habit, running state, accumulated time)
- Habits list: `ritual.notch.timer.habits.v1` (cached habits for offline use)

This means timer sessions survive widget restarts.

### 7. Speech Recognition (Existing Infrastructure)
There is already existing infrastructure for speech recognition:
- `SpeechRecognition.swift` implements `start_speech_recognition()` / `stop_speech_recognition()` using `SFSpeechRecognizer` + `AVAudioEngine`
- `MicrophonePermission.swift` handles permission requests and System Settings redirection
- `build.rs` compiles these into a static library linked into the Rust binary
- `native_widget.rs` declares the FFI extern bindings and wraps them as Tauri commands
- Results are communicated via `UserDefaults` keys that the Rust side polls

**Important**: The speech recognition FFI functions are compiled into the *Rust binary* (via `build.rs`), not into the `NativeTimerWidget` executable. They are called from the Tauri frontend via commands, not from the notch widget itself. Integrating voice into the notch would require either: (a) adding speech recognition directly into the `NativeTimerWidget` Swift package, or (b) adding an IPC mechanism for the Rust side to relay speech results to the widget.

### 8. Habit Icon Mapping
`TimerSessionStore.habitIcon(for:)` maps habit names to SF Symbols by keyword matching:
- "read" → `book`, "walk" → `figure.walk`, "sleep" → `moon.zzz`, "code" → `chevron.left.forwardslash.chevron.right`, "workout" → `figure.strengthtraining.traditional`, etc.
- Default: `circle.fill`

---

## Visual States

### Hidden
Nothing visible. Default state when no session is active and pointer is away from the notch.

### Compact
Small content flanking the notch:
- **Left**: Habit icon + short name (or Ritual logo when no session)
- **Right**: Elapsed time (monospaced) + colored dot (green = running, white = paused)

### Expanded
Full panel below the notch (380px wide):
- **Top row**: Habit dropdown picker | Large elapsed time (28pt monospaced) | Discard (×) button
- **Middle**: Progress bar (shows progress within current hour, blue-to-cyan gradient)
- **Bottom row**: Status text | Start/Pause pill button | Log pill button

---

## API Endpoints Used

| Method | Endpoint | Used For |
|---|---|---|
| `GET` | `/api/habits` | Fetch list of user's habits (with auth token) |
| `POST` | `/api/habits/{id}/logs` | Create a habit log entry after timer session |

### Log Entry Payload
```json
{
  "date": "2026-02-24",
  "duration": 1800,
  "completed_at": "2026-02-24T12:30:00Z",
  "status": "completed",
  "notes": "Timer session from native notch"
}
```

---

## Build & Run Flow

1. **Cargo build** (`build.rs`): Compiles `MicrophonePermission.swift` + `SpeechRecognition.swift` → `libspeech_native.a` (linked into Rust binary)
2. **Widget build** (`build_widget.sh`): `swift build -c release` → `target/release/NativeTimerWidget`
3. **App startup** (`main.rs`): Calls `native_widget::restart_native_timer_widget()` which:
   - Terminates any existing widget process
   - Checks if binary needs rebuild (compares source file timestamps)
   - Builds if needed
   - Spawns `NativeTimerWidget` with `RITUAL_PARENT_PID` env var
4. **Widget startup** (`TimerWidgetApp.swift`): Creates `NSApplication` → `NativeNotchAppDelegate` → `NotchController` → `DynamicNotch`

---

## Current Limitations & Extension Points

1. **No hotkey/command-key support**: The widget has no keyboard shortcut handling. There is no `NSEvent.addGlobalMonitorForEvents(matching: .keyDown)` or similar. All interaction is mouse-based (hover + click).

2. **No voice input in the notch**: While `SpeechRecognition.swift` and `MicrophonePermission.swift` exist, they are compiled into the Rust binary's FFI layer, not into the `NativeTimerWidget` executable. The notch widget currently has no way to trigger or receive speech recognition results.

3. **No close command**: `close_native_timer_widget()` is a placeholder (logs a message, does nothing). The only way to stop the widget is to kill the process.

4. **One-way IPC**: Communication is file-based and mostly one-way. There's no mechanism for Rust to send arbitrary commands to the running Swift widget (e.g., "start recording", "switch habit").
