# Desktop Release Smoke Checklist

Run this after building a signed desktop artifact and before sharing it with beta users.

## Packaged App

- Launch the packaged app from the DMG-installed location, not from a dev build.
- Confirm the app opens the hosted production UI instead of a localhost URL.
- Confirm the normal browser is blocked from the hosted app and redirected to `/desktop-only`.

## Auth

- Sign in from the packaged app.
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

## Core Product

- Load dashboard, analytics, chat, and settings once each.
- Confirm watcher/device settings render.
- Confirm desktop-only search/activity surfaces render without auth or API errors.
- Quit and reopen the app one more time to confirm restart persistence.
