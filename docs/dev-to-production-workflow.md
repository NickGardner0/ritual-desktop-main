# Dev To Production Workflow

This is the practical workflow for building Ritual quickly without constantly deploying directly to production.

Use this document when you want to:

- build features fast in local dev
- test desktop behavior before production
- use preview deployments instead of touching production for every change
- understand when a Vercel deploy is enough versus when a new desktop release is required

## Core Rule

Do not use production as your main development environment.

The default path should be:

1. build locally
2. validate locally
3. use preview deployments when needed
4. promote to production only when the feature is ready

That keeps Vercel and Railway deploys reserved for validation and release, not for everyday iteration.

## Architecture

Ritual desktop is split into three moving parts:

- Hosted dashboard UI on `https://desktop.ritualdb.com`
- Hosted backend API on Railway
- Native macOS Tauri shell distributed separately through GitHub Releases

That means different kinds of changes ship in different ways.

## Fastest Local Development Loop

### Frontend only

Run the dashboard locally:

```bash
npm run dev
```

This serves the UI on `http://localhost:3000`.

### Backend only

Run the backend locally:

```bash
npm run dev:backend
```

This serves the backend on `http://localhost:8000`.

### Desktop + local UI

Run the desktop shell against local frontend:

```bash
npm run desktop
```

or, if you want a clean local desktop session:

```bash
npm run desktop:fresh
```

In debug mode, the desktop shell defaults to `http://localhost:3000`, so local desktop development should not require any Vercel deploy.

## Best Workflow By Change Type

### 1. Web-only change

Examples:

- layout tweaks
- auth page changes
- analytics/dashboard rendering
- integrations page UI
- backend-independent frontend logic

Recommended workflow:

1. build locally with `npm run dev`
2. validate in local browser
3. validate in local desktop with `npm run desktop`
4. push a branch
5. review the Vercel preview deploy
6. merge to production when ready

You do not need a new desktop build for web-only changes.

### 2. Backend-only change

Examples:

- FastAPI endpoints
- sync logic
- database writes
- integration token handling

Recommended workflow:

1. run backend locally with `npm run dev:backend`
2. test frontend locally against local backend
3. only deploy to Railway when the backend change is ready

If the change is large or risky, create a separate Railway staging service instead of repeatedly deploying production.

### 3. Desktop/native change

Examples:

- Tauri/Rust changes
- tray behavior
- updater behavior
- native watcher changes
- deep links
- permissions
- window behavior

Recommended workflow:

1. validate locally with `npm run desktop`
2. if needed, run local production-like validation with:

```bash
npm run desktop:prod
```

3. when ready, build a new desktop release
4. publish a new GitHub Release so installed apps can update

Web deploys alone do not ship native changes.

### 4. Mixed change

Examples:

- web UI depends on a new Tauri command
- hosted app expects new native updater/runtime behavior
- integrations UI depends on new native watcher capabilities

Recommended workflow:

1. build and test locally first
2. ship the new desktop release first
3. let users update
4. then deploy the hosted frontend/backend change

If the web app requires the new shell, use the compatibility gate only after the compatible desktop build has already shipped.

## How To Use Preview Deployments Without Touching Production

### Frontend preview

Push a branch and let Vercel build a preview deployment.

You can test the desktop shell against a preview URL by overriding the app URL when launching the desktop app:

```bash
RITUAL_APP_URL="https://your-preview-url.vercel.app" npm run desktop
```

or for a production-style local run:

```bash
RITUAL_APP_URL="https://your-preview-url.vercel.app" npm run desktop:prod
```

This is the safest way to test hosted frontend changes without changing `desktop.ritualdb.com`.

### Backend preview

There is no free instant preview environment for Railway by default in this repo. For fast iteration:

- use local backend for most work
- reserve Railway production for finalized backend changes
- if backend changes are frequent and risky, create a dedicated staging Railway service

## Recommended Release Policy

### During active feature work

- stay local by default
- use Vercel preview for frontend review
- avoid Railway production until the backend change is ready
- avoid rebuilding the desktop app unless the change is actually native

### When promoting to production

- web-only change: deploy Vercel
- backend-only change: deploy Railway
- native change: publish a new desktop release
- mixed change: desktop release first, then Vercel/Railway

## Current Desktop Release Reality

Today, the reliable desktop release path is:

1. build locally with:

```bash
npm run desktop:release:preflight
npm run desktop:release:mac
```

2. publish the GitHub Release manually with the generated artifacts

This is because the local release script contains the macOS sidecar-signing workaround for `ritual-watcher`, while the current GitHub Actions workflow still uses the simpler Tauri action path.

Until CI is updated to use the same workaround, manual release publishing is the safe path.

## Current Release Artifacts

For each desktop release, upload these files:

- DMG
- updater tarball
- updater signature
- `latest.json`

For example, for `0.1.1`:

- `apps/desktop/src-tauri/target/release/bundle/dmg/ritual-desktop_0.1.1_aarch64.dmg`
- `apps/desktop/src-tauri/target/release/bundle/updater/ritual-desktop.app.tar.gz`
- `apps/desktop/src-tauri/target/release/bundle/updater/ritual-desktop.app.tar.gz.sig`
- `apps/desktop/src-tauri/target/release/bundle/updater/latest.json`

## Safe Day-To-Day Workflow

Use this as the default:

1. work on a feature branch
2. run frontend locally
3. run backend locally when needed
4. run desktop locally when the feature touches desktop behavior
5. push branch and review Vercel preview
6. only then deploy to production
7. only build a new desktop release if native code changed

## Anti-Patterns To Avoid

- changing Vercel production for every small frontend experiment
- changing Railway production for every backend experiment
- rebuilding the desktop app for web-only changes
- shipping a hosted web deploy that assumes a newer shell before the desktop release is out
- treating production as the primary place to test new work

## Related Docs

- [docs/desktop-release-playbook.md](/Users/nickgardner/Desktop/ritual-desktop-main/docs/desktop-release-playbook.md)
- [docs/desktop-github-releases.md](/Users/nickgardner/Desktop/ritual-desktop-main/docs/desktop-github-releases.md)
- [docs/desktop-release-smoke-checklist.md](/Users/nickgardner/Desktop/ritual-desktop-main/docs/desktop-release-smoke-checklist.md)
