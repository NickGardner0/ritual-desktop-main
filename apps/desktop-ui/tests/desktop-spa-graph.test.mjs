import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertDesktopSpaBudgets,
  desktopSpaDistExists,
} from '../../../tools/performance/desktop-spa-budgets.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(root, '../..');
const dashboard = join(repo, 'apps/dashboard');
const srcRoot = join(root, 'src');
const adapters = join(srcRoot, 'adapters');

const ALIASES = new Map([
  ['@/lib/desktop-session', join(adapters, 'clerk.tsx')],
  ['@/lib/app-navigation', join(adapters, 'next-navigation.ts')],
  ['next/navigation', join(adapters, 'next-navigation.ts')],
  ['next/link', join(adapters, 'next-link.tsx')],
  ['next/dynamic', join(adapters, 'next-dynamic.tsx')],
  ['next/image', join(adapters, 'next-image.tsx')],
  ['@clerk/nextjs', join(adapters, 'clerk.tsx')],
]);

function tryFile(base) {
  const candidates = [
    base,
    `${base}.tsx`,
    `${base}.ts`,
    `${base}.jsx`,
    `${base}.js`,
    join(base, 'index.tsx'),
    join(base, 'index.ts'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function resolveSpec(fromFile, spec) {
  if (ALIASES.has(spec)) return ALIASES.get(spec);
  if (spec.startsWith('@/')) return tryFile(join(dashboard, spec.slice(2)));
  if (spec.startsWith('.')) return tryFile(join(dirname(fromFile), spec));
  return null;
}

function staticSpecs(source) {
  const specs = [];
  const fromRe = /^[ \t]*import(?:\s+type)?[\s\S]*?from\s+['"]([^'"]+)['"]/gm;
  const sideRe = /^[ \t]*import\s+['"]([^'"]+)['"]/gm;
  const exportRe = /^[ \t]*export\s+\{[\s\S]*?\}\s+from\s+['"]([^'"]+)['"]/gm;
  for (const re of [fromRe, sideRe, exportRe]) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(source))) {
      specs.push(match[1]);
    }
  }
  return specs;
}

function eagerFilesFrom(entryRel) {
  const visited = new Set();
  const queue = [join(root, entryRel)];
  while (queue.length) {
    const file = queue.pop();
    if (!file || visited.has(file)) continue;
    if (!existsSync(file)) continue;
    const ext = extname(file);
    if (ext === '.css' || ext === '.json') continue;
    visited.add(file);
    const source = readFileSync(file, 'utf8');
    for (const spec of staticSpecs(source)) {
      const resolved = resolveSpec(file, spec);
      if (resolved) queue.push(resolved);
    }
  }
  return [...visited];
}

test('App eager graph does not import Clerk Next or next/navigation', () => {
  const files = eagerFilesFrom('src/App.tsx');
  assert.ok(files.some((file) => file.endsWith('client-dashboard.tsx')));
  assert.ok(files.some((file) => file.endsWith('clerk.tsx')));
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(
      source,
      /from ['"]@clerk\/nextjs['"]/,
      file,
    );
    assert.doesNotMatch(
      source,
      /from ['"]next\/navigation['"]/,
      file,
    );
  }
});

test('gzip Index SPA budgets keep Streamdown off the entry chunk', {
  skip: desktopSpaDistExists() ? false : 'desktop-ui dist is not built',
}, () => {
  const summary = assertDesktopSpaBudgets(assert);
  assert.ok(summary.indexJs.gzipBytes > 0);
  assert.ok(summary.chunks.some((chunk) => chunk.name.includes('streamdown')));
});
