# Ritual Canonical Screen Read-Model Migration Plan

## Summary

Replace the root `plan.md` with this migration plan. Ritual should keep FastAPI as the canonical backend and React Query as the dashboard cache, but Metrics, Logs, and Calendar must stop assembling screen truth from scattered client caches. Each major screen should read one backend-owned read model, and each write should update derived facts before returning, then invalidate only the affected read models.

The goal is to prevent zero-out glitches, inconsistent totals, duplicate aggregation rules, and source-precedence bugs across manual logs, wearables, watcher data, Biome iPhone Time, imports, and offline desktop fallback.

## Key Changes

### Backend Read Models

- Keep `/api/dashboard/overview-snapshot` as the canonical Overview read model and add:
  - `GET /api/dashboard/metrics-snapshot`
  - `GET /api/logs/read-model`
  - `GET /api/calendar/read-model`
- Every read-model response must include:
  - `generatedAt`, `rangeKey`, `source`, `partial`, `warnings`
  - complete screen data for the requested user/date range
  - stable source labels such as `metric_facts`, `watcher_local_fallback`, `biome_iphone`, `wearable`, `import`, `degraded_cache`
- Metrics snapshot owns metric totals, averages, deltas, sparklines, habit rows, category cards, app rankings, website rankings, Computer Time, and iPhone Time.
- Logs read model owns paginated rows, filters, source counts, available habits/categories, and daily read-only rollup rows for iPhone Time. Raw iPhone app-level events stay in Metrics/activity detail, not the main Logs table.
- Calendar read model owns visible calendar days, habit logs, scheduled blocks, project sessions, wearable/biometric summaries, day tooltips, and selected-day summary inputs.

### Frontend Data Flow

- Add central query keys for `overviewSnapshot`, `metricsSnapshot`, `logsReadModel`, and `calendarReadModel`.
- Replace screen-local aggregation in Metrics/Calendar/Logs with render-only usage of the backend read models.
- Remove React aggregation paths that calculate habit totals from `habitLogsList`, local activity rows, wearable rows, or partial analytics payloads.
- Keep the existing defensive snapshot merge behavior: partial, empty, or zero-heavy payloads must not overwrite known non-zero values.
- Server-prefetch high-traffic dashboard data where practical, hydrate React Query, then let the client reuse the canonical cache.

### Mutations And Invalidation

- Manual/AI habit writes continue through `/api/logs/batch`; the backend must rebuild affected metric facts and return the post-write Overview snapshot plus affected habit/date metadata.
- Add specific invalidation helpers:
  - `invalidateAfterHabitWrite`: Overview, Metrics, Logs, Calendar
  - `invalidateAfterWearableSync`: Overview, Metrics, Calendar
  - `invalidateAfterActivitySync`: Overview, Metrics, Calendar
  - `invalidateAfterImport`: Overview, Metrics, Logs, Calendar
- Keep optimistic updates only for safe local entity edits such as renamed labels or temporary pending row UI. Never optimistically mutate aggregate totals, streaks, app rankings, Computer Time, iPhone Time, or date-range summaries.
- Log edit/delete endpoints must also rebuild affected metric facts and invalidate the same canonical read models.

### Desktop And Multi-Source Rules

- Backend metric facts are canonical for habit totals.
- Watcher local DB and desktop fallback may fill activity-specific widgets only when backend activity data is missing or offline.
- Local fallback must merge non-destructively and must never zero backend habit totals.
- Computer Time and iPhone Time use the same projection contract: raw events land in activity storage, affected daily facts are rebuilt, screen snapshots read facts.
- Metrics can show app/website breakdowns from local watcher fallback, but the habit total remains the backend fact unless explicitly marked degraded.

## Test Plan

- Manual logging regression: log Workout and assert Caffeine, Nicotine, Sleep, Computer Time, iPhone Time, Spending, Steps, Reading, and existing app rankings do not zero or change unexpectedly.
- Metrics read-model tests: missing watcher rows, empty local fallback, or sync-pending state must preserve backend habit facts.
- Logs read-model tests: daily iPhone Time rollup rows appear without flooding Logs with raw foreground events; pagination/filter metadata remains stable.
- Calendar read-model tests: Calendar day totals match Logs and Overview for the same date range.
- Mutation tests: create, edit, delete, import, wearable sync, and activity sync rebuild affected metric facts before returning or before invalidation completes.
- Snapshot guard tests: partial, empty, zero-heavy, and degraded payloads cannot overwrite known non-zero cached values.
- Post-deploy smoke test: run `npm run smoke:prod:read-models` against production to verify Overview, Metrics, Logs, and Calendar read models return complete non-partial payloads and important all-time totals are not unexpectedly zero.
- Performance tests: compare request count, initial Metrics render time, Calendar range switch time, Logs first page time, and post-log time-to-correct-total before and after migration.

## Assumptions

- Do not migrate to tRPC; keep FastAPI plus generated OpenAPI clients.
- Do not remove existing endpoints immediately. Add canonical read models first, migrate screens, then delete obsolete client aggregation and proxy paths.
- Logs should show daily read-only iPhone Time rollups, while raw iPhone app-level events belong in Metrics/activity detail.
- Correctness beats fake instant aggregate optimism. Manual logging should feel fast by applying canonical returned snapshots, not by doing client-side aggregate math.
- The first implementation slice should migrate Metrics because it currently has the highest risk of source-precedence bugs and visible zero-out behavior.
