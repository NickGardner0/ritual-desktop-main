import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const source = readFileSync(
  join(repo, 'apps/dashboard/components/analytics/overview-summary-cards.tsx'),
  'utf8',
);

test('Index card view uses Ritual Card and Midday-style value + detail', () => {
  assert.match(source, /from '@ritual\/ui\/card'/);
  assert.match(source, /<Card/);
  assert.match(source, /density="compact"/);
  assert.match(source, /items-baseline/);
  assert.match(source, /text-\[22px\] font-medium/);
  assert.match(source, /text-\[var\(--text-muted\)\]/);
  assert.match(source, /text-\[var\(--text-primary\)\]/);
  assert.doesNotMatch(source, /You haven.?t logged anything yet today/);
  assert.doesNotMatch(source, /border-\[#e6e6e6\]/);
  assert.doesNotMatch(source, /#27251E/);
  assert.doesNotMatch(source, /recharts/);
  assert.doesNotMatch(source, /hover:bg-\[var\(--surface-panel\)\]/);
});
