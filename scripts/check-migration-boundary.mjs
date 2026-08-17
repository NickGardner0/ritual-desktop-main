#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const requiredFiles = [
  "apps/backend/alembic.ini",
  "apps/backend/migrations/env.py",
  "apps/backend/migrations/README.md",
  "apps/backend/migrations/legacy_runtime_schema.py",
  "apps/backend/migrations/versions/20260524_0001_legacy_runtime_schema.py",
  "apps/backend/migrations/versions/20260817_0001_reconcile_legacy_script_schemas.py",
];
const errors = [];

for (const file of requiredFiles) {
  if (!existsSync(join(root, file))) {
    errors.push(`Missing migration scaffold file: ${file}`);
  }
}

const connectionPath = join(root, "apps/backend/database/connection.py");
const connection = readFileSync(connectionPath, "utf8");

if (connection.includes("_run_migrations")) {
  errors.push("database/connection.py must not contain legacy runtime schema migrations.");
}

if (connection.includes("RITUAL_ALLOW_RUNTIME_SCHEMA_MIGRATIONS")) {
  errors.push("Runtime schema mutation env flag must not be wired into startup.");
}

const revision = readFileSync(
  join(root, "apps/backend/migrations/versions/20260524_0001_legacy_runtime_schema.py"),
  "utf8",
);
if (!revision.includes("Base.metadata.create_all") || !revision.includes("COLUMN_MIGRATIONS")) {
  errors.push("Legacy runtime DDL is not represented by the Alembic revision.");
}

const reconciliation = readFileSync(
  join(root, "apps/backend/migrations/versions/20260817_0001_reconcile_legacy_script_schemas.py"),
  "utf8",
);
if (
  !reconciliation.includes('revision = "20260817_0001"') ||
  !reconciliation.includes('down_revision = "20260729_0003"') ||
  !reconciliation.includes("CANDIDATE_TABLES") ||
  !reconciliation.includes("_backfill_habit_names")
) {
  errors.push("Legacy standalone-script behavior is not represented by the reconciliation revision.");
}

const manifest = JSON.parse(
  readFileSync(join(root, "tools/ops/backend-scripts.manifest.json"), "utf8"),
);
const migrationCandidates = Object.entries(manifest.scripts)
  .filter(([, entry]) => entry.status === "migration_candidate")
  .map(([name]) => name);
if (migrationCandidates.length > 0 || manifest.statuses.migration_candidate) {
  errors.push(
    `Standalone migration candidates are forbidden: ${migrationCandidates.join(", ") || "status remains declared"}`,
  );
}

const scriptsDirectory = join(root, "apps/backend/scripts");
const schemaMutationPattern = /\b(?:CREATE|ALTER|DROP)\s+TABLE\b|\.metadata\.create_all\s*\(|__table__\.create\s*\(/i;
for (const name of readdirSync(scriptsDirectory)) {
  if (!/\.(?:py|sh)$/.test(name)) continue;
  const source = readFileSync(join(scriptsDirectory, name), "utf8");
  if (schemaMutationPattern.test(source)) {
    errors.push(`Backend operational script mutates schema outside Alembic: ${name}`);
  }
}

const retiredCommands = [
  "add_habit_log_columns.py",
  "add_habit_name_column.py",
  "init_turso_tables.py",
  "migrate_add_ai_tables.py",
  "migrate_add_financial_tables.py",
  "migrate_add_heart_rate_tables.py",
  "migrate_add_import_tables.py",
  "migrate_add_screen_time_tables.py",
  "migrate_add_ui_preferences.py",
  "migrate_add_watcher_tables.py",
  "migrate_add_wearables_tables.py",
  "migrate_import_indexes.py",
  "migrate_watcher_v2.py",
  "repair_wearable_events_schema.py",
];
for (const name of retiredCommands) {
  if (existsSync(join(scriptsDirectory, name))) {
    errors.push(`Retired standalone migration still exists: ${name}`);
  }
}

if (errors.length) {
  console.error("Migration boundary check failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("Migration boundary check passed.");
