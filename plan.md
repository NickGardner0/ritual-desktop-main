# iPhone Time Integration Plan

## Summary

Replace the root `/Users/nickgardner/Desktop/ritual-desktop-main/plan.md` with this plan. Make Apple Screen Time / iPhone Time a real first-class Integration using the existing Mac Biome pipeline: the desktop watcher reads Apple Biome `App.InFocus` data, queues normalized iPhone app-usage intervals, the Tauri runtime drains them to FastAPI, and backend read models display `iPhone Time` in Overview, Metrics, Logs, and Calendar.

V1 should focus on the desktop Biome path, not the iOS companion path. Same-iCloud Mac users get the most automated setup. Users with a different iCloud account on their daily Mac account get a guided bridge/import path using a shared JSONL export from the matching macOS account.

## Key Changes

### Integrations Page

- Move `Apple Screen Time` into the first row directly after `Computer Use`.
- Rename the card display to `Apple Screen Time`, keep the tracked habit/read-model label as `iPhone Time`.
- Update card description to: `Track your iPhone screen time and app usage by syncing across devices.`
- Remove `Coming soon`; make the card status-driven with `Connect`, `Sync Now`, and `Details`.
- Add an `iPhone Time` details panel with:
  - current status,
  - last imported date,
  - total imported events,
  - outbox count,
  - last drain result/error,
  - local Biome source-file count,
  - setup instructions,
  - bridge import controls.

### Status And Diagnostics

- Add a dashboard hook that combines:
  - Tauri command `get_biome_iphone_diagnostics`,
  - backend `/api/screen-time/stats/summary`,
  - backend read-model/fact state for the `iPhone Time` habit.
- Derive these exact UI statuses:
  - `not_desktop`: only available in Ritual desktop.
  - `watcher_not_running`: desktop is open but watcher is not running.
  - `waiting_for_icloud_sync`: no local Biome iOS peers/source files found.
  - `source_ready`: local Biome source files exist and can be parsed.
  - `queued`: events are waiting in `biome_iphone_events.jsonl`.
  - `syncing`: drain just ran or queued count is decreasing.
  - `connected`: backend has recent `iPhone Time` facts.
  - `error`: latest drain/parser/backend error exists.
- Show a clear warning when source files are missing: "Ritual can only read iPhone Screen Time if this Mac user is signed into the same iCloud account as the iPhone and Screen Time data has synced locally."
- Do not claim the Apple ID itself is mismatched, because the app cannot safely read/compare Apple account identity; infer only from missing Biome peers/source files.

### Connect And Sync Behavior

- `Connect` should:
  - verify Ritual is running in Tauri,
  - verify watcher runtime,
  - call `get_biome_iphone_diagnostics`,
  - show the details panel with the next required action.
- `Sync Now` should:
  - trigger the existing Biome outbox drain,
  - refresh diagnostics,
  - force-refresh Overview/Metrics/Logs/Calendar read models after success.
- If source files exist but no events are queued, prompt the user to wait for the watcher scan or restart Computer Use.
- If backend facts exist, mark the integration connected even if the local outbox is empty.

### Bridge Path For BiomeTest / Alternate iCloud Accounts

- Add a Tauri import command that accepts a Biome JSONL export file and enqueues valid events into the same `biome_iphone_events.jsonl` outbox.
- Add a details-panel section: `Using a different iCloud account?`
- Show the exact helper command for the other macOS account:
  - `/Users/Shared/ritual-watcher-biome-diagnostic --biome-export-jsonl /Users/Shared/ritual-biome-iphone-export.jsonl`
- Add an `Import Export File` button that lets the daily Ritual account import `/Users/Shared/ritual-biome-iphone-export.jsonl`.
- Validate imported rows against the existing Biome event schema, dedupe by stable event key, quarantine malformed rows, and never delete the source export.
- After import, immediately trigger outbox drain and refresh integration/read-model status.

### Backend And Read Models

- Keep `/api/watcher/biome-ingest` as the canonical ingestion endpoint.
- Add or expose a lightweight backend status endpoint for `iPhone Time` facts if existing summary data is insufficient:
  - latest imported day,
  - total active milliseconds,
  - total event count,
  - last fact rebuild timestamp if available.
- Preserve current behavior:
  - accepted Biome events rebuild `iPhone Time` metric facts,
  - Logs show daily read-only `iPhone Time` rollups,
  - raw app-level details stay in Metrics/activity detail.
- Ensure status reads never overwrite known positive `iPhone Time` values with zero-heavy degraded payloads.

## Test Plan

- Dashboard tests:
  - Apple Screen Time card appears directly after Computer Use.
  - Card is no longer `Coming soon`.
  - Description matches the requested copy.
  - Missing Biome files shows the same-iCloud warning.
  - Existing backend facts mark the card connected.
  - Queued outbox rows show `queued`, drain error shows `error`.
- Tauri/Rust tests:
  - `get_biome_iphone_diagnostics` reports source files, outbox count, committed cursors, and last drain.
  - JSONL bridge import accepts valid rows, dedupes existing events, and quarantines malformed rows.
  - Import does not advance committed cursors until backend acknowledgement.
- Backend tests:
  - Biome ingest still creates/updates `iPhone Time` facts.
  - Status/summary endpoint returns latest imported day and non-zero totals when facts exist.
  - Ignored pseudo-app events do not count toward `iPhone Time`.
- End-to-end smoke:
  - Same-iCloud Mac with Biome files: Connect -> source ready/connected -> Overview/Metrics show `iPhone Time`.
  - Alternate iCloud account: export from BiomeTest -> import in Ritual -> drain -> read-model smoke passes -> `iPhone Time` visible.
  - Network failure: queued rows remain and UI shows retryable error.

## Assumptions

- V1 production path is desktop Biome, not the iOS companion Screen Time path.
- The app cannot silently read another macOS user's Biome files; alternate-account support must use an explicit export/import bridge.
- Apple Screen Time is the integration name; `iPhone Time` remains the habit/metric name in app data.
- Same-iCloud Mac setup should be automated after the user opens Ritual desktop and the watcher runs.
- The existing backend Biome ingest and metric-fact projection are reused rather than replaced.
