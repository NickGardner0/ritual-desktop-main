# Buzz Architecture Review for Ritual

**Date:** 2026-07-29  
**Status:** Research only — no Ritual production code was modified.  
**Analyst scope:** Compare Block’s open-source Buzz repository with Ritual’s current implementation and approved privacy direction. Recommend adopt / adapt / prototype / reject decisions.

---

## 1. Executive summary

Buzz is a **self-hostable, Nostr-shaped collaboration workspace** where humans and agents share a signed event log on a relay. Ritual is a **personal self-tracking desktop product** with a Tauri shell, Next.js dashboard, FastAPI backend, local activity DB, and an encrypted local vault for sensitive behavioral records.

Buzz’s highest transferable value is **not** Nostr, Redis, Postgres, cryptographic agent keys, or a central relay. It is a set of engineering principles:

1. **Accept the primary write first**, with explicit idempotency (`was_inserted`), then fan out secondary work.
2. **Keep domain types free of I/O** so rules can be tested without databases or network.
3. **Bound queues, cancel work, and clean up process groups** so agents and sidecars cannot runaway.
4. **Make agent actions attributable** — same audit surface as human actions, preferably with user-visible receipts.
5. **Colocate search with the source of truth** (Buzz: Postgres FTS generated column; Ritual adaptation: SQLite FTS / local vault index), rather than inventing a separate always-critical search cluster.

Ritual already owns several of these ideas in partial form: `client_event_id` uniqueness, desktop cloud-sync outbox with dead letters, `action_receipts` / approvals for workflows, OCR FTS5, and `repo:check` guardrails. The opportunity is to **complete and productize** those seams for personal tracking and AI trust — not to re-platform Ritual as Buzz.

**Critical Ritual direction note (verified):** Live file-native Markdown-as-database is **deferred**. Approved V1 treats the encrypted local vault/local DB as canonical for sensitive behavioral records; Ritual Vault folder export/mirror is File-over-App, not the runtime database (`docs/privacy/18-privacy-simplification-pass-2-after-report.md`). Recommendations below respect that direction and do **not** revive Obsidian-live-runtime as a prerequisite.

---

## 2. Buzz commit and analysis scope

| Field | Value |
| --- | --- |
| Clone path | `/tmp/ritual-buzz-analysis` (outside Ritual working tree) |
| Remote | `https://github.com/block/buzz.git` |
| Analyzed commit | `f95fdc1a102e17c6718a44323d9a2feaed702db7` |
| Commit date | 2026-07-29 18:15:30 -0400 |
| Commit subject | `feat(agent,acp): wire provider total_tokens through NIP-AM publish chain (#3593)` |
| Shallow clone | **Yes** (`git rev-parse --is-shallow-repository` → `true`) |
| Workspace version | `0.1.0` (`Cargo.toml` `[workspace.package]`) |
| Desktop app version | `0.5.2` (`desktop/package.json`, `desktop/src-tauri/Cargo.toml`) |
| Relay package version | `0.2.0` (`crates/buzz-relay/Cargo.toml`) |
| License | Apache License 2.0 (`LICENSE`; Copyright 2026 Block, Inc.) |
| NOTICE file | **Not present** in clone; Apache 2.0 still requires NOTICE preservation if redistributing NOTICE contents from dependencies |

### Inspected subsystems

Fully or substantially inspected via docs + code:

- Workspace / crates / Justfile / CI / Docker
- `buzz-core`, `buzz-db`, `buzz-relay` ingest/fan-out, `buzz-search`, `buzz-audit`, `buzz-auth`, `buzz-pubsub`, `buzz-workflow`
- `buzz-agent`, `buzz-acp`, `buzz-cli`, `buzz-dev-mcp`
- Desktop Tauri package (structure, updater, managed agents, Playwright presence)
- Schema (`schema/schema.sql`) for events, FTS, audit, workflows

Not fully inspected (shallow clone + time bounds):

- Mobile Flutter app internals beyond CI file-size hooks
- Mesh / pairing / iroh transport deep paths
- Full media upload streaming behavior under load
- Production Keycloak/IdP operational runbooks
- Historical git history beyond HEAD (shallow)

### Documentation vs implementation (material corrections)

| Claim | Status |
| --- | --- |
| `buzz-core` has zero I/O dependencies | **Verified implementation** — Cargo.toml explicitly excludes tokio/sqlx/redis/axum (`crates/buzz-core/Cargo.toml:30`) |
| Service crates do not call each other; relay orchestrates | **Partially false** — `buzz-workflow` depends on `buzz-db`; `buzz-pubsub` depends on `buzz-auth` |
| Search uses bounded out-of-band Typesense queue | **Stale documentation claim** — Typesense queue removed; FTS generated on insert (`crates/buzz-relay/src/handlers/event.rs` comments around post-commit dispatch) |
| Workflow approval gates are complete | **Incomplete feature** — executor returns NotImplemented / incomplete persistence TODOs (`crates/buzz-workflow/src/executor.rs` WF-07/WF-08) |
| Audit is a cryptographically signed immutable history | **Overstated** — DB hash chain with advisory locks; not independently signed (`crates/buzz-audit/src/service.rs`) |
| Production rate limiter exists | **Incomplete** — interface + test AlwaysAllow (`crates/buzz-auth`) |

---

## 3. Ritual current-state architecture

### 3.1 Product shape

Ritual is a monorepo personal OS for habits, routines, tasks, health imports, computer activity, and AI assistance:

| Layer | Location | Role |
| --- | --- | --- |
| Dashboard | `apps/dashboard` | Next.js 16 / React 19 App Router, Clerk, React Query, Tauri API client |
| Desktop shell | `apps/desktop/src-tauri` | Tauri **2.10.3**, tray, updater, vault IPC, watcher lifecycle |
| Local activity DB | `apps/desktop/src-tauri/crates/ritual-db` | libSQL/SQLite for activity, OCR FTS, project-time, sync outbox |
| Encrypted vault | `apps/desktop/src-tauri/src/local_vault.rs` | AES-256-GCM record store under `~/.ritual` |
| Backend | `apps/backend` | FastAPI, Turso/libSQL, Clerk JWT, Tinybird/Typesense fan-out |
| Chat runtime | `packages/chat-runtime` | OpenAI tool loop for dashboard/SMS |
| iOS companion | `apps/ios-companion` | HealthKit / Screen Time / location (out of desktop focus) |
| Analytics | `apps/tinybird` | ClickHouse-backed pipes |

Evidence: `README.md`; `apps/desktop/src-tauri/Cargo.toml:54-64`; `docs/privacy/00-current-architecture-audit.md`; `docs/privacy/18-privacy-simplification-pass-2-after-report.md`.

### 3.2 Desktop shell (verified)

- **Tauri 2** already (not Tauri 1). Version `0.1.80` app package.
- IPC commands registered in `main.rs` for windows, auth/token, microphone/speech, watcher, updater, vault CRUD, local search, migration/deletion receipts.
- Sidecars: `ritual-watcher` (managed); `ritual-vision-helper` bundled; legacy recorder explicitly not shipped.
- Watcher start kills prior child + same-device orphans (`watcher/lifecycle.rs` ~573–607).
- Updater: GitHub manifest + Minisign; delayed check then 4h interval; in-flight guard (`desktop_runtime/updater.rs`).
- Global shortcuts: **no evidence** of Tauri global-shortcut registration.
- Cloud sync worker: 60s loop, policy-gated plaintext outbox drain, dead-letter on permanent failure (`cloud_sync.rs`).

### 3.3 Frontend (verified)

- App Router + Clerk + React Query v5 with conservative refetch defaults (`lib/query-client.ts`).
- LocalStorage query hydration (bounded) and habit mutation outbox for partial offline.
- Virtualization for habit logs and chat lists.
- Error boundaries exist at selected segments; not universal per route.
- Browser fetches go through `/api` BFF; remediation guardrails via `npm run repo:check`.

### 3.4 Backend / persistence (verified)

- Transactional SoT for most product domains: backend Turso/libSQL (`database/connection.py`).
- Embedded replica + best-effort sync; local-only is deploy mode, not end-user privacy mode.
- Secondary fan-out: Tinybird, Typesense, WebSockets — often `asyncio.create_task` fire-and-forget (`habits_service.py` ~332–387).
- Idempotency present but uneven: tasks/routines `client_event_id`; location/wearables ingest; habit logs partial; imports file-hash checks.
- Workflows, approvals, `action_receipts`, ambient signals already modeled (`database/models/workflows.py`).
- Private Sync: encrypted envelopes + device/key-grant ledger (`database/models/privacy_sync.py`).

### 3.5 Sensitive data reality

Still **fragmented**, not fully vault-first across all features:

| Data | Primary today | Notes |
| --- | --- | --- |
| Habits/logs/tasks/routines | Backend Turso | Vault adapter/pilot paths exist; cloud remains dominant |
| Computer activity / OCR | Local `ritual.db` | Optional plaintext cloud outbox |
| Sensitive vault records | Encrypted `vault.db` | Key file on disk (0600), not Keychain |
| AI conversations | Backend tables | Typesense index; OpenAI prompts |
| Wearables / Apple Health | Backend + iOS local | Raw payloads high sensitivity |
| Screenshots | Local + analyzer providers | Gemini/OpenAI |
| Ritual Vault folder | Export/mirror only | Not live SoT |

### 3.6 AI / automation (verified)

- Tool registry with owners/channels (`packages/chat-runtime/src/tool-registry.ts`) — includes mutating `logHabit` / `createHabit`.
- Tool executors call backend APIs; persistence is fire-and-forget (`persistence.ts`).
- `ActionReceiptDB` exists and is written via `action_policy_service.py` for workflow/policy paths — **not** wired as the default chat UX receipt surface.
- Fact suggestions can be `pending`; not full approval for all AI mutations.
- No active dedicated vector DB found; desktop has OCR FTS5; Typesense is remote lexical/faceted search.

### 3.7 Approved architectural direction (authoritative)

From `docs/privacy/18-privacy-simplification-pass-2-after-report.md`:

- Encrypted local vault/local DB = canonical for sensitive behavioral records (V1).
- File-over-App via export/import/mirror, **not** live Markdown DB.
- Live Obsidian-style runtime deferred.
- Private Sync = opaque envelopes + device revoke.

**Stale docs to discount:** `docs/ARCHITECTURE-ANALYSIS.md` still describes Tauri 1.8.1 and a shipped recorder sidecar — contradicted by current Cargo.toml and `main.rs`. Prefer privacy pass-2 docs + code.

### 3.8 Cross-layer coupling (examples)

1. Chat runtime → direct backend conversation HTTP (`packages/chat-runtime/src/persistence.ts:7-49`).
2. Habits service → Tinybird + Typesense via unbounded create_task fan-out (`habits_service.py:332+`).
3. Desktop cloud sync → remote libSQL with rich activity fields (`cloud_sync.rs`).
4. Import/workflow jobs → process-local asyncio tasks (`api/imports.py`, `workflow_service.py`).

---

## 4. Buzz architecture map

### 4.1 Module structure

Rust workspace (~27 members) plus excluded desktop Tauri workspace. Key crates:

| Crate | Role | Boundary note |
| --- | --- | --- |
| `buzz-core` | Types, verification, kinds, filters | Zero I/O deps — verified |
| `buzz-relay` | Axum orchestration, ingest, fan-out | Primary composition root |
| `buzz-db` | Postgres persistence | Idempotent inserts |
| `buzz-search` | FTS queries | Returns candidates; relay authorizes |
| `buzz-audit` | Hash-chain audit log | DB-trust-bound |
| `buzz-pubsub` | Redis fan-out | Depends on `buzz-auth` |
| `buzz-workflow` | YAML workflows | Depends on `buzz-db` (boundary exception) |
| `buzz-auth` | NIP-42/98, scopes | Rate limiter incomplete |
| `buzz-agent` / `buzz-acp` | LLM agent + harness | Process groups, bounded queues |
| `buzz-cli` / `buzz-dev-mcp` | Agent tools / MCP | Edge tooling |
| `buzz-sdk` | Event builders | No transport |

Ops: Docker Compose (Postgres 17, Redis 7, Keycloak, MinIO), multi-stage Dockerfile, large Justfile, GitHub Actions with Playwright smoke + relay-backed E2E, `cargo-deny`, file-size ratchet scripts.

### 4.2 Event model (verified)

- Nostr signed events with kind registry (ephemeral / replaceable / parameterized-replaceable).
- Storage: monthly partitions, `(community_id, created_at, id)` uniqueness.
- Insert: `ON CONFLICT DO NOTHING` → `was_inserted` (`crates/buzz-db/src/event.rs:253-311`).
- Duplicates accepted without re-fanout (`ingest` duplicate path).
- Generated `search_tsv` on events with privacy kind exclusions (`schema/schema.sql`).

### 4.3 Ingestion pipeline (verified)

```
Client EVENT
  → connection auth / scope
  → spawn_blocking signature verify
  → membership / channel authz
  → kind validation
  → transactional insert OR replaceable path
  → if was_inserted:
       local echo → Redis publish → filtered fan-out
       → audit enqueue (bounded capacity 1000, backpressures)
       → workflow trigger (async / best-effort)
  → ACK (including duplicate ACK)
```

Primary write success is independent of Redis/workflow success. Audit currently backpressures rather than drop-on-full.

### 4.4 Agent architecture (verified)

- ACP harness: per-channel queues, max 500 pending, batch 50, retries with backoff, dead-letter after 10 (`buzz-acp/src/queue.rs:23-36`).
- MCP children: process groups, kill-on-cleanup, bounded tool output/schema sizes (`buzz-agent`).
- Desktop managed agents similarly use process-group lifecycle.
- Identity model is Nostr keypairs for agents-as-members — **Buzz-specific**.

### 4.5 Workflow engine

YAML triggers (message/reaction/diff/schedule/webhook) and actions. Incomplete: DM, set topic, approval resume. Interval state in memory — lost on restart. **Do not copy as a complete system.**

### 4.6 Desktop stack

Tauri 2 + React 19 + Vite 8 + TanStack Router/Query/Virtual + Playwright. Overlaps Ritual’s Tauri 2 + React 19 + Query + virtualization; differs on Next.js vs Vite SPA.

---

## 5. Major architectural differences

| Dimension | Buzz | Ritual |
| --- | --- | --- |
| Product | Multi-user team workspace | Personal self-tracking |
| Canonical log | Signed Nostr events on relay | Domain tables + encrypted vault + local activity DB |
| Identity | Cryptographic pubkeys | Clerk users + device IDs |
| Transport fan-out | Redis pub/sub | React Query / WebSocket / Trigger.dev / outbox |
| Search SoT | Postgres FTS column | Typesense (cloud) + OCR FTS5 (local) + incomplete unified UX |
| Agents | First-class channel members | Chat tools over backend APIs |
| Workflows | YAML + evalexpr (partial) | DB definitions + action profiles + ambient signals |
| Privacy model | Community tenancy + kind exclusions | Local vault + policy gates + Private Sync envelopes |
| Scale assumptions | Multi-tenant relay | Single-user primary, optional cloud |

---

## 6. High-value transferable principles

### P1 — Idempotent primary write with inserted-vs-duplicate

**Principle:** Retries must not duplicate side effects.  
**Buzz:** `was_inserted` gates fan-out.  
**Ritual adaptation:** Standardize `(user_id, client_event_id)` (or content hash) across logs, imports, AI mutations; return duplicate-success without re-emitting analytics/search.

### P2 — Secondary processing is bounded and non-corrupting

**Principle:** Search/audit/automation failures must not erase an accepted user action; overload must degrade.  
**Buzz:** Post-commit dispatch; bounded audit channel; workflow async.  
**Ritual adaptation:** Replace naked `create_task` fan-outs with a small job runner (concurrency classes, retries, dead letters). Desktop outbox is already closer to this ideal than backend habits fan-out.

### P3 — Zero-I/O domain core

**Principle:** Scoring, recurrence, validation, correlation rules should be pure.  
**Buzz:** `buzz-core` Cargo fence.  
**Ritual adaptation:** Extract pure modules for habit log validation, streak/schedule math, routine recurrence — no SQLAlchemy/React/Tauri imports.

### P4 — Explicit orchestration boundary

**Principle:** Storage must not call AI; AI must not own sync; sidecars should not invent cross-domain writes.  
**Buzz:** Relay composition root (imperfectly enforced).  
**Ritual adaptation:** Application services as the only cross-subsystem callers; expand `repo:check` style dependency tests.

### P5 — Agent actions need receipts and bounds

**Principle:** Users trust AI when they can see what changed and stop runaway work.  
**Buzz:** Event audit trail + process bounds + queues.  
**Ritual adaptation:** Productize `ActionReceiptDB` for chat tools; cancel tokens for long AI/import jobs; bounded tool output.

### P6 — Search colocated with authority

**Principle:** Search should not invent a second SoT.  
**Buzz:** Generated FTS on event row.  
**Ritual adaptation:** Unified **local** lexical index over vault + habits/logs cache + activity; keep Typesense optional/cloud-gated.

### P7 — Engineering guardrails that fail the build

**Principle:** Architecture is enforced mechanically.  
**Buzz:** File-size ratchet, Playwright desktop smoke, cargo-deny, conformance.  
**Ritual adaptation:** Make Rust line budget honest (not warn-only), add import-graph tests for “no I/O in domain,” add desktop Playwright smoke for vault/watcher/updater.

---

## 7. Inappropriate or conflicting Buzz choices

| Buzz choice | Why reject / defer for Ritual |
| --- | --- |
| Nostr as protocol | Personal app does not need cryptographic event mesh complexity |
| Central relay as SoT | Contradicts local-vault-first privacy direction |
| Redis pub/sub | Unnecessary ops surface for single-user desktop |
| Postgres monthly partitions | Ritual’s libSQL/SQLite + Turso path is the right size |
| Agent cryptographic identities | Actor enum + receipt IDs suffice |
| Hash-chain audit as product core | Low user value vs complexity; DB admin can rewrite anyway |
| Full YAML workflow DSL | Ritual already has DB workflows; Buzz approvals incomplete |
| Vite migration from Next | No quantified Ritual problem solved |
| Multi-community tenancy | Wrong product shape |
| Incomplete Buzz features (approvals, rate limit) | Do not copy aspirational code |

---

## 8. Product-feature opportunities

| Opportunity | User value | Fit |
| --- | --- | --- |
| **AI action receipts in chat** (“what did Ritual change?”) | Trust, undo, supportability | Highest — schema already exists |
| **Provenance chips on logs** (user / AI / import / Health / correction) | Clarity when data conflicts | High |
| **Unified search** across habits, notes, activity, chat | Find “why Tuesday felt off” | High if local-first |
| **Personal automations v0** (if X logged then remind / create task) | Habit compounding | Medium — keep tiny |
| **Import/AI progress with cancel** | Control over heavy jobs | High reliability UX |
| **CLI / Shortcuts bridge via stable tools** | Power users | Later |

Non-goals as product: agent teammates with channel membership, git forges, huddles, community moderation.

---

## 9. Reliability and performance findings

### Ritual gaps relative to Buzz patterns

1. **Backend fan-out unbounded:** `asyncio.create_task` for Tinybird/Typesense without shared semaphore/dead-letter (`habits_service.py`).
2. **In-process job ownership:** imports/workflows/sync registry lose executor ownership across restarts.
3. **Desktop background loops:** updater/sync are spawned infinite loops; structured cancellation/join less explicit than Buzz ACP tokens.
4. **AI tool loop:** bounded iterations exist in places, but mutating tools lack durable receipts and cancel UX.
5. **Search inconsistency:** local OCR FTS ≠ cloud Typesense ≠ vault contents — no single ranked surface.

### Ritual strengths

- Desktop sync outbox with retries/dead letters.
- Watcher orphan cleanup on start/stop.
- Import cancellation APIs.
- Privacy policy gates on several cloud paths.
- Existing line/API/capability budgets.

---

## 10. Security and privacy findings

### Transfer carefully

- Buzz’s privacy-sensitive kind exclusions from FTS are a good **pattern** for Ritual: never index screenshots OCR / precise location / raw health payloads into a cloud search product by default.
- Buzz’s “authorize after candidate search” is correct for multi-tenant; Ritual should prefer **not indexing** sensitive fields rather than relying on post-filter alone.
- Agent process-group kill is highly relevant to `ritual-watcher` and any future MCP/CLI helper.

### Do not import

- Broader CSP/cloud origins in Ritual already need continuous review; Buzz’s team-collab threat model (channel ACLs, NIP auth) is different.
- Hash chains do not replace encryption or Keychain-backed key storage.

### Ritual-specific risks Buzz does not solve

- Vault key as filesystem file vs Keychain.
- Plaintext activity outbox when cloud sync allowed.
- AI provider exfiltration of conversation/tool payloads.

---

## 11. Testing and tooling findings

| Buzz practice | Ritual analogue | Gap |
| --- | --- | --- |
| Playwright desktop smoke + relay E2E | Manual checklists + unit tests | No Playwright desktop suite found |
| File-size ratchet vs main | Dashboard/Rust line budgets | Rust budget warn-only historically |
| `cargo-deny` | Partial via CI/deps discipline | Weaker formal deny config |
| Protocol conformance crate | OpenAPI + generated client checks | Good; keep |
| Process cleanup tests | Some watcher tests | Expand |
| Architecture dependency tests | `repo:check` scripts | Missing pure-domain / crate-graph enforcement |

Ritual’s `npm run repo:check` is already a strong cultural match to Buzz’s Just/CI guardrails — tighten honesty of gates rather than invent a parallel system.

---

## 12. License considerations

| Item | Detail |
| --- | --- |
| License | Apache-2.0 |
| Copyright | Copyright 2026 Block, Inc. (LICENSE) |
| NOTICE | No top-level NOTICE in clone; if redistributing Apache-covered third-party NOTICE texts, preserve them |
| This research | Concepts only — **no Buzz code copied into Ritual** |
| Future direct reuse | Requires legal review, attribution, NOTICE handling, and likely independent reimplementation preference |
| Default policy | **Independently implement principles**; do not vendor Buzz crates |

---

## 13. Final recommendation

Ritual should treat Buzz as a **reliability and agent-accountability textbook**, not a product template.

**Do soon (low risk, high trust):**

1. Wire mutating chat tools through `action_receipts` and show them in chat UI.
2. Standardize idempotent write acknowledgements for logs/imports/AI mutations.
3. Add actor/source provenance fields on writes (user/ai/import/integration/system).
4. Bound backend secondary fan-out with a tiny job helper (concurrency + retry + dead letter).

**Prototype before committing:**

5. Unified local lexical search over vault + habits/logs + activity.
6. Shared local/desktop job manager for imports, sync, transcription, embeddings.
7. Pure domain crate/package for scoring/recurrence/validation.

**Reject / defer:**

- Nostr, Redis, central relay SoT, crypto agent identities, hash-chain as UX, Vite rewrite, general-purpose YAML automation platform, copying Buzz’s incomplete approval engine.

**Single architectural lesson:** Make the primary user write idempotent and authoritative; keep everything else bounded, attributable, and disposable without corrupting that write.

**Single product lesson:** Ship **AI action receipts** — the Buzz “answer with receipts” idea, adapted to personal habit/log mutations users can inspect and undo.
