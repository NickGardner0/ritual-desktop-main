# Codex Feature Matrix

Date: March 21, 2026

| Feature / Component | Area / Module | Expected Behavior | Validation Method | Status | Notes / Issues |
| --- | --- | --- | --- | --- | --- |
| Desktop shell startup and hosted UI boot | `apps/desktop/src-tauri/src/main.rs`, `apps/desktop/src-tauri/tauri.conf.json` | Packaged app opens the main hosted Ritual UI in a desktop webview | `cargo check`, code inspection | fixed | Desktop user agent now explicitly set on main and sidebar windows |
| Browser blocking for hosted app | `apps/dashboard/proxy.ts`, `apps/dashboard/app/desktop-only/page.tsx` | Normal browsers are redirected away from the product UI; desktop webview can access it | code inspection, production build route inventory | fixed | Public exceptions kept for landing/legal/OAuth helper routes |
| Desktop auth and session restore | Clerk auth routes, dashboard auth pages, Tauri hosted shell | Desktop users can sign in and return to the app without browser-only gating failures | code inspection, production-noise cleanup on auth surfaces | unverified | Needs packaged smoke test |
| Desktop OAuth callback / integration success flow | `apps/dashboard/app/api/integrations/whoop/*`, `apps/dashboard/app/integrations/success/page.tsx` | OAuth completes in system browser and returns cleanly to desktop success path | route inspection, build route inventory | at risk | Preserved in browser-accessible allowlist, but not manually tested end-to-end |
| Onboarding / first-run flow | `apps/dashboard/app/onboarding/*`, `apps/dashboard/app/welcome` | New desktop users can complete onboarding and reach the dashboard | route inventory, code inspection | unverified | No runtime walkthrough performed |
| Dashboard navigation and static surfaces | dashboard app routes and layout components | Core app routes render and route structure is internally consistent | successful production build | verified | Route inventory built cleanly |
| Chat / semantic lookup | `apps/dashboard/app/api/chat/*`, `apps/backend/services/watcher_service_search.py` | Focused memory questions return grounded evidence and proper intent routing | backend tests, targeted inspection | verified | Semantic lookup and evidence timeline paths pass local contract coverage |
| Broad overview / “what did I do today?” | dashboard chat tools + backend memory query service | Relative-date queries honor user timezone and return current-day evidence | backend tests, targeted fixture verification | fixed | Timezone is now threaded from dashboard callers into backend resolution |
| Time-spent / activity summaries | watcher stats routes, screen-search tools, memory query service | Time aggregation and computer activity breakdowns return correct activity windows | backend tests, code inspection | verified | Local golden gate now deterministic under pytest by forcing local mode |
| Biometrics freshness contract | `apps/backend/services/biometrics_service.py`, biometrics tests | Live biometrics become stale only after the intended threshold | pytest contract tests | fixed | Service and tests now share the same threshold contract |
| Settings / modal state sync | settings modal, kanban dialog/hooks, activity logs filters | UI opens and syncs state without render cascades | lint + code inspection | verified | Previous `setState`-in-effect warnings were removed in this audit pass |
| Desktop watcher / device control routes | `apps/dashboard/app/api/watcher/*`, backend watcher services | Device listing, start/stop, stats, and sync endpoints remain reachable | route inspection, compile/test checks | verified | No packaged desktop manual validation performed |
| Legal / privacy / retention pages | `apps/dashboard/app/privacy`, `apps/dashboard/app/data-retention`, `apps/dashboard/app/desktop-only` | Browser users can reach legal/download surfaces even when app UI is blocked | production build route inventory | verified | Explicitly preserved in middleware allowlist |
| Production frontend build path | root/app dashboard build scripts, `apps/dashboard/next.config.mjs` | `npm run build` completes consistently for the current tree | `npm run build` | fixed | Repo now builds cleanly on webpack; Turbopack path was stalling |
| Release packaging / signing / notarization | Tauri config, release scripts, GitHub workflow | macOS artifact builds and is acceptable to Gatekeeper | workflow inspection, generated-config compile validation | at risk | Production config compiles, but signed/notarized artifact generation was not completed in this audit |
| Updater feed / release metadata | updater config, release workflow, `latest.json` path | Desktop clients can check for and parse updates successfully | `desktop:updater:config`, code inspection | at risk | GitHub Releases endpoint and updater key are wired; uploaded updater assets still need end-to-end validation |

## Notes

- `verified` means validated by local automated checks and code-path inspection, not by a packaged end-to-end desktop QA pass.
- `fixed` means a concrete launch-relevant issue was found during the audit and patched.
- `at risk` means the surface likely works but still has a known warning, missing runtime verification, or observable quality issue.
