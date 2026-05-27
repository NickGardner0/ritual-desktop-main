# Macro Adoption Analysis For Ritual

Date: 2026-04-08

Analyzed Macro commit:

- `5e82d2f02469dddafd53405aa0fc36333726b791`

Primary Macro references:

- [README](https://github.com/macro-inc/macro/blob/5e82d2f02469dddafd53405aa0fc36333726b791/README.md)
- [Root routes](https://github.com/macro-inc/macro/blob/5e82d2f02469dddafd53405aa0fc36333726b791/js/app/packages/app/component/Root.tsx)
- [Unified list / Soup view registry](https://github.com/macro-inc/macro/blob/5e82d2f02469dddafd53405aa0fc36333726b791/js/app/packages/app/component/split-layout/componentRegistry.tsx)
- [Soup view](https://github.com/macro-inc/macro/blob/5e82d2f02469dddafd53405aa0fc36333726b791/js/app/packages/app/component/next-soup/soup-view/soup-view.tsx)
- [Query filters](https://github.com/macro-inc/macro/blob/5e82d2f02469dddafd53405aa0fc36333726b791/js/app/packages/app/component/next-soup/filters/query-filters.ts)
- [Command menu](https://github.com/macro-inc/macro/blob/5e82d2f02469dddafd53405aa0fc36333726b791/js/app/packages/app/component/command/CommandMenu.tsx)
- [Command item sourcing](https://github.com/macro-inc/macro/blob/5e82d2f02469dddafd53405aa0fc36333726b791/js/app/packages/app/component/command/useCommandItems.ts)
- [Quick access provider](https://github.com/macro-inc/macro/blob/5e82d2f02469dddafd53405aa0fc36333726b791/js/app/packages/core/context/quickAccess/QuickAccessProvider.tsx)
- [Properties constants](https://github.com/macro-inc/macro/blob/5e82d2f02469dddafd53405aa0fc36333726b791/js/app/packages/core/component/Properties/constants.ts)
- [Properties types](https://github.com/macro-inc/macro/blob/5e82d2f02469dddafd53405aa0fc36333726b791/js/app/packages/core/component/Properties/types.ts)
- [Properties service README](https://github.com/macro-inc/macro/blob/5e82d2f02469dddafd53405aa0fc36333726b791/rust/cloud-storage/properties_service/README.md)
- [Saved views library](https://github.com/macro-inc/macro/blob/5e82d2f02469dddafd53405aa0fc36333726b791/rust/cloud-storage/saved_views/src/lib.rs)
- [Saved views API](https://github.com/macro-inc/macro/blob/5e82d2f02469dddafd53405aa0fc36333726b791/rust/cloud-storage/document_storage_service/src/api/saved_views.rs)
- [Mention transformers](https://github.com/macro-inc/macro/blob/5e82d2f02469dddafd53405aa0fc36333726b791/js/app/packages/lexical-core/transformers/mentions.ts)
- [Task creation model](https://github.com/macro-inc/macro/blob/5e82d2f02469dddafd53405aa0fc36333726b791/rust/cloud-storage/documents/src/domain/models.rs)
- [Frecency model](https://github.com/macro-inc/macro/blob/5e82d2f02469dddafd53405aa0fc36333726b791/rust/cloud-storage/frecency/src/domain/models.rs)
- [Loro Mirror README](https://github.com/macro-inc/macro/blob/5e82d2f02469dddafd53405aa0fc36333726b791/js/app/packages/loro-mirror/README.md)

Primary Ritual references:

- `docs/ARCHITECTURE-ANALYSIS.md`
- `docs/ritual-recorder-ai-search.md`
- `apps/dashboard/app/(dashboard)/dashboard/page.tsx`
- `apps/dashboard/app/(dashboard)/tasks/tasks-client.tsx`
- `apps/dashboard/app/(dashboard)/activity/logs-client.tsx`
- `apps/dashboard/components/command-palette.tsx`
- `apps/dashboard/contexts/HabitsContext.tsx`
- `apps/backend/services/search_service.py`
- `apps/backend/database/models.py`
- `apps/backend/models/habit_models.py`
- `apps/backend/services/project_memory_card_service.py`

## Executive Take

Macro is not a direct product template for Ritual. It is a linked work OS with email, channels, docs, files, tasks, AI, permissions, and collaboration. Ritual is already much stronger in quantified-self capture, biometrics, imports, computer activity, local OCR, and memory search.

The value is not in copying Macro's headline surfaces. The value is in borrowing its product primitives:

1. A unified entity layer with reusable list/filter/action infrastructure.
2. A real property system for flexible metadata, not fixed schemas everywhere.
3. Persistent saved views and presets across surfaces.
4. Linked references between notes, tasks, AI, and data artifacts.
5. Behavior-aware ranking via recency/frecency and quick access.
6. A more serious keyboard-first interaction model.

Those are the pieces most likely to compound Ritual's existing strengths.

## What Ritual Already Has

Ritual is not starting from zero:

- Strong quantified-self data model around habits, logs, wearables, imports, and analytics.
- Desktop capture, OCR, FTS, embeddings, and screen-history retrieval.
- AI chat plus context-memory and project memory card work.
- A command palette and federated search endpoint.
- A task board and a limited saved-view system for activity logs.

That means the adoption question is mostly about depth and unification, not feature parity.

## What Macro Is Actually Doing Well

### 1. It treats the product as a unified entity graph

Macro routes most core views through one reusable list system:

- `inbox`
- `agents`
- `mail`
- `documents`
- `tasks`
- `channels`
- `folders`
- `search`

These are all driven through the same split-layout plus `SoupView` pattern, with view-specific query filters and client filters layered on top.

Why that matters for Ritual:

- Ritual currently feels more page-by-page.
- Habits, logs, tasks, calendar, activity, memory, imports, recaps, and AI feel related conceptually but are not modeled as a shared entity system.

Adoption value:

- High

Recommended adaptation:

- Do not port Macro's work-entity taxonomy.
- Do build a Ritual-native entity model for things like:
  - habits
  - habit logs
  - wearable sessions/events
  - scheduled blocks
  - tasks/experiments
  - AI recaps
  - project memory cards
  - screen moments / context snapshots
  - imports

This would enable one reusable list/search/filter/action layer across the app.

### 2. Its property system is much more valuable than its task UI

Macro has a generalized properties layer with:

- property definitions
- typed values
- select options
- entity references
- system properties
- pinned/default properties
- filterable properties

Ritual's core models are still mostly fixed-schema:

- `HabitDB`
- `HabitLogDB`
- `ScheduledBlockDB`
- import rows and wearable tables

Why this matters for Ritual:

- Quantified-self use cases quickly become custom:
  - confidence
  - context
  - experiment phase
  - trigger type
  - mood
  - location
  - protocol
  - body state
  - recovery score band
  - tags
  - adherence reason
  - intervention type

Right now each new dimension likely becomes another special-case field, table, import rule, filter, and analytics branch.

Adoption value:

- Very high

Recommended adaptation:

- Add a typed properties/custom-fields system to Ritual before adding more specialized surfaces.
- Start with:
  - custom habit properties
  - custom log/session properties
  - system properties for tasks/experiments
  - property-based filtering in logs, tasks, and AI retrieval

Best immediate use case:

- Turn Ritual from "habit tracker with some special integrations" into "personal measurement system with structured metadata."

### 3. Persistent saved views should be generalized

Macro has backend-backed saved views and excluded default views. Ritual currently has a useful but local-only saved view model in the activity logs page.

Why this matters for Ritual:

- Quantified-self users repeatedly ask the same questions:
  - today's manual logs
  - missed health signals
  - last 7 days sleep-only
  - all imported caffeine entries
  - experiments with low adherence
  - recovery below threshold plus low sleep

Those should be first-class saved views across the product, not just one table screen.

Adoption value:

- High

Recommended adaptation:

- Generalize the current `activity/logs-client.tsx` saved-view concept into a shared backend-backed saved view service.
- Persist:
  - filters
  - sort
  - selected columns
  - date range mode
  - groupings
  - metric cards / chart configurations where relevant

Best target surfaces:

- habit logs
- tasks / experiments
- activity search
- metrics dashboard
- imports / audit views

### 4. Linked references are a strong fit for Ritual

Macro's mention system is one of its most valuable primitives. It allows typed references to users, documents, dates, contacts, and more, and the same editor machinery is reused across surfaces.

Ritual already has AI, memory search, project memory cards, and user-entered notes, but those do not appear to form a navigable reference graph.

Why this matters for Ritual:

- Ritual has many evidence artifacts that should be linkable:
  - a log note could reference a screenshot moment
  - a recap could reference a task or experiment
  - a task could reference a habit and a date range
  - an AI answer could link directly to logs, charts, screen moments, or memory cards
  - a habit could reference a protocol note or imported source

Adoption value:

- High

Recommended adaptation:

- Introduce typed links/mentions for:
  - habit
  - log
  - task
  - recap
  - memory card
  - screen moment
  - date range
  - wearable sync/import run

This is especially valuable for AI output: Macro's AI prompt stack clearly assumes linked citations and mentions. Ritual should do the same with its own entities.

### 5. Quick access and frecency would materially improve Ritual UX

Macro combines history, recently viewed state, and a frecency model to drive quick access and command results. Ritual's command palette is useful, but it is still closer to "search + static quick actions" than "behavior-aware operating surface."

Why this matters for Ritual:

- Ritual usage tends to be repetitive and routine-heavy.
- The best shortcuts are often:
  - the few habits you log every day
  - the last active task/experiment
  - the last filtered logs view
  - the last screen-search query
  - the same 2-3 calendar and metrics views

Adoption value:

- Medium-high

Recommended adaptation:

- Add recency/frecency signals to:
  - command palette ranking
  - search suggestions
  - dashboard shortcuts
  - "continue where you left off" modules

Short-term version:

- simple local recents + weighted access counts

Longer-term version:

- real event-based frecency across habits, views, tasks, and memory artifacts

### 6. Macro's keyboard-first model is worth selectively copying

Macro goes well beyond `cmd+k`. It has:

- route hotkeys
- command scopes
- entity action hotkeys
- list navigation hotkeys
- sidebar leader-key navigation
- split-aware opening behavior

Ritual has some shortcuts and a command palette, but not a coherent keyboard interaction system.

Why this matters for Ritual:

- Daily tracking tools benefit disproportionately from low-friction repeat actions.
- Ritual users will repeatedly:
  - log
  - search
  - jump between overview/metrics/calendar/activity/chat
  - change date ranges
  - apply saved views
  - open a recent habit

Adoption value:

- Medium-high

Recommended adaptation:

- Add a real shortcut map for:
  - view switching
  - log creation
  - date range presets
  - open search / focus filter
  - apply recent saved views
  - next/previous detail item

This is lower risk than larger architectural changes and has strong perceived polish.

### 7. Cross-entity inbox is interesting and probably underused in Ritual

Macro's `Inbox` is not just email. It looks like a generalized attention queue driven by notification and importance semantics across multiple entity types.

Ritual has the raw ingredients for a strong personal attention layer:

- missed habits
- unreviewed imports
- stale wearable connections
- unusual biometrics
- unresolved tasks/experiments
- low-confidence screenshot imports
- incomplete calendar plans
- open recap items

Adoption value:

- Medium

Recommended adaptation:

- Build a Ritual-specific "Attention" or "Review" inbox rather than copying Macro's inbox directly.
- Populate it from system-generated prompts, not generic notifications.

This would fit quantified-self workflows well:

- review what needs interpretation
- confirm low-confidence logs
- close loops on experiments
- investigate anomalies

### 8. Tasks as documents is useful mostly as a design pattern

Macro's tasks are not a separate simplistic object. They are document-backed tasks with structured properties, filters, and views.

Ritual currently has a local-storage kanban board. It looks helpful for UX exploration, but it is not a durable or deeply integrated system.

Adoption value:

- Medium

Recommended adaptation:

- Do not adopt "tasks as markdown docs" literally unless Ritual is also getting a note/document layer.
- Do adopt the idea that tasks/experiments should be:
  - durable
  - structured
  - queryable
  - linkable to logs and analytics
  - property-driven

Best framing for Ritual:

- "experiments" or "protocol tasks" rather than generic productivity tasks

### 9. AI with citations and attached context is directly relevant

Macro's AI prompt/tooling stack is built around attached entities and explicit citations. That is a strong fit for Ritual because Ritual already has rich evidence objects.

Adoption value:

- High

Recommended adaptation:

- Make Ritual AI responses cite concrete internal objects:
  - logs
  - date windows
  - charts
  - screen moments
  - memory cards
  - wearable events

This would make Ritual's AI feel materially more trustworthy and navigable.

## Best Feature Bets For Ritual

If I had to pick the highest ROI Macro-inspired investments, in order:

1. Property system for habits, logs, tasks, and sessions.
2. Shared saved views across list surfaces.
3. Linked entities and AI citations.
4. Unified entity-list infrastructure for Ritual-native objects.
5. Recency/frecency-driven quick access and command ranking.
6. Better keyboard-first flows.
7. A Ritual-specific attention inbox.

## Features That Are Interesting But Probably Not Worth Adopting

### Team channels, groups, and permissions

These are core to Macro but peripheral to Ritual's main value. They add heavy complexity without clearly improving quantified-self outcomes.

### Full email client functionality

Not aligned with Ritual's core mission. At most, email import or summaries could be useful later, but not an in-app email surface.

### Full collaborative CRDT docs stack

Technically impressive, but for Ritual it is only justified if you decide notes/journaling become a major product pillar.

### Canvas/diagramming as a primary surface

Useful only if Ritual becomes a "protocol design" or "life systems planning" tool. Otherwise it is novelty relative to higher-value groundwork.

### Macro-scale service decomposition

Macro's service architecture reflects a much broader product. Ritual should borrow patterns, not service count.

## Recommended Product Translation For Ritual

Do not ask:

- "Should Ritual add docs, channels, and folders?"

Ask instead:

- "What is Ritual's equivalent of a linked entity graph for personal data?"

My answer:

- habits
- logs
- sessions
- experiments
- recaps
- imports
- screen moments
- memory cards
- connections

If those become first-class linked entities with properties, views, saved filters, and AI citations, Ritual gets a lot of Macro's upside without losing focus.

## Concrete Rollout Plan

### Phase 1: Low-risk, high-ROI

- Generalize saved views beyond activity logs.
- Add recents/frecency to command palette and suggestions.
- Add more keyboard shortcuts around logging, navigation, and filtering.
- Add AI citations that open Ritual entities directly.

### Phase 2: Core platform improvement

- Build a typed properties system.
- Start with habit-level and log-level custom fields.
- Add property filters to logs and task/experiment views.

### Phase 3: Structural unification

- Introduce a shared Ritual entity list layer.
- Move logs, experiments, imports, and recaps onto consistent list/filter/action primitives.

### Phase 4: New surface unlocked by the above

- Replace the current local-storage kanban with durable experiments/tasks.
- Add an attention/review inbox.
- Optionally add linked notes/journal entries if the product direction supports it.

## Bottom Line

The most valuable things to adopt from Macro are not its collaboration or communication features. They are the reusable operating-system primitives underneath:

- entity unification
- flexible properties
- persistent views
- linked context
- behavior-aware navigation
- keyboard-driven workflows

For Ritual, those would make the app feel less like a collection of strong features and more like a coherent personal data system.

That is the part of Macro worth stealing.
