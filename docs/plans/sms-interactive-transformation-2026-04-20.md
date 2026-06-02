# SMS Chatbot Interactive Transformation — Implementation Plan

**Date:** 2026-04-20
**Owner:** _(assign)_
**Status:** Scope-reduced after CEO review 2026-04-20 — ready for implementation

**Strategic frame (set 2026-04-20):** SMS is a **nudge/notification layer that drives users back to the dashboard** — not a standalone conversational product. Under this frame, the bot's job is to surface the right insight at the right time with a clear CTA back to the dashboard, not to replace the dashboard with chat.

Specs 5 (long-term memory), 6 (async tasks), and 7 (MMS charts) were **cut during CEO review** — they optimize for "SMS is the product" which is not the strategic target. See §9 (NOT in scope) and §14 (iteration changelog) for the full record.

This plan now transforms the Ritual SMS chatbot from a reactive utility into a warm, proactive nudge layer that respects the user's time and drives dashboard engagement, while preserving the current safety guardrails that prevent misrouted health-data writes.

---

## 0. Context & Success Criteria

### Goal
Ship Specs 1–7 (detailed in `/docs/analysis/sms-interactive-spec-notes.md` — or carried forward from this plan's §2) to move the SMS bot from one-shot Q&A to a multi-turn, proactive, personality-forward experience.

### Success criteria
- **Strategic:** Proactive SMS → dashboard session rate ≥ 35% within 1h of send (tracked via signed deep-link click). **This is the primary outcome metric** — reply-back is secondary.
- **Engagement:** 7-day reply-back rate (fraction of users who text again within 7 days of receiving a bot reply) increases ≥25%.
- **Safety:** Rate of misrouted writes (write actions on read-intent queries) stays flat or decreases. Baseline established by commit `f721c40`'s hard READ/WRITE split.
- **Proactive quality:** ≥60% of proactive messages receive a user response OR dashboard click within 6h; ≤1% opt-out rate in the first month.
- **Latency:** Median SMS reply latency stays under 5s; p95 under 12s (unchanged from today).

### Non-goals
- Voice-note support (speech-to-text). Flagged for a follow-up project.
- Cross-provider SMS (Twilio, etc.). Sendblue only.
- Group texting. 1:1 only.

---

## 1. Architecture Summary

### 1.1 Baseline infra already in place

| Concern | File / Symbol | Notes |
|---|---|---|
| Inbound webhook proxy | `apps/dashboard/app/api/sendblue/webhook/route.ts` | Forwards `sb-signing-secret` + payload to backend |
| Inbound handler | `apps/backend/api/sendblue.py` (L173–358) | HMAC verify, user lookup by phone, persistence, orchestrator call, fallback fuzzy parser |
| Orchestrator (AI reply) | `apps/dashboard/lib/ai/chat-stream/orchestrator.ts` `handleSmsChatPost()` (L1341–1508) | GPT-4o with tool loop, max 4 iterations, 15s timeout |
| Voice prompt | `apps/dashboard/lib/ai/chat-stream/system-prompt.ts` `SMS_STYLE_PROMPT` (L211–244) | Current READ/WRITE hard rules |
| Conversation persistence | `apps/backend/services/conversation_service.py` + `AIConversationDB` (models.py:604) / `AIMessageDB` (L621) | `channel` col already present |
| SMS prefs | `SmsPreferencesDB` (models.py:636) | `enabled`, `proactive_enabled`, `quiet_hours_start/end`, `max_proactive_per_day`, `allowed_triggers`, `last_proactive_sent_at` |
| Outbound service | `apps/backend/services/sendblue_service.py:47` `send_message()` | Already supports `media_url` for MMS (L67) |
| Scheduler | `apps/backend/main.py:546` `_internal_scheduler_loop()` | Hourly, gated by `ENABLE_INTERNAL_SCHEDULER`, proactive SMS stub hook already present |
| SMS prefs helpers | `apps/backend/services/sms_preferences_service.py` | `is_in_quiet_hours()` (L78), `can_send_proactive()` (L103) |

**Missing infra:** long-term user memory table, async job queue (currently fire-and-forget `asyncio.create_task()` + a couple of manual queue tables).

### 1.2 New infra to build

- `apps/backend/jobs/sms_proactive.py` + `triggers/` subpackage — evaluates triggers, calls composer LLM, sends with caps.
- `apps/backend/services/user_memory_service.py` — thin wrapper around [`mem0`](https://github.com/mem0ai/mem0) for long-term user memory. (Decision 2026-04-20: use mem0 instead of rolling custom extractor/dedup/decay — cuts ~2 files and inherits production-tested semantic dedup.)
- `apps/backend/services/chart_render.py` — vega-lite → PNG, cached blob storage.
- `SmsTaskQueueDB` table + `apps/backend/jobs/sms_task_worker.py` — deferred tasks.
- `SmsProactiveSendDB` audit log.
- `delivery_status` col on `AIMessageDB`.

### 1.3 Consolidated migration

One additive migration (SQLite-compatible, matches the Turso-per-user schema). Shipped at the start of the phase that first needs it; safe to leave any later-phase columns unused.

```sql
-- Spec 2: per-message delivery tracking for multi-message replies
ALTER TABLE ai_messages ADD COLUMN delivery_status TEXT
  CHECK(delivery_status IN ('pending','sent','failed')) DEFAULT 'sent';

-- Spec 4: clarification-in-flight window
ALTER TABLE ai_conversations ADD COLUMN pending_clarification_at TIMESTAMP;
ALTER TABLE ai_conversations ADD COLUMN pending_clarification_text TEXT;

-- Spec 1: proactive audit + dry-run gate
CREATE TABLE IF NOT EXISTS sms_proactive_sends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  trigger_kind TEXT NOT NULL,
  trigger_context TEXT,         -- JSON snapshot of data that fired the trigger
  rendered_messages TEXT,       -- JSON array of the segments
  dry_run INTEGER NOT NULL DEFAULT 0,
  outcome TEXT NOT NULL,        -- sent | dry_run | skipped_quiet_hours | skipped_daily_cap | send_failed
  sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_sps_user_sent ON sms_proactive_sends(user_id, sent_at);

ALTER TABLE sms_preferences ADD COLUMN proactive_dry_run INTEGER NOT NULL DEFAULT 1;
ALTER TABLE sms_preferences ADD COLUMN mms_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sms_preferences ADD COLUMN memory_enabled INTEGER NOT NULL DEFAULT 1;

-- Spec 5: long-term user memory — mem0 manages its own storage (Qdrant embedded
-- or Postgres extension). We only store the mem0 user_id mapping if different
-- from our own user_id; otherwise mem0 is zero additional schema on our side.
-- Audit trail of every memory write we trigger (for observability + /forget):
CREATE TABLE IF NOT EXISTS user_memory_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  event_kind TEXT NOT NULL CHECK(event_kind IN ('add','update','delete','retrieve')),
  mem0_memory_id TEXT,
  content_preview TEXT,         -- first 80 chars, for debugging
  source_message_id INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (source_message_id) REFERENCES ai_messages(id)
);
CREATE INDEX IF NOT EXISTS idx_memory_events_user ON user_memory_events(user_id, created_at);

-- Spec 1 fix: multi-replica scheduler leader lock. Exactly one backend replica
-- acquires the lock per tick and runs the hourly loop; losers skip.
CREATE TABLE IF NOT EXISTS scheduler_leader_lock (
  lock_name TEXT PRIMARY KEY,
  holder_id TEXT NOT NULL,      -- replica instance ID
  acquired_at TIMESTAMP NOT NULL,
  expires_at TIMESTAMP NOT NULL -- acquired_at + 90s TTL
);

-- Spec 6: async task queue
CREATE TABLE IF NOT EXISTS sms_task_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  conversation_id INTEGER NOT NULL,
  task_kind TEXT NOT NULL,
  task_payload TEXT NOT NULL,   -- JSON
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','running','done','failed','timeout')),
  result_text TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_queue_status ON sms_task_queue(status, created_at);

-- Spec 7: chart render cache
CREATE TABLE IF NOT EXISTS chart_render_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cache_key TEXT NOT NULL UNIQUE,   -- SHA256 of (kind, params, data window)
  image_url TEXT NOT NULL,
  alt_text TEXT NOT NULL,
  rendered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL
);
```

All changes additive. No destructive migrations at any phase.

---

## 2. Phased Implementation

### Phase 1 — Voice & Multi-Message (Specs 2, 3) — Week 1

**Goal:** Biggest felt impact at zero infra cost. Rewritten prompt + multi-message delivery, behind `SMS_V2_PROMPT_ENABLED` flag for 50/50 A/B.

#### T1.1 Rewrite `SMS_STYLE_PROMPT` (Spec 3)
- **File:** `apps/dashboard/lib/ai/chat-stream/system-prompt.ts` L211–244
- **Change:** Replace with Appendix B.1. Preserve existing READ/WRITE safety rules block unchanged (those still lead the prompt; voice additions come after).
- **Acceptance:**
  - 20-prompt eval suite scored blind by 3 reviewers; new prompt scores ≥ existing on accuracy and ≥1 point higher on warmth/concision (10-point scale).
  - Zero increase in misrouted writes on 200-message replay.

#### T1.2 Multi-segment parsing (Spec 2)
- **File:** `apps/dashboard/lib/ai/chat-stream/orchestrator.ts` `handleSmsChatPost()`
- **Change:** Return type → `Promise<{ messages: string[], tool_calls_made: number }>`. Post-model: split on `\n---\n`, trim, filter empty, cap to 4 segments × 220 chars. If split yields 0, fall back to `[content]`.
- **Acceptance:** Unit tests for: single-segment, 2-segment, 4-segment-with-overflow-dropped, over-length-single-segment, empty-split.

#### T1.3 Multi-message sender loop (Spec 2)
- **File:** `apps/backend/api/sendblue.py` — extract existing reply-send logic into `_send_reply_and_persist(messages: list[str])`.
- **Change:** Iterate messages. First segment sent immediately; subsequent use `await asyncio.sleep(0.8 + random() * 0.6)`. Each persists as its own `AIMessageDB` row with `delivery_status` set (`sent` on success, `failed` on exception — halt loop on failure, don't partial-deliver silently).
- **Acceptance:** Integration test with mocked Sendblue (`respx`/`pytest-httpx`): 3-segment reply produces 3 API calls with delays ≥0.8s and ≤1.4s between them.

#### T1.4 Feature flag + A/B telemetry
- **Files:** `apps/backend/api/sendblue.py`, `apps/dashboard/lib/ai/chat-stream/orchestrator.ts`.
- **Change:** Env var `SMS_V2_PROMPT_ENABLED`. Hash `user_id` → assign to arm. Log arm in `AIMessageDB.tool_payload` metadata (`{ "ab_arm": "v2" }`).
- **Rollout gate:** Internal Ritual team only (5 users) for 3 days before enabling 50/50 on all SMS users.

#### T1.5 Eval harness
- **File:** `apps/backend/tests/sms_eval_suite.py` (new)
- **Contents:** 20 representative prompts with expected intent classification + quality rubric. Runs against both prompt arms. Becomes a regression gate on every future prompt change.

**Phase 1 done when:**
- 7 days of A/B at 50% traffic.
- Reply-back rate delta non-negative vs. control.
- Zero safety regressions per eval suite.

#### T1.6 SMS provider abstraction (added 2026-04-20)

Future-proofs the Sendblue-vs-Linq decision by putting all outbound SMS calls behind a provider interface. At Ritual's current scale (100 users) Sendblue wins on cost; at 1,000+ users with daily proactive, the 200/day follow-up cap becomes a real ceiling. This abstraction makes that switch a config change, not a rewrite.

- **New file:** `apps/backend/services/sms_provider.py` (~80 LOC)
- **Interface:**
  ```python
  class SmsProvider(Protocol):
      async def send_message(
          self,
          to: str,
          content: str,
          media_url: str | None = None,
          from_number: str | None = None,
      ) -> SmsSendResult: ...

      async def verify_inbound_signature(
          self,
          headers: Mapping[str, str],
          raw_body: bytes,
      ) -> bool: ...

      @property
      def follow_up_daily_cap(self) -> int | None: ...

      @property
      def inbound_daily_cap(self) -> int | None: ...
  ```
- **Implementations:**
  - `SendblueProvider` — thin wrapper around the existing `sendblue_service.send_message()` at `apps/backend/services/sendblue_service.py:47`. Reports `follow_up_daily_cap=200`, `inbound_daily_cap=1000`. Signature verify uses `sb-signing-secret`.
  - `LinqProvider` — stub at launch (raises `NotImplementedError`). Lives in the same file so it's discoverable. Gets fleshed out only if/when Linq pricing justifies the switch.
- **Selection:** env var `SMS_PROVIDER=sendblue|linq` (default `sendblue`). A factory function `get_sms_provider() -> SmsProvider` reads env once at startup.
- **Refactor:** `apps/backend/api/sendblue.py` replaces direct calls to `sendblue_service.send_message()` with `get_sms_provider().send_message()`. Signature verify path similarly routes through the provider. File keeps its name (inbound webhook path) but no longer hardcodes Sendblue beyond the route.
- **Gate cascade reads caps from provider:** The proactive job's daily-cap check (Spec 1) consults `provider.follow_up_daily_cap` instead of hardcoding 200. Swapping providers automatically updates the global cap enforcement.

**Acceptance:**
- Unit tests: `SendblueProvider.send_message` calls the existing Sendblue endpoint with the right payload; signature verify succeeds on valid HMAC + fails on invalid.
- Integration test: flip `SMS_PROVIDER=linq` → `LinqProvider` stub raises → startup log warns, app falls back to Sendblue. No silent switch.
- Regression test: existing Sendblue replay suite passes unchanged via the new interface.

**Why in Phase 1, not later:**
Zero behavior change. Ship it alongside the voice + multi-message work so the refactored sender loop lands once. Adding the abstraction later would be a second pass through the same file. Minimal diff, maximum option value.

---

### Phase 2 — Clarifying Questions + Proactive Scaffold (Specs 4, 1a) — Week 2

**Goal:** Ship Spec 4 fully. Build Spec 1 scaffold in dry-run mode — no user-facing changes yet.

#### T2.1 `requestClarification` tool (Spec 4)
- **File:** `apps/dashboard/lib/ai/chat-stream/tools/request-clarification.ts` (new) + register in the tool registry.
- **Schema:** `requestClarification(question: string): {question: string}`. Tool returns the question; orchestrator reply to user is the question itself.
- **Prompt update:** Replace the binary READ/WRITE split with a trinary (confident READ | confident WRITE | ambiguous → `requestClarification`). Inviolable rule: ambiguous → never WRITE without asking.

#### T2.2 Clarification-in-flight window (Spec 4)
- **File:** `apps/backend/api/sendblue.py`
- **Change:** When orchestrator returns a clarification, set `AIConversationDB.pending_clarification_at = now()` + `pending_clarification_text = question`. If the next inbound arrives within 5 min, prepend a system note to orchestrator context: *"The user is answering your clarifying question: `{question}`."* Clear the fields after consuming.
- **Acceptance:** End-to-end test — "8 hours" → bot asks "sleep or something else?" → user replies "sleep" → bot writes an 8h sleep log.

#### T2.3 Intent outcome telemetry
- **File:** `apps/dashboard/lib/ai/chat-stream/orchestrator.ts`
- **Change:** Emit counter `sms_intent{outcome=read|write|clarified|confused}` after each turn.

#### T2.4 Scheduler leader lock (fix from review)
- **File:** `apps/backend/services/scheduler_lock.py` (new) + `apps/backend/main.py` `_internal_scheduler_loop()`
- **Change:** Before running any scheduled work, each tick attempts a conditional UPSERT on `scheduler_leader_lock` (lock_name='internal_hourly'): `INSERT ... ON CONFLICT DO UPDATE WHERE expires_at < now()`. The winner (returning replica ID matches our instance ID) runs the loop; losers skip. Lock TTL = 90s; renewed on success. Instance ID = `hostname + pid + random` set at boot.
- **Why:** Without this, Railway replicas > 1 each fire the scheduler — duplicate proactive SMS. P0 fix.
- **Acceptance:** Integration test with 3 concurrent simulated replicas — only one runs the cycle per tick; all three observe the same lock state after each tick.

#### T2.5 Proactive job scaffold — DRY RUN (Spec 1a)
- **File:** `apps/backend/jobs/sms_proactive.py` (new)
- **Function:** `evaluate_and_compose(user_id) -> ProactiveDecision`. Gate cascade: allowlist → quiet hours → daily cap → trigger evaluation → composer → hallucination validator (T2.7). Writes to `sms_proactive_sends` with `dry_run=True`. Does **not** call Sendblue.
- **Rollout gate precedence (from review):** allowlist short-circuits before hash check. Explicit order in code: `if user_id in PROACTIVE_SMS_ALLOWLIST: eligible = True; elif hash(user_id) % 100 < rollout_pct: eligible = True; else: skip`.
- **Initial triggers (scaffold):** `morning_digest`, `anomaly_sleep`, `re_engagement` — as functions in a single `apps/backend/jobs/sms_proactive/triggers.py` module (decision 2026-04-20: consolidated, not one file per trigger — split only when any trigger grows >100 LOC).
- **Composer:** `apps/dashboard/lib/ai/chat-stream/sms-composer.ts` (new) — gpt-4o-mini; takes trigger context; returns 1–3 messages. Prompt in Appendix B.2.

#### T2.6 Wire into scheduler (dry-run)
- **File:** `apps/backend/main.py:546` `_internal_scheduler_loop()`
- **Change:** After leader-lock acquisition (T2.4), hourly call `sms_proactive.run_for_all_eligible_users()`. Returns list of decisions, all dry-run.
- **Acceptance:** After 48h in dry-run, `sms_proactive_sends` has realistic traffic; reviewing 50 random decisions by hand shows ≥70% pass the "yes, I'd want this text" bar.

#### T2.7 Composer hallucination validator (fix from review)
- **File:** `apps/backend/jobs/sms_proactive.py` helper function `validate_composed_against_context(messages, trigger_context) -> list[str]` returning list of unsupported claims.
- **Logic:** Extract numeric tokens (integers, decimals, percentages, time expressions) from each composed message. Each must appear verbatim in the JSON-stringified `trigger_context`. Flagged messages skip send (audit row gets `outcome=validation_failed`).
- **Why:** "Use only facts from trigger context" is a prompt rule; a programmatic post-check is a much stronger guard against the Critical risk. P1.
- **Acceptance:** Unit test with synthetic trigger contexts and 10 adversarial messages (including a message with an invented 7.2h sleep average when context says 7.4h) — all get flagged.

#### T2.8 Clarification abandon signal (fix from review)
- **File:** `apps/backend/api/sendblue.py` + orchestrator
- **Change:** Extend the clarification-in-flight handling: when a new inbound arrives within the 5-min window, run a lightweight intent classifier (same gpt-4o call, low-token) — *"Is this message answering the question `{pending_clarification_text}`? yes/no/unclear"*. If `no` or `unclear`, clear the pending fields and treat as fresh turn. Only `yes` injects the clarification context.
- **Why:** Without this, users who forget the clarification and send unrelated messages get garbage outcomes. P1.

#### T2.9 Restrict `AIMessageDB` history hydration to sent-only (fix from review)
- **File:** `apps/backend/services/conversation_service.py` — wherever orchestrator history is built.
- **Change:** `WHERE delivery_status = 'sent' OR delivery_status IS NULL` (NULL handles pre-migration rows). Never feed `failed` rows back into context.
- **Why:** Multi-segment half-failure means user saw fewer messages than the DB has; bot must not reference what user didn't see. P1.

#### T2.10 Internal Slack review channel
- **Env:** `SMS_PROACTIVE_SLACK_WEBHOOK_URL`
- **Change:** In dry-run mode, post `{user, trigger, rendered_messages, validator_result}` to an internal Slack channel for rapid review.

**Phase 2 done when:**
- Spec 4 live for all SMS users with `clarified` rate between 3–12% (calibration target — too high annoys users, too low means ambiguity is still silently defaulting).
- Leader lock verified in production with replicas=2 smoke test.
- 48h dry-run reviewed; composer + validator quality bar met (zero hallucination escapes in the sample).

---

### Phase 3 — Proactive Live + Memory Scaffold (Specs 1b, 5a) — Week 3

**Goal:** Turn Spec 1 on gradually with strong guardrails. Build Spec 5's extractor + store; don't inject yet.

#### T3.1 Remaining trigger evaluators (Spec 1)
- **File:** `apps/backend/jobs/sms_proactive/triggers.py` (single module, decision 2026-04-20)
- **Additions:** `evaluate_evening_reflection`, `evaluate_anomaly_hr`, `evaluate_streak_milestone`, `evaluate_missed_streak_recovery`. Each is a pure function `(user_id, now) -> TriggerContext | None`. A module-level `TRIGGER_REGISTRY: list[tuple[int, Callable]]` holds `(priority, fn)` pairs; highest priority wins per cycle.
- **Split criterion:** If any single trigger exceeds ~100 LOC, extract it to its own file at that point. Not before.

#### T3.2 Proactive kill switches
- **Env:** `PROACTIVE_SMS_ENABLED` (global), `PROACTIVE_SMS_ROLLOUT_PCT` (0–100).
- **Change:** `hash(user_id) % 100 < rollout_pct` → eligible. Default `rollout_pct=0`.

#### T3.3 Internal rollout (5 users, 3 days)
- Allowlist env var `PROACTIVE_SMS_ALLOWLIST` (comma-separated user IDs) bypasses percentage gate.
- Manually review every sent message. Fix prompt/trigger issues as they surface.

#### T3.4 Gradual external rollout
| Day | Rollout % |
|---|---|
| 1 | 1 |
| 3 | 5 |
| 5 | 25 |
| 7 | 100 |

**Rollback criterion:** opt-out rate >2% in a 24h window → revert to previous `rollout_pct`, file an incident.

#### T3.5 Memory via mem0 (Spec 5a) — decision 2026-04-20: use mem0, not custom
- **File:** `apps/backend/services/user_memory_service.py` (new) — thin wrapper around `mem0.Memory`.
- **Deps:** Add `mem0ai` to `apps/backend/requirements.txt`. Configure mem0 to use the project's existing LLM (OpenAI) and a managed vector store. Start with mem0's built-in `qdrant` local deployment; revisit if Turso-hosted vector makes sense.
- **API (wrappers):**
  - `add_memory(user_id, messages: list[{role, content}], metadata) -> MemoryId` — called fire-and-forget after every SMS turn.
  - `search_memory(user_id, query_text, limit=5) -> list[Memory]` — called before reply.
  - `forget(user_id, topic: str) -> int` — returns count deleted.
- **PII:** mem0's default extraction prompt already filters PII at extraction time. Override the extraction prompt to add explicit "no medical specifics, no diagnoses, no medications" rules (see Appendix B.3). Also add a pre-pass regex scrubber for E.164 phone numbers and long numeric sequences before calling mem0.
- **Audit:** Every mem0 call also logs an `user_memory_events` row (kind: add/retrieve/delete) for observability + `/forget` debugging.
- **Failure handling:** If `add_memory` raises, log the error + original message; do NOT retry automatically (mem0 has its own retry). One row in `user_memory_events` with `event_kind='add'` and NULL `mem0_memory_id` indicates a failed extraction — surfaced in observability dashboard.
- **Acceptance:** Run on 100 historical SMS conversations; manually review stored memories for accuracy ≥85% and zero PII leaks.

#### T3.6 Memory UI (Spec 5a)
- **Files:** `apps/dashboard/app/(dashboard)/settings/ai-memory/page.tsx` (new) + `apps/dashboard/app/api/ai-memory/route.ts`
- **Features:** List view (calls `mem0.get_all(user_id)`), per-item delete (calls `mem0.delete`), bulk "reset memory" button (calls `mem0.delete_all(user_id)`).
- **Opt-out:** `SmsPreferencesDB.memory_enabled` (default true; banner on first surface explaining what's stored).

**Phase 3 done when:**
- Proactive at 100% rollout; 24h opt-out rate <1%.
- mem0 running for all users; memories visible in UI. **No injection yet.**

---

<!-- CEO REVIEW 2026-04-20: Phases 4–5 CUT from scope. Specs 5 (memory), 6 (async),
     and 7 (MMS charts) deferred indefinitely. See §9 NOT in scope for rationale.
     Original Phase 4–5 content preserved below commented out for future reference. -->

<!-- ORIGINAL PHASE 4 — CUT

### Phase 4 — Memory Live + MMS (Specs 5b, 7) — Week 4

**Goal:** Turn on fact injection. Ship MMS for sparkline charts.

#### T4.1 Memory injector (Spec 5b)
- **File:** `apps/backend/services/user_memory_service.py`
- **API:** `retrieve_relevant_facts(user_id, incoming_msg, k=5) -> list[Memory]`. Calls `mem0.search(query=incoming_msg, user_id=user_id, limit=k)`. mem0 handles vector search + ranking internally — no custom cosine code on our side.
- **Integration:** `apps/backend/api/sendblue.py` — call before orchestrator. Pass as new parameter `userContext: string[]` to `handleSmsChatPost()`.
- **Prompt injection:** Prefix system prompt with `Known about this user:\n- …\n- …`.
- **Latency budget:** mem0 search p95 must be <300ms. If exceeded, drop to `limit=3` or disable injection. Measured via tracing on every call.
- **Flag:** `SMS_MEMORY_INJECTION_ENABLED`, 50/50 A/B for 7 days.

#### T4.2 `/forget` command (fix from review: strict parsing)
- **File:** `apps/backend/api/sendblue.py`
- **Change:** Dedicated slash-command parser. Regex `^/forget(\s+(.+))?$` — only matches literal slash prefix at start. If topic captured, call `user_memory_service.forget(user_id, topic)` which calls `mem0.delete` with topic-based search filter. Reply with count: *"forgot 3 things about caffeine"*. Skip LLM entirely.
- **Bare `/forget`:** reply with a disambiguation ("forget what? try `/forget caffeine` or `/forget goals`").
- **Test:** user messages like "I forget sometimes", "/forget caffeine", "  /forget  " (whitespace), "forget caffeine" (no slash) — only the canonical `^/forget(\s+.+)?$` form triggers the delete.

#### T4.3 Memory TTL — handled by mem0
- **Note:** mem0 manages memory lifecycle (consolidation, decay) internally based on reinforcement signals and extraction prompts. No custom TTL job needed. We monitor via `user_memory_events` counts and mem0's own metrics.
- **Remove:** no `apps/backend/jobs/user_facts_decay.py` file. Delete from Appendix A.

#### T4.4 Chart renderer (Spec 7)
- **File:** `apps/backend/services/chart_render.py` (new)
- **Deps:** Add `altair` + `vl-convert-python` to `apps/backend/requirements.txt`.
- **API:** `render_chart(kind, params, data) -> (image_url, alt_text, cache_key)`. Uploads PNG to S3 / Vercel Blob with 30-day signed URL. Caches in `chart_render_cache` (cache hits skip upload).
- **Kinds at launch:** `sparkline_30d` only.
- **Size budget:** 600 × 300 px, ≤ 100 KB.

#### T4.5 `renderChart` orchestrator tool (Spec 7)
- **File:** `apps/dashboard/lib/ai/chat-stream/tools/render-chart.ts` (new)
- **Schema:** Returns `{image_url, alt_text}`. Registered for SMS path only.
- **Prompt update:** Add to `SMS_STYLE_PROMPT`: *"When answering a question best shown visually ('how's my X this month?'), call `renderChart` and attach the image."*

#### T4.6 Sendblue MMS path
- **File:** `apps/backend/api/sendblue.py` `_send_reply_and_persist()`
- **Change:** If reply segments include an `image_url`, call `send_message` with `media_url` param; caption = `alt_text`. **Hard rule: max 1 image per reply.**
- **Flag:** `SmsPreferencesDB.mms_enabled` default `false`; opt-in via `/mms on` text command or dashboard settings.

#### T4.7 MMS carrier matrix smoke test (from review)
- **Manual test plan:** Before external rollout, confirm MMS delivery on the three major US carriers (T-Mobile, AT&T, Verizon) using internal team phones. Delivery success, image visibility, caption rendering. Log results in `~/.gstack/projects/{slug}/mms-carrier-matrix.md`.
- **Why:** MMS delivery rate varies dramatically by carrier; blind rollout risks 30%+ silent failures on one carrier.
- **Block:** No external MMS rollout until ≥ 95% on all three.

**Phase 4 done when:**
- Memory injection live at 100% (no safety regressions).
- `sparkline_30d` requested in ≥5% of eligible queries; MMS delivery success ≥95% per carrier (T4.7).

-->

<!-- ORIGINAL PHASE 5 — CUT

### Phase 5 — Async Tasks (Spec 6) — When Needed

Only build when the first "slow query" complaint lands. Estimated trigger: a user query that regularly exceeds 15s (e.g., deep cross-month correlation analysis).

#### T5.1 Queue schema
Already in §1.3. No new migration.

#### T5.2 `asyncTask` tool
- **File:** `apps/dashboard/lib/ai/chat-stream/tools/async-task.ts` (new)
- **Schema:** `asyncTask(kind: string, params: object) -> {task_id: string, estimated_seconds: number}`. Inserts row into `sms_task_queue`, returns immediately. Model's next turn is an ack message ("ok, crunching — text you back soon").

#### T5.3 Worker sub-loop
- **File:** `apps/backend/jobs/sms_task_worker.py` (new)
- **Behavior:** Every 30s: `SELECT * FROM sms_task_queue WHERE status='pending' ORDER BY created_at LIMIT 5`. For each: set `running`, execute handler by `task_kind`, write `result_text`, send follow-up via Sendblue, set `done`.
- **Wire:** New 30s sub-tick in `_internal_scheduler_loop()`.

#### T5.4 Initial handlers
- `analytics_summary`, `trend_analysis`, `chart_render` (deferred chart path when data query is slow).

#### T5.5 Guardrails
- 10-min age cap → set `timeout`, send "sorry, couldn't finish that."
- Retries: 2 with exponential backoff (1m, 4m).
- Per-user dedup: ≥3 pending → respond "still working on your last one."
- Startup reconciler: on scheduler boot, any `running` row older than 2 min → reset to `pending` (worker crashed mid-flight).
- **Idempotency keys (fix from review):** Each handler must be idempotent. Handlers receive the task row as input and must check `completed_at IS NULL` before side-effecting. A handler that's killed mid-run and requeued by the reconciler must be able to resume or re-execute without duplicating user-visible effects. Critical for `chart_render` (avoid double-publishing blobs) and any analytics handler that sends a Sendblue message (avoid double-texting).
- **Scheduler leader lock (from T2.4):** The worker sub-loop runs only on the replica holding the `scheduler_leader_lock` — prevents duplicate task pickup across replicas.

-->

### Phase 4 (reduced) — Proactive live with deep-link CTA (Spec 1b reframed) — Week 3

**Goal:** Proactive SMS at 100% rollout, with every message ending in a `cta_text → deep_link_url` pair that drives the user to the right dashboard view. This is the core outcome-moving feature under strategy B.

#### T4.1 Deep-link service (new)
- **File:** `apps/backend/services/deep_link_service.py` (new)
- **API:** `mint_deep_link(user_id, trigger_context) -> str` — returns a signed URL like `https://ritual.app/d/{token}` where `{token}` is a short JWT encoding `(user_id, dashboard_route, expiry=48h)`. Backend redirect resolves the token and sends the user to the authenticated dashboard route.
- **Routes:** one per trigger kind. E.g., `anomaly_sleep` → `/dashboard?view=metrics&habit=sleep&range=7d`; `streak_milestone` → `/dashboard?view=overview&habit={id}`.
- **Click tracking:** every resolved link logs `{user_id, trigger_kind, clicked_at}` to a new `sms_deep_link_clicks` table — this is the numerator for the primary success metric.

#### T4.2 Composer integration
- **File:** `apps/dashboard/lib/ai/chat-stream/sms-composer.ts`
- **Change:** Input adds `deep_link_url`. Output requires non-empty `cta_text` + `deep_link_url`. Backend assembles final outbound as `[insight_message(s), "{cta_text} → {deep_link_url}"]` — deep link is always the last segment.
- **Validator (T2.7 extension):** `cta_text` must contain an action verb (pre-approved list: "see", "open", "check", "tap", "view"). Reject otherwise.

#### T4.3 Gradual rollout
Same as original T3.4 — 1% → 5% → 25% → 100% over 7 days. Rollback criterion: opt-out rate >2% OR deep-link click rate <15% (means users ignore the CTA and the strategic bet is wrong).

#### T4.4 Migration additions
```sql
CREATE TABLE IF NOT EXISTS sms_deep_link_clicks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  trigger_kind TEXT NOT NULL,
  token TEXT NOT NULL,
  sent_at TIMESTAMP NOT NULL,
  clicked_at TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_deep_link_user ON sms_deep_link_clicks(user_id, sent_at);
```

**Phase 4 (reduced) done when:**
- Proactive at 100% rollout; opt-out rate <1%.
- **Deep-link click rate ≥ 35% within 1h of send** (primary success metric).
- Reply-back rate (secondary) non-regressed vs. control.

---

<!-- SPECS 5, 6, 7 CUT FROM SCOPE — see §9 NOT in scope for rationale.
     Original Phase 5 content removed from the plan. -->

## 3. Testing Strategy

### 3.1 Eval suite (added Phase 1)
`apps/backend/tests/sms_eval_suite.py` — 20 → 100 representative prompts with expected behavior. Runs on every PR touching SMS paths. Blocks merge if accuracy drops >2%.

### 3.2 Replay tests
Snapshot last 200 real SMS conversations (anonymized via PII redactor). Regression test required before any prompt change. Fixtures: `apps/backend/tests/fixtures/sms_replay/`.

### 3.3 Unit tests per spec
| Spec | Key cases |
|---|---|
| 2 | splitter boundaries (0/1/2/4/5 segments, overflow, over-length) |
| 4 | trinary intent classification on synthetic prompts |
| 1 | trigger evaluators fire/don't-fire on injected fake data |
| 1 (deep-link) | signed token mint + resolve round-trip; expiry honored; click logged |
| 1 (CTA validator) | composer output with non-verb CTA rejected; missing deep_link_url rejected |

### 3.4 End-to-end integration tests
Sendblue mocked at HTTP level. Scenarios:
- Clarification round-trip (Spec 4).
- 3-segment reply with timing assertions (Spec 2).
- Proactive dry-run → audit row written, no Sendblue call (Spec 1a).
- Proactive live → Sendblue called, audit row with `outcome=sent`, deep-link CTA present (Spec 1b).
- Deep-link click → `sms_deep_link_clicks` row written with `clicked_at` populated.
- Leader lock smoke: 2 replicas simulated, only one proactive fires per cycle.

---

## 4. Feature Flags & Rollout

| Flag | Default | Purpose |
|---|---|---|
| `SMS_V2_PROMPT_ENABLED` | `false` | Phase 1 A/B |
| `PROACTIVE_SMS_ENABLED` | `false` | Global proactive kill switch |
| `PROACTIVE_SMS_ROLLOUT_PCT` | `0` | Gradual rollout percentage |
| `PROACTIVE_SMS_ALLOWLIST` | `""` | Comma-separated user IDs bypassing the % gate |
| `SMS_MEMORY_INJECTION_ENABLED` | `false` | Phase 4 A/B |
| `ASYNC_SMS_TASKS_ENABLED` | `false` | Phase 5 kill switch |
| `SMS_PROACTIVE_SLACK_WEBHOOK_URL` | (unset) | Dry-run review channel |

All flags are env-based (Railway). Flipping requires a rolling restart. If this becomes painful, add a DB-backed flag table in Phase 4.

---

## 5. Observability & Metrics

### 5.1 Dashboards
- **Per-message:** reply latency p50/p95, segment count distribution, tool calls per turn, intent outcome `{read|write|clarified|confused}`, intent confidence score per turn (for debugging misrouted writes).
- **Proactive:** sends per trigger kind per day, dry-run vs. live, opt-out rate, reply-back rate within 6h, **deep-link click rate within 1h** (primary success metric), composer validator flag rate (T2.7).
- **Deep-link funnel (primary):** sends → link clicks → dashboard session completed → action taken in dashboard. Track drop-off at each step per trigger kind.
- **Scheduler:** leader lock hold duration, leadership hand-off count (should be near-zero under stable replicas), skipped-tick count (losers).

### 5.4 Cost budget (post-scope-reduction)

Monthly at 100k SMS turns/month:

| Item | Unit cost | Est monthly |
|---|---|---|
| GPT-4o orchestrator (avg ~500 in + 200 out tokens/turn) | $5/M in + $15/M out | ~$550 |
| GPT-4o-mini composer (proactive, ~1 per user per day, 1k users) | $0.15/M in + $0.60/M out | ~$15 |
| Sendblue SMS outbound (1 per turn + 1 per proactive, multi-segment up to 4) | $0.0075/segment | ~$825 |
| **Total (rough)** | | **~$1,390/mo** |

Sendblue is the dominant cost by ~25× the LLM spend. The strategy-B cut removes ~$160/mo in mem0 + MMS costs.

### 5.2 Alarms
| Condition | Severity | Action |
|---|---|---|
| Proactive opt-out rate >2% in 24h | P1 | Page on-call, revert rollout_pct |
| Reply latency p95 > 15s | P2 | Page on-call |
| Misrouted-write rate >1% (post-hoc eval sample) | P1 | Freeze SMS deploys, investigate |
| Extractor error rate >5% | P3 | File ticket |
| Sendblue 4xx rate >2% | P2 | Page on-call |

### 5.3 Structured logging
Per turn: `{user_id_hash, turn_id, channel:sms, intent, tool_calls, segments, memory_facts_injected, ab_arm, latency_ms}`. Retained 30 days.

---

## 6. Risk Register

| Risk | Severity | Mitigation |
|---|---|---|
| Proactive message says something factually wrong (hallucinated trend) | **Critical** | Composer uses only pre-validated `TriggerContext` values. **Programmatic validator (T2.7) post-checks every numeric claim against context** — prompt rules alone are insufficient. Human review during dry-run + internal rollout |
| Multi-replica scheduler fires proactive Nx (duplicate SMS) | **Critical** | DB-backed leader lock (T2.4); verified with replicas=2 smoke test before Phase 3 launch |
| Over-texting users → mass opt-out | High | Daily caps, quiet hours enforced, re-engagement trigger gated on 7-day silence, gradual rollout with alarm |
| Multi-message half-failure corrupts future orchestrator context | High | Future history hydration filters to `delivery_status='sent' OR NULL` (T2.9) |
| Stale clarification-in-flight matches unrelated message | High | Lightweight intent classifier checks whether new inbound is actually answering pending question (T2.8); default to treating as fresh turn on `unclear` |
| Multi-message reply causes Sendblue rate limit | Medium | Max 4 segments, ≥800ms between; monitor per-user send rate |
| Prompt rewrite regresses safety (writes on ambiguous) | **Critical** | Eval suite + 200-msg replay block merge |
| Deep-link CTAs get rejected by SMS carriers as spam | Medium | Use a branded short domain (e.g., `r.ritual.app/...`) with SHAFT-compliant content; monitor Sendblue delivery reports for blocks |
| Users ignore deep links (bot feels like "just notifications") | **Critical (strategy risk)** | Deep-link click rate <15% in gradual rollout → revert to `rollout_pct=0` and reconsider strategy. This is the primary evidence loop for strategy B. |
| Sendblue outage during proactive send window | Low | Audit row marks `send_failed`; no retry (don't pile up stale proactive messages) |

---

## 7. Open Questions

1. **Typing indicators:** Does Sendblue expose programmatic typing indicators? If yes, Phase 1 gets a free polish bump between segments.
2. **MMS opt-in UX:** `/mms on` text command vs. dashboard toggle vs. both? Recommendation: dashboard + one-time explainer text on first MMS send.
3. **Vector store choice:** pgvector in main DB, Turso vector namespace, or inline BLOB with Python-computed cosine. Start inline BLOB (simplest); revisit at 100k+ facts total.
4. **Shared composer vs. per-trigger:** Specced as one composer with trigger-context-as-input. Alternative: per-trigger prompt templates for consistency. Decide after Phase 2 dry-run review.
5. **Voice notes (STT):** Poke supports voice. Out of scope here; scope follow-up after Phase 4.
6. **Long-term memory vs. agent-retrieval:** Could augment Spec 5 with tool-based "search my past conversations" instead of pre-injection. Worth prototyping in Phase 4.

---

## 8. Rollback Plan

Every phase rolls back independently:

- **Phase 1:** `SMS_V2_PROMPT_ENABLED=false` → existing prompt. Single-file revert available.
- **Phase 2:** Revert T2.1 tool registration + prompt. Clarification-in-flight columns are additive, safe to leave.
- **Phase 3:** `PROACTIVE_SMS_ENABLED=false` stops all proactive sends. mem0 extractor keeps running silently — no user-visible effect without injection.
- **Phase 4:** `SMS_MEMORY_INJECTION_ENABLED=false` disables injection; mem0 store intact. `mms_enabled=false` in prefs disables MMS per user. Leader lock (T2.4) must remain enabled even during rollback — removing it reintroduces the multi-replica duplicate-send bug.
- **Phase 5:** `ASYNC_SMS_TASKS_ENABLED=false` — tool de-registers, worker drains, idles.

All migrations are additive (new columns w/ defaults, new tables). Zero destructive changes.

---

## Appendix A — File Inventory

### Created (post-CEO-review scope)
- `apps/backend/services/sms_provider.py` (provider abstraction — T1.6, ~80 LOC; `SmsProvider` protocol + `SendblueProvider` + `LinqProvider` stub + factory)
- `apps/backend/jobs/sms_proactive.py` (includes composer validator T2.7 + deep-link CTA validator)
- `apps/backend/jobs/sms_proactive/triggers.py` (single module — all trigger evaluators)
- `apps/backend/services/scheduler_lock.py` (leader lock — T2.4)
- `apps/backend/services/deep_link_service.py` (signed JWT short links — T4.1)
- `apps/backend/api/deep_link.py` (token resolver route — `/d/{token}` → authenticated redirect)
- `apps/backend/tests/sms_eval_suite.py`
- `apps/backend/tests/fixtures/sms_replay/` (data)
- `apps/backend/migrations/20260425_sms_interactive.sql`
- `apps/dashboard/lib/ai/chat-stream/sms-composer.ts`
- `apps/dashboard/lib/ai/chat-stream/tools/request-clarification.ts`

### Removed by CEO review 2026-04-20 (scope reduction)
- ~~`apps/backend/services/user_memory_service.py`~~ — Spec 5 cut
- ~~`apps/backend/services/chart_render.py`~~ — Spec 7 cut (replaced by deep-link service)
- ~~`apps/backend/jobs/sms_task_worker.py`~~ — Spec 6 cut
- ~~`apps/dashboard/lib/ai/chat-stream/tools/render-chart.ts`~~ — Spec 7 cut
- ~~`apps/dashboard/lib/ai/chat-stream/tools/async-task.ts`~~ — Spec 6 cut
- ~~`apps/dashboard/app/(dashboard)/settings/ai-memory/page.tsx`~~ — Spec 5 cut
- ~~`apps/dashboard/app/api/ai-memory/route.ts`~~ — Spec 5 cut

### Removed by eng review 2026-04-20
- ~~`apps/backend/services/user_facts_service.py`~~ — replaced by mem0 (then mem0 cut by CEO)
- ~~`apps/backend/jobs/user_facts_decay.py`~~ — mem0 handled lifecycle (then mem0 cut)
- ~~7 files in `apps/backend/jobs/sms_proactive/triggers/`~~ — consolidated to single `triggers.py`

**File count trajectory:** 21 (original) → 15 (post-eng-review) → 10 (post-CEO-review) → **11 (+ provider abstraction)**. Still −48% from original plan.

### Modified
- `apps/backend/api/sendblue.py` — multi-message sender routes through `SmsProvider` abstraction (T1.6), clarification window + abandon signal (T2.8), deep-link CTA assembly. (`/forget`, MMS path, memory retrieval, `/mms on` command all cut with Specs 5/7.)
- `apps/backend/services/sendblue_service.py` — wrapped by `SendblueProvider` (T1.6); no signature change, still called via provider interface
- `apps/backend/main.py` — scheduler leader-lock acquisition (T2.4), sub-tick for async worker
- `apps/backend/database/models.py` — new tables + additive columns (per §1.3)
- `apps/backend/services/conversation_service.py` — history hydration filters `delivery_status` (T2.9)
- `apps/backend/services/sms_preferences_service.py` — dry-run check, mms_enabled check, memory_enabled check
- `apps/dashboard/lib/ai/chat-stream/orchestrator.ts` `handleSmsChatPost()` — return type change, `userContext` injection, multi-segment parsing
- `apps/dashboard/lib/ai/chat-stream/system-prompt.ts` `SMS_STYLE_PROMPT` — new voice, trinary intent, multi-segment rule, `renderChart` guidance
- `apps/dashboard/lib/ai/chat-stream/tool-registry.ts` — new tools

---

## Appendix B — Prompt Drafts

### B.1 `SMS_STYLE_PROMPT` (Spec 3 replacement)

```
You are Ritual, the user's health and habits co-pilot via text.
Talk like a smart friend who happens to know their data — not a chatbot.

VOICE
- Punchy. No preamble. No "Sure!" / "Absolutely" / "I'd be happy to".
- Contractions, casual acks: "yep", "nope", "ok got it", "nice", "oof".
- First-person for actions: "got it, logged 2 miles"
  (not "Logging 2 miles complete").
- When returning numbers, add ONE interpretive sentence:
  "that's 20min below your avg — decent rebound from Tuesday".
- Opinionated is fine. Clinical is not.

INTENT (inviolable — never misroute a write)
- Confident READ: has "?" or interrogative ("how's", "what's", "when",
  "why", "how was") → use READ tools.
- Confident WRITE: bare value + unit ("2 miles", "8h sleep"), past-tense
  action ("ran 5k this morning"), explicit verb ("log water")
  → use WRITE tool.
- Ambiguous: call requestClarification with a ≤15-word question.
  NEVER write without asking.

FORMAT
- Default: 1 short message.
- If the thought has distinct beats, break into up to 4 segments with
  "\n---\n" between them.
- Each segment ≤ 220 chars. No markdown.

CONTEXT
- Reference recent thread context naturally when relevant.
- If a "Known about this user:" block is present, use it — don't restate it.

CHARTS
- For "how's my X this/last ...?" style questions best shown visually,
  call renderChart(kind, params) and include the returned image_url.
- Max 1 chart per reply.
```

### B.2 Proactive composer prompt (Spec 1 — reframed for strategy B)

```
You are Ritual, texting a user proactively. Your job is to surface an insight
from their data and give them a clean path to see more in the dashboard.
Write 1–3 short messages (≤220 chars each).

RULES
- Lead with the insight, not the preamble.
- If flagging something concerning, acknowledge it plainly — don't
  sugarcoat or catastrophize.
- **Always include a deep_link_url as the primary CTA.** The dashboard is
  where the user sees the full picture. Your text is the nudge that
  brings them there.
- Use only facts from the trigger context. Do not invent numbers or trends.
- Tone matches the SMS voice prompt.

Trigger: {trigger_kind}
Context: {trigger_context_json}
Deep link: {deep_link_url}

Output JSON: {
  "messages": ["<insight>", "<optional follow-up>"],
  "cta_text": "<action verb + ≤6 words>",  // e.g., "see the breakdown", "open the trend"
  "deep_link_url": "<the signed url from input>"
}

The final message segment to the user will be: "{cta_text} → {deep_link_url}"
```

### B.3 mem0 extraction-prompt override (Spec 5)

Passed to mem0 via `custom_fact_extraction_prompt` in the `Memory` constructor.

```
You extract durable facts about the user from chat messages.

KEEP: stated goals, ongoing constraints (diet, injuries, schedule),
      preferences (prefers mornings, dislikes running), long-term context
      (parent of toddler, training for a marathon).

IGNORE: ephemeral complaints, greetings, questions, casual chat.

PRIVACY (inviolable):
- Never store raw medical diagnoses (e.g., "has insomnia", "diabetic").
- Never store medication names.
- Never store names of other people.
- Prefer abstract frames: "cares about sleep quality" over "has insomnia".
- Skip any fact with a raw phone number, address, or date of birth.
```

A pre-pass regex scrubber on the inbound message strips E.164 phone numbers and
long digit sequences before mem0 sees the text:

```python
import re
PHONE_RE = re.compile(r"\+?\d[\d\s\-\(\)]{8,}\d")
LONG_DIGITS_RE = re.compile(r"\b\d{8,}\b")

def scrub_pii(text: str) -> str:
    text = PHONE_RE.sub("[phone]", text)
    text = LONG_DIGITS_RE.sub("[number]", text)
    return text
```

---

## Appendix C — Success Metrics Baseline (Fill During Phase 1)

Collect the following baseline numbers during Phase 1 A/B so later phases have comparators:

- 7-day reply-back rate (control arm) — _TBD_
- Avg segments per reply — _TBD (will be 1.0 on control)_
- Intent distribution `{read, write, clarified, confused}` — _TBD_
- Median reply latency / p95 — _TBD_
- SMS conversations per user per week (distribution) — _TBD_

These become the numerators for the success criteria in §0.

---

---

## 9. NOT in Scope

Explicitly deferred. Each has a one-line rationale so scope creep is visible.

### Cut by CEO review 2026-04-20 (strategic reduction)

Under strategy B (SMS drives dashboard), these features optimize for "SMS is the product" — a different target. Revisit only if strategy B doesn't move the primary success metric (deep-link click rate).

- **Spec 5: Long-term user memory (mem0 or custom)** — memory matters when the bot is a conversational companion. Under "SMS drives dashboard", the user's memory lives in the dashboard UI; the bot is transactional. Defer to v2 pending deep-link-click-rate data.
- **Spec 6: Async tasks** — "I'll text you back" is a bot-as-product pattern. The correct pattern under strategy B is "tap for details in the dashboard." Skip indefinitely; revisit only if a legitimately slow query emerges that can't redirect to the dashboard.
- **Spec 7: MMS charts** — a deep link to the dashboard with preview text is cheaper to build, drives the target behavior (dashboard usage), and works on carriers that block MMS. Skip image rendering entirely.

### Originally out of scope

- **Voice notes (inbound STT, outbound TTS)** — large surface, new vendor. Deferred post-launch.
- **Cross-provider SMS (Twilio, Bandwidth)** — Sendblue works; multi-provider adds failover logic and vendor abstraction without clear ROI yet.
- **Group SMS** — Sendblue supports it, but product use case is unclear. 1:1 only.
- **Per-trigger prompt templates** — plan uses single composer with trigger-context-as-input. Revisit only if dry-run review shows systematic per-trigger quality gaps.
- **Real-time streaming replies** — SMS is not interactive enough to benefit. Reply is complete when sent.
- **Separate per-trigger files** — decision 2026-04-20: consolidated single module until any trigger grows beyond ~100 LOC.
- **DB-backed feature flag table** — env-based flags via Railway env + rolling restart are sufficient for this surface.
- **Distribution pipeline** — no new artifacts (binaries, packages). All internal backend services; no build/publish pipeline needed.

---

## 10. What Already Exists

Code already in the repo that this plan builds on (not rebuilds). Cross-reference for reviewers who want to sanity-check reuse.

| Concern | Existing location | Reused as |
|---|---|---|
| SMS inbound handler + HMAC verify | `apps/backend/api/sendblue.py` L173–358 | Modified for multi-segment sender, `/forget`, MMS path, memory retrieval |
| SMS outbound (with MMS support) | `apps/backend/services/sendblue_service.py:47` `send_message()` | Reused verbatim for text; `media_url` param already available for MMS (L67) |
| SMS preferences | `SmsPreferencesDB` at `models.py:636` | Extended with `proactive_dry_run`, `mms_enabled`, `memory_enabled` (additive) |
| Quiet-hours check | `sms_preferences_service.py:78` `is_in_quiet_hours()` | Reused verbatim by proactive gate cascade |
| Daily cap check | `sms_preferences_service.py:103` `can_send_proactive()` | Reused verbatim by proactive gate cascade |
| In-process scheduler | `main.py:546` `_internal_scheduler_loop()`, gated by `ENABLE_INTERNAL_SCHEDULER` | Reused; leader-lock wrapper added (T2.4) |
| Conversation persistence | `AIConversationDB` / `AIMessageDB` with `channel='sms'` | Extended with `delivery_status`, `pending_clarification_at/text` (additive) |
| Orchestrator SMS path | `orchestrator.ts` `handleSmsChatPost()` L1341–1508 | Return type changed; `userContext` param added |
| SMS system prompt | `system-prompt.ts` `SMS_STYLE_PROMPT` L211–244 | Rewritten for voice + trinary intent |
| Fire-and-forget pattern | `_fire_habit_log_side_effects()` via `asyncio.create_task()` | Same pattern reused for mem0 extraction trigger |
| Fuzzy parser fallback | `_legacy_fuzzy_logging_fallback()` at `sendblue.py` L414 | Unchanged; remains safety net for orchestrator failures |

---

## 11. Failure Modes per Codepath

For each new codepath, one realistic production failure + whether the plan handles it.

| Codepath | Failure scenario | Test? | Error handling? | User-visible? |
|---|---|---|---|---|
| Multi-segment send (T1.3) | Segment 2/3 send fails mid-loop | ✓ T1.3 | ✓ halt loop, `delivery_status='failed'` | Partial reply visible (fewer segments than intended); no bot-references-unsent-msg regression thanks to T2.9 |
| Leader lock acquisition (T2.4) | Two replicas race on initial insert | ✓ T2.4 integration | ✓ only one wins per tick | None — internal |
| Clarification-in-flight (T2.2+T2.8) | Stale clarification window catches unrelated message | ✓ T2.8 new test | ✓ intent classifier checks match | Bot resumes fresh turn instead of garbage answer |
| Proactive composer validator (T2.7) | Model invents "your sleep avg is 7.2h" when context says 7.4h | ✓ T2.7 unit | ✓ audit row `outcome=validation_failed`; no send | None — message suppressed |
| mem0 extraction (T3.5) | mem0 service timeout | ✓ T3.5 | ✓ error logged to `user_memory_events`; reply unaffected (fire-and-forget) | None |
| mem0 retrieval (T4.1) | mem0 search p95 > 300ms | ✓ latency budget check | ✓ drop limit to 3 or disable injection | Silent graceful degrade |
| Chart render (T4.4) | vl-convert fails on malformed data | ✓ T4.4 fallback | ✓ fall back to text-only | Text reply without image |
| MMS delivery (T4.6) | Carrier blocks the media URL | ✓ T4.7 matrix | ✓ alt_text caption always included | Insight still delivered in caption |
| Async task worker (T5.3) | Handler crashes; task stays `running` | ✓ T5.5 reconciler | ✓ reset to `pending` after 2min + retry | Silent retry; after 2 retries → timeout apology |
| `/forget` command (T4.2) | User has habit literally named "forget" | ✓ T4.2 strict regex | ✓ only `^/forget(\s+.+)?$` triggers | Habit safe; casual "forget" passes through to normal flow |

**Critical gap assessment:** All listed failure modes have test + error handling + non-silent user-visible outcome. **Zero critical gaps** after iteration. Before iteration there were 5 critical gaps (multi-replica, composer hallucination, half-failure context corruption, stale clarification, loose `/forget`).

---

## 12. Worktree Parallelization

Work lanes for independent parallel implementation after Phase 1 ships.

| Lane | Tasks | Primary modules touched |
|---|---|---|
| A | T2.4 leader lock | `apps/backend/services/scheduler_lock.py`, `apps/backend/main.py`, migration |
| B | T2.1+T2.2+T2.3+T2.8 clarification | `apps/dashboard/lib/ai/chat-stream/tools/`, `system-prompt.ts`, `orchestrator.ts`, `apps/backend/api/sendblue.py` |
| C | T2.5+T2.6+T2.7 proactive scaffold | `apps/backend/jobs/sms_proactive.py`, `triggers.py`, `sms-composer.ts` |
| D | T3.5+T3.6 mem0 memory scaffold | `apps/backend/services/user_memory_service.py`, `apps/dashboard/app/(dashboard)/settings/ai-memory/` |
| E | T4.4+T4.5 chart render | `apps/backend/services/chart_render.py`, `tools/render-chart.ts` |

**Execution order:**
- Phase 2: **Lanes A + B + C in parallel.** Lane A is self-contained (new file). Lane B touches `sendblue.py`; Lane C also touches `sendblue.py` but only inside `_send_reply_and_persist` (additive). Flag B+C for careful merge; assign same owner if contention is a concern.
- Phase 3: Lane C continues (trigger additions); Lane D starts in parallel.
- Phase 4: Lane D injector + Lane E chart render in parallel.

**Conflict flag:** Lanes B + C both touch `apps/backend/api/sendblue.py`. Mitigation: Lane B lands first (clarification), Lane C rebases on B's changes before starting the proactive-wire step. Alternatively, same owner sequences B → C.

---

## 13. Test Plan Artifact for `/qa`

Written to `~/.gstack/projects/NickGardner0-ritual-desktop-main/{user}-{branch}-eng-review-test-plan-{datetime}.md` so `/qa` and `/qa-only` can consume as primary test input. Contents:

```markdown
# Test Plan — SMS Interactive Transformation
Generated by /plan-eng-review on 2026-04-20
Branch: codex/release-0.1.1-prep

## Affected Pages/Routes
- /settings/ai-memory — new page; list/delete individual memories; reset-all button
- /api/sendblue/webhook — unchanged interface but behavior changes per phase

## Key Interactions to Verify
- SMS: clarification round-trip (ambiguous → ask → answer → correct action)
- SMS: multi-segment reply timing (delays visible between segments)
- SMS: /forget command — exact match only; habit named "forget" is safe
- SMS: /mms on and /mms off toggle
- Proactive: dry-run Slack notification arrives for each intended send
- Proactive: live send respects quiet hours + daily cap
- MMS: chart image renders on T-Mobile, AT&T, Verizon (Phase 4)
- Memory UI: delete a memory → next SMS reply does not reference it

## Edge Cases
- Multi-segment half-failure: bot does not reference unsent segments next turn
- Stale clarification (5+ min): new unrelated message treated as fresh turn
- Composer hallucination: messages with numeric claims not in trigger_context are suppressed
- Async task timeout: user gets "sorry, couldn't finish that" after 10min
- Replicas=2 smoke: leader lock prevents duplicate proactive sends

## Critical Paths
- Safety: ambiguous "8 hours" → clarification round-trip → correct WRITE
- Safety: confident WRITE unchanged ("ran 5k this morning" → log habit)
- Safety: confident READ unchanged ("how's my sleep?" → read tools)
- Proactive: trigger fires → composer → validator → send OR suppression audit
- Memory: mem0 extraction → storage → retrieval → injection → cited in reply → /forget removes
```

---

## 13b. CEO Review Decision Record — 2026-04-20

**Strategic frame decision:** SMS is a **nudge/notification layer that drives users back to the dashboard** (option B of three framings considered). Not "SMS is the product" (option A) and not "SMS is deprecated, voice is next" (option C).

**Mode:** SCOPE REDUCTION.

**What was cut:**
- Spec 5 (long-term user memory) — optimizes for bot-as-product; wrong under strategy B.
- Spec 6 (async tasks) — "I'll text you back" pattern is bot-as-product; strategy B says "tap for details".
- Spec 7 (MMS charts) — replaced by deep links w/ preview text, which is cheaper and actively drives dashboard usage.

**What was added:**
- Deep-link service (T4.1) — signed JWT short links with click tracking. This is the instrumentation that lets us measure whether strategy B is working.
- Primary success metric added: **deep-link click rate ≥ 35% within 1h of send**. Reply-back rate demoted to secondary.
- Rollback criterion: click rate <15% during gradual rollout → pause and reconsider strategy.

**Why this is right for now:**
Strategy B is an untested bet. The full plan would spend 5 weeks building Poke-style interactivity to optimize for an outcome (bot engagement) that may not correlate with what we actually care about (habit retention, dashboard DAU). Scope reduction + deep-link instrumentation lets us ship Phase 1–4 in 3 weeks, measure the right thing, and decide in 14 days whether to resurrect Specs 5/6/7 or pivot strategy.

**Premise questions that went unresolved:**
1. What % of Ritual DAU currently texts the SMS bot? Needed to calibrate how much surface this investment represents.
2. Does SMS engagement correlate historically with retention? If there's no data, Phase 4's rollout is our first measurement.

**Files:** 21 → 15 → **10** (reduced). Timeline: 5wks → **3wks**.

---

## 14. Iteration Changelog — 2026-04-20

Changes applied from /plan-eng-review pass. Originals preserved in git history.

- **Added** scheduler leader lock (T2.4) — fixes multi-replica duplicate sends. Migration adds `scheduler_leader_lock` table.
- **Added** composer hallucination validator (T2.7) — programmatic guard against "used only trigger context" prompt rule failure.
- **Added** clarification abandon signal (T2.8) — prevents stale window from catching unrelated messages.
- **Added** delivery_status filter on history hydration (T2.9) — prevents bot from referencing unsent segments next turn.
- **Added** MMS carrier matrix smoke test (T4.7) — blocks rollout until verified across T-Mobile/AT&T/Verizon.
- **Added** async handler idempotency requirement (T5.5) — handlers must check `completed_at IS NULL` before side-effecting.
- **Added** cost budget table (§5.4) — Sendblue is the dominant cost by ~5×.
- **Added** failure modes table (§11), parallelization lanes (§12), test plan artifact (§13).
- **Replaced** custom memory (Spec 5) with **mem0** — cuts `user_facts_service.py` + `user_facts_decay.py` + embedding column + cosine search code. Schema swaps `user_facts` table for `user_memory_events` audit log.
- **Consolidated** 7 trigger files into single `triggers.py` module.
- **Tightened** `/forget` command parser to strict `^/forget(\s+.+)?$` regex.
- **Spelled out** rollout gate precedence: allowlist → hash check.
- **Added** PII regex scrubber before mem0 (phone + long digit sequences).
- **Reduced** net created-file count: 21 → 15 (−29%).

### CEO review pass (2026-04-20, 2nd iteration)

- **Strategic frame chosen:** SMS is a nudge layer that drives dashboard usage (not "SMS is the product").
- **Cut** Spec 5 (long-term memory) — misaligned with strategy.
- **Cut** Spec 6 (async tasks) — misaligned with strategy.
- **Cut** Spec 7 (MMS charts) — replaced by deep links.
- **Added** `deep_link_service.py` + signed JWT link resolver + `sms_deep_link_clicks` table.
- **Added** primary success metric: deep-link click rate ≥35% within 1h.
- **Added** strategy-failure rollback: click rate <15% → pause.
- **Reframed** Phase 3 (proactive) → Phase 4 (reduced): every proactive message now has a CTA + signed deep link as the last segment.
- **Reduced** file count: 15 → **10** (−33% again).
- **Reduced** timeline: 5 weeks → **3 weeks**.

### Provider abstraction pass (2026-04-20, post-CEO iteration)

- **Added T1.6:** `apps/backend/services/sms_provider.py` — `SmsProvider` protocol + `SendblueProvider` (active) + `LinqProvider` (stub). All outbound SMS and signature verification now route through the provider. Env-driven selection via `SMS_PROVIDER=sendblue|linq` (default `sendblue`).
- **Why:** At 100 users Sendblue wins on cost. At 1,000+ users with daily proactive, Sendblue's 200/day follow-up cap becomes a ceiling. The abstraction makes a future provider switch a config change, not a rewrite. Also surfaces provider caps to the proactive gate cascade (no more hardcoded 200 — read from `provider.follow_up_daily_cap`).
- **File count:** 10 → **11** (still −48% from original plan).
- **Landed in Phase 1** so the sender loop refactor happens once alongside the voice + multi-message work.

---

## 15. Completion Summary

### /plan-eng-review pass
- Step 0 scope challenge: scope reduced (mem0 + triggers consolidation)
- Architecture: 6 issues found, resolved
- Code Quality: 3 issues found, resolved
- Test Review: coverage diagram + 8 gaps → added to task list
- Performance: 3 issues resolved
- Failure modes: 0 critical gaps (down from 5)

### /plan-ceo-review pass
- Mode: **SCOPE REDUCTION**
- Strategic frame declared: "SMS drives dashboard" (not "SMS is the product")
- Scope cut: Specs 5, 6, 7 → v2 / indefinite
- New primary outcome metric: deep-link click rate ≥35%
- New file added: `deep_link_service.py` + click tracking
- Files: 21 → 15 → **10** (net −52% from original)
- Timeline: 5wks → **3wks**
- Outside voice: skipped (user iterating inline)
- Lake Score: **5/5** recommendations accepted

**Unresolved decisions:** none.
**Open research questions to track:** (1) SMS DAU share; (2) historical correlation of SMS engagement → retention. Neither blocks implementation — deep-link click rate telemetry from Phase 4 will generate the data we need.

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | CLEAR (SCOPE_REDUCTION) | Strategic frame declared (B: "SMS drives dashboard"); 3 specs cut (5, 6, 7); 1 new feature added (deep-link service + click tracking); file count 15 → 10; timeline 5wks → 3wks |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (PLAN) | 12 issues found, 12 resolved via in-plan iteration; 0 critical gaps; 5 lanes parallelized |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — (no UI scope remaining after CEO cuts removed the /settings/ai-memory page) |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

**UNRESOLVED:** 0.
**VERDICT:** **CEO + ENG CLEARED — ready to implement.** Note: the eng review was run against the pre-CEO-cut scope. The cuts (Specs 5/6/7) remove files without changing architectural invariants, so a re-run is not strictly required, but consider a quick `/plan-eng-review` pass specifically on the new deep-link service (T4.1) before Phase 4 ships.

---

*End of plan.*

