# Buzz-Inspired Roadmap for Ritual

**Companion docs:** `BUZZ_ARCHITECTURE_REVIEW.md`, `BUZZ_ADOPTION_MATRIX.md`  
**Buzz commit analyzed:** `f95fdc1a102e17c6718a44323d9a2feaed702db7`  
**Constraint:** Preserve Ritual’s approved V1 privacy model (encrypted local vault as sensitive SoT; Ritual Vault folder = export/mirror only). Do not revive live file-native Markdown runtime as a dependency of this roadmap.

---

## Phase 0: No-code validation

Research and instrumentation before architectural investment.

### 0.1 Measure AI mutation trust gap

- Sample recent `logHabit` / `createHabit` chat turns (local/dev or anonymized metrics).
- Count: mutations without user-visible confirmation; corrections after AI logs; support tickets mentioning “AI logged wrong.”
- **Success signal to proceed:** Nontrivial rate of AI writes or user confusion → receipts are justified.

### 0.2 Map idempotency coverage

- Inventory all mutating ingest paths: habit logs, imports, location, wearables, tasks/routines, AI tools, desktop outbox.
- For each: unique key? duplicate response? secondary fan-out gated?
- Deliverable: spreadsheet or short markdown table in this folder (optional follow-up).

### 0.3 Measure secondary fan-out failure modes

- Add temporary structured logs around Tinybird/Typesense `create_task` failures (no redesign yet).
- Observe: frequency, lag, duplicate index symptoms.

### 0.4 Confirm search demand

- Command palette / Typesense usage qualitatively; which corpora users expect in one box.
- Decide local-lexical prototype corpus order (habits+notes first vs activity first).

### 0.5 Doc hygiene (optional)

- Mark `docs/ARCHITECTURE-ANALYSIS.md` stale regarding Tauri 1 / recorder, or add a banner pointing to privacy pass-2 docs.
- No production behavior change.

---

## Phase 1: Low-risk foundations

Incremental changes that do **not** change Ritual’s canonical storage model.

### 1.1 AI action receipts for mutating chat tools — **Adopt soon**

**Why:** Highest user-trust ROI; `ActionReceiptDB` already exists.

**Scope:**

- On successful `logHabit` / `createHabit` (and optionally SMS equivalents), write `ActionReceiptDB` with `conversation_id`, `before_json`/`after_json`/`undo_json`, model/tool metadata.
- Chat UI: collapsible “Ritual changed…” receipt (not a wall of JSON).
- Undo path: call existing correction/delete APIs when undo payload present.

**Likely files:**

- `packages/chat-runtime/src/executors/habits.ts`
- `packages/chat-runtime/src/chat-stream/tool-dispatch.ts`
- `apps/backend/services/action_policy_service.py` (or thin receipt helper)
- `apps/dashboard/app/(dashboard)/chat/*`

**Non-goals:** Approvals for every read tool; MCP; new event store.

### 1.2 Idempotent write acknowledgements — **Adopt soon**

**Why:** Buzz’s `was_inserted` pattern prevents duplicate analytics/search side effects.

**Scope:**

- Standardize duplicate-success responses for habit log create + import item apply + AI-driven creates when `client_event_id`/hash present.
- Gate Tinybird/Typesense fan-out on “newly inserted” only.

**Likely files:**

- `apps/backend/services/habits_service.py`
- Habit log models/migrations if unique index gaps remain
- Import apply paths under `apps/backend/api/imports.py`

### 1.3 Actor / source provenance fields — **Adopt soon**

**Why:** Users cannot distinguish user vs AI vs import vs Health without lineage.

**Scope:**

- Add optional `actor_type`, `actor_id`, `source_*` fields (or JSON provenance blob) on habit log writes and receipt metadata.
- Populate from chat tools, import runs, wearable projection.

**Non-goals:** Event-sourcing all entities; hash chains.

### 1.4 Bound backend secondary fan-out — **Adopt soon**

**Why:** Naked `asyncio.create_task` is an unbounded reliability footgun.

**Scope:**

- Small in-process `SecondaryJobRunner`: concurrency cap per class (`analytics`, `search`, `notify`), retry with backoff, dead-letter list, drop/log when saturated.
- Migrate habits Tinybird/Typesense tasks first.

**Likely files:**

- New helper under `apps/backend/services/`
- `habits_service.py` call sites

**Non-goals:** Cross-process distributed queue; Redis.

### 1.5 Process lifecycle hardening — **Adopt soon**

**Why:** Buzz’s process-group + cancellation discipline maps to watcher/updater/sync.

**Scope:**

- Structured shutdown: cancel sync/updater loops on `ExitRequested` with join timeout.
- Expand watcher cleanup tests (orphan kill, double-start).
- Document concurrency classes for desktop background work.

**Likely files:**

- `apps/desktop/src-tauri/src/main.rs`
- `cloud_sync.rs`, `desktop_runtime/updater.rs`
- `watcher/lifecycle.rs` tests

### 1.6 Guardrail honesty — **Adopt soon**

**Why:** Ritual already has Buzz-like culture via `repo:check`.

**Scope:**

- Make Rust line budget fail CI or maintain an explicit exception list (no silent warn-only).
- Add a dependency/architecture check: “domain package cannot import SQLAlchemy/React/Tauri” once Phase 1.7 lands.
- Keep privacy verifier green.

### 1.7 Pure domain extraction (start) — **Adopt soon**

**Why:** Buzz `buzz-core` zero-I/O fence is the cleanest maintainability win.

**Scope:**

- Extract streak/schedule/validation pure functions used by habits/routines into `packages/domain-*` or backend `domain/` with no I/O imports.
- Unit tests only.

**Non-goals:** Move persistence into the domain package.

---

## Phase 2: Small prototypes

Each prototype must be removable without migration drama.

### Prototype P2.1 — Chat receipts end-to-end (if not fully done in 1.1)

| Field | Content |
| --- | --- |
| Hypothesis | Showing AI write receipts increases trust and reduces corrective re-logs |
| User benefit | See/undo what AI changed |
| Isolated scope | Chat mutating tools only |
| Files | chat-runtime executors, chat UI, action_receipts API |
| Success metrics | Receipt visible on ≥95% AI writes in test; undo works; no +>50ms p95 regression on logHabit |
| Failure criteria | Users ignore receipts; undo too error-prone; support load unchanged |
| Removal plan | Feature-flag off; leave receipt rows inert |

### Prototype P2.2 — Unified local lexical search

| Field | Content |
| --- | --- |
| Hypothesis | One local search box over habits + vault notes + activity titles beats fragmented Typesense-only UX for desktop users |
| User benefit | Find behaviors/activity without cloud round-trip |
| Isolated scope | Desktop/local index; read-only UI surface behind flag |
| Files | `ritual-db` FTS or vault projection index; dashboard command palette branch |
| Success metrics | p95 local query <50ms on fixture vault; privacy exclusions enforced (no raw GPS/OCR dump by default) |
| Failure criteria | Ranking useless; index bloat; privacy leak |
| Removal plan | Delete index tables; remove UI entry |

### Prototype P2.3 — Derived activity journal

| Field | Content |
| --- | --- |
| Hypothesis | A derived append-only journal enables timeline/debug/sync without event-sourcing entities |
| User benefit | “What changed today across sources?” |
| Isolated scope | Writer after successful domain mutations; no readers in critical path initially |
| Files | backend or vault journal writer; optional debug view |
| Success metrics | Journal rows match mutation count in tests; zero dual-write inconsistency bugs in soak |
| Failure criteria | Dual-write drift; performance regression; temptation to make journal SoT |
| Removal plan | Stop writers; drop table |

### Prototype P2.4 — Shared job runner for imports + fan-out

| Field | Content |
| --- | --- |
| Hypothesis | One bounded runner reduces stuck imports and duplicate secondary effects |
| User benefit | Cancel/progress reliability |
| Isolated scope | Backend process only; start with imports + habits fan-out |
| Files | `JobRunner`, `api/imports.py`, `habits_service.py` |
| Success metrics | Cancel works across restart *or* clearly reports orphaned; no queue meltdown under load test |
| Failure criteria | More complexity than asyncio tasks without reliability gain |
| Removal plan | Feature flag back to create_task |

### Prototype P2.5 — Playwright desktop smoke

| Field | Content |
| --- | --- |
| Hypothesis | One automated smoke catches updater/watcher/vault IPC regressions earlier than checklists |
| User benefit | Indirect — fewer broken builds |
| Isolated scope | Headless/smoke: app launch, vault status command, watcher start/stop |
| Files | `apps/desktop` e2e folder; CI job |
| Success metrics | Stable on CI for 2 weeks; catches ≥1 real regression in trial |
| Failure criteria | Flake rate >10% |
| Removal plan | Disable CI job |

---

## Phase 3: Larger approved investments

Only after Phase 0–2 evidence.

### 3.1 Personal automations v1 (product)

- Build on **existing** Ritual workflows/approvals — not Buzz YAML.
- User-facing: 3–5 templates with plain-language editor (store as JSON/DB; optional Markdown export later).
- Triggers: behavior logged, routine missed, metric threshold, schedule.
- Actions: notify, create task, ask chat follow-up, start routine.
- Hard requirements: loop prevention, quiet hours, approval for outbound integrations.

### 3.2 Durable local/desktop job manager

- Persist job leases for imports, transcription, sync, embeddings.
- Concurrency classes: `interactive`, `bulk_import`, `ai`, `sync`.
- Crash recovery + progress UI.

### 3.3 Hybrid search

- Local lexical (required) + optional embeddings for semantic recall.
- Privacy: embeddings local or explicitly opted-in cloud.
- Ranking experiments only after lexical baseline ships.

### 3.4 External automation surface

- Versioned tool protocol (`ritual.*`) for Shortcuts / future MCP / CLI.
- Same executors as chat; same receipts and approvals.
- Default deny for destructive tools.

### 3.5 Keychain-backed vault keys

- Not from Buzz; from Ritual privacy plans — still higher leverage than hash-chain audit.

---

## Explicit non-goals

Ritual should **not** pursue from Buzz:

1. Nostr protocol adoption or signed event mesh as product substrate  
2. Central relay as canonical store  
3. Redis (or equivalent) pub/sub for single-user fan-out  
4. Postgres-partitioned global event log replacing Turso/libSQL/vault  
5. Cryptographic agent identities / agents-as-channel-members  
6. Hash-chain audit as a user-facing integrity product  
7. Porting Buzz’s incomplete YAML approval/DM workflow engine  
8. Migrating dashboard from Next.js to Vite/TanStack Router without a quantified crisis  
9. Downgrading or re-litigating Tauri 2 (already on Tauri 2)  
10. Multi-tenant community / moderation / forge / huddle product surfaces  
11. Treating Buzz README vision docs as completed implementation to copy  
12. Making a derived event journal the canonical replacement for domain tables or the encrypted vault  

---

## Suggested sequencing (90-day sketch)

```text
Weeks 1–2   Phase 0 measurements + doc stale banners
Weeks 2–5   Phase 1.1 receipts + 1.2 idempotency + 1.3 provenance
Weeks 4–7   Phase 1.4 fan-out runner + 1.5 desktop lifecycle
Weeks 6–8   Phase 1.6–1.7 guardrails + pure domain start
Weeks 7–12  Prototypes P2.2 search and/or P2.3 journal (pick one primary)
Week 10+    Decide Phase 3 automations only if templates demand is clear
```

---

## Decision checkpoints

| Checkpoint | Proceed if | Stop/defer if |
| --- | --- | --- |
| After receipts ship | Users engage undo/receipt UI; fewer bad AI logs | Zero engagement |
| After idempotency | Duplicate Tinybird/Typesense rows drop in metrics | No duplicates observed (still keep keys) |
| After local search prototype | Weekly active search > threshold; privacy review pass | Ranking failure / index cost |
| Before automations v1 | ≥1 concrete user journey beyond engineering curiosity | Buzz-like platform creep |

---

## Highest-confidence next implementation prompt

See final answer in the review conversation: implement **AI action receipts for `logHabit` / `createHabit` only**, reusing `ActionReceiptDB`, behind a feature flag, with chat UI affordance and undo. No event store, no Buzz code, no workflow rewrite.
