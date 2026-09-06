# Desktop Updates via GitHub Releases

Ritual desktop now uses GitHub Releases as its production update feed.

For the full rollout policy, including when to deploy web-only changes versus when to release a new desktop build, see [docs/desktop-release-playbook.md](/Users/nickgardner/Desktop/ritual-desktop-main/docs/desktop-release-playbook.md).

## Feed

- Stable updater endpoint: `https://github.com/NickGardner0/ritual-desktop-releases/releases/latest/download/latest.json`
- The desktop app bakes this endpoint into the production Tauri config at build time.
- The app checks for updates on startup and can be told to re-check from the tray menu.
- The updater assets live in the separate public repo `NickGardner0/ritual-desktop-releases` so the source repo can stay private.

## Policy

- Standard path: push a matching desktop version tag and let [desktop-release.yml](/Users/nickgardner/Desktop/ritual-desktop-main/.github/workflows/desktop-release.yml) build, notarize, sign updater artifacts, and publish the release.
- Fallback path: build locally and publish manually only when GitHub Actions is unavailable, release recovery is required, or you intentionally need a workstation-driven release.
- The CI path is the default source of truth for new desktop releases.

## Keys

- Public updater key: [apps/desktop/src-tauri/updater.pub](/Users/nickgardner/Desktop/ritual-desktop-main/apps/desktop/src-tauri/updater.pub)
- Private updater key: currently generated locally at `/private/tmp/ritual-updater.key`

Move the private key out of `/private/tmp` before release day and store it in GitHub Actions as `TAURI_SIGNING_PRIVATE_KEY`.

## Required GitHub Secrets

- `APPLE_CERTIFICATE_P12_BASE64`
- `APPLE_CERTIFICATE_PASSWORD`
- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if you later rotate to a password-protected updater key
- `DESKTOP_RELEASES_REPO_TOKEN`

Current key behavior:

- The current updater key is passwordless, but local signing still needs an explicit empty password.
- For local fallback releases, export `TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""`.
- In GitHub Actions, the workflow step environment already provides the empty value when no secret is configured.

Optional override:

- `APPLE_SIGNING_IDENTITY` if you do not want CI to use the committed `bundle.macOS.signingIdentity` from [apps/desktop/src-tauri/tauri.conf.json](/Users/nickgardner/Desktop/ritual-desktop-main/apps/desktop/src-tauri/tauri.conf.json)

Notarization can use either of these credential sets:

- Apple ID flow: `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`
- App Store Connect API key flow: `APPLE_API_KEY`, `APPLE_API_ISSUER`, plus either `APPLE_API_KEY_P8` or `APPLE_API_KEY_P8_BASE64`

The `DESKTOP_RELEASES_REPO_TOKEN` secret must be able to create and update releases in `NickGardner0/ritual-desktop-releases`.

## Release Flow

### Current recommended path

Today, the default release path is CI-driven:

1. Bump the desktop version in [apps/desktop/src-tauri/tauri.conf.json](/Users/nickgardner/Desktop/ritual-desktop-main/apps/desktop/src-tauri/tauri.conf.json).
2. Keep [apps/desktop/src-tauri/Cargo.toml](/Users/nickgardner/Desktop/ritual-desktop-main/apps/desktop/src-tauri/Cargo.toml) in sync.
3. Commit and push the release-prep changes.
4. Push a matching tag such as:

```bash
git tag -a v0.1.99 -m "Ritual desktop v0.1.99"
git push origin v0.1.99
```

5. Let [desktop-release.yml](/Users/nickgardner/Desktop/ritual-desktop-main/.github/workflows/desktop-release.yml) run on GitHub Actions. It now:
   - imports the Developer ID certificate into a temporary keychain
   - runs [scripts/build-macos-desktop-release.sh](/Users/nickgardner/Desktop/ritual-desktop-main/scripts/build-macos-desktop-release.sh)
   - creates or updates the matching release in `NickGardner0/ritual-desktop-releases`
   - uploads the notarized DMG, updater tarball, updater signature, app zip, and `latest.json`
   - validates the live updater feed after upload

6. After the workflow finishes, validate the updater feed again if you want an explicit local confirmation:

```bash
node scripts/validate-updater-artifacts.mjs --latest https://github.com/NickGardner0/ritual-desktop-releases/releases/latest/download/latest.json --check-urls
```

7. Run [docs/desktop-release-smoke-checklist.md](/Users/nickgardner/Desktop/ritual-desktop-main/docs/desktop-release-smoke-checklist.md).

### Local fallback path

Use this only when GitHub Actions is unavailable or you intentionally need to rerun the release from a workstation:

```bash
unset TAURI_PRIVATE_KEY TAURI_KEY_PATH TAURI_KEY_PASSWORD
export TAURI_SIGNING_PRIVATE_KEY_PATH="$HOME/.ritual-secrets/ritual-updater.key"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
export APPLE_ID="you@example.com"
export APPLE_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="D657T2LVR2"

npm run desktop:release:preflight
npm run desktop:release:mac
bash scripts/publish-apple-silicon-desktop-release-assets.sh v0.1.99
node scripts/validate-updater-artifacts.mjs --latest https://github.com/NickGardner0/ritual-desktop-releases/releases/latest/download/latest.json --check-urls
```

That fallback command writes a production-only Tauri config with the updater enabled, then builds signed `dmg` and `updater` artifacts.

## Validate Uploaded Updater Assets

After publishing the Release, validate the updater feed:

```bash
node scripts/validate-updater-artifacts.mjs --latest https://github.com/NickGardner0/ritual-desktop-releases/releases/latest/download/latest.json --check-urls
```

Then run the packaged-app checks in [docs/desktop-release-smoke-checklist.md](/Users/nickgardner/Desktop/ritual-desktop-main/docs/desktop-release-smoke-checklist.md).
