# Watcher lifecycle and launch evidence

## Ownership

The desktop watcher has one native lifecycle owner in `apps/desktop/src-tauri/src/watcher`. The hosted dashboard can request enable/disable, but it does not decide readiness or sample the sidecar process directly.

Preference schema v2 distinguishes `never_enabled`, `enabled`, and `disabled_by_user`. A missing preference is `never_enabled`; a legacy plain `WatcherConfig` migrates atomically to an enabled v2 envelope. Disabling retains the last configuration only for exact-device orphan cleanup. Production uses `~/.ritual`, QA uses `~/.ritual-qa`, and development uses `~/.ritual-dev`. Only production can migrate the legacy production preference. The explicit QA seed command copies preference intent/settings and refuses to copy activity, auth, vault, or outbox data:

```bash
npm run desktop:watcher:seed-qa
```

## Readiness and telemetry

Lifecycle states are `never_enabled`, `disabled_by_user`, `disabled_no_permission`, `starting`, `ready`, `failed`, and `backoff`. Process spawn is not readiness. The watcher must be reachable with a fresh heartbeat before the native owner emits `desktop://watcher-ready` and samples RSS. Readiness monitoring is bounded to 20 seconds and never blocks UI startup.

The native event contract is:

- `desktop://watcher-start-requested`
- `desktop://watcher-ready`
- `desktop://watcher-failed`
- `desktop://watcher-rss-sampled`

Enabled RSS is accepted only after readiness and only when it is greater than zero. A disabled or never-enabled watcher is serialized with a null RSS, `not_applicable`, and a reason. `native_ready` remains a shell milestone and cannot satisfy watcher readiness.

## Evidence status

`tools/performance/launch-budgets.json` schema v2 truthfully labels the legacy ten debug samples as fixtures. Their missing watcher samples are null/not-applicable, not zero. The release-evidence status remains `incomplete`; fixtures exercise the parser and budget checker but cannot close the release gate.

Live capture uses a signed production-shaped app and writes raw per-trial logs plus SHA-256 provenance:

```bash
npm run perf:launch:capture -- --channel production --tracking enabled --cold 5 --warm 5
npm run perf:launch:capture -- --channel production --tracking disabled --cold 5 --warm 5
```

Closing evidence requires five cold and five warm enabled trials and five cold and five warm disabled trials on the supported Apple Silicon release. Enabled trials require a ready PID and nonzero RSS; disabled trials require null/not-applicable RSS. Signed release captures remain a Phase 4 gate.

`npm run perf:launch:release-check` is the strict release gate and fails while that evidence is incomplete. The ordinary repository check continues to validate fixture parsing while reporting the incomplete release status explicitly.

## Compatibility and rollback

The v1 plain preference remains readable for one native release. Rolling back consumers does not change the v2 file or reinterpret null as zero. A rollback may disable FastAPI/dashboard telemetry consumption, but it must preserve channel-isolated activity stores and must not copy QA/development activity into production or vice versa.
