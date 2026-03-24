# Codex Preflight Audit

Date: March 21, 2026

## Executive Summary

Current recommendation: **GO WITH WAIVERS** for a tightly scoped beta, provided you complete one packaged-app smoke pass before distributing it.

What changed during this audit:

- Fixed desktop-only hosted-app gating by adding a stable desktop user agent in Tauri and enforcing it in the hosted Next middleware.
- Fixed timezone handling for memory queries so relative windows such as "today" resolve in the caller's timezone instead of server-local defaults.
- Fixed the biometrics stale-threshold contract drift and removed the deprecated `utcnow()` usage on that path.
- Fixed the frontend production build gate by forcing the verified webpack build path instead of the Next 16 default Turbopack path that was stalling.
- Reduced some production-noisy logging by removing unconditional Sentry bootstrap logs and a repeated provider initialization log during build/prerender.

Automated gate status from the current tree:

- `npm run contracts:typecheck`: pass
- `npm run typecheck`: pass
- `npm run lint`: pass
- `npm run build`: pass with only stale Browserslist baseline warnings
- `python3 -m pytest apps/backend/tests -q`: pass, 72 passed
- `cargo check --workspace --all-targets` in `apps/desktop/src-tauri`: pass
- `npm run desktop:updater:config`: pass
- `tauri build --config src-tauri/tauri.generated.production.conf.json --bundles none --debug --ci`: pass

Quantified status:

- P0 issues found: 7
- P0 issues fixed during audit: 5
- P0 issues remaining: 2
- P1 issues remaining: 1
- P2 issues remaining: 3
- Unverified release-critical areas: 3

## Stack And Architecture Summary

- Package manager / lockfile: npm with root `package-lock.json`
- Frontend: Next.js 16 App Router in `apps/dashboard`
- Desktop shell: Tauri 1.x + Rust in `apps/desktop/src-tauri`
- Backend: FastAPI + SQLAlchemy in `apps/backend`
- Local desktop data: watcher/activity SQLite and local search context
- Remote data / analytics: Turso/libSQL, Tinybird, Clerk, Sentry, OpenPanel
- Shared contracts: `packages/shared-contracts`
- Async jobs: Trigger.dev under `apps/dashboard/src/trigger`
- Release path: GitHub workflow + Tauri updater config + hosted Vercel dashboard

## Commands / Checks Run

- `git status --short`
- `git diff --stat`
- `npm run contracts:typecheck`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npm run desktop:updater:config`
- `python3 -m pytest apps/backend/tests -q`
- `python3 -m pytest apps/backend/tests/test_memory_golden_gate.py -q`
- `python3 -m pytest apps/backend/tests/test_biometrics_contract.py -q`
- `cargo check --workspace --all-targets`
- `cd apps/desktop && ../../node_modules/.bin/tauri build --config src-tauri/tauri.generated.production.conf.json --bundles none --debug --ci`
- targeted `rg`, `sed`, and direct script inspection across dashboard, backend, desktop, release, and report surfaces

## Findings By Severity

### P0 Launch Blockers Remaining

1. Signed/notarized packaged artifact is still unverified.
   - I validated generated production config creation and a `tauri build` compile path with `--bundles none`, but I did not generate a signed/notarized DMG or updater artifact in this environment.
   - `bash scripts/build-macos-desktop-release.sh` currently exits early in this shell because notarization credentials are not present.
   - Impact: final packaging can still fail on signing, notarization, or bundling even though compile-time validation now passes.

2. Packaged desktop smoke tests were not executed end-to-end from a real artifact.
   - Unverified flows include packaged launch, Clerk session restore, system-browser OAuth return, restart persistence, and an actual updater check against uploaded artifacts.
   - Impact: a launch can still fail in real user flows despite local code/build/test checks passing.

### P0 Fixed During Audit

1. Hosted product UI was not technically desktop-only.
   - Fixed by adding `RitualDesktop/0.1.0` as the authoritative Tauri webview user agent and gating hosted routes in `apps/dashboard/proxy.ts`.
   - Browser users are now redirected to `/desktop-only`, while required helper routes remain open.

2. Memory broad-overview queries used unstable local-date resolution.
   - Fixed by adding `timezone` to the memory query request path and resolving relative windows in `apps/backend/services/watcher_service_search.py` with `ZoneInfo`.

3. Biometrics stale-threshold contract was misaligned with tests.
   - Fixed by updating the contract test to use the service constant and by modernizing the UTC timestamp generation path.

4. `npm run build` was not a reliable production gate.
   - Fixed by changing the repo build scripts to use `next build --webpack`, which completes cleanly on the current tree.

5. Updater production config generation was previously unverified.
   - Fixed by validating `scripts/write-tauri-production-config.mjs`, which now writes `apps/desktop/src-tauri/tauri.generated.production.conf.json` with the GitHub Releases `latest.json` endpoint and updater public key.

### P1 High-Risk Remaining

1. Production logging is still noisier than it should be outside the highest-risk auth/onboarding surfaces.
   - I removed the Sentry bootstrap logs, provider-init log, and several auth/onboarding/integration success logs, but broader analytics/chat/tooling paths still emit production `console.log` traffic.
   - Impact: noisy logs reduce signal during beta incident response and can increase client/server console noise.

### P2 Cleanup / Follow-Up

1. `baseline-browser-mapping` is stale and warns during lint/build.
2. Confirmed unused dependencies remain installed:
   - `geist`
   - `react-markdown`
   - `remark-gfm`
3. `@emnapi/runtime` is present as an extraneous install.
4. Backend test warnings remain:
   - SQLAlchemy `declarative_base()` deprecation
   - Pydantic class-config deprecations
   - `test_backend.py` tests returning `True` instead of asserting

## Performance / Data-Efficiency Findings

- The biggest release-path performance issue was build reliability, not runtime render speed. The default Next 16 Turbopack build path stalled with no forward progress; webpack completes and should be treated as the production build path for this beta.
- The memory query path had a correctness issue that also affected perceived relevance and trust. Fixing timezone-aware windowing materially improves broad-overview accuracy for "today" and related queries.
- The React effect-warning hotspots were cleaned up during this pass, so the remaining frontend quality noise is mostly dependency and build-data related rather than immediate rerender churn.
- The repeated production logging in chat/analytics/auth paths is still unnecessary work and creates support noise even when it does not break correctness.

## Dependency Cleanup Summary

Validated non-use by repo search:

- `geist`
- `react-markdown`
- `remark-gfm`

Validated install-tree issue:

- `@emnapi/runtime` shows as extraneous in `npm ls --depth=0`

I did not complete lockfile/package cleanup because `npm uninstall` hung in this sandboxed environment. These are safe cleanup candidates, but they are not launch blockers.

## Feature Verification Summary

Verified or fixed by automated checks and code inspection:

- desktop webview user-agent wiring
- hosted desktop-only route gating
- updater production config generation
- production Tauri config compile path
- backend biometrics contracts
- backend memory query contracts
- frontend production build path
- backend suite and Rust desktop compile path

Still unverified manually:

- packaged app startup against production hosted URL
- Clerk sign-in/session restore inside packaged desktop webview
- system-browser OAuth roundtrip back into the desktop success flow
- updater check against uploaded release assets
- restart/reopen persistence

## Remaining Launch Risks

- Release artifact risk: signing/notarization and bundle generation still need a real artifact pass.
- Distribution risk: updater endpoint wiring is verified, but uploaded updater assets and client update checks are not.
- Auth/OAuth risk: packaged desktop flow was not manually exercised end-to-end in this audit.
- Operational noise risk: production logs are still verbose in several launch-critical surfaces.

## Recommended Next Steps

### Must Do Before Launch

1. Build a packaged macOS artifact from the current tree and confirm signing/notarization behavior.
2. Run the packaged desktop smoke tests:
   - launch
   - sign-in/session restore
   - Whoop OAuth
   - restart/reopen persistence
3. Validate updater feed and `latest.json` against the artifact you intend to ship.
4. Confirm the hosted production deployment is using the new desktop-only gate and that browser requests redirect to `/desktop-only`.

### This Week

1. Remove the remaining production-noisy `console.log` paths in analytics and chat/tool orchestration.
2. Remove the confirmed unused dependencies and clean the extraneous install state.
3. Update or intentionally suppress the stale Browserslist baseline data warning.
4. Decide whether to keep edge Sentry disabled for beta or restore it with a clean build path.

### Later

1. Resolve the Sentry edge runtime warning path if you want edge-side Sentry back after beta.
2. Revisit whether you want edge Sentry enabled in production once the build path is fully clean.
3. Clean backend deprecation warnings and weak test patterns.
4. Revisit whether Turbopack is production-safe for this repo before switching back from webpack.

## Launch Recommendation

**GO WITH WAIVERS**

Reasoning:

- The codebase-level blockers identified in this audit were fixed, and the automated gates now pass cleanly enough to support a limited beta.
- The remaining risk is operational, not architectural: packaged artifact validation, updater asset validation, and one real packaged smoke pass.
- If you are distributing to a small trusted beta group today, this tree is reasonable to ship once those last manual checks are complete.
