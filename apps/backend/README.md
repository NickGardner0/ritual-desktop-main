# Backend Service

FastAPI backend for Ritual.

## Locked Python environment

Backend generation, tests, CI, and Railway use Python 3.12.12 and the hash-pinned `requirements.lock.txt`. Do not invoke OpenAPI generation or pytest through an ambient virtualenv.

- `npm run api:openapi`
- `npm run api:generate-client`
- `npm run backend:test`

The first backend command provisions an ignored `.venv/backend-*` environment keyed by the lock hash. `BACKEND_PYTHON` may select the source interpreter, but it must be exactly Python 3.12.12; installed ambient packages are never reused.

To change a dependency, edit `requirements.in` or `requirements-dev.in`, install uv 0.9.2, and run `npm run backend:lock`. Generation fails before importing FastAPI if the inputs, Python version, FastAPI 0.119.0, or Pydantic 2.12.2 drift.

## Key Paths

- `apps/backend/main.py`: API entrypoint
- `apps/backend/services`: business logic
- `apps/backend/database`: DB connection and models
- `apps/backend/tests`: backend test suite
- `docs/guides/weatherkit-setup.md`: WeatherKit setup + verification

## Run

From repo root:

- `npm run dev:backend`

Or directly:

- `cd apps/backend && python start.py`

## Test

From the repo root run `npm run backend:test`. For a focused test, use the locked wrapper directly:

- `node scripts/backend-python.mjs -- -m pytest -q apps/backend/tests/test_unified_wearables.py`

## Clerk account-deletion webhook

Account deletion is coordinated by `POST /api/webhooks/clerk`. Before enabling
the endpoint:

1. Apply the Alembic migration that creates `account_deletion_jobs`.
2. In Clerk Dashboard, create a webhook endpoint for `user.deleted` pointing to
   `https://backend-api-production-a37e.up.railway.app/api/webhooks/clerk`.
3. Set the endpoint's signing secret in Railway as
   `CLERK_WEBHOOK_SIGNING_SECRET`.

The webhook verifies the raw Svix signature, deletes executable external data,
deletes the user's per-user Turso database and local replica, removes all
transitively owned rows from the shared database, and retains a data-minimized
deletion receipt (Clerk id plus a one-way email hash) for idempotent retries.
Processors without a configured erasure API are recorded as follow-up work
instead of being reported as deleted.
