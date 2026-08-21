# Ritual Desktop

Monorepo for Ritual: dashboard (Next.js), desktop (Tauri), backend (FastAPI), iOS companion, and shared packages.

## Architecture (post remediation)

| Layer | Location | Notes |
|-------|----------|-------|
| Browser API | [`apps/dashboard/lib/api/client.ts`](apps/dashboard/lib/api/client.ts) | All client fetches use `/api` BFF proxy |
| Server API | [`lib/api/server-client.ts`](apps/dashboard/lib/api/server-client.ts) | Direct backend URL only here |
| Shared DTOs | [`packages/shared-contracts`](packages/shared-contracts) | Habits, computer activity, etc. |
| Integrations UI | [`apps/dashboard/app/(dashboard)/integrations/plugins/`](apps/dashboard/app/(dashboard)/integrations/plugins/) | Plugin registry per provider |
| Desktop capabilities | [`apps/dashboard/lib/desktop-capabilities.tsx`](apps/dashboard/lib/desktop-capabilities.tsx) | `useDesktopCapabilities()` instead of scattered `isTauri()` |
| Backend entry | [`apps/backend/main.py`](apps/backend/main.py) | Thin; app in `app_factory.py` |
| Backend models | [`apps/backend/database/models/`](apps/backend/database/models/) | Split by domain |
| Chat runtime | [`packages/chat-runtime/src/chat-stream/`](packages/chat-runtime/src/chat-stream/) | Split orchestrator |

Full remediation program: [`docs/thermo-nuclear-remediation-plan.md`](docs/thermo-nuclear-remediation-plan.md)

## Common commands

```bash
npm run dev              # Dashboard (port 3000)
npm run dev:backend      # FastAPI (port 8000)
npm run repo:check       # Structure, API boundary, line budgets
npm run typecheck        # Dashboard TS
npm run test:dashboard   # Dashboard unit tests
```
