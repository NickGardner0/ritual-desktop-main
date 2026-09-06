import assert from 'node:assert/strict';
import test from 'node:test';

import { AnalyticsLoader } from '../lib/analytics-loader.mjs';

test('deduplicates concurrent analytics requests by key', async () => {
  const loader = new AnalyticsLoader();
  let calls = 0;
  const request = async () => {
    calls += 1;
    await Promise.resolve();
    return { rows: [1] };
  };
  const [first, second] = await Promise.all([
    loader.load({ scope: 'cards', key: 'range-1', request }),
    loader.load({ scope: 'bars', key: 'range-1', request }),
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(first, second);
});

test('serves fresh cached results without a second request', async () => {
  const loader = new AnalyticsLoader();
  let calls = 0;
  const request = async () => ++calls;
  assert.equal(await loader.load({ scope: 'cards', key: 'range-1', request }), 1);
  assert.equal(await loader.load({ scope: 'cards', key: 'range-1', request }), 1);
  assert.equal(calls, 1);
});

test('aborts an obsolete request when its last scope moves to a new key', async () => {
  const loader = new AnalyticsLoader();
  let aborted = false;
  const obsolete = loader.load({
    scope: 'cards',
    key: 'old',
    request: (signal) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => {
        aborted = true;
        reject(new DOMException('Aborted', 'AbortError'));
      });
    }),
  });
  await Promise.resolve();
  const current = loader.load({ scope: 'cards', key: 'new', request: async () => 'new' });
  await assert.rejects(obsolete, { name: 'AbortError' });
  assert.equal(await current, 'new');
  assert.equal(aborted, true);
});
