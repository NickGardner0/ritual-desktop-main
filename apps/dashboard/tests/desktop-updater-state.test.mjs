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
