# Desktop Release Smoke Checklist

Run this after building a signed desktop artifact and before sharing it with beta users.

## Packaged App

- Launch the packaged app from the DMG-installed location, not from a dev build.
- Run this checklist independently on an Apple Silicon Mac and a real Intel Mac.
- Confirm `file` and `shasum -a 256` match the target entries in `binaries/sidecar-lock.json`.
- Confirm diagnostics report the expected product name, bundle ID, callback scheme, target, executable path, backend base, and channel-specific app-data root.
- Confirm the app opens the hosted production UI instead of a localhost URL.
- Confirm the normal browser is blocked from the hosted app and redirected to `/desktop-only`.

## Auth

- Sign in from the packaged app with the app initially closed, then again with it already open.
- Confirm the browser progresses from pending to consumed to acknowledged.
- Confirm the custom-scheme callback contains no verifier or Clerk ticket, then prove replay, wrong-channel, wrong-binary, expired, and wrong-protocol callbacks fail without consuming another handoff.
- Quit and reopen the app.
- Confirm the session is restored without a sign-in loop.

## OAuth

- Start a Whoop connection from the packaged app.
- Confirm the system browser opens.
- Complete the OAuth flow.
- Confirm the browser lands on the integration success page and the packaged app reflects the connected state.

## Updater

- Publish or stage the release assets and `latest.json`.
- Run:

```bash
node scripts/validate-updater-artifacts.mjs --latest https://github.com/NickGardner0/ritual-desktop-releases/releases/latest/download/latest.json --check-urls
```

- From the packaged desktop app, trigger an update check.
- Confirm the updater does not show a feed/signature error.
- Repeat manifest validation with `--platform darwin-aarch64` and `--platform darwin-x86_64`.

## Watcher and Window QA

- With tracking enabled, confirm watcher readiness precedes PID/RSS and RSS is nonzero.
- With tracking never enabled or disabled, confirm PID/RSS are null with a reason—not zero.
- In QA, confirm Cmd+R and View → Reload Ritual reload only the focused main WKWebView.
- Run `npm run desktop:diagnostics -- --json`; require `ignoresMouseEvents=false`, `windowLevel=0`, and `hitTestable=true`.
- Capture the declared opaque/glass/hit-test points with `npm run desktop:qa:capture -- --channel qa`; require fully opaque main/hit samples and a window-title acknowledgement from the real WKWebView click target.
- Confirm the production build has no Reload Ritual menu item or handler.

## Core Product

- Load dashboard, analytics, chat, and settings once each.
- Confirm watcher/device settings render.
- Confirm desktop-only search/activity surfaces render without auth or API errors.
- Quit and reopen the app one more time to confirm restart persistence.
