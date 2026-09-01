import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const dashboardRoot = new URL('../', import.meta.url);

function read(path) {
  return readFileSync(new URL(path, dashboardRoot), 'utf8');
}

function sliceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `Missing start marker: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `Missing end marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test('Apple Screen Time card is active and directly follows Computer Use', () => {
  const registrySource = read('app/(dashboard)/integrations/plugins/registry.ts');
  const orderedRegistry = sliceBetween(
    registrySource,
    'export const INTEGRATION_PLUGINS = [',
    '] satisfies readonly IntegrationPlugin[];',
  );
  const iphoneCardSource = read('app/(dashboard)/integrations/plugins/iphone-time/card.tsx');
  const computerCardSource = read('app/(dashboard)/integrations/plugins/computer-tracking/card.tsx');

  const computerIndex = orderedRegistry.indexOf('computerTracking');
  const screenTimeIndex = orderedRegistry.indexOf('iphoneTime');
  const appleWatchIndex = orderedRegistry.indexOf('appleHealth');

  assert.ok(computerIndex >= 0, 'Computer Use should exist in the integration registry');
  assert.ok(screenTimeIndex >= 0, 'Apple Screen Time should exist in the integration registry');
  assert.ok(appleWatchIndex >= 0, 'Apple Watch should exist in the integration registry');
  assert.ok(computerIndex < screenTimeIndex, 'Apple Screen Time should come after Computer Use');
  assert.ok(screenTimeIndex < appleWatchIndex, 'Apple Screen Time should be in the first row before Apple Watch');

  assert.match(computerCardSource, /id:\s*'computer'/);
  assert.match(computerCardSource, /connectLabel=\{computerTrackingRegistered \? 'Start' : 'Connect'\}/);
  assert.match(computerCardSource, /Not running/);
  assert.match(computerCardSource, /handleComputerTrackingConnect/);
  assert.match(iphoneCardSource, /id:\s*'apple-screen-time'/);
  assert.match(iphoneCardSource, /title:\s*'Apple Screen Time'/);
  assert.match(iphoneCardSource, /IPHONE_TIME_CARD_DESCRIPTION/);
  assert.doesNotMatch(iphoneCardSource, /comingSoon/);
  assert.match(iphoneCardSource, /onConnect=\{handleIphoneTimeConnect/);
  assert.match(iphoneCardSource, /onSync=\{handleIphoneTimeSync/);
});

test('iPhone Time status model includes required states and user-facing warning', () => {
  const sharedSource = read('app/(dashboard)/integrations/integrations-client.shared.helpers.tsx');

  assert.match(
    sharedSource,
    /Track your iPhone screen time and app usage by syncing across devices\./,
  );
  assert.match(
    sharedSource,
    /Ritual can only read iPhone Screen Time if this Mac user is signed into the same iCloud account/,
  );

  for (const status of [
    'not_desktop',
    'watcher_not_running',
    'waiting_for_icloud_sync',
    'source_ready',
    'queued',
    'syncing',
    'connected',
    'error',
  ]) {
    assert.match(sharedSource, new RegExp(`'${status}'`), `Missing iPhone Time status: ${status}`);
  }
});

test('iPhone Time details panel exposes diagnostics and bridge import instructions', () => {
  const detailsSource = read('app/(dashboard)/integrations/plugins/iphone-time/detail-panel.tsx');

  assert.match(detailsSource, /Current status/);
  assert.match(detailsSource, /Last imported date/);
  assert.match(detailsSource, /Total imported events/);
  assert.match(detailsSource, /Outbox count/);
  assert.match(detailsSource, /Local Biome files/);
  assert.match(detailsSource, /Last drain/);
  assert.match(detailsSource, /Using a different iCloud account\?/);
  assert.match(
    detailsSource,
    /\/Users\/Shared\/ritual-watcher-biome-diagnostic --biome-export-jsonl \/Users\/Shared\/ritual-biome-iphone-export\.jsonl/,
  );
  assert.match(detailsSource, /Import Export File/);
});
