# Backend Ops Scripts

`backend-scripts.manifest.json` is the ownership ledger for one-off backend scripts.

Rules:

- Every file in `apps/backend/scripts` must appear in the manifest.
- Every manifest entry must have an `owner`, `runtime`, `smoke_test`, `review_action`, and one of the allowed statuses.
- `repo:check` syntax-checks every listed script, but it does not execute data-mutating operations.
- `migration_candidate` scripts should move into Alembic or desktop versioned migrations.
- `archive_candidate` scripts should be deleted or moved to historical docs after owner review.
- `manual_repair` scripts are break-glass tools and need smoke tests before they are promoted to `supported`.
