# Backend Service

FastAPI backend for Ritual.

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

From repo root, install the backend test dependencies into your backend environment:

- `cd apps/backend && python -m pip install -r requirements-dev.txt`

Then run focused tests from the repo root, for example:

- `cd apps/backend && python -m pytest tests/test_unified_wearables.py tests/test_wearables_query_service.py`

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
