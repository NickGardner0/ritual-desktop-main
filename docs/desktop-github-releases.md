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

### Current recommended path

Today, the safest release path is:

1. Build locally with [scripts/build-macos-desktop-release.sh](/Users/nickgardner/Desktop/ritual-desktop-main/scripts/build-macos-desktop-release.sh) through:

```bash
npm run desktop:release:preflight
npm run desktop:release:mac
```

2. Create the Git tag, for example:

```bash
git tag v0.1.1
git push origin v0.1.1
```

3. Create the GitHub Release manually in the GitHub web UI.
4. Upload the local release artifacts:
   - DMG
   - updater tarball
   - updater signature
   - `latest.json`
5. Publish the release so `/releases/latest/download/latest.json` becomes the live updater feed.

### Why manual release upload is currently preferred

The local release script contains the macOS sidecar-signing workaround for `ritual-watcher`, while the current GitHub Actions workflow still uses the simpler Tauri Action path. Until the workflow is updated to reproduce the same signing/notarization flow, local build + manual GitHub Release upload is the reliable option.

### Future goal

Once `.github/workflows/desktop-release.yml` is updated to use the same sidecar-signing flow as the local release script, tag-only automated releases can become the default path again.

## Local Release Build

```bash
export APPLE_ID="you@example.com"
export APPLE_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="D657T2LVR2"
export TAURI_PRIVATE_KEY="$HOME/.ritual-secrets/ritual-updater.key"
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
