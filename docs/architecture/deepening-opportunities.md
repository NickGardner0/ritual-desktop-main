# Ritual — Deepening Opportunities

**Status:** Proposed improvements (no code changes yet)
**Date:** 2026-07-02
**Vocabulary:** Uses [Matt Pocock's `/codebase-design`](https://github.com/mattpocock/skills) terms — **module**, **interface**, **depth**, **seam**, **adapter**, **leverage**, **locality**.

This document proposes refactors to simplify Ritual's architecture, make it easier to build upon, and reduce bug surface. Each candidate is evaluated with the three design tests:

1. **Deletion test** — Would deleting this module concentrate complexity elsewhere, or just vanish?
2. **Interface is the test surface** — Can callers and tests cross the same seam?
3. **One adapter = hypothetical seam; two adapters = real seam** — Are we introducing abstractions before we have two real variants?

### Adapter discipline

In-memory adapters validate testability, but they do not by themselves justify a new external seam. Each new facade or deep module must include production call-site migration criteria, legacy deletion or expiry criteria, and interface-level tests. A facade that only wraps legacy paths indefinitely is a compatibility layer, not a completed deep module.

For the current-state inventory, see [current-architecture.md](./current-architecture.md).

---

## Table of contents

1. [Executive summary](#executive-summary)
2. [Recommendation priority matrix](#recommendation-priority-matrix)
3. [Candidate 1: Wearables unified ingest](#candidate-1-wearables-unified-ingest)
4. [Candidate 2: Integration orchestrator → typed plugin interfaces](#candidate-2-integration-orchestrator--typed-plugin-interfaces)
5. [Candidate 3: Vault sync facade](#candidate-3-vault-sync-facade)
6. [Candidate 4: Habits service decomposition](#candidate-4-habits-service-decomposition)
7. [Candidate 5: Migration path consolidation](#candidate-5-migration-path-consolidation)
8. [Candidate 6: Voice input deep module](#candidate-6-voice-input-deep-module)
9. [Candidate 7: Chat serving canonical path](#candidate-7-chat-serving-canonical-path)
10. [Candidate 8: Analytics boundary migration](#candidate-8-analytics-boundary-migration)
11. [Candidate 9: Desktop command module extraction](#candidate-9-desktop-command-module-extraction)
12. [Candidate 10: iOS sync decomposition](#candidate-10-ios-sync-decomposition)
13. [Candidate 11: Shared contracts expansion](#candidate-11-shared-contracts-expansion)
14. [Candidate 12: CONTEXT.md and living glossary](#candidate-12-contextmd-and-living-glossary)
15. [Smaller wins (quick deepening)](#smaller-wins-quick-deepening)
16. [What not to do](#what-not-to-do)
17. [Suggested execution sequence](#suggested-execution-sequence)

---

## Executive summary

Ritual's architecture has **12 major deepening opportunities** and several quick wins. The highest-impact refactors share a pattern: **two parallel implementations** of the same concern, connected by a **shallow orchestrator** with a **large interface**.

The recommended sequence:

```
P0: CONTEXT.md foundation → Migration safety → Wearables unification
P1: Integrations typed boundaries → Vault facade → Habits decomposition
P2: Analytics boundary → Chat path decision → Desktop/iOS monolith splits
P3: Shared contracts expansion
```

Each candidate below includes: current shape (shallow), proposed shape (deep), design test results, expected leverage/locality gains, and alignment with the thermo-nuclear remediation program.

---

## Recommendation priority matrix

| # | Candidate | Strength | Impact | Effort | Risk if ignored |
|---|-----------|----------|--------|--------|-----------------|
| 1 | Wearables unified ingest | **Strong** | Critical | Large | Dual ingest bugs, iOS/dashboard/backend drift |
| 2 | Integration typed interfaces | **Strong** | High | Medium | Plugin bugs require orchestrator edits |
| 3 | Vault sync facade | **Strong** | High | Large | Privacy sync bugs across 3 runtimes |
| 4 | Habits service decomposition | **Strong** | High | Medium | Fan-out bugs, hard to test |
| 5 | Migration path consolidation | **Strong** | Critical | Medium | Prod schema drift (known incident class) |
| 6 | Voice input deep module | **Strong** | Medium | Small | Duplicate bug fixes |
| 7 | Chat serving canonical path | Worth exploring | Medium | Medium | Two chat paths, chat-api untested in CI |
| 8 | Analytics boundary migration | Worth exploring | Medium | Medium | BFF budget blocked, split analytics logic |
| 9 | Desktop command extraction | Worth exploring | Medium | Medium | main.rs grows unbounded |
| 10 | iOS sync decomposition | Worth exploring | Medium | Large | BackgroundSyncManagerV2 bugs |
| 11 | Shared contracts expansion | Speculative | Medium | Large | Type drift across surfaces |
| 12 | CONTEXT.md glossary | **Strong** | High | Small | Agent/human misalignment every session |

---

## Candidate 1: Wearables unified ingest

**Recommendation strength:** Strong
**Thermo-nuclear alignment:** Phase wearables / "One canonical path per concern"

### Current shape (shallow)

Two parallel ingest modules with overlapping responsibilities:

```
┌─────────────────────────────────────────────────────────┐
│  Integration orchestrator + wearables routes (callers)  │
└────────────────────────┬────────────────────────────────┘
                         │
              ┌──────────▼──────────┐
              │ wearables_unified/  │
              │ canonical ingest    │
              └──────────┬──────────┘
                         ▼
              Turso + Tinybird + outbox
```

**Smells:** Divergent Change, Shotgun Surgery, Duplicated Code
**Deletion test:** Deleting `wearables_service.py` forced production callers to learn unified device security and Apple ingest services — complexity now concentrates in the canonical module.

**Affected files:**

- `apps/backend/services/wearables_service.py` — deleted legacy target
- `apps/backend/services/wearables_unified/*` — keep and deepen
- `apps/backend/api/wearables_routes/apple.py` (958 lines) — split + migrate
- `apps/backend/api/screen_time.py` / `screen_time_service.py` — now use unified device security
- `apps/dashboard/integrations-client.legacy-wearables.ts` — delete target
- `apps/ios-companion/.../BackgroundSyncManagerV2.swift` — calls backend ingest

### Proposed shape (deep)

One deep module with small interface:

```
┌─────────────────────────────────────────────────────────┐
│  Callers: iOS, dashboard plugins, Trigger.dev jobs    │
└────────────────────────┬────────────────────────────────┘
                         │
              ┌──────────▼──────────┐
              │  WearablesIngest    │  ← Small interface
              │  .ingest(provider,  │     4-5 methods
              │   payload)          │
              │  .status(provider)  │
              │  .disconnect(...)   │
              │  .export(...)       │
              ├─────────────────────┤
              │  Provider adapters  │  ← Internal
              │  apple | whoop |    │
              │  oura | garmin |    │
              │  screen_time        │
              ├─────────────────────┤
              │  Projection sink    │  ← Internal
              │  (materialization   │
              │   cascade)          │
              └──────────┬──────────┘
                         ▼
              Turso + outbox + Tinybird
```

**Interface (external seam):**

```python
class WearablesIngest:
    async def ingest(self, provider: Provider, payload: IngestPayload) -> IngestResult: ...
    async def status(self, provider: Provider, user_id: str) -> ConnectionStatus: ...
    async def disconnect(self, provider: Provider, user_id: str) -> None: ...
    async def export(self, provider: Provider, user_id: str, range: DateRange) -> ExportBundle: ...
```

**Adapters (internal, not at external seam):**

- `AppleHealthAdapter`, `WhoopAdapter`, `ScreenTimeAdapter`, etc.
- `InMemoryWearablesIngest` for interface tests only; production call-site migration decides whether the external seam has earned its keep

### Design test results

| Test | Result |
|------|--------|
| Deletion test | Legacy `wearables_service.py` is deleted; ingest logic now concentrates in unified modules — good |
| Interface is test surface | Tests call `ingest()` with fixture payloads; no need to mock internal provider adapters |
| Two adapters | Production ingest + in-memory test adapter gives a testable seam, but completion still requires migrating production callers off legacy paths |

### Expected gains

- **Leverage:** iOS, dashboard, Trigger.dev, and backend routes all call same 4-method interface
- **Locality:** Ingest bugs fixed once; materialization cascade logic in one place
- **Testability:** Provider scenarios tested through `ingest()` without reaching into projection

### Migration steps (implementation status)

1. Done: audited production call sites of `wearables_service.py` and dashboard legacy wearable handlers.
2. Done: migrated `screen_time_service.py` and `wearables_routes/apple.py` to unified device security / Apple ingest services.
3. Done: removed legacy `wearables_service` imports from production callers.
4. Done: deleted `wearables_service.py`.
5. Remaining: delete or explicitly expire `integrations-client.legacy-wearables.ts` with an owner/date after Apple/Oura/Garmin handlers are plugin-owned.
6. Remaining: split `apple.py` into device / ingest / export / status sub-routers (each <400 lines).
7. Remaining: add broader integration tests at the final `WearablesIngest` interface.

---

## Candidate 2: Integration orchestrator → typed plugin interfaces

**Recommendation strength:** Strong
**Thermo-nuclear alignment:** Integrations plugin registry completion

### Current shape (shallow)

Plugin registry exists, but orchestrator passes a **god-context**:

```
┌──────────────────────────────────────────────────────────┐
│  IntegrationOrchestratorDeps (125+ lines of deps)        │
│  IntegrationRuntimeContext (Record<string, unknown>…)   │
├──────────────────────────────────────────────────────────┤
│  Thin pass-through to 6 plugins                          │
└──────────────────────────────────────────────────────────┘
         │         │         │         │         │         │
         ▼         ▼         ▼         ▼         ▼         ▼
      whoop    plaid    tesla   apple-w   iphone   computer
      hook     hook     hook    health    time     tracking
      (~470L)  (~400L)  (~300L)  (~350L)  (~300L)  (~250L)
```

**Smells:** Data Clumps, Primitive Obsession (`Record<string, unknown>`), Middle Man, Large Interface
**Deletion test:** Deleting `IntegrationRuntimeContext` would force each plugin to declare its own deps — complexity concentrates into typed interfaces (good).

**Affected files:**

- `plugins/types.ts` (125 lines)
- `integrations-client.impl.tsx`
- `integrations-client.shared.helpers.tsx`
- `integrations-client.legacy-wearables.ts`
- Per-plugin `use-*-integration.ts` hooks

### Proposed shape (deep)

Each plugin owns a **small interface**. Orchestrator becomes a thin registry:

```
┌─────────────────────────────────────────────────────────┐
│  IntegrationsRegistry (orchestrator)                    │
│  Interface: register(plugin), renderCards(), openDetail()│
├─────────────────────────────────────────────────────────┤
│  Wires shared deps once: getToken, queryClient, router  │
└────────────┬────────────────────────────────────────────┘
             │ typed props, not god-context
    ┌────────┼────────┬────────┬────────┬────────┐
    ▼        ▼        ▼        ▼        ▼        ▼
 WhoopPlugin Plaid  Tesla  AppleH  iPhone  Computer
 Interface   Plugin  Plugin  Plugin  Plugin  Plugin
 (5 methods) (5)     (4)     (6)     (4)     (3)
```

**Example — Whoop plugin interface:**

```typescript
interface WhoopPlugin {
  id: 'whoop';
  useConnection(): { status: WhoopStatus; connect: () => void; disconnect: () => Promise<void> };
  DetailPanel: React.FC;
  PanelAction: React.FC;
  buildCard: (ctx: CardContext) => IntegrationCardItem | null;
}
```

Orchestrator deps shrink to:

```typescript
interface IntegrationsRegistryDeps {
  getToken: () => Promise<string | null>;
  queryClient: QueryClient;
  router: AppRouter;
  isDesktop: boolean;
}
```

### Design test results

| Test | Result |
|------|--------|
| Deletion test | Removing god-context forces explicit plugin contracts — good |
| Interface is test surface | Each plugin testable with mock `getToken` + `queryClient` |
| Two adapters | Mock Whoop API adapter for tests; production OAuth adapter — real seam |

### Expected gains

- **Leverage:** New integration = implement 5-method interface, register in `registry.ts`
- **Locality:** Whoop bugs fixed in `plugins/whoop/` only; no orchestrator edits
- **Type safety:** Remove `whoop as unknown as IntegrationPlugin` cast

### Migration steps

1. Define typed interface per plugin (start with Whoop — largest hook)
2. Refactor `use-whoop-integration.ts` to satisfy interface internally
3. Shrink `IntegrationRuntimeContext` field by field as plugins migrate
4. Delete `integrations-client.legacy-wearables.ts`
5. Delete `IntegrationOrchestratorDeps` fields that become plugin-internal

---

## Candidate 3: Vault sync facade

**Recommendation strength:** Strong
**Thermo-nuclear alignment:** Privacy program (`docs/privacy/*`)

### Current shape (shallow)

Vault logic scattered across 3 runtimes with no unified seam:

```
Dashboard TS (~15 modules)          Backend Python           Desktop Rust
├── local-vault.ts                  ├── api/privacy.py       ├── local_vault.rs
├── vault-private-sync.ts (768L)    ├── privacy_* services   ├── vault_* commands
├── vault-private-sync-keyring.ts   └── privacy_sync models  └── cloud_sync.rs
├── ritual-vault-export.ts (794L)
├── habit-vault-adapter.ts
└── task-vault-adapter.ts
         │                                   │                      │
         └──────────── no single seam ───────┴──────────────────────┘
```

**Smells:** Shotgun Surgery, Divergent Change, Message Chains
**Deletion test:** Deleting any one module leaves vault behavior broken in multiple places — complexity is **spread**, not **deep**.

### Proposed shape (deep)

One deep module per runtime with matching interface contract:

```
┌─────────────────────────────────────────────────────────┐
│  VaultSync (TypeScript facade)                          │
│  Interface:                                             │
│    initialize(config) → VaultStatus                     │
│    putRecord(type, record) → void                       │
│    getRecord(type, id) → Record | null                    │
│    listRecords(type, filter) → Record[]                   │
│    pushOutbox() → SyncResult                              │
│    pullChanges(since) → ChangeSet                         │
│    export() → ExportBundle                                │
│    rotateKeys() → KeyRotationResult                       │
├─────────────────────────────────────────────────────────┤
│  Adapters:                                              │
│    WebCryptoAdapter (browser production)                │
│    TauriVaultAdapter (desktop production)               │
│    InMemoryVaultAdapter (tests only)                    │
└─────────────────────────────────────────────────────────┘
```

Backend and Rust remain adapters behind HTTP/Tauri seams — not merged into TS module, but **documented state machine** ties them together.

### Design test results

| Test | Result |
|------|--------|
| Deletion test | Deleting `vault-private-sync.ts` without facade recreates logic across adapters — facade earns its keep |
| Interface is test surface | Sync scenarios tested via `pushOutbox()` / `pullChanges()` |
| Two adapters | WebCrypto + Tauri are production adapters; InMemory only proves the interface is testable |

### Expected gains

- **Locality:** Sync bugs diagnosed in one module; keyring logic internal
- **Leverage:** Habits and tasks both use same vault interface (delete duplicate outbox patterns)
- **AI-navigability:** One file to read for vault behavior

### Migration steps

1. Document vault sync state machine (diagram in `docs/privacy/`)
2. Create `lib/privacy/vault-sync.ts` facade wrapping existing modules
3. Migrate `habit-vault-adapter.ts` and `task-vault-adapter.ts` to call facade
4. Collapse `vault-private-sync*.ts` into facade implementation (internal)
5. Add in-memory adapter + tests at facade interface
6. Treat the facade as incomplete until habits/tasks use it and old private-sync modules are collapsed or deleted

---

## Candidate 4: Habits service decomposition

**Recommendation strength:** Strong
**Thermo-nuclear alignment:** Backend service decomposition

### Current shape (shallow)

`habits_service.py` (1,251 lines) handles CRUD, fan-out, projection, and side effects:

```
┌─────────────────────────────────────────────────────────┐
│  habits_service.py — Large Interface                    │
│  create_habit, update_habit, delete_habit,              │
│  create_log, update_log, delete_log,                    │
│  + Tinybird write, + Typesense index,                   │
│  + metric facts trigger, + WebSocket notify,            │
│  + alias management, + scheduled blocks,                │
│  + import projection hooks                              │
└─────────────────────────────────────────────────────────┘
```

**Smells:** Divergent Change, Feature Envy (reaching into Tinybird, Typesense, facts)
**Deletion test:** Deleting habits_service spreads fan-out logic to every router — it earns keep but needs **internal deepening**.

### Proposed shape (deep)

Split into deep modules with event-driven fan-out:

```
┌──────────────────┐     ┌──────────────────┐
│  HabitCommands   │     │  HabitQueries    │
│  (write seam)    │     │  (read seam)     │
│  create/update/  │     │  get/list/search │
│  delete          │     │                  │
└────────┬─────────┘     └──────────────────┘
         │ emit HabitEvent
         ▼
┌─────────────────────────────────────────────────────────┐
│  HabitEventSink (deep module)                           │
│  Interface: handle(event: HabitEvent) → None              │
├─────────────────────────────────────────────────────────┤
│  Internal adapters: Tinybird, Typesense, MetricFacts,   │
│  WebSocket, OpenPanel                                   │
└─────────────────────────────────────────────────────────┘
```

**External interface for callers:**

```python
class HabitCommands:
    async def create_habit(self, user_id, data: CreateHabit) -> Habit: ...
    async def create_log(self, user_id, data: CreateLog) -> HabitLog: ...
    # 4-6 methods total

class HabitQueries:
    async def get_habits(self, user_id, filter) -> list[Habit]: ...
    async def get_logs(self, user_id, range) -> list[HabitLog]: ...
    # 4-6 methods total
```

### Expected gains

- **Locality:** Fan-out logic in `HabitEventSink`; command bugs don't require reading Tinybird code
- **Testability:** Commands tested without mocking 5 sinks; sink tested with event fixtures
- **Deletion test:** Deleting `HabitEventSink` would scatter fan-out to commands — earns keep

---

## Candidate 5: Migration path consolidation

**Recommendation strength:** Strong
**Thermo-nuclear alignment:** Phase 0 / deploy safety

### Current shape (shallow)

Two migration systems:

```
Alembic (apps/backend/migrations/)     Ad-hoc scripts (scripts/migrate_*.py)
         │                                      │
         └──────── both mutate schema ──────────┘
                         │
                    Prod deploy
                    (known failure: code deployed,
                     Alembic not applied → 500s)
```

**Smells:** Duplicated Code, Shotgun Surgery
**Incident reference:** `review.md` — schema drift caused production 500s.

### Proposed shape (deep)

One deep module — Alembic-only path:

```
┌─────────────────────────────────────────────────────────┐
│  SchemaMigration (deploy seam)                          │
│  Interface: migrate_to_head() → MigrationResult           │
│             check_pending() → PendingStatus               │
├─────────────────────────────────────────────────────────┤
│  Adapter: AlembicRunner (production + CI)               │
│  Adapter: InMemorySchema (tests only)                   │
└─────────────────────────────────────────────────────────┘
```

`InMemorySchema` is a test substitute, not a reason to keep a second production migration path. This module is complete only when ad-hoc migration scripts are audited/removed and deploys invoke Alembic checks before traffic shift.

**Actions:**

1. Audit `apps/backend/scripts/migrate_*.py` — migrate logic into Alembic revisions or delete
2. CI gate: `check-migration-boundary.mjs` already exists — enforce in deploy pipeline
3. Add deploy gate: `migrate_to_head()` must succeed before traffic shift
4. Archive ad-hoc scripts per `tools/ops/backend-scripts.manifest.json`

### Expected gains

- **Locality:** Schema changes have one path; deploy failures caught before prod
- **Risk reduction:** Eliminates known incident class

---

## Candidate 6: Voice input deep module

**Recommendation strength:** Strong (quick win)
**Effort:** Small

### Current shape (shallow)

Two near-identical 552-line hooks:

- `app/(dashboard)/chat/use-chat-voice-input.ts`
- `components/ai-habit-chat/use-ai-habit-voice.ts`

**Smell:** Duplicated Code
**Deletion test:** Deleting one hook loses voice in one feature — pure duplication.

### Proposed shape (deep)

```
┌─────────────────────────────────────────────────────────┐
│  useRitualVoiceInput(config: VoiceInputConfig)          │
│  Interface:                                             │
│    startListening() → void                              │
│    stopListening() → TranscriptResult                   │
│    isListening: boolean                                 │
│    error: VoiceError | null                             │
├─────────────────────────────────────────────────────────┤
│  Internal: Deepgram adapter, permission checks,         │
│  debounce, error recovery                               │
└─────────────────────────────────────────────────────────┘
         ▲                              ▲
         │ thin config                  │ thin config
   use-chat-voice-input           use-ai-habit-voice
   (onTranscript → chat)          (onTranscript → habit form)
```

### Expected gains

- **Leverage:** Bug fixes apply to chat and habit voice simultaneously
- **Effort:** ~1 day; delete ~500 lines of duplication

---

## Candidate 7: Chat serving canonical path

**Recommendation strength:** Worth exploring

### Current shape (shallow)

Two chat serving paths:

- Dashboard: `app/api/chat/stream` → `@ritual/chat-runtime`
- Chat API: `apps/chat-api` POST `/chat/stream` → `@ritual/chat-runtime`

Chat API is not directly typechecked by CI today. The dashboard API manifest currently says the Next chat stream route must stay in Next for browser stream semantics, so making chat-api canonical requires an explicit architecture decision.

### Proposed shape (deep)

Pick one canonical path after proving stream semantics:

**Option A:** Keep Next stream canonical
- Keep `app/api/chat/stream` as the production stream module
- Add `typecheck:chat-api` to CI if chat-api remains useful, or delete chat-api if it is unused

**Option B:** Make chat-api canonical
- First prove equivalent browser stream semantics through dashboard callers
- Update the dashboard API manifest and record the decision in an ADR before removing or proxying the Next route

### Design test

- **Two adapters:** Next stream adapter + chat-api adapter can coexist during evaluation; the deepening is complete only after one production path is chosen and the other is deleted or explicitly retained with a reason.

---

## Candidate 8: Analytics boundary migration

**Recommendation strength:** Worth exploring

### Current shape (shallow)

8 Tinybird query routes in dashboard (`analytics-boundary` category). Manifest notes they exist *"until analytics is fully moved behind FastAPI."*

### Proposed shape (deep)

```
Dashboard → /api/analytics/* (BFF proxy) → FastAPI analytics router → TinybirdService
```

**Benefits:**

- Frees 8 BFF route budget slots (currently at 39/39 cap)
- **Locality:** Analytics query logic in `analytics_service.py` alongside write path
- **Leverage:** iOS/desktop could call same analytics API in future

---

## Candidate 9: Desktop command module extraction

**Recommendation strength:** Worth exploring

### Current shape (shallow)

`main.rs` (1,669 lines) — all Tauri commands registered in one file.

### Proposed shape (deep)

Extract command groups into modules (already started with `watcher/` submodule):

```
main.rs (thin: setup + register modules)
├── commands/window.rs
├── commands/auth_bridge.rs
├── commands/watcher.rs      (exists partially)
├── commands/vault.rs
├── commands/ritual_db.rs
└── commands/updater.rs
```

**Interface:** Tauri command registration per module; `main.rs` just calls `watcher::register()`.

**Locality:** Watcher command bugs isolated to `commands/watcher.rs`.

---

## Candidate 10: iOS sync decomposition

**Recommendation strength:** Worth exploring

### Current shape (shallow)

`BackgroundSyncManagerV2.swift` (2,217 lines) — state machine + upload + retry + anchor storage + provider routing.

### Proposed shape (deep)

```
BackgroundSyncCoordinator (small interface)
├── AnchorStore (local persistence)
├── BatchUploader (HTTP to RitualAPIClient)
├── ProviderRouter (HealthKit | ScreenTime | Location)
└── RetryQueue (offline resilience)
```

**Locality:** Sync bug in retry logic doesn't require reading HealthKit code.

---

## Candidate 11: Shared contracts expansion

**Recommendation strength:** Speculative (high effort)

### Current shape

`@ritual/shared-contracts` has ~13 dashboard imports. iOS Swift and backend Pydantic maintain parallel types.

### Proposed shape

- Generate Swift structs from contracts (or vice versa)
- Generate Pydantic models from OpenAPI (already partially done for backend client)
- **Leverage:** Type drift bugs eliminated at compile time

**Caution:** Only introduce seam when generation pipeline is real (two adapters: TS source → Swift/Python targets).

---

## Candidate 12: CONTEXT.md and living glossary

**Recommendation strength:** Strong (quick win)

### Current shape

Domain terms scattered across 70+ docs. No root glossary. Agents re-discover jargon every session.

### Proposed shape

Create `CONTEXT.md` at repo root (extract glossary from [current-architecture.md](./current-architecture.md)). Update inline when naming new modules during refactors.

**Leverage:** Every future `/improve-codebase-architecture` and `/code-review` session starts aligned.

---

## Smaller wins (quick deepening)

| Item | Smell | Fix | Effort |
|------|-------|-----|--------|
| `@ritual/ui` unused package | Speculative Generality | Delete or populate | 1 hour |
| Clerk version mismatch (root vs dashboard) | — | Align versions | 1 hour |
| `useMetrics*` deprecated aliases | Middle Man | Delete deprecated exports | 2 hours |
| `registry.ts` + `registry.tsx` duplication | Duplicated Code | Single registry file | 1 hour |
| Backend `imports.py` (1,398 lines) | Divergent Change | Split route vs orchestration | 1 week |
| `search_service.py` + `metric_facts_service.py` | Divergent Change | Split by query type | 2 weeks |

---

## What not to do

Per `/codebase-design` principles and thermo-nuclear program rules:

1. **Don't add ports without two adapters.** No `IHabitsRepository` until you have Turso + in-memory implementations actively used in tests.

2. **Don't split files without reducing concepts per file.** Moving 1,000 lines into five 200-line pass-through files makes things worse (shallow modules).

3. **Don't wrap legacy paths indefinitely.** Deleted legacy files are the model. Remaining migration helpers such as `integrations-client.legacy-wearables.ts` should have deletion dates.

4. **Don't disable CI gates to pass refactors.** Thermo-nuclear rule #8.

5. **Don't merge runtimes.** Vault facade in TS doesn't mean rewriting Rust vault in TypeScript — respect runtime seams.

6. **Don't big-bang refactor.** One deepening candidate per PR, behavior-preserving, phase-gated.

---

## Suggested execution sequence

Aligned with thermo-nuclear phases and impact/risk:

### Phase A — Safety & canonical paths (2-3 weeks)

| Step | Candidate | Deliverable |
|------|-----------|-------------|
| A1 | #12 CONTEXT.md | Root glossary live |
| A2 | #5 Migration consolidation | Alembic-only deploy gate |
| A3 | #6 Voice input | Shared hook, delete duplicate |

### Phase B — High-coupling domains (4-6 weeks)

| Step | Candidate | Deliverable |
|------|-----------|-------------|
| B1 | #1 Wearables unified | Legacy service deleted |
| B2 | #2 Integration interfaces | God-context eliminated |
| B3 | #4 Habits decomposition | Event sink extracted |

### Phase C — Privacy & platform depth (4-6 weeks)

| Step | Candidate | Deliverable |
|------|-----------|-------------|
| C1 | #3 Vault facade | Single TS seam + state machine doc |
| C2 | #7 Chat canonical path | Explicit stream-path decision |
| C3 | #8 Analytics migration | Tinybird queries in FastAPI |

### Phase D — Platform monoliths (ongoing)

| Step | Candidate | Deliverable |
|------|-----------|-------------|
| D1 | #9 Desktop commands | main.rs < 400 lines |
| D2 | #10 iOS sync split | BackgroundSyncManagerV2 decomposed |
| D3 | #11 Shared contracts | Codegen pipeline (if justified) |

---

## How to use these documents with Matt Pocock skills

| Skill | When to use | Input |
|-------|-------------|-------|
| `/improve-codebase-architecture` | Pick next candidate | This document + CONTEXT.md |
| `/codebase-design` | Design interface for chosen candidate | DEEPENING.md for dependency categories |
| `/grilling` | Walk design tree before implementing | Selected candidate card |
| `/code-review` | Review refactor PR | Fixed point: `main`; spec: candidate section |
| `/tdd` | Implement behavior-preserving refactor | Interface from design session |

---

## Related documents

- [current-architecture.md](./current-architecture.md) — Current-state inventory
- [../thermo-nuclear-remediation-plan.md](../thermo-nuclear-remediation-plan.md) — Active remediation program
- [../privacy/00-current-architecture-audit.md](../privacy/00-current-architecture-audit.md) — Privacy fan-out analysis
- [Matt Pocock codebase-design skill](https://github.com/mattpocock/skills/tree/main/skills/engineering/codebase-design) — Vocabulary reference
