# Ritual Context

This file is the shared language for humans and agents working in the Ritual
codebase. Keep terms short, stable, and aligned with
`docs/architecture/current-architecture.md`.

## Domain Glossary

| Term | Definition |
|------|------------|
| BFF | Backend-for-Frontend: Next.js `/api/*` routes that proxy, enrich, or guard calls to FastAPI. |
| Catch-all proxy | `app/api/[...backendPath]/route.ts`, the OpenAPI-allowlisted forwarder to FastAPI. |
| Materialization cascade | Upstream data from wearables, watcher, or imports projecting into habit logs, metric facts, and analytics. |
| Wearables unified ingest | Canonical ingest path under `services/wearables_unified/`; legacy `wearables_service.py` has been removed from production code. |
| Watcher | macOS activity capture subsystem: Rust sidecar `ritual-watcher`, `ritual-db`, and backend projection. |
| Cloud sync outbox | Desktop plaintext JSON queue in `cloud_sync.rs` that uploads local activity rows to per-user Turso. |
| Local vault | Encrypted on-device record store reached through `VaultSync`, with WebCrypto and Tauri production adapters. |
| Write outbox | Local-first pattern: mutate local state first, then replay creates/updates to backend asynchronously. |
| Fan-out | One user write causing secondary copies such as Tinybird, Typesense, metric facts, WebSocket, or analytics events. |
| Per-user Turso | Isolated libSQL database per user for high-volume activity data, owned by `turso_user_service.py`. |
| Integration plugin | Self-contained UI module for a third-party connection such as Whoop, Plaid, Tesla, Apple Health, or Screen Time. |
| Integration orchestrator | Central React layer wiring shared deps into typed plugin-owned runtime contexts. |
| Chat runtime | `@ritual/chat-runtime`, the shared AI turn engine, tools, and streaming helpers. |
| Desktop capabilities | `useDesktopCapabilities()`, the canonical seam for detecting and invoking Tauri features. |
| Trigger.dev job | Historical scheduled cloud task such as wearable sync, Plaid sync, or Tesla sync calling backend with internal auth. |

## Maintenance Rules

- Add or sharpen terms when a refactor names a new deep module or changes a domain seam.
- Prefer these terms in architecture docs, PRDs, code reviews, and issue descriptions.
- Keep implementation details in architecture docs; keep this file focused on language.
