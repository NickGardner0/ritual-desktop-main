# Ritual Development And Preview Workflow

This guide explains how to implement and inspect Ritual frontend, backend, and desktop changes quickly without publishing a signed macOS release for every iteration.

## Purpose

Use **Ritual Dev** as the everyday desktop development environment. It runs the real Tauri shell against the local Vite SPA, preserves a separate development profile, and applies most React and CSS edits through Vite hot module replacement (HMR).

A signed desktop release is a distribution step, not a preview step. You do not need one to build, inspect, or validate changes locally.

One important boundary remains: Ritual currently bundles the Vite SPA inside the desktop application. Frontend changes therefore require a new desktop release when they are ready to reach installed production users, even when no Rust code changed. HMR removes that cost during development; it does not remotely update an already installed production app.

## Current Architecture

| Layer | Location | Development server | Production delivery |
| --- | --- | --- | --- |
| Desktop SPA | `apps/desktop-ui` plus shared modules from `apps/dashboard` | Vite on `127.0.0.1:1420` | Bundled in the signed Tauri app |
| Browser dashboard | `apps/dashboard` | Next.js on `localhost:3000` | Hosted web deployment |
| API | `apps/backend` | FastAPI on `localhost:8000` | Railway |
| Native shell | `apps/desktop/src-tauri` | Tauri development process | Signed and notarized macOS release |
| Agent and chat runtime | `apps/agent`, `apps/chat-runtime` | Built before the desktop shell starts | Bundled sidecar/runtime assets |

The desktop app is not a wrapper around the hosted dashboard. Its production frontend is the output of `apps/desktop-ui`, and that Vite app reuses selected dashboard components and clients through aliases and adapters.

## Default Everyday Loop

From the repository root:

```bash
npm install
npm run tauri:dev
```

This starts:

- the app named **Ritual Dev**
- the development Tauri shell
- the desktop Vite server on port `1420`
- the prerequisite agent and chat-runtime builds

Keep that terminal running. Edit React, TypeScript, or CSS in `apps/desktop-ui` or the dashboard modules it imports. Vite should update the open Ritual Dev window immediately; a full desktop rebuild or release is unnecessary.

### Development identity and sign-in

Ritual deliberately isolates desktop channels:

| Channel | App name | Bundle identifier | Local data root |
| --- | --- | --- | --- |
| Production | Ritual | `com.ritual.desktop` | `~/.ritual` |
| QA | Ritual QA | `com.ritual.desktop.qa` | `~/.ritual-qa` |
| Development | Ritual Dev | `com.ritual.desktop.dev` | `~/.ritual-dev` |

Ritual Dev may ask you to sign in once even if the production Ritual app is already signed in. That is expected isolation, not a production logout. Keep the same Ritual Dev process open during a work session so HMR does not interrupt that session.

## Workflow By Change Type

### Desktop frontend only

Examples include calendar layout, navigation, React state, styling, and desktop adapters.

```bash
npm run tauri:dev
```

Edit and save. Use the open Ritual Dev window as the source of truth because the desktop SPA has Tauri-specific adapters that a browser-only preview does not exercise.

If a change is not reflected, first restart only the Vite/Tauri development process. Do not cut a release to test it.

### Browser dashboard only

For a route that belongs to the hosted Next.js dashboard:

```bash
npm run dev
```

Open `http://localhost:3000`. A hosted dashboard deployment can ship independently when the changed code is not also bundled into the desktop SPA.

### Desktop frontend with the hosted API

For most UI work, simply run:

```bash
npm run tauri:dev
```

The development app can use the configured hosted services. Treat data mutations carefully because a local frontend can still point at real hosted data.

### Desktop frontend with a local backend

Use two terminals.

Terminal 1:

```bash
npm run dev:backend
```

Terminal 2:

```bash
NEXT_PUBLIC_PYTHON_API_URL=http://127.0.0.1:8000 \
VITE_PYTHON_API_URL=http://127.0.0.1:8000 \
npm run tauri:dev
```

FastAPI reloads Python edits. Vite hot-reloads frontend edits. Restart the relevant process only when a changed configuration, generated artifact, or compiled sidecar cannot be hot-reloaded.

### API contract or schema change

When backend types or OpenAPI behavior change, update generated artifacts before judging the frontend:

```bash
npm run api:openapi
npm run api:generate-client
npm run contracts:build
```

Then restart the frontend process if the generated client is not picked up automatically.

### Shared package, agent, or chat-runtime change

Some dependencies are compiled before the desktop app starts rather than watched by Vite:

```bash
npm run contracts:build
npm run build:chat-runtime
npm run build:agent
```

Restart `npm run tauri:dev` after these builds when necessary. This is still a local development rebuild, not a signed desktop release.

### Rust, Tauri configuration, sidecar, or native capability change

Continue to use:

```bash
npm run tauri:dev
```

Tauri/Cargo recompiles native changes locally. These changes require a signed desktop release only when they are ready to be distributed to other installed apps.

## What Updates Without A Release

| Change | Local preview | What normally refreshes | Release needed for production users? |
| --- | --- | --- | --- |
| Desktop React/CSS | `npm run tauri:dev` | Vite HMR | Yes, because the SPA is bundled |
| Next.js-only page | `npm run dev` | Next.js Fast Refresh | No desktop release; deploy the web app |
| FastAPI implementation | `npm run dev:backend` | Uvicorn reload | No desktop release if the API remains compatible |
| Generated API client/contracts | Regenerate, then run Ritual Dev | Often requires process restart | Only if the bundled desktop client changed |
| Agent/chat runtime | Rebuild package, restart Ritual Dev | Process restart | Yes when bundled behavior changes |
| Rust/Tauri/native shell | `npm run tauri:dev` | Cargo/Tauri rebuild | Yes |

## Validation Before Sharing Changes

Choose checks that match the changed layer.

Desktop frontend:

```bash
npm run --workspace @ritual/desktop-ui typecheck
npm run test:dashboard
```

Broader TypeScript changes:

```bash
npm run typecheck
```

Backend:

```bash
npm run backend:compile
npm run backend:test
```

For focused backend tests, use the repository test wrapper described in `apps/backend/README.md` so the locked Python 3.12 environment is preserved.

Repository-wide structural check:

```bash
npm run repo:check
```

Validation and release are separate decisions. Passing tests does not require publishing a release.

## Release Decision

Do **not** cut a desktop release merely to see a change. Cut one when a tested bundle is ready to reach production desktop users.

| Changed surface | How to preview | How to ship |
| --- | --- | --- |
| Next.js-only web code | Local Next.js / hosted preview | Web deployment |
| Compatible FastAPI-only code | Local FastAPI | Railway deployment |
| Desktop Vite SPA code | Ritual Dev with HMR | Signed desktop release |
| Rust/Tauri code | Ritual Dev with local native rebuild | Signed desktop release |
| Both backend and desktop client | Run both locally | Deploy in a compatibility-safe order, then release desktop |

The key distinction is **iteration versus distribution**: frontend-only desktop work is fast and release-free during implementation, but the final bundled assets still need a desktop release to replace assets already installed on users' Macs.

## Suggested Commit And Review Loop

1. Start Ritual Dev once with `npm run tauri:dev`.
2. Implement the smallest coherent change and inspect it through HMR.
3. Run layer-specific checks.
4. Commit and push the change for source review.
5. Continue iterating in Ritual Dev; several commits can accumulate without a release.
6. Cut one signed desktop release after the collection is stable and ready for users.

Pushing to GitHub does not update an installed Ritual app by itself. The open Ritual Dev app displays the local working tree, so it can show uncommitted and newly committed changes immediately without downloading anything from GitHub.

## Troubleshooting

### Ritual Dev asks for sign-in

Development, QA, and production use separate bundle identifiers and data directories. Sign in to Ritual Dev once; do not clear its data between ordinary sessions.

### The installed Ritual app still looks old

That app contains the frontend assets from its last signed release. Open Ritual Dev to inspect current source changes. The production app will change only after installing an update containing the new bundle.

### A saved frontend file does not update

- confirm `npm run tauri:dev` is still running
- confirm the edit belongs to `apps/desktop-ui` or a module imported by it
- check the Vite terminal for a compile error
- restart Ritual Dev if a generated package or adapter changed

### Port 1420 is already in use

Find the stale development process:

```bash
lsof -nP -iTCP:1420 -sTCP:LISTEN
```

Stop that specific process, then run `npm run tauri:dev` again.

### Backend edits do not appear

Confirm the backend is listening on port `8000` and that both API URL variables were set in the terminal that launched Ritual Dev. Restart Ritual Dev after changing environment variables.

## Production Promotion

When a group of desktop changes is ready:

1. run the appropriate frontend, backend, and packaged-app checks
2. bump the desktop version
3. create and push the matching desktop release tag
4. let the desktop release workflow build, sign, notarize, and publish the artifacts
5. smoke-test the packaged app and updater feed

Follow `docs/desktop-release-playbook.md` for the release procedure. The normal development loop in this guide should happen many times before that production promotion step.

## Related Documentation

- `docs/desktop-release-playbook.md`
- `docs/desktop-release-workflow.md`
- `docs/release-operations.md`
- `docs/api-client-regeneration.md`
- `apps/backend/README.md`
