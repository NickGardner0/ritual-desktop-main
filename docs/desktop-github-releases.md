# Desktop Updates via GitHub Releases

Ritual desktop now uses GitHub Releases as its production update feed.

For the full rollout policy, including when to deploy web-only changes versus when to release a new desktop build, see [docs/desktop-release-playbook.md](/Users/nickgardner/Desktop/ritual-desktop-main/docs/desktop-release-playbook.md).

## Feed

- Stable updater endpoint: `https://github.com/NickGardner0/ritual-desktop-main/releases/latest/download/latest.json`
- The desktop app bakes this endpoint into the production Tauri config at build time.
- The app checks for updates on startup and can be told to re-check from the tray menu.
- The GitHub Release must be published normally and its assets must be publicly downloadable for the updater feed to work.

## Keys

- Public updater key: [apps/desktop/src-tauri/updater.pub](/Users/nickgardner/Desktop/ritual-desktop-main/apps/desktop/src-tauri/updater.pub)
- Private updater key: currently generated locally at `/private/tmp/ritual-updater.key`

Move the private key out of `/private/tmp` before release day and store it in GitHub Actions as `TAURI_PRIVATE_KEY`.

## Required GitHub Secrets

- `APPLE_ID`
- `APPLE_PASSWORD`
- `APPLE_TEAM_ID`
- `TAURI_PRIVATE_KEY`
- `TAURI_KEY_PASSWORD` if you later rotate to a password-protected updater key

## Release Flow

1. Bump the desktop version in [apps/desktop/src-tauri/tauri.conf.json](/Users/nickgardner/Desktop/ritual-desktop-main/apps/desktop/src-tauri/tauri.conf.json).
2. Commit the version bump to `main`.
3. Push a Git tag like `v0.1.1`.
4. GitHub Actions runs [.github/workflows/desktop-release.yml](/Users/nickgardner/Desktop/ritual-desktop-main/.github/workflows/desktop-release.yml).
5. GitHub publishes a normal Release so `/releases/latest/download/latest.json` stays valid for the updater.

## Local Release Build

```bash
export APPLE_ID="you@example.com"
export APPLE_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="D657T2LVR2"
export TAURI_PRIVATE_KEY="/private/tmp/ritual-updater.key"
npm run desktop:release:preflight
npm run desktop:release:mac
```

That command writes a production-only Tauri config with the updater enabled, then builds signed `dmg` and `updater` artifacts.

## Validate Uploaded Updater Assets

After publishing the Release, validate the updater feed:

```bash
node scripts/validate-updater-artifacts.mjs --latest https://github.com/NickGardner0/ritual-desktop-main/releases/latest/download/latest.json --check-urls
```

Then run the packaged-app checks in [docs/desktop-release-smoke-checklist.md](/Users/nickgardner/Desktop/ritual-desktop-main/docs/desktop-release-smoke-checklist.md).
