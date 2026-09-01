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
const layout = readFileSync(
  join(repo, 'apps/dashboard/components/analytics/overview/OverviewView.tsx'),
  'utf8',
);
const prefs = readFileSync(
  join(repo, 'apps/dashboard/hooks/use-ui-preferences.ts'),
  'utf8',
);

test('Index keeps fetch as a selectable view and list as the default habit list', () => {
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
  assert.match(prefs, /DEFAULT_OVERVIEW_VIEW_MODE: OverviewViewMode = 'list'/);
  assert.match(section, /isFetchView = overviewViewMode === 'summary'/);
  assert.match(section, /<span>Fetch<\/span>/);
  assert.match(section, /isFetchView \? \(/);
  assert.match(section, /<OverviewFetchBlock/);
  assert.match(section, /<SortableHabitList/);
  assert.match(section, /flex h-full min-h-0 flex-col/);
  assert.match(section, /min-h-0 flex-1 overflow-y-auto/);
  assert.match(section, /max-w-\[408px\]/);
  assert.match(layout, /flex h-\[calc\(100vh-160px\)\] min-h-0 flex-col/);
  assert.match(analytics, /setOverviewViewMode\('summary'\)/);
  assert.match(analytics, /<OverviewViewMenuItems/);
  assert.doesNotMatch(section, /<span>Card<\/span>/);
  assert.doesNotMatch(analytics, /<span>Card<\/span>/);
  assert.doesNotMatch(section, /OverviewSummaryCards/);
  assert.doesNotMatch(source, /from '@ritual\/ui\/card'/);
  assert.doesNotMatch(source, /from 'recharts'/);
  assert.doesNotMatch(source, /You haven.?t logged anything yet today/);
  assert.doesNotMatch(source, /neofetch|fastfetch|obsifetch/i);
  assert.doesNotMatch(source, /#27251E/);
  assert.doesNotMatch(source, /min-h-\[110px\]/);
});
