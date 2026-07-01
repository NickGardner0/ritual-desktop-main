#!/usr/bin/env node
/**
 * Phase 8 gate: isTauri() is only allowed in the desktop capability boundary.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ALLOWED_FILES = new Set([
  'apps/dashboard/instrumentation-client.ts',
  'apps/dashboard/lib/ai/overview-activity/overview-activity-query.ts',
  'apps/dashboard/lib/computerActivity/api.ts',
  'apps/dashboard/lib/computerActivity/aggregate-local-first.ts',
  'apps/dashboard/lib/computerActivity/backend-read.ts',
  'apps/dashboard/lib/computerActivity/policy.ts',
  'apps/dashboard/lib/computerActivity/tauri-fallback.ts',
  'apps/dashboard/lib/computerActivity/useComputerActivity.ts',
  'apps/dashboard/lib/tauri-utils.ts',
  'apps/dashboard/lib/desktop-runtime.ts',
  'apps/dashboard/lib/desktop-capabilities.tsx',
  'apps/dashboard/lib/native-voice.ts',
  'apps/dashboard/lib/perf-debug.ts',
]);

const PATTERN = /\b(?:isTauri|isDesktopRuntime)\s*\(/;

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walk(path, acc);
      continue;
    }
    if (!/\.(ts|tsx|js|jsx|mjs)$/.test(entry)) continue;
    acc.push(path);
  }
  return acc;
}

export function checkDesktopCapabilitiesBoundary(options = {}) {
  const root = options.root ?? process.cwd();
  const dashboardRoot = join(root, 'apps/dashboard');
  const files = walk(dashboardRoot);
  const violations = [];

  for (const file of files) {
    const rel = relative(root, file).replace(/\\/g, '/');
    if (rel.includes('/tests/')) continue;
    if (ALLOWED_FILES.has(rel)) continue;

    const source = readFileSync(file, 'utf8');
    if (!PATTERN.test(source)) continue;

    const lines = source.split('\n');
    lines.forEach((line, index) => {
      if (PATTERN.test(line)) {
        violations.push({
          file: rel,
          line: index + 1,
          text: line.trim(),
        });
      }
    });
  }

  return violations;
}

function main() {
  const violations = checkDesktopCapabilitiesBoundary();
  if (violations.length === 0) {
  console.log('✅ Desktop capabilities boundary: no stray desktop runtime probes.');
    process.exit(0);
  }

  console.error(`❌ Found ${violations.length} desktop runtime probe(s) outside the allowlist:\n`);
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line}  ${violation.text}`);
  }
  process.exit(1);
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  main();
}
