#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const budget = Number.parseInt(process.env.RITUAL_RUNTIME_SCHEMA_MUTATION_BUDGET || '100', 10);
const runtimeSchemaFiles = [
  'apps/backend/database/connection.py',
  'apps/backend/services/turso_user_service.py',
  'apps/desktop/src-tauri/src/ritual_database.rs',
  'apps/desktop/src-tauri/crates/ritual-db/src/schema.rs',
  'apps/desktop/src-tauri/crates/ritual-db/src/migration.rs',
];

const ddlPattern = /\b(CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE|CREATE\s+INDEX|DROP\s+INDEX)\b/gi;
const counts = [];
let total = 0;

for (const relativePath of runtimeSchemaFiles) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!existsSync(absolutePath)) {
    continue;
  }

  const contents = readFileSync(absolutePath, 'utf8');
  const matches = contents.match(ddlPattern) || [];
  if (matches.length > 0) {
    counts.push({ file: relativePath, count: matches.length });
    total += matches.length;
  }
}

if (total > budget) {
  console.error(`Runtime schema mutation budget exceeded: ${total}/${budget}.`);
  console.error('Move startup/service-layer DDL into versioned migrations before adding more schema changes.');
  for (const item of counts) {
    console.error(`- ${item.file}: ${item.count}`);
  }
  process.exit(1);
}

console.log(`Runtime schema mutation budget passed: ${total}/${budget}.`);
