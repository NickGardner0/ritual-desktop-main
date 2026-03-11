# Littlebird Parity Plan

## Goal
Make Ritual's app/browser memory capture, retrieval quality, and structured recap answers feel as precise and useful as Littlebird.

This plan assumes the context-memory migration is already in place and focuses on the remaining parity gaps:
- native app capture quality is still uneven, especially for Cursor/editor surfaces
- browser/native capture must stay unified through one watcher
- retrieval still needs stronger document/task/entity modeling
- recap answers still need more deterministic structure and evidence-backed specificity

## Current State

### What is working
- Browser capture is strong when the extension is loaded and the watcher is listening on `127.0.0.1:8766`.
- Native macOS capture is accessibility-first, not OCR-first.
- The watcher now records `context_snapshots`, `context_sessions`, and context retrieval docs.
- Cursor now reliably yields:
  - active window title
  - active `AXDocument` path / file identity
- Things now yields useful task text via AX.
- One watcher is currently active on `127.0.0.1:8766`.

### What is still weak
- Cursor does not yet expose actual editor-body text through the current AX surface.
- Electron-style editors can expose sparse AX trees at the app root and require fallback probing of related helper/renderer surfaces.
- Retrieval still over-relies on raw context snippets rather than stronger task/document/entity abstractions.
- Final recap answers still need stronger deterministic planning and rendering to consistently match Littlebird’s specificity.

## Source Of Truth
- Capture/runtime:
  - `/Users/nickgardner/Desktop/ritual-desktop-main/apps/desktop/src-tauri/bin/ritual-watcher/src/macos.rs`
  - `/Users/nickgardner/Desktop/ritual-desktop-main/apps/desktop/src-tauri/bin/ritual-watcher/src/main.rs`
  - `/Users/nickgardner/Desktop/ritual-desktop-main/apps/browser-extension/background.js`
- Retrieval/answering:
  - `/Users/nickgardner/Desktop/ritual-desktop-main/apps/backend/services/watcher_service_search.py`
  - `/Users/nickgardner/Desktop/ritual-desktop-main/apps/backend/services/memory_story_service.py`
  - `/Users/nickgardner/Desktop/ritual-desktop-main/apps/backend/services/memory_cloud_query_service.py`
  - `/Users/nickgardner/Desktop/ritual-desktop-main/apps/backend/services/memory_turbopuffer_service.py`
- Dashboard/orchestration:
  - `/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/lib/ai/chat-stream/screen-search.ts`
  - `/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/lib/ai/chat-stream/orchestrator.ts`

## Principles
- Accessibility-first for native apps.
- Watcher-owned context capture only; no new always-on sidecar.
- Generic AX traversal first, narrow app-specific fallbacks second.
- Deterministic task/story planning before LLM phrasing.
- Claims must be evidence-backed.
- Keep browser and native capture unified through one watcher on `8766`.

## Slice 1: Stabilize Single-Watcher Capture
- Ensure the desktop-managed watcher is the only long-running watcher process.
- Add a startup self-check that fails fast or warns loudly if another watcher already holds `8766`.
- Add runtime diagnostics for:
  - `current_listener_port`
  - `watcher_pid`
  - `duplicate_watcher_detected`
  - `browser_heartbeat_port_mismatch`
- Make the browser extension heartbeat port configurable from the desktop app, but default to `8766`.
- Add a health check that confirms browser heartbeats and native snapshots are landing in the same watcher instance.

Validation:
- `lsof -n -P -iTCP:8766 -sTCP:LISTEN`
- verify no watcher on `8767`
- verify fresh browser and native rows appear from the same live session window

## Slice 2: Improve Editor Capture Discovery
- Expand native candidate collection for editor-style apps to include:
  - `AXDocument`
  - `AXFilename`
  - selected item / selected row style attrs where available
  - additional structural branches from nested groups / scroll areas / split panes
- Extend the AX dump to probe more alternate attrs on nodes:
  - `AXSelectedRows`
  - `AXSelectedChildren`
  - `AXTabs`
  - `AXTabGroup`
  - `AXContents`
  - `AXScrollAreas`
  - `AXLists`
  - `AXColumns`
  - `AXIdentifier`
- Add targeted helper/renderer-process probing for Electron editors only when root-window capture is weak.
- Record debug traces for the top raw candidates in dev mode so future parity work is not blind.

Primary success criterion:
- Cursor snapshots consistently contain active file identity and some local editor-neighbor context, not just window chrome.

Validation:
- `cargo run -p ritual-watcher --bin ritual-watcher -- --device-id ... --user-id ... --ax-dump-pid <pid>`
- manual live validation in Cursor, Codex, Things, Terminal

## Slice 3: Clean Final Native Snapshot Content
- Add stronger final-text sanitization so snapshot text does not contain:
  - window-control help strings
  - generic terminal-tab labels
  - hidden-folder explorer listings like `.pytest_cache .cursor .github`
  - repeated duplicate window titles
- Prefer the final snapshot composition order:
  1. active document/file identity
  2. active window title
  3. meaningful nearby descendant text
  4. only then fallback shell/sidebar context
- Add a `capture_components` debug field in dev mode so it is clear which final text parts came from:
  - `window_title`
  - `ax_document`
  - `focused`
  - `parent`
  - `sibling`
  - `visible_descendant`
  - `related_window`

Validation:
- manual Cursor snapshots should no longer show hidden-folder listings or zoom-button help text

## Slice 4: Improve Browser Context Semantics
- Keep current strong browser visible-text capture, but add a normalization pass that extracts:
  - main page title
  - active document/article name
  - selected text
  - prominent headings
  - domain-specific artifact names
- Add browser app/domain enrichers for:
  - docs sites
  - GitHub
  - Linear
  - Slack web
  - Calendar
  - Gmail
- Add browser-side document identity fields to retrieval docs so a page can be matched by:
  - title
  - domain
  - artifact/entity names
  - visible task phrases

Validation:
- browser snapshots and retrieval docs produce stable document identity without drowning in raw page chrome

## Slice 5: Add Stronger Document / Task / Entity Abstractions
- Build deterministic extraction over snapshots/sessions for:
  - `document_items`
  - `artifact_refs`
  - `task_phrases`
  - `entities`
  - `work_items`
- For editors, derive:
  - repo
  - file
  - likely feature/task topic
  - neighboring artifact names
- For browser/docs, derive:
  - doc/article/repo/topic identity
- Use these abstractions in both local and cloud retrieval docs.

Why:
- Littlebird-quality search depends on more than raw visible text.
- File/document/task identity needs to be first-class in retrieval.

Validation:
- retrieval docs should contain explicit document/task/entity fields, not only flattened visible text

## Slice 6: Upgrade Local And Cloud Retrieval Ranking
- Change local context search to rank on:
  - document identity match
  - entity overlap
  - task phrase overlap
  - app continuity
  - session continuity
  - time relevance
- Add downranking for noisy shell/sidebar-only context.
- In cloud retrieval:
  - index active document identity separately from raw text
  - index task/entity fields separately from raw context text
  - use hybrid ranking that rewards document/task/entity agreement
- Add diversity controls over:
  - `session_id`
  - `work_item_id`
  - `app_name`
  - `browser_domain`
  - time buckets

Validation:
- targeted retrieval tests for:
  - “What was I doing in Cursor?”
  - “What file was I editing?”
  - “When was I working on the activity dashboard?”
  - “What did I do this morning?”

## Slice 7: Make Story Planning More Deterministic
- Strengthen `memory_story_service.py` to build claims primarily from:
  - `work_items`
  - `document_items`
  - `artifact_refs`
  - `task_phrases`
  - `entities`
- Add explicit claim classes:
  - `main_event`
  - `task_completed`
  - `document_worked_on`
  - `planning_followup`
  - `research_topic`
  - `uncertainty`
- Every recap paragraph must map to a claim card and evidence set.
- Add “main event” ranking that prefers:
  - longer duration
  - repeated session continuity
  - concrete artifact density
  - cross-app continuity
  - execution over browsing noise

Validation:
- recap answers lead with the dominant task/workstream instead of generic app summaries

## Slice 8: Build Littlebird-Style Structured Renderers
- Render recap answers deterministically by query class:
  - `broad_overview`
  - `daypart_overview`
  - `app_drilldown`
  - `time_breakdown`
  - `topic_lookup`
- Default structure should be:
  - main event
  - supporting workstreams
  - concrete tasks
  - tools/apps used
  - strongest evidence
  - uncertainty
- LLMs should phrase or compress grounded planner output, not invent structure.

Validation:
- compare Ritual answers side-by-side against Littlebird screenshots and a gold fixture set

## Slice 9: Build A Focused Evaluation Harness
- Add a parity-focused eval set with queries like:
  - “What did I work on today?”
  - “What did I do this morning?”
  - “What happened in Cursor?”
  - “What file was I working on?”
  - “Where did my time go?”
- Score:
  - specificity
  - evidence density
  - false genericity
  - document identity accuracy
  - task identity accuracy
  - ordering quality
- Add live smoke scripts for:
  - Cursor
  - Codex
  - Things
  - Chrome
  - Terminal

## Immediate Next Priorities
1. Keep one watcher on `8766` only.
2. Keep improving Cursor/editor capture until snapshots include active file identity plus meaningful local context.
3. Promote document/task/entity identity into retrieval docs and ranking.
4. Tighten story planning and structured rendering so recap answers become as concrete as Littlebird’s.

## Exit Criteria For “Near Littlebird Parity”
- One stable watcher process on `8766`
- Browser visible-text capture remains strong
- Native AX capture is strong for:
  - Cursor/Codex
  - Things
  - Terminal
  - major browser-based tools
- Cursor snapshots include:
  - active file/document identity
  - meaningful adjacent context
  - no obvious window-chrome/sidebar junk
- Retrieval consistently returns the right tasks/documents for common memory queries
- Recap answers are structured, specific, evidence-backed, and consistently useful
