# Ritual Tinybird project

This directory is the declarative Tinybird project for Ritual. Runtime ingestion,
privacy enforcement, circuit buffering, and query access are owned by
`apps/backend/services/tinybird_service.py`; there is no second Python client in
this project.

## Managed resources

`tinybird.config.json` intentionally includes only the committed `datasources/`
and `pipes/` directories. A remote inventory performed on 2026-08-17 found the
same seven data sources and seventeen pipes as the repository, with no
unmanaged remote resources.

Before changing the include set, compare the cloud inventory with production
call sites. Import referenced remote-only resources into this project. Back up
and retire unreferenced resources only after confirming they have had no writes
or queries for 30 days.

## Local development

```bash
tb login
tb local start
npm run build
npm run deploy:local
```

The local `.tinyb` credential file is ignored by Git.

## Cloud deployment

Cloud changes are staged and promoted separately. Do not use an unreviewed
one-step `tb --cloud deploy` command.

```bash
npm run check:cloud
npm run stage:cloud
# Smoke-test the staging endpoints, then:
npm run promote:cloud
```

The `Tinybird Deployment` GitHub Actions workflow exposes those same three
manual operations. It authenticates with the scoped `TINYBIRD_TOKEN` repository
secret. Promotion remains a distinct manual dispatch so a successful check or
staging deployment cannot publish by itself.

After staging, smoke-query every endpoint changed by the deployment with a
representative test user and verify ingestion against each changed data source.
