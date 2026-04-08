# Desktop Shell Hardening Checklist

This checklist scopes the Tauri/desktop improvements into low-risk release slices.
It intentionally avoids watcher, recorder, activity DB, cloud sync, and updater logic.

## Guardrails

- Do not combine shell hardening with watcher/database/cloud-sync architecture changes.
- Put every new shell behavior behind a runtime flag.
- Keep existing `invoke` command compatibility until the bridge is proven.
- Verify signed-in launch, signed-out launch, offline launch, auth callback, tray reopen, updater check, watcher health, local capture freshness, and cloud sync after each release.

## Release 0.1.24

Goal: bridge cleanup and structured shell observability only.

### Ticket 0.1.24-A: Add desktop bridge modules

Files:
- `/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/lib/desktop-bridge/commands.ts`
- `/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/lib/desktop-bridge/runtime.ts`
- `/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/lib/desktop-bridge/observability.ts`
- `/Users/nickgardner/Desktop/ritual-desktop-main/apps/desktop/src/desktop-shell-bridge.js`

Checklist:
- Add one `invokeDesktopCommand` wrapper for hosted dashboard code.
- Add one `openDesktopExternalUrl` wrapper for hosted dashboard code.
- Add one `recordDesktopShellEvent` wrapper for hosted dashboard code.
- Add one small bridge module for the packaged local shell used by `DesktopShellApp.jsx`.
- Keep existing exported APIs in `tauri-utils.ts`, `desktop-runtime.ts`, and `native-voice.ts` working by routing them through the new bridge.

Release impact:
- Desktop release: yes
- Vercel deploy: yes

### Ticket 0.1.24-B: Add native shell observability command

Files:
- `/Users/nickgardner/Desktop/ritual-desktop-main/apps/desktop/src-tauri/src/desktop_observability.rs`
- `/Users/nickgardner/Desktop/ritual-desktop-main/apps/desktop/src-tauri/src/main.rs`

Checklist:
- Add a new Tauri command for structured shell events.
- Support event levels: `info`, `warn`, `error`.
- Log event name plus JSON payload into `ritual-desktop.log`.
- Keep payload logging best-effort and non-fatal.
- Register the new command in `main.rs`.

Release impact:
- Desktop release: yes
- Vercel deploy: no

### Ticket 0.1.24-C: Log shell/bootstrap lifecycle

Files:
- `/Users/nickgardner/Desktop/ritual-desktop-main/apps/desktop/src/DesktopShellApp.jsx`
- `/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/app/desktop/bootstrap/page-client.tsx`
- `/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/lib/tauri-utils.ts`
- `/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/lib/desktop-runtime.ts`
- `/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/lib/native-voice.ts`

Checklist:
- Emit shell events for:
  - bootstrap config loaded
  - hosted reachability success/failure
  - redirect start
  - fallback UI shown
  - retry clicked
  - open in browser
  - backend bootstrap ready/error
  - desktop frontend ready
  - desktop auth handoff attempted/failed
- Do not change navigation behavior in this release.
- Do not add auto-recovery yet.

Release impact:
- Desktop release: yes
- Vercel deploy: yes

## Release 0.1.25

Goal: report-only navigation gate and deep-link normalization.

### Ticket 0.1.25-A: Add navigation policy in report mode

Files:
- `/Users/nickgardner/Desktop/ritual-desktop-main/apps/desktop/src-tauri/src/main.rs`
- `/Users/nickgardner/Desktop/ritual-desktop-main/apps/desktop/src-tauri/tauri.conf.json`
- Optional new file:
  - `/Users/nickgardner/Desktop/ritual-desktop-main/apps/desktop/src-tauri/src/desktop_navigation.rs`

Checklist:
- Define approved internal origins for production, staging, and dev.
- Add `RITUAL_DESKTOP_NAV_GATE_MODE=off|report|enforce`.
- In `report` mode, log internal vs external navigation decisions.
- Keep existing behavior unchanged while telemetry is gathered.

Release impact:
- Desktop release: yes
- Vercel deploy: no

### Ticket 0.1.25-B: Normalize deep-link routing

Files:
- `/Users/nickgardner/Desktop/ritual-desktop-main/apps/desktop/src-tauri/src/main.rs`
- `/Users/nickgardner/Desktop/ritual-desktop-main/apps/desktop/src-tauri/src/desktop_runtime.rs`
- `/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/app/auth/callback/page.tsx`
- `/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/app/desktop/bootstrap/page-client.tsx`

Checklist:
- Add one native deep-link queue.
- Focus/show main window before delivery.
- Queue deep link if frontend is not ready.
- Deliver via one consistent event payload once frontend is ready.
- Preserve existing auth callback behavior during rollout.

Release impact:
- Desktop release: yes
- Vercel deploy: yes

## Release 0.1.26

Goal: hosted shell heartbeat/recovery and enforced navigation gate.

### Ticket 0.1.26-A: Add hosted shell heartbeat

Files:
- `/Users/nickgardner/Desktop/ritual-desktop-main/apps/desktop/src-tauri/src/desktop_runtime.rs`
- `/Users/nickgardner/Desktop/ritual-desktop-main/apps/desktop/src-tauri/src/main.rs`
- `/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/app/desktop/bootstrap/page-client.tsx`
- `/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/app/home-client.tsx`
- Optional new file:
  - `/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/lib/desktop-bridge/heartbeat.ts`

Checklist:
- Add a shell heartbeat separate from watcher heartbeat.
- Expose shell health in desktop runtime state.
- Add `RITUAL_DESKTOP_SHELL_HEARTBEAT=0|1`.
- Show recovery UI before enabling auto-reload.
- Add `RITUAL_DESKTOP_SHELL_AUTO_RECOVER=0|1` for later activation.

Release impact:
- Desktop release: yes
- Vercel deploy: yes

### Ticket 0.1.26-B: Turn navigation gate to enforce

Files:
- `/Users/nickgardner/Desktop/ritual-desktop-main/apps/desktop/src-tauri/src/main.rs`
- `/Users/nickgardner/Desktop/ritual-desktop-main/apps/desktop/src-tauri/tauri.conf.json`

Checklist:
- Use telemetry from `0.1.25`.
- Enforce approved internal origins only.
- Open everything else externally.
- Reduce `dangerousRemoteDomainIpcAccess` to the minimum set that still supports the hosted shell.

Release impact:
- Desktop release: yes
- Vercel deploy: no

## Test Matrix

Run after every release candidate:

- Signed-in cold launch
- Signed-out cold launch
- Offline cold launch
- Auth callback via `ritual://`
- Deep link while app already open
- External URL opens in browser
- Allowed Ritual URL stays in app
- Tray reopen
- Manual updater check
- Watcher healthy for 30 minutes
- Local capture freshness still current
- Cloud sync backlog drains

## Non-Goals

- No Tauri 2 migration in these releases
- No watcher refactor
- No recorder refactor
- No activity DB schema/open-path changes
- No cloud sync redesign
