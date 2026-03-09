# Ritual Memory Remaining Fixes Plan (After D/A/B/C)

**Date:** March 2, 2026  
**Scope:** Plan next implementation phase for E/F/G/H after applying:
- `D` remove silent legacy semantic fallback
- `A` intent-aware freshness anchoring
- `B/C` adaptive embedding cadence + semantic readiness coverage gate

## Objective
Finish the quality/reliability loop so semantic answers are both accurate and transparently confidence-scoped.

---

## Fix E: Event-Boosted Capture (Hybrid Event + Polling)

## Goal
Improve evidence alignment for semantic queries without a full OS-hook rewrite.

## Deliverables
1. Add capture urgency channel (`High`, `Normal`, `Idle`) in recorder runtime loop.
2. Trigger `High` urgency on focus/window/app changes already available in recorder state.
3. Decay back to `Normal` after burst window.
4. Keep existing idle fallback as safety net.

## Proposed intervals
1. `High`: 500ms for 5-10s burst window
2. `Normal`: 3s
3. `Idle`: 10s

## Touchpoints
1. `apps/desktop/src-tauri/bin/ritual-recorder/src/main.rs`
2. (Optional) recorder config file if you want tunable intervals

## Acceptance criteria
1. Captured frames increase around focus/window transitions.
2. No sustained CPU spike in idle or steady-state usage.
3. “When did I last work on X?” shows tighter timestamp alignment on transition-heavy sessions.

---

## Fix F: Shared Query Expansion Dictionary

## Goal
Remove Python/Rust alias drift by using one canonical expansion source.

## Deliverables
1. Create `shared/query_expansion.json` with aliases/expansions.
2. Load file in Python search utils.
3. Load same file in Rust vector retrieval (startup or lazy cache).
4. Add fallback defaults if file missing/corrupt.
5. Add CI check to validate schema + both parsers.

## Touchpoints
1. `apps/backend/services/watcher_service_search_utils.py`
2. `apps/desktop/src-tauri/crates/ritual-db/src/vector.rs`
3. new `shared/query_expansion.json`
4. test file(s) for parser parity

## Acceptance criteria
1. Same query token expansion set in Python and Rust for a test corpus.
2. No regression in existing semantic retrieval tests.
3. New aliases can be added without code changes.

---

## Fix G: Retrieval Tier Reporting (Explicit Quality Mode)

## Goal
Expose retrieval quality tier so users and LLM response templates do not overstate certainty.

## Tier model
1. `semantic_full`: bridge available, chunk readiness healthy
2. `semantic_frame`: vectors available but chunk coverage/readiness not full
3. `lexical_fts`: lexical/FTS fallback only
4. `activity_only`: semantic path blocked, time/activity context only

## Deliverables
1. Add `retrieval_tier` to backend response payloads.
2. Propagate tier through orchestrator context and canvas payload.
3. Update response copy templates:
   - lexical tier -> “text match based”
   - activity tier -> “activity presence, not topic proof”
4. Log tier distribution for debugging.

## Touchpoints
1. `apps/backend/services/watcher_service_search.py`
2. `apps/backend/api/watcher_common.py` (response models)
3. `apps/dashboard/lib/ai/chat-stream/orchestrator.ts`
4. `apps/dashboard/components/chat/habit-canvas.tsx`

## Acceptance criteria
1. Every semantic/time answer has a deterministic `retrieval_tier`.
2. UI warning language matches tier.
3. No high-confidence topic claims when tier is `lexical_fts` or `activity_only`.

---

## Fix H: Expand Golden Eval and Make Gate Mandatory

## Goal
Prevent regressions and block launch on known quality failures.

## Deliverables
1. Expand fixtures from 2 cases to 50-100 across:
   - recency
   - topic-specific
   - time-spent
   - negation
   - ambiguity
   - empty/no-result
2. Add assertions for:
   - intent resolution
   - citation grounding tokens
   - confidence floor/ceiling by tier
   - forbidden-token false positives
3. CI integration with required env/bootstrap for local DB fixture.
4. Publish pass/fail metrics in CI logs.

## Touchpoints
1. `apps/backend/tests/fixtures/memory_golden_queries.json`
2. `apps/backend/tests/test_memory_golden_gate.py`
3. CI workflow config (repo-specific pipeline file)

## Acceptance criteria
1. Precision >= 0.85 on fixture set.
2. High-confidence false claims = 0.
3. CI fails hard when gate fails (not opt-in).

---

## Recommended Order and Effort

1. `G` Retrieval tier reporting (small/medium, immediate trust gain)
2. `F` Shared expansion dictionary (small/medium, low risk)
3. `H` Golden gate expansion (medium, high long-term value)
4. `E` Event-boosted capture (medium/high, highest implementation complexity)

---

## Risks to Watch

1. Over-aggressive capture bursts increasing CPU/storage.
2. Shared expansion dictionary schema drift if not versioned.
3. Tier logic fragmentation if computed in multiple places.
4. Golden tests becoming brittle if fixtures depend on volatile local data snapshots.

---

## Exit Criteria for This Phase

1. Retrieval tier visible in API + UI for all memory answers.
2. Shared token expansion source active in both backend and Rust retrieval.
3. Golden gate mandatory in CI with expanded fixture coverage.
4. Event-boosted capture rolled out behind a feature flag and validated on real sessions.

