import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '../../..');

function read(rel) {
  return readFileSync(join(repo, rel), 'utf8');
}

test('Index list greeting copies Midday ticker behavior with Waldenburg', () => {
  const header = read('apps/dashboard/components/analytics/overview-welcome-header.tsx');
  const section = read('apps/dashboard/components/analytics/overview-initial-section.tsx');
  const css = read('apps/dashboard/app/globals.css');
  const copy = read('apps/dashboard/components/analytics/overview-welcome.ts');

  assert.match(section, /<OverviewWelcomeHeader align="start"/);
  assert.match(section, /<OverviewFetchBlock/);
  assert.match(section, /<SortableHabitList/);
  assert.doesNotMatch(section, /isSummaryView/);
  assert.doesNotMatch(section, /OverviewSummaryCards/);
  assert.doesNotMatch(section, /setOverviewViewMode/);
  assert.match(header, /align === 'start' \? 'text-left' : 'text-center'/);
  assert.match(header, /ritual-index-greeting/);
  assert.match(header, /text-\[28px\]/);
  assert.match(header, /h-\[2px\] w-4/);
  assert.match(header, /onMouseEnter=\{\(\) => goTo\(insightIndex\)\}/);
  assert.match(header, /WELCOME_TICK_DURATION_MS/);
  assert.match(header, /AnimatePresence mode="wait"/);
  assert.match(header, /filter: 'blur\(4px\)'/);
  assert.match(header, /user\?\.firstName/);
  assert.doesNotMatch(header, /font-serif/);
  assert.doesNotMatch(copy, /runway/);
  assert.doesNotMatch(copy, /invoice/);
  assert.match(copy, /Good morning/);
  assert.match(copy, /Good afternoon/);
  assert.match(copy, /Good evening/);
  assert.match(copy, /hour >= 5 && hour < 12/);
  assert.match(copy, /hour >= 12 && hour < 17/);
  assert.match(css, /html body \.ritual-index-greeting/);
  assert.match(css, /font-family: var\(--ritual-font-waldenburg\) !important;/);
  assert.match(css, /:not\(\.ritual-index-greeting \*\)/);
});
