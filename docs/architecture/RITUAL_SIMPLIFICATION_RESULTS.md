# Ritual simplification results

**Started:** 2026-08-20  
**Worktree:** `/Users/nickgardner/Desktop/ritual-release-0.1.1-prep` on `codex/release-0.1.1-prep`.  
**Governing rule:** delete unnecessary machinery; do not hide complexity behind new interfaces.  
**Architecture report:** [`RITUAL_SIMPLIFICATION_ARCHITECTURE_REPORT.md`](./RITUAL_SIMPLIFICATION_ARCHITECTURE_REPORT.md)

## Baseline

Measured with Tokei after the same exclusions used in the audit (node_modules, target, .next, dist, tests, `*.test.*`):

| Bucket | Code lines |
|---|---:|
| Dashboard (incl. JSON/assets in that tree) | 99,224 |
| Dashboard TSX | 53,674 |
| FastAPI Python (tests/scripts/migrations excluded) | 55,324 |
| Rust desktop/watcher/ritual-db | 32,127 |
| chat-api TypeScript | 106 |
| Unique npm runtime deps (root ∪ dashboard) | 74 |

Unrelated dirty work (entities, experiments, onboarding, routines, chat receipts, etc.) was left in place.

Pre-existing failures from the audit still apply to this dirty tree: dashboard production typecheck was already red. The `aggregate-local-first.ts` `isDesktopRuntime()` allowlist failure is fixed (redundant probe removed).

## Checklist

| Phase | Status | Notes |
|---|---|---|
| 1. Delete abandoned/unused surfaces | Done | Kanban, `/widget`, unused shadcn sidebar, `apps/chat-api`, profiling bridge, unused IPC, tracked tmp junk |
| 2. Collapse desktop IPC | Done | Feature code imports `@/lib/native-gateway`. Generated triad: command name + ACL capability + TS input/output from Rust signatures. `tauri-utils` is a compatibility re-export. `DesktopRuntimeBridge` still owns auth/events/sync lifecycle; shell bootstrap stays a separate early path |
| 3. Tauri ACL contract | Done | Frontend-needed commands allowed; unused IPC attributes removed from internal-only Rust fns; `scripts/check-tauri-command-acl.mjs` generates/verifies the NativeGateway command/capability/input/output triad |
| 4. Identity-safe React Query cache | Done | Restore waits for Clerk user id and uses `ritual:react-query-cache:v1:<userId>`. Habit snapshots were folded into this persist path |
| 5. Chat persistence / AssistantKernel | Done for strangler | `AssistantKernel` owns `queued → running → committing → completed\|failed\|canceled`. Durable FastAPI `assistant_turns` store, dashboard outbox, SMS/web/queue entrypoints, serial mutating tools, epoch cancel |
| 6. One scheduler | Done | Trigger.dev deleted. FastAPI loops are the only scheduler; job table in `docs/architecture/SCHEDULER_JOBS.md`. Default on when `RAILWAY_ENVIRONMENT` is set. `ENABLE_INTERNAL_SCHEDULER` documented in backend README and `.env.example` |
| 7. Search/index | Done for Typesense | Typesense client, PyPI dep, indexing fan-out, `/api/search/index-phrase`, `/api/search/reindex`, and erasure target removed on the release tree. Command palette / habit search read Turso SQL. MiniSearch remains for the in-modal habit picker. Tinybird remains analytics via FastAPI. `/api/search/status` is a SQL-search health check |
| 8. Telemetry overlap | Done for Speed Insights | Removed Vercel Speed Insights from the root layout and dashboard dependency. OpenPanel (product) and Sentry (errors) kept |
| 9. Local UI preferences | Partial | FastAPI still owns cross-device overview/color prefs. Local cache is now per-user (`ritual:ui-preferences:v2:<userId>`) |
| 10. Activity ownership | Done for raw/recent desktop | Desktop raw and ≤7-day reads use `activity.db` with observable `local \| synced \| unavailable`. No hidden HTTP/backend mix. Web/iOS and long-range desktop aggregates remain explicit `synced` |
| 11. Provider soup | Inventoried | `@mui/icons-material` (Toc + habit icons), Lucide, and Paper shaders are still referenced. Deleted unused `use-stick-to-bottom`, `cmdk`, `usehooks-ts`, and `@shadcn/ui` |
| 12. Config/env | Done for dead cloud-memory | Removed Turbopuffer / `RITUAL_MEMORY_CLOUD*` / Cohere embed-rerank env after confirming no TS/Python consumer |
| 13. Native helper pinning | Done for shipped arm64 | `sidecar-lock.json` SHA-256 pins `ritual-watcher` and `ritual-vision-helper` for `aarch64-apple-darwin`. `x86_64-apple-darwin` is an explicit unsupported target until those binaries are committed. Release verifies hashes and no longer rebuilds vision helper unless `RITUAL_REBUILD_SIDECARS=1` |

## Ledger

| Change | LOC before | LOC after | Net LOC | Runtime components removed | Dependencies removed | Notes |
|---|---:|---:|---:|---:|---:|---|
| Delete Kanban + TodaysFocusWidget + types/hook | 3,373 physical | 0 | −3,373 | abandoned feature | none (`@dnd-kit` still used by analytics) | No live page imported it |
| Delete `/widget` route | 337 physical | 0 | −337 | unused Next route | none | Debug timer, unlinked |
| Delete unused `components/ui/sidebar.tsx` | 774 physical | 0 | −774 | unused primitive | none | App uses `components/sidebar.tsx` |
| Delete `apps/chat-api` | 106 code | 0 | −106 | extra chat deployable | `@hono/node-server` workspace | Canonical host remains dashboard `/api/chat/stream` |
| Delete profiling HTTP bridge + tests | 81 + 28 physical | 0 | −109 | fake `:3031` transport | none | Desktop commands now require native Tauri IPC |
| Remove unused Tauri IPC wrappers | ~230 Rust physical | 0 | ~−230 | 10 unused command exposures | none | Internal watchdog/project-time functions kept |
| Identity-safe query cache + ACL contract test | n/a | small add | small add | none | none | Restore is per-user after Clerk; registered==allowed==invoked (60) |
| Hide nonfunctional AI retention / clear-history controls | small | 0 | small | deceptive UI | none | Hidden until a real persistence/erasure path exists |
| Delete Typesense (completed on release tree) | `search_service.py` 1,703 Typesense client | SQL search 824 | −879 plus deleted index/erasure call sites | Typesense cluster | `typesense` PyPI | Command palette/habit search read Turso. Privacy destination/erasure target removed |
| Delete Trigger.dev | trigger jobs + client + config | 0 | ~−400 | Trigger.dev cloud cron | `@trigger.dev/sdk`, `@trigger.dev/build` | FastAPI `background_tasks.py` owns wearable/SMS/report/workflow jobs. On by default on Railway |
| Fold habit snapshots into React Query persist | dedicated localStorage snapshots | 0 | small | extra cache | none | Habits and habit-logs now persist only via identity-keyed React Query cache |
| Per-user UI preference cache | global `ritual:ui-preferences:v1` | `v2:<userId>` | ~0 | cross-user stale prefs | none | FastAPI remains the cross-device store |
| Delete unused Midday agent stack | unused `lib/ai/agents` + `ai-sdk-tools` | 0 | ~−500 plus npm tree | unused agent runtime | `ai-sdk-tools` | Chat already owns tools via `@ritual/chat-runtime` |
| Remove Vercel Speed Insights (completed on release tree) | layout widget + dashboard dep | 0 | small | extra web-vitals vendor | `@vercel/speed-insights` | OpenPanel + Sentry remain |
| Collapse ChatTurnEngine wrapper | `chat-turn-engine.ts` + route aliases | 0 | ~−50 | extra chat entry class | none | BFF routes call `handleChatStreamRequest` / SMS handlers directly |
| Await user-message chat persist | fire-and-forget | awaited with assistant | ~0 | none | none | Same save path; no new outbox |
| Desktop activity IPC | silent HTTP fallback | local miss returns empty | ~0 | hidden cloud fallback | none | Web still uses `/api/watcher/activity` |
| Collapse `desktop-runtime.ts` into `desktop-bridge/runtime.ts` | 277 | 277 (moved) | ~0 | extra IPC module | none | Callers import `desktop-bridge` only. `tauri-utils` still re-exports shell |
| Event-driven native auth in `DesktopRuntimeBridge` | 45s interval + events | events + visibility; legacy interval kept | ~0 | native auth poll | none | `desktop://token-refresh-needed` already existed |
| Desktop activity `local \| synced \| unavailable` | ~1,150 mix/fallback | api 319 + local-read 115 + policy 156 | ~−500 | hidden backend/local mix, today-correction, background reconcile | none | Recent desktop is activity.db only. Historical/web stay explicit `synced` |
| Delete leftover Typesense phrase indexer caller | ~30 | 0 | −30 | no-op `/api/search/index-phrase` fan-out from chat habits | none | Caller deleted earlier; stub endpoints also removed |
| Remove dead Turbopuffer/memory-cloud env | config only | 0 | 0 | unused env surface | none | Confirmed no Python/TS consumer. `ENABLE_INTERNAL_SCHEDULER` documented |
| Delete unused `use-stick-to-bottom` | n/a | 0 | 0 | unused npm dep | `use-stick-to-bottom` | Zero imports. MUI, Lucide, shaders still have call sites |
| Pin desktop sidecars | mutable rebuild on release | SHA-256 lock + verify | small add | unpinned vision rebuild | none | arm64 binaries hashed in `sidecar-lock.json`. x86_64 not present in this tree |
| Delete leftover Typesense write stubs | two no-op POST routes + unused methods | 0 | small | `/api/search/index-phrase`, `/api/search/reindex`, `index_log_phrase`, `ensure_collections` | none | No frontend callers. `/api/search/status` remains as the SQL-search health check |
| AssistantKernel + durable turn store | stream/SMS/dashboard race | kernel + FastAPI `assistant_turns` + desktop outbox | small add | none as a service; FastAPI is the store | none | Turns have queued→running→committing→completed\|failed\|canceled. Mutating tools serial. Queue items reuse `queue:<id>` |
| NativeGateway generated command/capability/I-O triad | stringly IPC | `NATIVE_COMMANDS` + `NATIVE_COMMAND_CAPABILITIES` + `NativeCommandInputs`/`Outputs` generated from Rust | small add | extra caller import paths | none | `invokeDesktopCommand` is typed from the triad. Implementation modules stay in `desktop-bridge/*` |
| Five-trial launch/RSS CI budgets | local medians only | `tools/performance/launch-budgets.json` + `scripts/check-launch-budgets.mjs` + desktop-rust RSS tests | small add | none | none | Five cold and five warm fixture trials gated in `repo:check`. Live WKWebView captures should replace fixtures before a public release |
| Delete unused production surfaces | TimeTrackerWidget, overlay chart, insight cards, computer-time detail, mock reports, unused onboarding/biometrics/task recurrence | 0 | ~−2.2k | dead UI/data | none | Confirmed zero production importers |
| Pin CI/release toolchains | `actions/*@v4`, `dtolnay/rust-toolchain@stable` | Node/Python/Rust 1.92.0 + commit SHAs | ~0 | mutable `@stable` and version tags | none | Actions pinned to immutable SHAs with version comments |
| Launch milestones + median log | none | `recordLaunchMilestone` + local median samples + process RSS | small add | none | none | Cold/warm classified via sessionStorage. native_ready logs webview/watcher RSS. No five-trial CI budget yet |
| Activity cloud sync opt-in | always-on desktop backfill | `plaintext_sync` consent gate | ~0 | unconsented habit backfill | none | Local `activity.db` reads unchanged. Rust plaintext sync already required the same consent |
| AssistantKernel abort/in-flight fence | disconnect could complete; duplicate delivery could double-run | abort -> canceled; running/committing -> 409; stale running reclaims | small add | second in-flight model loop | none | Failure-injection tests cover disconnect, duplicate delivery, epoch switch, timeout retry |
| Split DesktopRuntimeBridge | one 532-line owner | auth / native events / legacy signals / backfill / realtime owners | ~0 | native 45s poll already gone; local_only skips websocket; OAuth store-code `setInterval` removed | none | Legacy builds still poll. Settings page hourly habit sync removed |
| Orphan sidecar + RSS helpers | prefix-matching `ps` parse; no RSS on runtime state | exact `--device-id` match + `process` RSS on runtime state | small add | none | none | Unit tests for parse; live RSS sampled at native_ready |
| Delete unused dashboard duplicates | leftover onboarding/setup, unused shadcn, unused live-HR widgets, unused server actions, unused React email | 0 | ~−3.5k physical | unused UI/data paths | none | Live onboarding permissions + vault folder remain. Calendar still reads HR range. iOS live biometrics API unchanged |
| Collapse colliding BFF proxy helper | `@/lib/server/proxy-response` resolved to `.mjs` missing `createProxiedSuccessResponse` | `.ts` NextResponse wrapper + `proxy-response-init.mjs` | ~0 | webpack missing-export path | none | Production webpack build compiles without that warning |
| Delete Next Tinybird client + unused trends BFF | `lib/tinybird-service.ts` + dedicated trends route | 0 | ~−400 | second Tinybird owner in Next | none | Habit trends go through FastAPI + catch-all. Remaining Next analytics routes still compose pipes FastAPI does not own |
| Delete unused npm + duplicate spinner/barrel | unused `cmdk`/`usehooks-ts`/`@shadcn/ui`, duplicate BrailleSpinner, unused `types/computerActivity`, unused `core/text-shimmer` | 0 | ~−150 plus npm tree | unused UI/data paths | `cmdk`, `usehooks-ts`, `@shadcn/ui` | Voice HUD uses the shared spinner. Unused server fetchers `getAnalyticsTrends` / `getWhoopStatus` / `getDashboardData` removed |
| Delete unused account/wordmark/side-panel and UI shims | unused `team-dropdown`, `ritual-wordmark`, `window-side-panel`, leftover `@/components/ui` re-exports | 0 | ~−400 | extra UI copies | none | Account menu already lives in `sidebar-account-menu`. Select/alert-dialog now import `@ritual/ui` |
| Restore privacy export/sync/erasure sections | compact two-toggle panel only | panel + existing sections | small add | none | none | Those sections still existed but were unwired on the release tree. Keep the compact sync toggles and mount the live export/private-sync/erasure UI |
| Restore privacy migration inventory and cloud deletion | export/sync/erasure only | inventory, dry-run, migrate, deletion plan/delete | small add | none | none | Required product controls were still unwired on the release tree. Uses `vaultSync`, not a second vault-client import path |
| Move remaining Tinybird analytics into FastAPI | Next summary/logs/daily-values/correlation/heart-rate routes | FastAPI payloads + catch-all | ~−1.2k Next, small FastAPI add | second Tinybird query owner in Next | none | Dashboard analytics reads FastAPI. Chat name-based correlation still uses Turso SQL |
| Delete remaining Next compatibility BFF wrappers | logs/all, search, Whoop sync, computer-activity breakdown | FastAPI + catch-all / client shaping | ~−1.0k Next | extra Next owners for FastAPI work | none | Calendar summary remains a streaming OpenAI Next route. Search quick-actions live in FastAPI |
| Delete unused correlation/list analytics client hooks | unused `useCorrelation` / `useHabitStats` / `useDailyBreakdown` | live `analyticsApi` fallbacks only | ~−150 | unused client wrappers | none | Expanded metrics still uses FastAPI correlation plus `getHabitStats`/`getDailyBreakdown` fallbacks |
| Delete unused Next import parsers | parse, apple-health parse/import, extract-from-image, legacy import | FastAPI preview + runs | ~−1.1k Next | second XML/OCR import owner | `xml2js`, `fast-xml-parser`, unused form/toast/slider packages | Live import UI already posts multipart to FastAPI. Screenshot OCR is `screenshot_analyzer.py` |
| Collapse import preview onto the catch-all | Next `/api/import/preview` FormData wrapper | catch-all multipart forwarding | ~−100 Next | second FastAPI import proxy | unused analytics/onboarding shims | Catch-all preserves multipart bytes and boundary. JSON callers still send `application/json` |
| Delete catch-all empty-payload fallbacks | GET stubs for connections/status/suggestions | FastAPI responses only | ~−40 | second invented BFF truth | leftover kibo-ui spinner wrapper | Dashed wearable path aliases remain. Whoop/Tesla OAuth code storage shares one in-memory store |
| Collapse Whoop/Tesla OAuth code bridges | two store-code routes + duplicated callbacks | one store-code route + shared callback helper | ~−150 | two identical desktop OAuth bridges | none | Provider redirect URIs stay on `/whoop/callback` and `/tesla/callback` |
| Delete unused wearable service facades | `unified_wearables_service.py` + `_impl.py` | `services.wearables_unified` only | ~−10 | unused compatibility re-export | none | Provider OAuth/sync behavior unchanged |
| Delete unused routines/bootstrap leftovers | unused `routines-ui.tsx` + unused bootstrap client | live routines pages + server bootstrap redirect | ~−750 | unused UI and a bootstrap client the server page never mounted | leftover Trigger.dev env keys | `shell_bootstrap` now records on the live root-providers path. Assistant-turn outbox drain is wired into chat |
| Delete leftover split-pane routines UI | unused list/detail/runs + old AI templates + ui helpers | compact list + configure modal + `lib/routines/templates.ts` | ~−1.4k | second unused routines surface | unused `lib/routines/ui.tsx` | Live routines still fetch runs for toasts/notifications |
| Collapse dashboard SSR fetchers onto the client catch-all | Midday `lib/server/data.ts` + metrics preload | client React Query + FastAPI catch-all | ~−400 | second habits/logs/summary fetch owner | unused `reference-task-shell.tsx` | Overview already skipped SSR. `?view=` still selects overview/metrics/chat |

## Aggregate (this pass)

```text
Production LOC before: ~192.5k (audit)
Remeasured 2026-08-21 after Next compatibility BFF collapse (tokei 14.0.0; generated backend client omitted from dashboard):
  Dashboard TS/TSX/JS + CSS: 88,129 (TSX 49,160)
  Shared packages TS/TSX + UI CSS: 9,641
  FastAPI Python excluding tests/scripts/migrations: 56,589
  Rust desktop/watcher/ritual-db: 34,886
  Desktop JS/JSX shell: 233
  Browser extension JS+HTML: 1,002
  Tinybird pipe/datasource authored: 2,085
  chat-api: 0
  Audit-comparable total: ~192.6k. Voice HUD, composer, and privacy restores added product code after the earlier ~184k snapshot. This slice reduces Next owners, not the restored product surface.
chat-api deployable: removed
Schedulers before/after: 2 → 1 (FastAPI loops only; Trigger.dev deleted)
Search/index systems before/after: 4 → 3 (SQL, Tinybird, MiniSearch). Typesense deleted on the release tree.
Frontend↔desktop paths before: commands + tauri-utils + desktop-runtime + runtime bridge + shell bridge + profiling
Frontend↔desktop paths after: NativeGateway barrel + generated command/capability/input/output triad; desktop-bridge is implementation; DesktopRuntimeBridge split into lifecycle owners; separate shell bootstrap
Assistant turn owner before/after: stream callbacks + dashboard drain + conversation_queue + SMS loop → AssistantKernel + assistant_turns + local outbox
Computer activity recent-desktop source: hidden mix → observable local | synced | unavailable
Native sidecars: rebuilt each macOS release → SHA-256 pinned for Apple Silicon (`aarch64-apple-darwin`) only. Intel is not a 0.1.1 ship target.
Dashboard production typecheck: green. `next build --webpack` compiles; local prerender needs Clerk keys.
```

Tests do not count against production reduction.

## Remaining architecture taxes

1. FastAPI `ui_preferences` remains because overview view mode and habit text color sync across devices.
2. Web/iOS and long-range desktop aggregates still read backend/Tinybird as explicit `synced`. Tinybird stays the analytics projection. FastAPI owns ingest and dashboard analytics reads.
3. `@mui/icons-material` and Lucide both remain (real call sites). Onboarding uses `eclipse.svg`, not a Paper shader logo. No giant icon rewrite.
4. 0.1.1 ships Apple Silicon only. `sidecar-lock.json` SHA-256 pins `ritual-watcher` and `ritual-vision-helper` for `aarch64-apple-darwin`. Intel Macs are not a release target.
5. Authored production LOC remasured at ~192.6k with the same tokei buckets (generated client omitted). The earlier ~184k snapshot predates restored product (voice HUD, composer, privacy). Remaining fat is live product plus calendar/OpenAI streaming in Next, not unused deployables.
6. Five-trial CI budgets gate fixture medians plus production launch/RSS instrumentation. Replacing those fixtures with live WKWebView captures is release QA, not missing architecture.
7. GitHub Actions in `ci.yml` and `desktop-release.yml` are pinned to commit SHAs (version tags remain in comments).
8. `DesktopRuntimeBridge` is split into lifecycle owners; native 45s poll is gone; `local_only` skips the habit websocket; legacy builds still poll.
9. Ops leftover after deploy: disable/delete the Trigger.dev cloud project so it cannot run in parallel with FastAPI. See `TRIGGER_DEV_OPS.md`.
