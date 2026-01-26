# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview
Ritual is a self-tracking application for measuring and quantifying behavior. It's a full-stack monorepo with a Next.js frontend, FastAPI backend, and Tauri desktop wrapper.

**Stack:**
- Frontend: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS, shadcn/ui
- Backend: Python FastAPI, SQLAlchemy
- Database: Turso (libSQL)
- Analytics: Tinybird
- Desktop: Tauri 1.x
- Background Jobs: Trigger.dev v4
- Auth: Clerk
- AI: OpenAI

**Architecture Pattern:** Server-first with React Server Components following Midday/NextFaster patterns for performance (<500ms page loads).

## Development Commands

### Frontend (Next.js)
```bash
# Development
pnpm dev                    # Start Next.js dev server on port 3000 (with Turbo)
npm run dev:webpack         # Start without Turbo (if needed)

# Building
npm run build               # Production build
npm run start               # Start production server

# Code Quality
npm run lint                # Run ESLint
npm run contracts:typecheck # TypeScript check for shared contracts
```

### Backend (Python FastAPI)
```bash
# Start backend server
cd backend && python start.py           # Recommended startup script (validates env)
npm run dev:backend                     # Alternative: runs uvicorn directly

# Testing
cd backend && python tests/test_endpoints.py    # Test backend endpoints
```

### Desktop (Tauri)
```bash
# Development
npm run desktop             # Start Tauri dev mode (Next.js must be running first)
npm run tauri:dev           # Direct tauri dev command

# Building
npm run tauri:build         # Build production desktop app
```

### Background Jobs (Trigger.dev)
```bash
npm run trigger:dev         # Start local Trigger.dev dev server
npm run trigger:deploy      # Deploy to staging
npm run trigger:deploy:prod # Deploy to production
```

### Shared Contracts
```bash
npm run contracts:build     # Build shared TypeScript contracts package
```

## Environment Setup

### Critical Environment Variables
Both frontend and backend require environment configuration. **The app will not run without proper .env files.**

#### Frontend (.env.local in project root)
```bash
# Server-side API URL (CRITICAL - no NEXT_PUBLIC prefix)
PYTHON_API_URL=http://127.0.0.1:8000

# Client-side API URL
NEXT_PUBLIC_PYTHON_API_URL=http://127.0.0.1:8000

# Clerk Authentication (Required)
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...

# AI (Required)
OPENAI_API_KEY=sk-...

# Tinybird Analytics (Required)
TINYBIRD_TOKEN=p.ey...
TINYBIRD_API_URL=https://api.us-east.aws.tinybird.co
```

#### Backend (.env in backend/ directory)
```bash
# Database (Required)
DATABASE_URL=libsql://your-db.turso.io
DATABASE_AUTH_TOKEN=eyJ...

# Clerk (Required)
CLERK_SECRET_KEY=sk_test_...

# Tinybird (Required)
TINYBIRD_TOKEN=p.ey...
TINYBIRD_API_URL=https://api.us-east.aws.tinybird.co

# Server Config
API_HOST=0.0.0.0
API_PORT=8000
DEBUG=true
CORS_ORIGINS=http://localhost:3000,https://localhost:3000,tauri://localhost
```

**See `ENVIRONMENT-SETUP.md` and `docs/env_setup.md` for complete configuration.**

## Architecture Patterns

### Server-First Architecture
This app follows Midday's server-first pattern (see `START-HERE.md`):

**Key Principles:**
- **Server Components** by default - data fetching happens on the server
- **Server Actions** for mutations (in `app/actions/`) - no API routes needed for most operations
- **Client Components** only for interactivity (suffix: `-client.tsx`)
- **Parallel data fetching** with Promise.all() in Server Components
- **Streaming** with React Suspense for progressive page loads

**File Patterns:**
```
app/(dashboard)/analytics/
  ├── page.tsx              # Server Component (fetches data)
  └── analytics-client.tsx  # Client Component (UI interactions)
```

### Data Flow
```
Browser (Client Components)
  ↕ HTML Streaming + Server Actions
Next.js Server (Server Components + lib/server/data.ts)
  ↕ HTTP + JWT
Python FastAPI Backend (backend/main.py)
  ↕ SQL / HTTP
Turso Database + Tinybird Analytics
```

### Key Directories

#### Frontend
- `app/` - Next.js App Router pages and layouts
  - `app/(dashboard)/` - Main app pages (dashboard, analytics, integrations, etc.)
  - `app/api/` - API routes (minimized - prefer Server Actions)
  - `app/actions/` - Server Actions for mutations
- `lib/` - Utility libraries
  - `lib/server/data.ts` - **Server-side data fetchers** (Server Components only)
  - `lib/python-api-client.ts` - Client-side API wrapper
  - `lib/*-service.ts` - Client-side service layers
- `components/` - React components (mostly client components)
- `public/` - Static assets

#### Backend
- `backend/main.py` - FastAPI app entry point
- `backend/services/` - Business logic services
  - `habits_service.py` - Habit CRUD operations
  - `tinybird_service.py` - Analytics ingestion
  - `whoop_service.py` - Whoop integration
  - `auth_service.py` - Clerk JWT verification
- `backend/api/` - API route handlers
- `backend/models/` - Pydantic models
- `backend/database/` - SQLAlchemy models and DB connection
- `backend/schemas/` - Data schemas
- `backend/scripts/` - Utility scripts

#### Desktop
- `src-tauri/` - Tauri configuration and Rust code
  - `tauri.conf.json` - Tauri app configuration
  - Note: Uses macOS Private API (`macOSPrivateApi: true`)

#### Background Jobs
- `src/trigger/` - Trigger.dev background jobs
  - `whoop-sync.ts` - Scheduled Whoop data synchronization

### Testing
**Python Backend:**
- Run `cd backend && python tests/test_endpoints.py` to test backend endpoints
- Backend uses pytest for unit tests (files: `backend/tests/test_*.py`)

**Frontend:**
- No test runner configured yet
- Manual testing via browser

## Important Implementation Notes

### Authentication
- Uses Clerk for authentication
- JWT tokens passed via `Authorization: Bearer <token>` header
- Server Components: Use `auth()` from `@clerk/nextjs/server`
- Client Components: Use Clerk React hooks
- Backend: Validates JWT with `AuthService.get_user_from_token()`

### Database
- Turso (libSQL) database with SQLAlchemy ORM
- Replica database created locally at `backend/.turso_replica.db`
- Connection via `libsql-client` and `sqlalchemy-libsql` packages

### Analytics & Observability
- Tinybird for analytics data warehouse
- Dual writes: SQLAlchemy + Tinybird ingestion for important events
- OpenPanel for product analytics (optional)
- Sentry for error tracking (optional)

### Desktop App
- Tauri wraps Next.js web app
- **Must start Next.js server first** (`npm run dev`) before `npm run desktop`
- Uses `tauri://localhost` origin
- File system access configured in `tauri.conf.json` allowlist

### Rate Limiting
- Backend uses `slowapi` for rate limiting
- Habit creation: 10/minute
- Habit fetching: 30/minute

### TypeScript Configuration
- Path alias: `@/*` maps to project root
- `typescript.ignoreBuildErrors: true` in next.config.mjs (TODO: fix TypeScript errors)

## Common Workflows

### Adding a New Page
1. Create Server Component in `app/(dashboard)/your-page/page.tsx`
2. Fetch data with functions from `lib/server/data.ts`
3. Create Client Component for interactivity: `your-page-client.tsx`
4. Add Server Actions in `app/actions/` if mutations needed
5. Use `revalidatePath()` in Server Actions to refresh data

### Adding a New API Endpoint (Backend)
1. Create service in `backend/services/your_service.py`
2. Add Pydantic models in `backend/models/`
3. Add endpoint in `backend/main.py` or `backend/api/`
4. Add server-side data fetcher in `lib/server/data.ts`
5. Call from Server Components

### Debugging Performance
- Server Components log to **terminal** (Next.js server logs)
- Client Components log to **browser console**
- Check `lib/server/data.ts` for server-side timing logs
- Network tab: Should see HTML streaming, not large JSON responses
- Analytics page should load <500ms, Integrations <200ms

## Package Manager
- Uses **pnpm** (specified in package.json: `"packageManager": "pnpm@9.15.0"`)
- Use `pnpm` for all npm operations, not `npm`

## Bundle Analysis
```bash
ANALYZE=true npm run build  # Generates bundle analyzer report
```
