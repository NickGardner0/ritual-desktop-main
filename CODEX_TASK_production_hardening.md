# Codex Task: Production Hardening -- Full Codebase Audit & Fix

## Context

Ritual is going live in production today. A comprehensive system architecture and audit document has already been prepared at `SYSTEM_ARCHITECTURE_AND_AUDIT.md` in the repo root. That document contains the full architecture reference, file-by-file inventory, and a catalog of every known issue.

Your job is to read `SYSTEM_ARCHITECTURE_AND_AUDIT.md` thoroughly, then execute the fixes described below across the entire `ritual-desktop-main` monorepo. Work through every section. Do not skip files. Optimize for performance, simplicity, and good software development practices.

---

## Scope

Every file in the repository. The audit document (Section 12) lists every file grouped by component. Use it as your checklist.

---

## Task 1: Security Hardening (Critical -- Do First)

### 1A. Sanitize backend error messages

**Files**: `apps/backend/main.py`, all files in `apps/backend/services/`

Find every instance of `detail=str(e)` or `detail=f"..."` that includes raw exception text in HTTP error responses. Replace each one with a safe, generic user-facing message. Log the real error server-side using Python `logging` (not `print`).

Example transform:
```python
# BEFORE
except Exception as e:
    raise HTTPException(status_code=500, detail=str(e))

# AFTER
except Exception as e:
    logger.exception("Failed to create habit log")
    raise HTTPException(status_code=500, detail="An internal error occurred. Please try again.")
```

Apply this pattern to every endpoint in `main.py` and every service method that raises `HTTPException`.

### 1B. Fix auth token storage

**File**: `apps/dashboard/lib/python-api-client.ts`

Remove the `localStorage` fallback for auth tokens. Token retrieval should only use Clerk's `getToken()` method. If no token is available, throw an explicit auth error instead of falling back to an insecure store.

**File**: `apps/desktop/src-tauri/src/native_widget.rs`

When writing the auth token to `~/.ritual/auth_token.txt`, set restrictive file permissions (0600 -- owner read/write only). Use Rust's `std::fs::set_permissions` or `std::os::unix::fs::PermissionsExt` to enforce this after every write.

### 1C. Fix WebSocket authentication

**File**: `apps/backend/main.py` (WebSocket endpoint)

The WebSocket endpoint currently accepts a raw `X-User-ID` header as a fallback when no JWT is provided. This allows impersonation from localhost. Change this so the fallback requires validation of an `INTERNAL_API_KEY` header alongside `X-User-ID`. If neither a valid JWT nor the internal key is present, reject the connection.

### 1D. Add timeouts to all external API calls

**Files**: All backend services that make HTTP calls:
- `apps/backend/services/tinybird_service.py` -- Add `timeout=30` to all `httpx` requests
- `apps/backend/services/whoop_service.py` -- Add `timeout=30` to all Whoop API calls
- `apps/backend/services/auth_service.py` -- Add `timeout=10` to Clerk JWKS and email fetch calls
- `apps/backend/services/search_service.py` -- Add `timeout=10` to Typesense calls
- `apps/backend/services/screenshot_analyzer.py` -- Add `timeout=60` to OpenAI/Gemini vision calls
- `apps/dashboard/app/api/chat/stream/route.ts` -- Add a timeout (90 seconds) to the OpenAI streaming call and to each tool call execution

### 1E. Fix Rust unwrap() calls

**File**: `apps/desktop/src-tauri/src/main.rs`

Find every `.unwrap()` call. Replace each one with proper error handling:
- For Tauri command handlers: use `Result<T, String>` return types and the `?` operator, or `match` / `if let`.
- For setup/initialization code: use `.unwrap_or_else(|e| { eprintln!("..."); ... })` or `.expect("descriptive message")` only where a panic is truly the right behavior (e.g., missing required config at startup).
- For optional values: use `.unwrap_or_default()` or `if let Some(v) = ...`.

Also audit `src/native_widget.rs`, `src/watcher.rs`, `src/recorder.rs`, `src/ritual_database.rs`, and `src/local_search_bridge.rs` for the same issue.

---

## Task 2: Replace print() with Structured Logging (High)

### 2A. Backend logging

**Files**: Every `.py` file in `apps/backend/`

1. Add `import logging` and create a module-level logger (`logger = logging.getLogger(__name__)`) at the top of every file that currently uses `print()`.
2. Replace every `print()` call with the appropriate log level:
   - Debug info -> `logger.debug()`
   - Normal operations -> `logger.info()`
   - Warnings -> `logger.warning()`
   - Errors with traceback -> `logger.exception()` (inside except blocks)
   - Errors without traceback -> `logger.error()`
3. In `main.py`, configure the root logger at startup with a format that includes timestamp, level, module, and message:
   ```python
   logging.basicConfig(
       level=logging.INFO,
       format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
   )
   ```

### 2B. Rust logging

**Files**: All `.rs` files in `apps/desktop/src-tauri/src/`

Replace `println!()` calls with the `log` crate macros (`info!()`, `warn!()`, `error!()`, `debug!()`). If the `log` crate is not already a dependency, add it to `Cargo.toml` along with `env_logger` for initialization.

---

## Task 3: Architecture Refactoring (High)

### 3A. Extract main.py into FastAPI routers

**File**: `apps/backend/main.py` (~3,928 lines)

This file contains all 60+ endpoint definitions. Extract them into separate router modules:

| New File | Endpoints to Move |
|----------|-------------------|
| `api/habits.py` | All `/api/habits/...` and `/api/habit-logs` endpoints |
| `api/analytics.py` | All `/api/analytics/...` endpoints |
| `api/integrations.py` | All `/api/integrations/whoop/...` endpoints |
| `api/import_.py` | All `/api/import/...` endpoints |
| `api/conversations.py` | All `/api/conversations/...` endpoints |
| `api/search.py` | All `/api/search/...` and `/api/suggestions` endpoints |
| `api/wearables.py` | All `/api/wearables/...` endpoints |
| `api/calendar.py` | All `/api/calendar/...` endpoints |
| `api/screenshots.py` | All `/api/screenshot/...` and `/api/screentime/...` endpoints |

Each router file should:
- Create an `APIRouter` with an appropriate prefix and tags.
- Import only the services and dependencies it needs.
- Keep `main.py` to ~200 lines: app creation, middleware, startup/shutdown hooks, router registration.

### 3B. Split watcher_service.py

**File**: `apps/backend/services/watcher_service.py` (~3,163 lines)

Split into sub-modules:
| New File | Responsibility |
|----------|---------------|
| `services/watcher/devices.py` | Device registration, state management |
| `services/watcher/events.py` | Activity event ingestion, queries |
| `services/watcher/rollups.py` | Daily rollup computation |
| `services/watcher/sync.py` | Tinybird sync, cache management |
| `services/watcher/search.py` | Screen search, FTS + hybrid bridge |
| `services/watcher/__init__.py` | Re-export public API for backward compatibility |

### 3C. Split chat stream route

**File**: `apps/dashboard/app/api/chat/stream/route.ts` (~1,320 lines)

Extract into:
- `lib/ai/chat-tools.ts` -- Tool definitions and tool execution logic
- `lib/ai/chat-stream.ts` -- Streaming response construction
- `lib/ai/chat-postprocess.ts` -- Voice mode post-processing

Keep `route.ts` as a thin handler that composes these modules.

---

## Task 4: Reliability Fixes (High)

### 4A. Add retry logic to python-api-client.ts

**File**: `apps/dashboard/lib/python-api-client.ts`

Add a retry wrapper with exponential backoff for transient failures (network errors, 502/503/504 status codes). Max 3 retries. Do not retry 4xx client errors.

```typescript
async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 3): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.ok || response.status < 500) return response;
      if (attempt === maxRetries) return response;
    } catch (error) {
      if (attempt === maxRetries) throw error;
    }
    await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 500));
  }
  throw new Error("Unreachable");
}
```

Apply this to all fetch calls in the client.

### 4B. Fix analytics-api.ts silent failures

**File**: `apps/dashboard/lib/services/analytics-api.ts`

Find places where API errors return empty result objects instead of throwing or returning error states. Change them to throw so the calling component can show an error state instead of an empty dashboard.

### 4C. Handle Tinybird service None state

**File**: `apps/backend/main.py`

Find every place where `tinybird_service` is used. Add a null check before each call. If the service is `None`, either skip the Tinybird operation (for non-critical dual-writes) or return a clear error (for analytics endpoints that depend on it).

### 4D. Fix batch logging transaction rollback

**Files**: `apps/backend/main.py` (batch log endpoint), `apps/backend/services/habits_service.py`

Wrap batch log operations in a database transaction. If any individual log fails, roll back the entire batch and return a clear error listing which items failed and why.

### 4E. Fix dashboard token refresh polling

**File**: `apps/dashboard/components/dashboard-layout.tsx`

The token refresh check currently polls every 500ms. Change it to poll every 5000ms (5 seconds), or better yet, replace the polling with a file system watcher event if running inside Tauri (use the Tauri `fs` watch API).

---

## Task 5: iOS Companion Fixes (Medium)

### 5A. Fix hardcoded token expiry

**File**: `apps/ios-companion/Sources/RitualCompanion/Services/RitualAPIClient.swift`

The token expiry is hardcoded to 55 minutes. Change this to derive the expiry from the Clerk JWT `exp` claim. Decode the JWT payload (base64), read the `exp` field, and refresh the token when it is within 5 minutes of expiry.

### 5B. Fix anchor confirmation

**File**: `apps/ios-companion/Sources/RitualCompanion/Services/AnchorStorage.swift`
**File**: `apps/ios-companion/Sources/RitualCompanion/Services/HealthKitManagerV2.swift`

Currently anchors are updated immediately before server confirmation. Change the flow so that:
1. Save anchor to a "pending" key before ingest.
2. After successful server response, promote pending anchor to confirmed.
3. On failure, keep the old confirmed anchor so the next sync retries the same data.

### 5C. Improve sync window

**File**: `apps/ios-companion/Sources/RitualCompanion/Services/BackgroundSyncManagerV2.swift`

The daily sync only fetches the last 7 days. If the device has been offline for longer, data is lost. Change the logic to:
1. Track the last successful sync timestamp.
2. On sync, fetch from `lastSuccessfulSync` to now (capped at 30 days to avoid huge payloads).
3. Only fall back to 7 days if no last-sync timestamp exists.

---

## Task 6: Backend Database & Connection Hardening (Medium)

### 6A. Improve health check

**File**: `apps/backend/main.py` (GET `/health`)

Upgrade the health check to verify actual connectivity:
```python
@app.get("/health")
async def health_check():
    checks = {"status": "ok", "db": "unknown", "tinybird": "unknown"}
    try:
        async with get_db_session() as session:
            await session.execute(text("SELECT 1"))
        checks["db"] = "ok"
    except Exception:
        checks["db"] = "error"
        checks["status"] = "degraded"
    if tinybird_service:
        try:
            # lightweight tinybird check
            checks["tinybird"] = "ok"
        except Exception:
            checks["tinybird"] = "error"
            checks["status"] = "degraded"
    return checks
```

### 6B. Fix migration error handling

**File**: `apps/backend/database/connection.py`

Migrations currently swallow errors silently. Change this so that:
1. Each migration logs its name and result.
2. Failed migrations are logged at ERROR level with the full traceback.
3. The app still starts (do not crash on migration failure) but the health check reports `"migrations": "error"`.

### 6C. Audit auth service email cache

**File**: `apps/backend/services/auth_service.py`

The email cache is an unbounded in-memory dict. Add:
1. A max size (e.g., 10,000 entries). Use an LRU eviction strategy (Python `functools.lru_cache` or a simple dict with size check).
2. A TTL of 1 hour per entry (not just for the JWKS).
3. Log a warning when the cache is full and evicting.

---

## Task 7: Tinybird Audit (Medium)

### 7A. Verify multi-tenant security

**Files**: All 14 `.pipe` files in `apps/tinybird/pipes/`

Check every pipe and confirm that each query filters by `user_id`. If any pipe does not filter by `user_id`, add it as a required parameter. This prevents users from querying other users' data.

### 7B. Review deduplication

**Files**: All pipes that use `LIMIT 1 BY id`

Document which pipes use this pattern and whether it causes measurable query slowdown on the current data volume. If the habit_logs datasource grows past 1M rows, this pattern will become expensive. Add a comment in each pipe noting this, and propose a materialized view alternative in a code comment for future implementation.

### 7C. Clean up Python client

**File**: `apps/tinybird/python-service/tinybird_client.py`

Remove all `print()` debug statements. Replace with Python `logging`. Add `timeout=30` to all `requests` calls. Add proper error handling for failed API calls.

---

## Task 8: Browser Extension Hardening (Low)

### 8A. Make server URLs configurable

**File**: `apps/browser-extension/background.js`

Move hardcoded server URLs (`localhost:8766`, `localhost:8767`) to a config object at the top of the file. Add support for reading these from `chrome.storage.sync` so they can be changed from the popup.

### 8B. Add reconnection backoff

**File**: `apps/browser-extension/background.js`

When all server candidates fail, add exponential backoff before retrying (start at 2s, max 60s, reset on success).

---

## Task 9: Shared Contracts Completeness (Low)

### 9A. Add missing types

**File**: `packages/shared-contracts/normalized.ts`

Add the following to the `MetricType` enum to match what the iOS companion sends:
- `sleep_rem`
- `sleep_deep`
- `sleep_core`
- `sleep_awake`
- `respiratory_rate`
- `blood_oxygen`

Verify these match the values in `apps/ios-companion/Sources/RitualCompanion/Models/NormalizedMetric.swift`.

### 9B. Add V2 ingest types

**File**: `packages/shared-contracts/apple_ingest.ts`

Add `AppleIngestRequestV2` and `AppleIngestResponseV2` types that match the V2 incremental ingest endpoint used by the iOS companion. Export them from `index.ts`.

---

## Task 10: Code Quality Sweep (Low)

### 10A. Remove dead code

**File**: `apps/backend/main.py` -- Remove the Supabase migration placeholder endpoint (`/api/migrate/from-supabase`) if it is non-functional.

**File**: `apps/dashboard/lib/habits-service.ts` -- This file is marked deprecated. If only types are used from it, move those types to the appropriate location and delete the file. Update all imports.

### 10B. Add missing null checks

**Files**: All 50 dashboard API route files in `apps/dashboard/app/api/`

Audit each route for:
1. Missing Clerk `auth()` token extraction -- every route that proxies to the backend must include the auth token.
2. Missing error handling -- every `fetch` to the Python backend should have a try/catch that returns a user-friendly error.
3. Missing input validation -- POST/PUT routes should validate request body before forwarding.

### 10C. Fix eval() in Tauri

**File**: `apps/desktop/src-tauri/src/main.rs`

Find any use of `eval()` for navigation. Replace with Tauri's `window.emit()` + frontend event listener pattern, or use `window.navigate()` (Tauri 1.x WebviewWindow method) to avoid code injection risk.

---

## Verification Checklist

After completing all tasks, verify:

- [ ] `npm run build` passes with no errors
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes (or only has pre-existing warnings)
- [ ] Python backend starts: `cd apps/backend && python start.py` runs without import errors
- [ ] `pytest apps/backend/tests/` passes
- [ ] No `detail=str(e)` patterns remain in backend code
- [ ] No `print()` calls remain in backend `.py` files (replaced with `logging`)
- [ ] No `.unwrap()` calls remain in `src/main.rs` (replaced with proper error handling)
- [ ] `main.py` is under 300 lines
- [ ] `watcher_service.py` has been split into sub-modules
- [ ] `chat/stream/route.ts` has been split into smaller modules
- [ ] All external API calls have explicit timeouts
- [ ] Health check endpoint verifies DB connectivity
- [ ] Auth token file is written with 0600 permissions
- [ ] localStorage fallback removed from python-api-client.ts
- [ ] WebSocket auth requires JWT or internal API key
- [ ] All Tinybird pipes filter by user_id

---

## Files Changed Summary

When complete, provide a summary of every file you created, modified, or deleted, grouped by task number.
