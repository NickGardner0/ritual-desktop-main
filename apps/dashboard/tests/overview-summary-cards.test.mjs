import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const source = readFileSync(
  join(repo, 'apps/dashboard/components/analytics/overview-fetch-block.tsx'),
  'utf8',
);
const section = readFileSync(
  join(repo, 'apps/dashboard/components/analytics/overview-initial-section.tsx'),
  'utf8',
);
const analytics = readFileSync(
  join(repo, 'apps/dashboard/components/analytics/unified-analytics-client.tsx'),
  'utf8',
);

test('Index uses a fetch dossier instead of summary cards', () => {
  assert.match(source, /from '@ritual\/ui\/separator'/);
  assert.match(source, /<Separator/);
  assert.match(source, /label: 'Today'/);
  assert.match(source, /label: 'Streak'/);
  assert.match(source, /label: 'Most tracked'/);
  assert.match(source, /label: 'This week'/);
  assert.match(source, /label: 'Sleep'/);
  assert.match(source, /label: 'Computer'/);
  assert.match(source, /FetchSpark/);
  assert.match(source, /<polyline/);
  assert.match(section, /<OverviewFetchBlock/);
  assert.match(section, /max-w-\[408px\]/);
  assert.doesNotMatch(section, /max-w-3xl/);
  assert.doesNotMatch(section, /OverviewSummaryCards/);
  assert.doesNotMatch(section, /LayoutGrid/);
  assert.doesNotMatch(analytics, /setOverviewViewMode\('summary'\)/);
  assert.doesNotMatch(analytics, /<span>Card<\/span>/);
  assert.doesNotMatch(source, /from '@ritual\/ui\/card'/);
  assert.doesNotMatch(source, /from 'recharts'/);
  assert.doesNotMatch(source, /You haven.?t logged anything yet today/);
  assert.doesNotMatch(source, /neofetch|fastfetch|obsifetch/i);
  assert.doesNotMatch(source, /#27251E/);
  assert.doesNotMatch(source, /min-h-\[110px\]/);
});
