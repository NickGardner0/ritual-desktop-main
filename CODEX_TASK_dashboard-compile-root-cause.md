# Codex Task: Find True Root Cause of Slow `/dashboard` Dev Compile

## Goal
Perform a fresh, end-to-end investigation of why the Next.js dashboard route compiles slowly in development mode (often 20s+ and sometimes 50s+), and produce a **single, high-confidence root-cause analysis** with a prioritized remediation plan.

The objective is to move from ad-hoc observations to reproducible evidence and concrete fixes.

## Project Context
- Monorepo root: `/Users/nickgardner/Desktop/ritual-desktop-main`
- Frontend app: `apps/dashboard`
- Dev command: `npm run dev` (runs `next dev -p 3000 --turbo`)
- Route under investigation: `/dashboard`
- Next version: `16.0.3` (Turbopack)

## Current Frontend/Next Architecture

### Routing and layout
- App Router structure with route groups under `apps/dashboard/app`.
- `app/layout.tsx` is server-side and wraps all pages with `RootProviders`.
- `RootProviders` is a client component and currently mounts global providers:
  - `ClerkProvider`
  - `QueryProvider` (`@tanstack/react-query`)
  - `HabitsProvider`
  - `OpenPanelProvider`
  - Additional platform/tauri bootstrap logic (`showMainWindow`, `ensureEmbeddingPipelineReadyOnLaunch`).

### Dashboard path
- `app/(dashboard)/dashboard/page.tsx` renders `ClientDashboard`.
- `app/(dashboard)/dashboard/client-dashboard.tsx` dynamically imports `UnifiedAnalyticsClient` with `ssr: false`.
- Dashboard analytics views have been split and moved behind `next/dynamic` boundaries where possible.

### Dashboard layout chain
- `app/(dashboard)/layout.tsx` -> `dashboard-layout-client.tsx` -> `components/dashboard-layout.tsx`.
- `dashboard-layout.tsx` has dynamic client-only boundaries for sidebar/modals/widgets.

### Build/Next config notes
- `apps/dashboard/next.config.mjs` includes:
  - `experimental.optimizePackageImports` for several heavy packages.
  - `serverExternalPackages: ['pino']`.
  - Sentry webpack plugin now conditionally disabled in dev:
    - production: `withSentryConfig(...)`
    - development: `nextConfig` without Sentry wrapper.

## Dependency Surface (not exhaustive, but key suspects)
- Framework/runtime: `next`, `react`, `react-dom`
- Auth: `@clerk/nextjs`
- Data/cache: `@tanstack/react-query`
- UI: many `@radix-ui/*` packages
- Charts: `recharts`
- DnD: `@dnd-kit/*`
- Date/time: `date-fns`, `react-day-picker`
- Icons: `lucide-react`
- AI stack: `ai`, `@ai-sdk/*`, `@ai-sdk/openai`
- Motion/UX: `framer-motion`, `cmdk`
- Monitoring: `@sentry/nextjs`
- Desktop integration: `@tauri-apps/api`

## What Has Already Been Tested/Changed

1. Introduced dashboard client boundaries (`next/dynamic`, `ssr: false`) for heavy views/components.
2. Split monolithic analytics files and moved chart/dnd code behind dynamic imports.
3. Removed stale/duplicate dashboard client file that was no longer imported.
4. Converted several `React.lazy` usages to `next/dynamic`.
5. Disabled Sentry plugin in development (kept for production), which improved compile times somewhat.
6. Ran repeated cold benchmarks (clear `apps/dashboard/.next`, restart dev server, request `/dashboard` once).

### Most recent benchmark evidence (cold runs)
- Run 1: 33.2s
- Run 2: 29.5s
- Run 3: 22.7s
- Run 4: 23.4s
- Run 5: 21.5s
- Min/Avg/Max: **21.5s / 26.06s / 33.2s**

## Known Confounders to Account For
- Clerk token-refresh/redirect-loop warnings observed in dev (`x-clerk-auth-*` headers and console warnings).
- Route requests made without auth cookies can distort perceived behavior.
- Desktop runtime (`npm run desktop`) can run concurrently and consume CPU/IO.
- Incremental cache invalidation can occur without manually deleting `.next` (config/source graph changes).

## Required Investigation Tasks
You must do all of the following and provide evidence for each claim:

1. **Measure reproducibly**
   - Build a repeatable benchmark harness for:
     - cold compile (fresh `.next`)
     - warm compile (no `.next` deletion)
   - Capture at least 5 runs each.
   - Report min/avg/max and raw logs.

2. **Trace real compilation work**
   - Identify which modules/chunks are compiled for first `/dashboard` hit.
   - Determine whether `ssr: false` boundaries still incur compile cost in Turbopack dev for this repo.
   - Quantify which subtree dominates compile time.

3. **Import graph attribution**
   - Produce a route-level dependency attribution for `/dashboard`:
     - root providers
     - dashboard layout chain
     - dashboard page/client boundary
     - analytics components
   - Flag the top 10 highest-cost modules/libraries by compile impact (not just package size on disk).

4. **Auth/proxy impact isolation**
   - Isolate compilation timing from auth redirect behavior.
   - Verify if Clerk loop is only runtime noise or if it amplifies compile behavior.

5. **Desktop-process contention isolation**
   - Compare benchmarks with:
     - only backend + next dev
     - backend + next dev + desktop watcher/recorder stack
   - Quantify slowdown from contention.

6. **Identify true primary root cause**
   - Conclude what single issue (or ordered top 2-3 issues) explains the majority of compile latency variance.
   - Back conclusions with measured data and file-level evidence.

7. **Provide actionable fix plan**
   - Propose minimal, safe code/config changes ranked by expected impact.
   - Include exact files/symbols to modify.
   - Include risk notes and validation steps.

## Output Format Required
Return one report with these sections:

1. **Executive Summary (max 8 bullets)**
2. **Measured Results (tables + raw sample lines)**
3. **Root-Cause Attribution (with percentages if possible)**
4. **Evidence (file paths, imports, logs)**
5. **Fix Plan (P0/P1/P2)**
6. **Validation Plan**
7. **Open Questions / Unknowns**

## Constraints
- Do not guess.
- Every claim must have direct evidence from code, logs, or measurements.
- Favor reproducibility over one-off observations.
- Preserve existing app behavior/functionality in recommendations.

