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
const section = readFileSync(
  join(repo, 'apps/dashboard/components/analytics/overview-initial-section.tsx'),
  'utf8',
);

test('Index card view stays compact and uses spark charts for series metrics', () => {
  assert.match(source, /from '@ritual\/ui\/card'/);
  assert.match(source, /<Card/);
  assert.match(source, /density="compact"/);
  assert.match(source, /min-h-\[110px\]/);
  assert.match(source, /text-xl font-medium/);
  assert.match(source, /PerplexityMiniSparkChart/);
  assert.match(source, /label="This week"/);
  assert.match(source, /label="Sleep"/);
  assert.match(source, /label="Computer"/);
  assert.match(section, /max-w-3xl/);
  assert.doesNotMatch(section, /max-w-\[1040px\]/);
  assert.doesNotMatch(source, /You haven.?t logged anything yet today/);
  assert.doesNotMatch(source, /border-\[#e6e6e6\]/);
  assert.doesNotMatch(source, /#27251E/);
  assert.doesNotMatch(source, /min-h-\[128px\]/);
  assert.doesNotMatch(source, /from 'recharts'/);
});
