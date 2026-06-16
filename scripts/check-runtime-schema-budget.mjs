#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const ddlPattern = /\b(CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE|CREATE\s+INDEX|DROP\s+INDEX)\b/gi;
const scannedExtensions = new Set(['.js', '.mjs', '.py', '.rs', '.ts', '.tsx']);

const runtimeRoots = [
  'apps/backend/api',
  'apps/backend/database',
  'apps/backend/main.py',
  'apps/backend/models',
  'apps/backend/schemas',
  'apps/backend/services',
  'apps/desktop/src-tauri/src',
  'apps/desktop/src-tauri/crates',
];

const approvedDdlFiles = new Set([
  'apps/backend/services/turso_activity_schema.py',
  'apps/desktop/src-tauri/crates/ritual-db/src/migration.rs',
  'apps/desktop/src-tauri/crates/ritual-db/src/schema/activity.rs',
  'apps/desktop/src-tauri/crates/ritual-db/src/schema/memory.rs',
  'apps/desktop/src-tauri/crates/ritual-db/src/schema/metadata.rs',
  'apps/desktop/src-tauri/crates/ritual-db/src/schema/migrations.rs',
  'apps/desktop/src-tauri/crates/ritual-db/src/schema/mod.rs',
  'apps/desktop/src-tauri/crates/ritual-db/src/schema/recorder.rs',
  'apps/desktop/src-tauri/crates/ritual-db/src/schema/sync.rs',
]);

function toRelative(absolutePath) {
  return path.relative(repoRoot, absolutePath).split(path.sep).join('/');
}

function walkFiles(root) {
  const absoluteRoot = path.join(repoRoot, root);
  if (!existsSync(absoluteRoot)) {
    return [];
  }
  const stat = statSync(absoluteRoot);
  if (stat.isFile()) {
    return [absoluteRoot];
  }

  const files = [];
  const stack = [absoluteRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === '__pycache__' || entry.name === 'target' || entry.name === 'node_modules') {
        continue;
      }
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolutePath);
      } else if (entry.isFile() && scannedExtensions.has(path.extname(entry.name))) {
        files.push(absolutePath);
      }
    }
  }
  return files;
}

function ddlMatches(relativePath) {
  const contents = readFileSync(path.join(repoRoot, relativePath), 'utf8');
  return contents.match(ddlPattern) || [];
}

const forbidden = [];
const approved = [];

for (const root of runtimeRoots) {
  for (const absolutePath of walkFiles(root)) {
    const relativePath = toRelative(absolutePath);
    const matches = ddlMatches(relativePath);
    if (matches.length === 0) {
      continue;
    }
    const item = { file: relativePath, count: matches.length };
    if (approvedDdlFiles.has(relativePath)) {
      approved.push(item);
    } else {
      forbidden.push(item);
    }
  }
}

if (forbidden.length > 0) {
  console.error('Runtime schema mutation guard failed: forbidden DDL found in runtime code.');
  console.error('Move schema changes into Alembic revisions, desktop versioned migrations, or explicit ops tools.');
  for (const item of forbidden) {
    console.error(`- ${item.file}: ${item.count}`);
  }
  process.exit(1);
}

console.log('Runtime schema mutation guard passed: 0 forbidden DDL statements in runtime code.');
if (approved.length > 0) {
  console.log('Approved migration/provisioning DDL files:');
  for (const item of approved.sort((a, b) => a.file.localeCompare(b.file))) {
    console.log(`- ${item.file}: ${item.count}`);
  }
}
