# Location And iPhone Biome Correctness Plan

## Summary

Implement location and iPhone Biome correctness fixes in this order:

1. Update iPhone Time metric facts immediately when Biome events are accepted.
2. Commit Biome scanner progress only after backend acknowledgement.
3. Emit bounded provisional intervals for the currently open iPhone foreground app.
4. Backfill missing location fields when location pings arrive late.
5. Drain outboxes by acknowledged IDs and quarantine rejected or malformed records.
6. Detect Mac Wi-Fi movement from the full `(bssid, ssid)` fingerprint.
7. Add sanitized real-fixture coverage for Biome parsing.

The implementation must preserve current API count fields (`accepted`, `rejected`, `duplicates`) while adding optional acknowledgement arrays for safer clients.

## Key Changes

### Backend Biome Ingest

- Add `biome_is_provisional` to `activity_events` schemas/migrations and per-user Turso schema.
- Make Biome event identity stable by `device_id + app_bundle_id + ts_start`.
- Change Biome writes from blind `INSERT OR IGNORE` to ack-aware upserts.
- Return `accepted_event_uids`, `duplicate_event_uids`, and `rejected_event_uids`.
- Rebuild only affected `iPhone Time` metric fact dates immediately after accepted or updated Biome events.

### Biome Scanner And Drainer

- Replace scanner-owned progress advancement with a committed cursor file under Application Support.
- Scanner queues events newer than the committed cursor and relies on outbox dedupe while upload is pending.
- Tauri drainer advances committed cursors only after accepted, duplicate, or terminal rejected backend acknowledgement.
- Synthetic open intervals are provisional, bounded to 2 hours, and emitted only for recent source data.
- Final close/switch events update the same stable event UID and clear `biome_is_provisional`.

### Location Backfill

- Add batch location resolution so many timestamps can be resolved from one candidate ping query.
- After accepting new location pings, backfill nearby habit logs and Biome activity rows missing `location_*` within a default `±60 minute` window.
- Add explicit wider backfill helpers for admin/dev use.
- Fix historical resolution so an old selected ping does not inherit the current state place label.

### Outbox Safety

- Add `accepted_ids`, `duplicate_ids`, and `rejected_ids` to location ingest responses.
- Mac and iOS location drainers remove only accepted or duplicate pings and quarantine rejected pings.
- Biome drainer removes only acknowledged event UIDs and quarantines rejected events.
- Malformed outbox records are moved to `*.malformed.*` quarantine files without blocking valid records.
- Transport failures, auth failures, 5xx responses, and unparseable backend responses remain retryable.

### Mac Wi-Fi Detection

- Compare both `bssid` and `ssid`.
- Treat BSSID changes, SSID changes with masked BSSID, and connect/disconnect transitions as movement signals.

## Test Plan

- Backend: run location, Biome, and metric fact tests; add coverage for ack arrays, immediate iPhone Time facts, batch location backfill, and historical place-label behavior.
- Desktop Rust watcher: run Biome and location tests; add coverage for committed cursors, provisional intervals, stable event IDs, malformed fixtures, and full Wi-Fi fingerprint comparison.
- Tauri runtime: add drainer tests for accepted, duplicate, rejected, mixed, malformed, and network-failure batches.
- iOS: verify `RitualCompanion` builds with `xcodebuild` and update outbox tests if a suitable test seam exists.
- End to end: ingest sample Biome events, verify iPhone Time facts without manual rebuild, submit late location pings, and verify missing location fields are backfilled.

## Assumptions

- The existing watcher activity table remains canonical for desktop and iPhone activity.
- Sanitized committed fixtures are allowed; private local Biome data must not be committed.
- Backend response additions are optional and backward compatible.
- Rejected IDs are terminal only when explicitly returned by the backend.
