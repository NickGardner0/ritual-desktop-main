#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const requiredFiles = [
  "apps/backend/alembic.ini",
  "apps/backend/migrations/env.py",
  "apps/backend/migrations/README.md",
  "apps/backend/migrations/legacy_runtime_schema.py",
  "apps/backend/migrations/versions/20260524_0001_legacy_runtime_schema.py",
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

if (errors.length) {
  console.error("Migration boundary check failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("Migration boundary check passed.");
