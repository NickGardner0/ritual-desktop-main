# Production Deploy Guide: Vercel Frontend + Railway Backend

This repo ships as a hosted stack:

- Vercel hosts the Next.js app in `apps/dashboard`
- Railway hosts the FastAPI backend in `apps/backend`
- The macOS desktop app loads the Vercel app and talks to the Railway API

Deploy the backend first, then wire the frontend to the backend URL, then redeploy the frontend.

## Deploy Order

1. Create the Railway backend service from `apps/backend`
2. Generate the Railway public URL
3. Set Vercel frontend env vars with that backend URL
4. Deploy the Vercel frontend from `apps/dashboard`
5. Update Railway `CORS_ORIGINS`, `APP_URL`, `NEXT_PUBLIC_APP_URL`, and Whoop redirect values to the final Vercel URL
6. Redeploy Railway
7. Smoke test the desktop app against the production URLs

## Vercel Frontend

### Project Settings

- Framework Preset: `Next.js`
- Root Directory: `apps/dashboard`
- Install Command: leave default
- Build Command: leave default, or set `npm run build`
- Output Directory: leave empty

This repo uses the root `package-lock.json` and npm workspaces. Vercel should import the monorepo and then target `apps/dashboard` as the project root.

### Production Environment Variables

Required:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `NEXT_PUBLIC_CLERK_SIGN_IN_URL`
- `NEXT_PUBLIC_CLERK_SIGN_UP_URL`
- `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL`
- `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL`
- `NEXT_PUBLIC_PYTHON_API_URL`
- `PYTHON_API_URL`
- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_APP_ORIGIN`
- `OPENAI_API_KEY`
- `TINYBIRD_TOKEN`
- `TINYBIRD_API_URL`
- `INTERNAL_API_KEY`

Set if used:

- `WHOOP_CLIENT_ID`
- `WHOOP_CLIENT_SECRET`
- `NEXT_PUBLIC_WHOOP_CLIENT_ID`
- `NEXT_PUBLIC_WHOOP_REDIRECT_URI`
- `NEXT_PUBLIC_SENTRY_DSN`
- `GROQ_API_KEY`
- `NEXT_PUBLIC_OPENPANEL_CLIENT_ID`
- `OPENPANEL_SECRET_KEY`

Recommended values:

- `NEXT_PUBLIC_PYTHON_API_URL=https://<your-railway-domain>`
- `PYTHON_API_URL=https://<your-railway-domain>`
- `NEXT_PUBLIC_APP_URL=https://<your-vercel-domain>`
- `NEXT_PUBLIC_APP_ORIGIN=https://<your-vercel-domain>`
- `NEXT_PUBLIC_WHOOP_REDIRECT_URI=https://<your-vercel-domain>/api/integrations/whoop/callback`

### Browser Access Note

Production app routes are intentionally desktop-only. Normal browser visits to the product UI will redirect to `/desktop-only`. That is expected for this beta.

### CLI Deploy

If you want to deploy from the terminal:

```bash
vercel --cwd apps/dashboard
vercel --cwd apps/dashboard --prod
```

## Railway Backend

### Service Settings

- Root Directory: `apps/backend`
- Config as code: uses `apps/backend/railway.json`
- Start command: `python -m uvicorn main:app --host 0.0.0.0 --port ${PORT}`
- Healthcheck: `/health`

### Production Environment Variables

Required:

- `DATABASE_URL`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `CLERK_JWKS_URL`
- `DEBUG=false`
- `CORS_ORIGINS`
- `INTERNAL_API_KEY`
- `TOKEN_ENCRYPTION_KEY`
- `TURSO_LOCAL_ENCRYPTION_KEY`
- `TINYBIRD_TOKEN`
- `TINYBIRD_API_URL`
- `APP_URL`
- `NEXT_PUBLIC_APP_URL`

Set if used:

- `WHOOP_CLIENT_ID`
- `WHOOP_CLIENT_SECRET`
- `NEXT_PUBLIC_WHOOP_REDIRECT_URI`
- `OPENAI_API_KEY`
- `GROQ_API_KEY`
- `NEXT_PUBLIC_WHOOP_CLIENT_ID`
- `RITUAL_MEMORY_CLOUD_ENABLED`
- `TURBOPUFFER_API_KEY`
- `TURBOPUFFER_BASE_URL`
- `TURBOPUFFER_NAMESPACE_PREFIX`
- `COHERE_API_KEY`
- `OPENAI_EMBED_MODEL`
- `OPENAI_ANSWER_MODEL`
- `COHERE_RERANK_MODEL`

Recommended values:

- `CORS_ORIGINS=https://<your-vercel-domain>,tauri://localhost`
- `APP_URL=https://<your-vercel-domain>`
- `NEXT_PUBLIC_APP_URL=https://<your-vercel-domain>`
- `NEXT_PUBLIC_WHOOP_REDIRECT_URI=https://<your-vercel-domain>/api/integrations/whoop/callback`

Notes:

- `DATABASE_URL` must include the Turso auth token in the query string. This backend expects the form `libsql://...turso.io?authToken=...`
- `CLERK_JWKS_URL` should point at your Clerk JWKS endpoint
- `TOKEN_ENCRYPTION_KEY` is required for encrypted token storage
- `TURSO_LOCAL_ENCRYPTION_KEY` should be a strong random secret for the embedded replica

### Dashboard Deploy

From Railway UI:

1. New Project
2. Deploy from GitHub repo
3. Select this repo
4. Set the service Root Directory to `apps/backend`
5. Add the env vars above
6. Deploy
7. In Settings, generate a public domain

## Post-Deploy Checks

Backend:

- `GET https://<railway-domain>/health`
- confirm `database.status` is `ok`
- confirm `tinybird.status` is `ok` or intentionally unavailable

Frontend:

- open `https://<vercel-domain>/desktop-only`
- confirm the page loads
- confirm allowed public routes still work:
  - `/api/integrations/whoop/callback`
  - `/integrations/success`

Desktop:

- sign in inside the macOS app
- verify habits load
- verify chat reaches the backend
- verify Whoop OAuth returns to the desktop success flow

## Rollback

Vercel:

- use the Vercel dashboard to promote the previous production deployment
- or run `vercel rollback <deployment-url-or-id>`

Railway:

- redeploy the previous successful deployment from the Railway dashboard
- if the issue is config-only, restore the prior env vars and redeploy
