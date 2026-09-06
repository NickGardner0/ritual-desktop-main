# Buzz → Ritual Adoption Matrix

**Buzz commit:** `f95fdc1a102e17c6718a44323d9a2feaed702db7` (shallow clone `/tmp/ritual-buzz-analysis`)  
**Ritual tree:** `/Users/nickgardner/Desktop/ritual-desktop-main` (analysis date 2026-07-29)  
**Policy:** Concepts only; no Buzz code reuse. Apache-2.0 inspiration.

## Scoring rubric

Scores are 1–5 unless noted. Higher is better for value/fit; for Effort/Risk/Maintenance, **higher means worse** (more costly). Weighted recommendation score:

```
score = 2*UserValue + 1.5*ArchFit + 1.5*PrivacyFit + LocalFirst + Reliability
        - Effort - Risk - 0.5*Maintenance
```

Reversibility is narrative (High/Med/Low), not in the numeric score.

## Classification legend

| Tag | Meaning |
| --- | --- |
| **Adopt soon** | Incremental, evidence-backed, low migration risk |
| **Prototype first** | Promising; validate with isolated experiment |
| **Consider later** | Real value only after foundations |
| **Reject** | Wrong product/architecture fit |
| **Already present** | Ritual has an analogue; note weaker/stronger/equivalent |

---

## Candidate evaluations (A–J)

### A. Typed internal activity event model

| Field | Assessment |
| --- | --- |
| Buzz principle | Common event envelope + kinds + idempotent append |
| Buzz evidence | `crates/buzz-core/src/event.rs`; `crates/buzz-db/src/event.rs:253-311`; `schema/schema.sql` events |
| Ritual evidence | Domain tables; partial `client_event_id` on tasks/routines (`database/models/tasks.py:31-80`); location ingest conflict-do-nothing |
| Same problem? | Partial — Ritual has fragmented provenance across logs/imports/AI/activity |
| Recommendation | **Prototype first** as a **derived journal / interoperability format**, not canonical SoT |
| Scores | UV 4, Arch 4, Privacy 5, LocalFirst 5, Perf 3, Rel 4, Effort 3, Risk 3, Maint 3, Rev High |
| Weighted | ~14.5 |
| Smallest adaptation | Append-only `activity_journal` (or vault category) written *after* successful domain writes; never replace habits/logs tables |

### B. Zero-I/O domain core

| Field | Assessment |
| --- | --- |
| Buzz principle | Core crate with no tokio/sqlx/redis/axum |
| Buzz evidence | `crates/buzz-core/Cargo.toml:30` |
| Ritual evidence | Domain rules mixed into FastAPI services / React / SQLAlchemy |
| Same problem? | Yes — hard to unit-test streak/schedule/validation without DB |
| Recommendation | **Adopt soon** for new/extracted pure modules; no big-bang rewrite |
| Scores | UV 3, Arch 5, Privacy 5, LocalFirst 5, Perf 4, Rel 4, Effort 3, Risk 2, Maint 2, Rev High |
| Weighted | ~18 |
| Smallest adaptation | New `packages/domain-habits` (or Rust module) for validation/recurrence/scoring only |

### C. One orchestration boundary

| Field | Assessment |
| --- | --- |
| Buzz principle | Relay composes services |
| Buzz evidence | `crates/buzz-relay` ingest/fan-out; imperfect — `buzz-workflow→buzz-db`, `buzz-pubsub→buzz-auth` |
| Ritual evidence | Habits fan-out in service; chat persistence direct HTTP; sync owns remote writes |
| Same problem? | Yes |
| Recommendation | **Adopt soon** as conventions + `repo:check` dependency tests |
| Scores | UV 3, Arch 5, Privacy 4, LocalFirst 4, Perf 3, Rel 4, Effort 3, Risk 2, Maint 2, Rev High |
| Weighted | ~16 |
| Smallest adaptation | Forbid new cross-calls AI↔Tinybird↔vault; route via application services; add lint/grep tests |

### D. Agent tool protocol

| Field | Assessment |
| --- | --- |
| Buzz principle | Stable CLI/MCP/ACP tool surfaces |
| Buzz evidence | `buzz-cli`, `buzz-dev-mcp`, `buzz-agent` MCP bounds |
| Ritual evidence | `packages/chat-runtime/src/tool-registry.ts` (owners/channels); mutating `logHabit`/`createHabit` |
| Same problem? | Partial — registry exists but not stable external protocol / versioned names |
| Recommendation | **Already present (weaker)** internally; **Consider later** for MCP/CLI export |
| Scores | UV 3, Arch 4, Privacy 3, LocalFirst 3, Perf 3, Rel 3, Effort 4, Risk 3, Maint 3, Rev Med |
| Weighted | ~8.5 |
| Smallest adaptation | Freeze namespaced aliases (`ritual.logs.create`) mapping to existing tools; document schema version |

### E. AI action receipts

| Field | Assessment |
| --- | --- |
| Buzz principle | Agents leave the same auditable trail as humans (“answers with receipts”) |
| Buzz evidence | Signed event log + audit enqueue; agent identity model (Buzz-specific) |
| Ritual evidence | `ActionReceiptDB` (`workflows.py:128-148`); written in `action_policy_service.py`; chat tools do not productize receipts |
| Same problem? | **Yes** — users need trust/undo for AI logging |
| Recommendation | **Adopt soon** |
| Scores | UV 5, Arch 5, Privacy 5, LocalFirst 4, Perf 4, Rel 5, Effort 2, Risk 2, Maint 2, Rev High |
| Weighted | ~24 |
| Smallest adaptation | On `logHabit`/`createHabit` success, persist `ActionReceiptDB` with before/after/undo; show collapsible receipt in chat |

### F. Personal workflow engine

| Field | Assessment |
| --- | --- |
| Buzz principle | Trigger → filter → action automations |
| Buzz evidence | `buzz-workflow` schema/executor; **approvals/DM incomplete** |
| Ritual evidence | `WorkflowService`, definitions, approvals, ambient signals (`workflow_service.py`, `workflows.py`) |
| Same problem? | Partial — Ritual already invested; Buzz YAML is not clearly better |
| Recommendation | **Already present (comparable/partial)**; **Consider later** for user-authored simple rules; **Reject** copying Buzz YAML/evalexpr |
| Scores | UV 3, Arch 3, Privacy 4, LocalFirst 3, Perf 3, Rel 2, Effort 4, Risk 4, Maint 4, Rev Low |
| Weighted | ~5 |
| Smallest adaptation | Ship 3 templates (missed routine → task; threshold → notification; import complete → summary) on existing engine |

### G. Unified local search

| Field | Assessment |
| --- | --- |
| Buzz principle | One search index over one event substrate |
| Buzz evidence | Postgres `search_tsv` + GIN; kind privacy exclusions (`schema/schema.sql`) |
| Ritual evidence | OCR FTS5 (`ritual-db/src/schema/fts.rs`); Typesense cloud (`search_service.py`); vault not unified |
| Same problem? | Yes — “search my life” is fragmented |
| Recommendation | **Prototype first** (local lexical); semantic/hybrid later |
| Scores | UV 5, Arch 4, Privacy 5, LocalFirst 5, Perf 3, Rel 3, Effort 4, Risk 3, Maint 3, Rev Med |
| Weighted | ~16.5 |
| Smallest adaptation | SQLite FTS over vault plaintext projections + habit names/notes + activity titles; privacy exclusions list |

### H. Append-only provenance / change journal

| Field | Assessment |
| --- | --- |
| Buzz principle | Append-only history + audit chain |
| Buzz evidence | Events + `buzz-audit` hash chain (`audit/service.rs:47-80`) |
| Ritual evidence | Tombstones/deletion receipts; import undo packages; receipt before/after fields; no general correction journal |
| Same problem? | Yes for corrections/imports/AI edits |
| Recommendation | **Adopt soon** light journal; **Reject** hash-chain |
| Scores | UV 4, Arch 4, Privacy 5, LocalFirst 5, Perf 4, Rel 4, Effort 3, Risk 2, Maint 2, Rev High |
| Weighted | ~18.5 |
| Smallest adaptation | `provenance_events` table/vault records: actor, source, entity, old/new, causationId |

### I. Bounded background job system

| Field | Assessment |
| --- | --- |
| Buzz principle | Semaphores, bounded channels, try_send/drop, retries, dead letters |
| Buzz evidence | ACP queue (`buzz-acp/src/queue.rs:23-36`); workflow semaphore; audit capacity channel |
| Ritual evidence | Desktop outbox strong; backend `sync_job_registry` in-memory; imports process-local tasks |
| Same problem? | **Yes** |
| Recommendation | **Prototype first** shared runner; adopt desktop patterns on backend fan-out immediately |
| Scores | UV 4, Arch 5, Privacy 4, LocalFirst 4, Perf 5, Rel 5, Effort 4, Risk 3, Maint 3, Rev Med |
| Weighted | ~17 |
| Smallest adaptation | `JobRunner` helper: named queues, concurrency caps, retry/backoff, dead-letter list, cancel token |

### J. Engineering guardrails

| Field | Assessment |
| --- | --- |
| Buzz principle | Mechanical architecture + size + E2E gates |
| Buzz evidence | `scripts/check-file-sizes-core.mjs`; CI Playwright; `cargo-deny`; Justfile |
| Ritual evidence | `npm run repo:check` (API boundary, line budgets, privacy verify); historically Rust budget warn-only |
| Same problem? | Partial — culture exists; honesty/E2E gaps |
| Recommendation | **Adopt soon** tighten; **Prototype** Playwright desktop smoke |
| Scores | UV 2, Arch 5, Privacy 4, LocalFirst 3, Perf 3, Rel 4, Effort 2, Risk 1, Maint 2, Rev High |
| Weighted | ~16.5 |
| Smallest adaptation | Enforce strict Rust budget or documented exceptions; add one Playwright smoke (launch → vault status → watcher start) |

---

## Full pattern matrix

| Buzz pattern or feature | Buzz evidence | Ritual evidence | User problem solved | Recommendation | User value | Effort | Risk | Privacy fit | Smallest viable adaptation |
| ----------------------- | ------------- | --------------- | ------------------- | -------------- | ---------: | -----: | ---: | ----------: | -------------------------- |
| Typed event model | `buzz-core` `StoredEvent`; kinds registry | Fragmented domain tables; partial `client_event_id` | Correlate AI/import/user changes | **Prototype first** | 4 | 3 | 3 | 5 | Derived journal after domain writes |
| Zero-I/O core | `buzz-core/Cargo.toml:30` | Rules in services/UI | Correct streaks/schedules without flaky integration tests | **Adopt soon** | 3 | 3 | 2 | 5 | Pure package for validation/recurrence |
| Orchestration boundary | Relay compose root; imperfect deps | Habits/chat/sync cross-call | Prevent privacy/sync bugs from random imports | **Adopt soon** | 3 | 3 | 2 | 4 | Dependency tests + service layer rule |
| Idempotent ingestion (`was_inserted`) | `buzz-db` `ON CONFLICT DO NOTHING` + fan-out gate | Partial unique keys; uneven ack semantics | Retries create duplicate logs/analytics | **Adopt soon** | 5 | 2 | 2 | 5 | Duplicate-success responses; gate Tinybird/Typesense |
| Agent tool protocol | `buzz-cli` / MCP / ACP | `tool-registry.ts` | Stable AI capabilities across surfaces | **Already present (weaker)** / later externalize | 3 | 4 | 3 | 3 | Namespaced aliases + schema version |
| JSON-in/JSON-out CLI | `buzz-cli` validate/JSON errors | No first-class Ritual CLI | Automate logging from terminal/Shortcuts | **Consider later** | 2 | 3 | 2 | 4 | Thin CLI calling same tool executors |
| AI action receipts | Event trail + “receipts” product story | `ActionReceiptDB` unused by chat UX | Trust AI mutations; undo | **Adopt soon** | 5 | 2 | 2 | 5 | Persist+render receipts for `logHabit`/`createHabit` |
| Workflow engine | YAML `buzz-workflow` (approvals incomplete) | `WorkflowService` + approvals models | Personal automations | **Already present**; reject Buzz YAML copy | 3 | 4 | 4 | 4 | Templates on existing engine |
| Approval gates | Incomplete WF-08 | `ApprovalRequestDB` + policy service | Sensitive AI/actions need confirm | **Already present (partial)** | 4 | 3 | 2 | 5 | Require approval for delete/bulk AI writes |
| Unified search | Postgres FTS generated column | OCR FTS + Typesense + vault silo | Find across life data | **Prototype first** | 5 | 4 | 3 | 5 | Local SQLite FTS union index |
| Audit / hash-chain | `buzz-audit` SHA-256 chain | Deletion receipts; no hash chain | Tamper evidence | **Reject** hash-chain; adopt light provenance | 2 | 4 | 3 | 3 | Append-only provenance journal only |
| Provenance ledger (light) | Signed events + audit enqueue | Import undo; receipt before/after | Know who/what wrote a log | **Adopt soon** | 4 | 3 | 2 | 5 | Actor/source columns + journal rows |
| Bounded queues | ACP 500/50; audit chan 1000; semaphores | Desktop outbox good; backend create_task weak | Avoid meltdown under import/AI load | **Adopt soon** / prototype shared runner | 4 | 3 | 2 | 4 | Cap fan-out; dead-letter secondary jobs |
| Cancellation & process cleanup | Process groups; cancel tokens; kill group | Watcher orphan cleanup; import cancel | Stuck watcher/AI/import jobs | **Adopt soon** | 4 | 2 | 2 | 4 | CancellationToken-style shutdown for sync/updater; tests |
| Crash recovery | Durable events; interval workflows weak | Outbox durable; in-memory jobs weak | Survive restart mid-import | **Prototype first** | 4 | 4 | 3 | 4 | Persist job leases for imports |
| Observability | metrics/OTel/prometheus | Sentry/OpenPanel; some tracing | Debug production | **Consider later** | 3 | 3 | 2 | 3 | Structured job metrics only |
| Tauri 2 patterns | Desktop Tauri 2 + managed agents | Already Tauri 2.10.3 | N/A upgrade | **Already present (equivalent)** | 1 | 1 | 1 | 5 | Steal process-group ideas only |
| Frontend data architecture | Vite + TanStack Router/Query/Virtual | Next + React Query + virtualization | Perf of large lists | **Already present (comparable)**; reject Next→Vite | 2 | 5 | 4 | 5 | Keep Next; continue virtualization |
| Testing harness | Playwright smoke + relay E2E | Unit/pytest; checklists | Catch desktop regressions | **Prototype first** | 3 | 3 | 2 | 5 | One Playwright desktop smoke |
| Architecture enforcement | Crate boundaries + CI | `repo:check` scripts | Stop boundary rot | **Adopt soon** | 2 | 2 | 1 | 4 | Add domain-I/O ban + honest Rust budget |
| File-size / UI guard scripts | `check-file-sizes-core.mjs` | Line budgets + UI boundary | Keep modules reviewable | **Already present (weaker)** | 2 | 1 | 1 | 5 | Optional byte ratchet; keep line budgets honest |

---

## Ranked by weighted score (approx.)

| Rank | Item | Class | Score |
| ---: | --- | --- | ---: |
| 1 | AI action receipts | Adopt soon | ~24 |
| 2 | Light provenance journal | Adopt soon | ~18.5 |
| 3 | Zero-I/O domain core | Adopt soon | ~18 |
| 4 | Bounded jobs / fan-out | Adopt soon / Prototype | ~17 |
| 5 | Unified local search | Prototype first | ~16.5 |
| 6 | Guardrails honesty + Playwright | Adopt / Prototype | ~16.5 |
| 7 | Orchestration boundary | Adopt soon | ~16 |
| 8 | Idempotent ingestion | Adopt soon | ~ (high UV; included in P1) |
| 9 | Typed derived events | Prototype first | ~14.5 |
| 10 | External tool protocol / CLI | Later | ~8.5 |
| — | Buzz YAML workflows / hash-chain / Nostr / Redis / Vite rewrite | Reject | — |

---

## Explicit rejects (detail)

1. **Nostr + cryptographic agent identities** — wrong identity model for Clerk/personal app.  
2. **Central relay as source of truth** — conflicts with encrypted local vault V1.  
3. **Redis pub/sub** — ops cost without multi-subscriber server need.  
4. **Postgres FTS as required cloud index** — prefer local SQLite FTS; Typesense optional.  
5. **Hash-chain audit UX** — weak against DB admins; high complexity; low consumer value.  
6. **Copying Buzz workflow YAML/approvals** — incomplete upstream; Ritual already has models.  
7. **Next.js → Vite / TanStack Router migration** — rewrite risk, no quantified gain.  
8. **Treating Buzz incomplete features as designs to port** — rate limiter, WF approvals, interval durability.

---

## License row

| Item | Value |
| --- | --- |
| License | Apache-2.0 |
| Direct code reuse considered? | **No** |
| Attribution needed for this research? | Cite Buzz as inspiration in docs; no code NOTICE required for concepts |
| If later vendoring | Legal review + NOTICE/LICENSE compliance |
