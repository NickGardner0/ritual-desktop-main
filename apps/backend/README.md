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
