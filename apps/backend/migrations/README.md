# Backend Migrations

Alembic is the only supported backend schema-migration path. Startup verifies
the database but never creates or alters schema implicitly.

Run every environment through the canonical command from the repository root:

```bash
python apps/backend/scripts/run_database_migrations.py
```

Set `ALEMBIC_DATABASE_URL` for a migration-specific connection, or
`DATABASE_URL` for the normal backend database. New DDL and data backfills must
be ordered revisions under `migrations/versions`; operational scripts under
`apps/backend/scripts` must not mutate schema.

The first revision adopts databases created before Alembic. The reconciliation
revision `20260817_0001` completes the known partial shapes from the retired
standalone scripts and preserves their data.
