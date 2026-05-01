# Desktop Release Playbook

This is the standard release process for Ritual desktop.

Use this document when shipping:

- a new downloadable desktop build
- a hosted web/dashboard deploy that desktop users will load
- a change that touches both the hosted app and the native Tauri shell

## Architecture

Ritual desktop ships as two layers:

- Hosted app: the desktop shell loads the production web UI from `https://desktop.ritualdb.com`
- Native shell: the Tauri/Rust app is updated through GitHub Releases and Tauri updater artifacts

That means:

- web-only changes can ship without a new desktop binary
- native changes require a new desktop release
- mixed changes must be rolled out in the correct order

## Default Rule

When in doubt:

1. Ship the desktop release first.
2. Let users update.
3. Then ship the hosted web change that depends on the new native behavior.

Do not force a minimum desktop version before the compatible desktop build has already been released and had time to propagate.

## Release Path Policy

- Standard path: CI tag-driven release through [desktop-release.yml](/Users/nickgardner/Desktop/ritual-desktop-main/.github/workflows/desktop-release.yml).
- Fallback path: local preflight + local build + manual asset publish only when CI is unavailable, release recovery is required, or you intentionally need a workstation-driven release.
- Treat the CI path as the default source of truth for new desktop releases.

## Release Types

### 1. Web-only release

Use this when the change only affects hosted dashboard behavior and does not require new Tauri commands, new native permissions, or new shell behavior.

Steps:

1. Deploy the dashboard normally.
2. Smoke test the hosted production app inside an installed desktop build.
3. Do not bump the desktop version.
4. Do not set `NEXT_PUBLIC_DESKTOP_MIN_VERSION` unless the web deploy truly requires a newer shell.

### 2. Native-only release

Use this when the change affects:

- `apps/desktop/src-tauri/**`
- updater behavior
- tray behavior
- permissions
- deep links
- watchers/recorder/native commands

Steps:

1. Bump the desktop version in [apps/desktop/src-tauri/tauri.conf.json](/Users/nickgardner/Desktop/ritual-desktop-main/apps/desktop/src-tauri/tauri.conf.json).
2. Keep [apps/desktop/src-tauri/Cargo.toml](/Users/nickgardner/Desktop/ritual-desktop-main/apps/desktop/src-tauri/Cargo.toml) in sync.
3. Push a tag such as `v0.1.1`.
4. Let [desktop-release.yml](/Users/nickgardner/Desktop/ritual-desktop-main/.github/workflows/desktop-release.yml) build and publish the release.
5. Validate the updater feed and run the packaged smoke checklist.

### 3. Mixed web + native release

Use this when the hosted web app expects new native capabilities.

Examples:

- new Tauri commands
- changed command signatures
- new native update behavior
- new desktop-only feature flags or capability requirements

Safe order:

1. Merge the native-compatible code.
2. Release the new desktop build first.
3. Validate the installed-app update path.
4. Wait for the desktop release to be available to users.
5. Deploy the hosted web change.
6. Only then enforce a minimum desktop version if needed.

## Standard Desktop Release Flow

1. Confirm the tree is ready for release.
2. Bump the desktop version in [apps/desktop/src-tauri/tauri.conf.json](/Users/nickgardner/Desktop/ritual-desktop-main/apps/desktop/src-tauri/tauri.conf.json).
3. Keep [apps/desktop/src-tauri/Cargo.toml](/Users/nickgardner/Desktop/ritual-desktop-main/apps/desktop/src-tauri/Cargo.toml) in sync.
4. Commit and push the release-prep changes.
5. Push a matching tag and let CI build and publish the release:

```bash
git tag -a v0.1.53 -m "Ritual desktop v0.1.53"
git push origin v0.1.53
```

6. Validate the updater artifacts:

```bash
node scripts/validate-updater-artifacts.mjs --latest https://github.com/NickGardner0/ritual-desktop-releases/releases/latest/download/latest.json --check-urls
```

7. Run [docs/desktop-release-smoke-checklist.md](/Users/nickgardner/Desktop/ritual-desktop-main/docs/desktop-release-smoke-checklist.md).

## Local Fallback Desktop Release Flow

Use this only when GitHub Actions is unavailable or you intentionally need a manual workstation build.

1. Export local notarization and updater signing variables:

```bash
unset TAURI_PRIVATE_KEY TAURI_KEY_PATH TAURI_KEY_PASSWORD
export TAURI_SIGNING_PRIVATE_KEY_PATH="$HOME/.ritual-secrets/ritual-updater.key"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
export APPLE_ID="you@example.com"
export APPLE_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="D657T2LVR2"
```

2. Run:

```bash
npm run desktop:release:preflight
npm run desktop:release:mac
bash scripts/publish-desktop-release-assets.sh v0.1.53
```

3. Validate the updater artifacts:

```bash
node scripts/validate-updater-artifacts.mjs --latest https://github.com/NickGardner0/ritual-desktop-releases/releases/latest/download/latest.json --check-urls
```

4. Run [docs/desktop-release-smoke-checklist.md](/Users/nickgardner/Desktop/ritual-desktop-main/docs/desktop-release-smoke-checklist.md).

## Standard Web Release Flow

1. Deploy the dashboard.
2. Open the deployed app inside a real installed desktop build.
3. Confirm the critical desktop surfaces still work:
   - auth
   - dashboard load
   - analytics/settings
   - integrations
   - desktop-only Tauri features used by the changed area
4. If the web deploy depends on a new shell, stop and convert the rollout to the mixed release flow above.

## Version Gating

The hosted app can block unsupported desktop shells using:

- `NEXT_PUBLIC_DESKTOP_MIN_VERSION`
- `NEXT_PUBLIC_DESKTOP_REQUIRED_CAPABILITIES`

Current guidance:

- prefer `NEXT_PUBLIC_DESKTOP_MIN_VERSION` for most rollouts
- use `NEXT_PUBLIC_DESKTOP_REQUIRED_CAPABILITIES` only when you need feature-level gating

### When to set `NEXT_PUBLIC_DESKTOP_MIN_VERSION`

Set it only after:

1. the required desktop build has been released
2. the updater path has been validated
3. you are ready for older shells to be blocked until they update

Example:

```bash
NEXT_PUBLIC_DESKTOP_MIN_VERSION=0.1.1
```

This means the hosted app should only run on desktop shell `0.1.1` or newer.

### When to set `NEXT_PUBLIC_DESKTOP_REQUIRED_CAPABILITIES`

Use this when the web app depends on specific native capabilities rather than a broad version floor.

Example:

```bash
NEXT_PUBLIC_DESKTOP_REQUIRED_CAPABILITIES=native-updater-v1,desktop-runtime-info-v1
```

Only do this if the capability names are already exposed by the shipped desktop runtime.

## Hard Rules

- Do not deploy a hosted web change that assumes a new native command before the matching desktop build is live.
- Do not set a minimum desktop version before the compatible desktop build has shipped.
- Do not treat `latest.json` generation as enough; always validate the published updater feed.
- Do not skip the installed-app smoke test for updater changes.

## Required Smoke Tests Before Broad Rollout

- packaged app launches from installed location
- production URL loads, not localhost
- sign-in and session restore work
- tray `Check for Updates` works
- startup update check works
- one real installed-app update works from an older build to the new build
- changed product surfaces work inside the packaged app

## Quick Decision Table

- Web UI only: deploy dashboard
- Native shell only: release desktop
- Web depends on native: release desktop first, then deploy web, then optionally enforce min version

## Related Docs

- [docs/desktop-github-releases.md](/Users/nickgardner/Desktop/ritual-desktop-main/docs/desktop-github-releases.md)
- [docs/desktop-release-smoke-checklist.md](/Users/nickgardner/Desktop/ritual-desktop-main/docs/desktop-release-smoke-checklist.md)
