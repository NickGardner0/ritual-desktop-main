# Dead Code Cleanup Checklist

Date: 2026-03-30

Purpose: give Claude Code a prioritized cleanup plan based on a repo-wide second-pass audit of app code, workspace packages, assets, scripts, and local repo artifacts.

Scope notes:
- This checklist is based on repo references and runtime entrypoint review, not on production telemetry.
- Items already deleted in the current git worktree are intentionally not repeated here.
- "Safe first" means "no app call sites found and low coupling."
- "Verify before delete" means "looks dead, but there is enough adjacent functionality that a quick confirmation step is still warranted."

## Safe First

These are the best first removals.

### 1. Remove unused workspace packages

- [ ] Remove [`packages/ui`](/Users/nickgardner/Desktop/ritual-desktop-main/packages/ui)
  Reason: no imports from `@ritual/ui` were found anywhere in app code.
- [ ] Remove [`packages/shared-contracts`](/Users/nickgardner/Desktop/ritual-desktop-main/packages/shared-contracts)
  Reason: no imports from `@ritual/shared-contracts` were found anywhere in app code.
- [ ] Remove the matching deps from [`apps/dashboard/package.json`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/package.json)
  Remove: `@ritual/ui`, `@ritual/shared-contracts`
- [ ] Remove the matching TS path aliases from [`apps/dashboard/tsconfig.json`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/tsconfig.json)
  Remove: `@ritual/ui/*`, `@ritual/shared-contracts/*`

### 2. Remove unused AI agent prototype files

- [ ] Remove [`apps/dashboard/lib/ai/context.ts`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/lib/ai/context.ts)
- [ ] Remove [`apps/dashboard/lib/ai/agents/habit-agent.ts`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/lib/ai/agents/habit-agent.ts)
- [ ] Remove [`apps/dashboard/lib/ai/agents/triage-agent.ts`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/lib/ai/agents/triage-agent.ts)
- [ ] Remove [`apps/dashboard/lib/ai/agents/index.ts`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/lib/ai/agents/index.ts)
  Reason: the agent files only reference each other; no app entrypoint imports them.

### 3. Remove clearly orphaned dashboard files

- [ ] Remove [`apps/dashboard/hooks/useLiveBiometrics.ts`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/hooks/useLiveBiometrics.ts)
- [ ] Remove [`apps/dashboard/lib/server/data.ts`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/lib/server/data.ts)
- [ ] Remove [`apps/dashboard/components/charts/MultiHabitOverlayChart.tsx`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/components/charts/MultiHabitOverlayChart.tsx)
- [ ] Remove [`apps/dashboard/components/dashboard/TodaysFocusWidget.tsx`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/components/dashboard/TodaysFocusWidget.tsx)
- [ ] Remove [`apps/dashboard/components/timer/TimeTrackerWidget.tsx`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/components/timer/TimeTrackerWidget.tsx)
- [ ] Remove [`apps/dashboard/components/biometrics/live-heart-rate-card.tsx`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/components/biometrics/live-heart-rate-card.tsx)
  Reason: no inbound app references found.

### 4. Remove unused barrels and shadow files

- [ ] Remove [`apps/dashboard/components/analytics/index.ts`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/components/analytics/index.ts)
- [ ] Remove [`apps/dashboard/components/kanban/index.ts`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/components/kanban/index.ts)
- [ ] Remove [`apps/dashboard/components/screen-recorder/index.ts`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/components/screen-recorder/index.ts)
- [ ] Remove [`apps/dashboard/components/kanban/KanbanHeader.tsx`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/components/kanban/KanbanHeader.tsx)
- [ ] Remove [`apps/dashboard/components/kanban/EnergyBudgetBar.tsx`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/components/kanban/EnergyBudgetBar.tsx)
- [ ] Remove [`apps/dashboard/components/kanban/StatusIcon.tsx`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/components/kanban/StatusIcon.tsx)
  Reason: no inbound references found, and the active Kanban icon path appears to be [`apps/dashboard/components/kanban/kanban-icons.tsx`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/components/kanban/kanban-icons.tsx).

### 5. Remove unused UI primitive files

- [ ] Remove [`apps/dashboard/components/ui/alert.tsx`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/components/ui/alert.tsx)
- [ ] Remove [`apps/dashboard/components/ui/chart.tsx`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/components/ui/chart.tsx)
- [ ] Remove [`apps/dashboard/components/ui/sidebar.tsx`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/components/ui/sidebar.tsx)
- [ ] Remove [`apps/dashboard/components/ui/slider.tsx`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/components/ui/slider.tsx)
- [ ] Remove [`apps/dashboard/components/ui/sonner.tsx`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/components/ui/sonner.tsx)
- [ ] Remove [`apps/dashboard/components/ui/tabs.tsx`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/components/ui/tabs.tsx)
- [ ] Remove [`apps/dashboard/components/ui/toaster.tsx`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/components/ui/toaster.tsx)
  Reason: no app imports found for these primitives.

### 6. Remove clearly unused packages from dashboard manifest

- [ ] Remove `react-markdown` from [`apps/dashboard/package.json`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/package.json)
- [ ] Remove `remark-gfm` from [`apps/dashboard/package.json`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/package.json)
- [ ] Remove `geist` from [`apps/dashboard/package.json`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/package.json)
- [ ] Remove `@shadcn/ui` from [`apps/dashboard/package.json`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/package.json)
  Reason:
  - no imports found for `react-markdown`
  - no imports found for `remark-gfm`
  - no imports found for the `geist` package
  - no usage found for `@shadcn/ui` outside metadata/config files

### 7. Remove stale or obviously obsolete scripts

- [ ] Remove [`scripts/apply-tinybird-changes.sh`](/Users/nickgardner/Desktop/ritual-desktop-main/scripts/apply-tinybird-changes.sh)
  Reason: it references replacement files that no longer exist.
- [ ] Remove [`tmp/tauri-sign-test.txt`](/Users/nickgardner/Desktop/ritual-desktop-main/tmp/tauri-sign-test.txt)
- [ ] Remove [`tmp/tauri-sign-test.txt.sig`](/Users/nickgardner/Desktop/ritual-desktop-main/tmp/tauri-sign-test.txt.sig)
  Reason: tracked temp artifacts with no repo references.

## Verify Before Delete

These look dead, but Claude Code should confirm with one focused search and then remove if still unused.

### 1. Old semantic search UI path

- [ ] Verify no route or dynamic import uses [`apps/dashboard/components/screen-recorder/SemanticSearch.tsx`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/components/screen-recorder/SemanticSearch.tsx)
- [ ] Verify no route or dynamic import uses [`apps/dashboard/hooks/use-semantic-search.ts`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/hooks/use-semantic-search.ts)
- [ ] Verify no route or dynamic import uses [`apps/dashboard/lib/screen-search.ts`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/lib/screen-search.ts)
- [ ] If still unused, remove all 3 together
  Reason: they appear to be an older semantic-search surface beside the active chat-stream retrieval path.

### 2. Root package.json dependency duplication

- [ ] Review [`package.json`](/Users/nickgardner/Desktop/ritual-desktop-main/package.json) for dependencies duplicated from [`apps/dashboard/package.json`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/package.json)
- [ ] In a clean branch, try moving app-specific runtime deps out of the root manifest and keep the root manifest limited to workspace-level tooling only
- [ ] Only keep root deps that are truly used by root-level scripts or installs
  Reason: the root manifest appears to duplicate most dashboard deps, but this can affect hoisting and local install behavior if the child workspace is missing declarations.

### 3. Manual utility scripts that may still be personally useful

- [ ] Verify whether [`scripts/generate-lucide-assets.mjs`](/Users/nickgardner/Desktop/ritual-desktop-main/scripts/generate-lucide-assets.mjs) is still part of your asset workflow
- [ ] Verify whether [`scripts/capture-ritual-freeze.sh`](/Users/nickgardner/Desktop/ritual-desktop-main/scripts/capture-ritual-freeze.sh) is still part of your debugging workflow
- [ ] If not used anymore, remove them

### 4. Unused dashboard assets

- [ ] Confirm there are no runtime string-built references to these images, then remove them:
  - [`apps/dashboard/public/images/CommandIcon.svg`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/public/images/CommandIcon.svg)
  - [`apps/dashboard/public/images/Vector.svg`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/public/images/Vector.svg)
  - [`apps/dashboard/public/images/Vector2.svg`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/public/images/Vector2.svg)
  - [`apps/dashboard/public/images/logo_fix1.svg`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/public/images/logo_fix1.svg)
  - [`apps/dashboard/public/images/new_logo3.svg`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/public/images/new_logo3.svg)
  - [`apps/dashboard/public/images/plaid.svg`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/public/images/plaid.svg)
  - [`apps/dashboard/public/images/ritual-logo.svg`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/public/images/ritual-logo.svg)
  - [`apps/dashboard/public/images/whoop_band.png`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/public/images/whoop_band.png)

### 5. Unused font assets

- [ ] Remove the clearly unreferenced app fonts in [`apps/dashboard/app/fonts`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/app/fonts)
- [ ] Verify whether the entire unreferenced families below can be removed:
  - [`apps/dashboard/public/fonts/Geist_Mono`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/public/fonts/Geist_Mono)
  - [`apps/dashboard/public/fonts/FKGroteskMono`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/public/fonts/FKGroteskMono)
  - [`apps/dashboard/public/fonts/neue-haas-grotesk-display-pro-cufonfonts`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/public/fonts/neue-haas-grotesk-display-pro-cufonfonts)
- [ ] Verify whether the unused italic FK Grotesk files in [`apps/dashboard/public/fonts/fk-grotesk-neue-font-family`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/public/fonts/fk-grotesk-neue-font-family) can be removed while keeping the files referenced in [`apps/dashboard/app/globals.css`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/app/globals.css)

### 6. Dashboard dependency that is probably dead but not as clean as the others

- [ ] Verify whether `@ai-sdk/react` can be removed from [`apps/dashboard/package.json`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/package.json)
- [ ] If removed, also update [`apps/dashboard/next.config.mjs`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/dashboard/next.config.mjs) to drop it from `optimizePackageImports`
  Reason: no direct imports found, but it is still named in Next config.

## Ignore-File Hygiene

These are mostly not tracked today, but they are cluttering the repo and should be explicitly ignored.

### 1. Add ignore rules for local databases and replicas

- [ ] Update [`.gitignore`](/Users/nickgardner/Desktop/ritual-desktop-main/.gitignore) to ignore:
  - `*.db`
  - `*.db-*`
  - `*.db.*`
  - `:memory:`
  - `:memory:-info`
  - `.turso_replica.db`
  - `apps/backend/.turso_*`
  - `apps/backend/.tmp_*.db*`

### 2. Add ignore rules for generated build and capture output

- [ ] Update [`.gitignore`](/Users/nickgardner/Desktop/ritual-desktop-main/.gitignore) to ignore:
  - `tmp/ritual-freeze-captures/`
  - `apps/desktop/src-tauri/native-timer/.build/`
  - `.trigger/tmp/`
  - `tmp/*.txt.sig`
  - `tmp/tauri-sign-test.txt`

### 3. Add ignore rules for Finder junk

- [ ] Update [`.gitignore`](/Users/nickgardner/Desktop/ritual-desktop-main/.gitignore) to ignore `**/.DS_Store`

### 4. Local cleanup targets

- [ ] Delete local file [`:memory:`](/Users/nickgardner/Desktop/ritual-desktop-main/:memory:) if it is not intentionally needed
- [ ] Delete local file [`:memory:-info`](/Users/nickgardner/Desktop/ritual-desktop-main/:memory:-info)
- [ ] Delete local dir [`tmp`](/Users/nickgardner/Desktop/ritual-desktop-main/tmp) if no active freeze/debug work depends on it
- [ ] Delete local dir [`apps/backend/.turso_user_replicas`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/backend/.turso_user_replicas) if no local backend session is using it
- [ ] Delete local dir [`apps/backend/.turso_import_seeds`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/backend/.turso_import_seeds) if no local import testing needs it
- [ ] Delete generated dir [`apps/desktop/src-tauri/native-timer/.build`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/desktop/src-tauri/native-timer/.build)

## Recommended Execution Order For Claude Code

### Pass 1

- [ ] Remove unused workspace packages
- [ ] Remove unused AI agent prototype files
- [ ] Remove orphan files, barrels, and UI primitives in `apps/dashboard`
- [ ] Remove clearly unused dashboard packages from `apps/dashboard/package.json`
- [ ] Run dashboard typecheck/build

### Pass 2

- [ ] Verify and remove old semantic-search UI path if still unused
- [ ] Verify and remove stale/manual scripts if no longer wanted
- [ ] Run dashboard typecheck/build again

### Pass 3

- [ ] Prune unused images and fonts
- [ ] Rebuild dashboard to catch missing asset references

### Pass 4

- [ ] Tighten `.gitignore`
- [ ] Remove local clutter and generated artifacts

## Suggested Validation

- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] If desktop is in scope, `npm run tauri:build` or at least `npm run tauri:dev`
- [ ] Smoke test:
  - dashboard loads
  - analytics page loads
  - chat loads
  - computer tracking settings loads
  - desktop bootstrap still works

## Things Not Marked Dead

These were reviewed and do not currently look dead:
- [`apps/browser-extension`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/browser-extension)
- [`apps/tinybird`](/Users/nickgardner/Desktop/ritual-desktop-main/apps/tinybird)
- watcher binary and browser-extension heartbeat path
- recorder binary
- backend Tinybird integration
