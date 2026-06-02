# Backend Migrations

This directory is the target home for backend schema changes.

Startup must not create or alter schema implicitly. During the transition, the
legacy additive migration function is only available through
`python apps/backend/scripts/run_database_migrations.py`.

New schema changes should be implemented as Alembic revisions under
`migrations/versions`.
