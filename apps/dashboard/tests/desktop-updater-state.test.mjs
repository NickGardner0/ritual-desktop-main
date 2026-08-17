import assert from 'node:assert/strict';
import test from 'node:test';

import { decodeDesktopUpdateEvent, reduceDesktopUpdateEvent } from '../lib/desktop-updater-state.mjs';

const initial = {
  phase: 'available', manifest: { version: '2.0.0' }, error: null,
  percentage: 0, contentLength: 0, downloaded: 0,
};

test('V2 updater events are decoded before contradictory legacy fields', () => {
  const event = decodeDesktopUpdateEvent({ version: 2, phase: 'installing', status: 'ERROR', error: 'legacy' });
  assert.equal(event.phase, 'installing');
});

test('legacy updater payloads remain compatible', () => {
  assert.equal(decodeDesktopUpdateEvent({ status: 'DONE' }).phase, 'relaunching');
  assert.equal(decodeDesktopUpdateEvent({ status: 'UPTODATE' }).phase, 'up_to_date');
});

test('new dashboard decodes the complete old-native lifecycle matrix', () => {
  const legacyMatrix = [
    ['UPTODATE', 'up_to_date'],
    ['AVAILABLE', 'available'],
    ['PENDING', 'downloading'],
    ['DOWNLOADING', 'downloading'],
    ['INSTALLING', 'installing'],
    ['DONE', 'relaunching'],
    ['ERROR', 'error'],
  ];
  for (const [status, phase] of legacyMatrix) {
    assert.equal(decodeDesktopUpdateEvent({ status })?.phase, phase, status);
  }
});

test('new-native V2 events remain authoritative while carrying old-dashboard fields', () => {
  const v2Matrix = [
    ['up_to_date', 'UPTODATE'],
    ['available', 'AVAILABLE'],
    ['downloading', 'DOWNLOADING'],
    ['installing', 'INSTALLING'],
    ['relaunching', 'DONE'],
    ['error', 'ERROR'],
  ];
  for (const [phase, status] of v2Matrix) {
    const decoded = decodeDesktopUpdateEvent({
      version: 2,
      phase,
      status,
      message: phase === 'error' ? 'v2 error' : null,
      error: phase === 'error' ? 'legacy error' : null,
    });
    assert.equal(decoded?.phase, phase);
    if (phase === 'error') assert.equal(decoded?.message, 'v2 error');
  }
  assert.equal(decodeDesktopUpdateEvent({ version: 3, phase: 'installing' }), null);
});

test('reducer clears fields that are invalid for terminal phases', () => {
  const failed = reduceDesktopUpdateEvent(
    { ...initial, percentage: 72, contentLength: 100, downloaded: 72 },
    { version: 2, phase: 'error', message: 'signature failure' },
  );
  assert.deepEqual(
    { phase: failed.phase, error: failed.error, percentage: failed.percentage, contentLength: failed.contentLength, downloaded: failed.downloaded },
    { phase: 'error', error: 'signature failure', percentage: 0, contentLength: 0, downloaded: 0 },
  );
});
