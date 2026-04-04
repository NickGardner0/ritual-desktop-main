import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getServerCandidates,
  isSameHeartbeat,
  replayQueuedEvents,
  shouldSendTabUpdateHeartbeat,
} from '../background-core.js';

test('getServerCandidates prioritizes active server and de-dupes', () => {
  const candidates = getServerCandidates('http://127.0.0.1:8767', [
    'http://127.0.0.1:8766',
    'http://127.0.0.1:8767',
    'http://localhost:8766',
  ]);

  assert.deepEqual(candidates, [
    'http://127.0.0.1:8767',
    'http://127.0.0.1:8766',
    'http://localhost:8766',
  ]);
});

test('isSameHeartbeat ignores queue metadata and compares tracking fields', () => {
  const a = {
    url: 'https://example.com/a',
    domain: 'example.com',
    title: 'Example A',
    document_title: 'Example A',
    visible_text_norm: 'alpha beta',
    meta_description: 'summary',
    selection_text: 'selected text',
    focused_element_text: 'search query',
    headings: ['Heading'],
    semantic_blocks: ['Selected text: selected text'],
    audible: false,
    incognito: false,
    browser_focused: true,
    idle_state: 'active',
    queued_at: 1,
  };
  const b = {
    ...a,
    queued_at: 99999,
  };

  assert.equal(isSameHeartbeat(a, b), true);
  assert.equal(isSameHeartbeat(a, { ...b, title: 'Example B' }), false);
  assert.equal(
    isSameHeartbeat(a, { ...b, semantic_blocks: ['Selected text: something else'] }),
    false
  );
});

test('replayQueuedEvents preserves unsent tail when send fails mid-queue', async () => {
  const queue = [
    { id: 'e1', timestamp_ms: 1 },
    { id: 'e2', timestamp_ms: 2 },
    { id: 'e3', timestamp_ms: 3 },
  ];

  const sent = [];
  const result = await replayQueuedEvents(queue, async (event) => {
    sent.push(event.id);
    return event.id !== 'e2';
  });

  assert.deepEqual(sent, ['e1', 'e2']);
  assert.equal(result.replayedCount, 1);
  assert.equal(result.failedAt, 1);
  assert.deepEqual(
    result.remaining.map((e) => e.id),
    ['e2', 'e3']
  );
  assert.deepEqual(
    result.remaining.map((e) => e.timestamp_ms),
    [2, 3]
  );
});

test('replayQueuedEvents clears queue when all events send', async () => {
  const queue = [{ id: 'e1' }, { id: 'e2' }];
  const result = await replayQueuedEvents(queue, async () => true);

  assert.equal(result.replayedCount, 2);
  assert.equal(result.failedAt, null);
  assert.deepEqual(result.remaining, []);
});

test('shouldSendTabUpdateHeartbeat only triggers for active-tab churn signals', () => {
  assert.equal(
    shouldSendTabUpdateHeartbeat({ url: 'https://example.com' }, { active: true }),
    true
  );
  assert.equal(
    shouldSendTabUpdateHeartbeat({ audible: true }, { active: true }),
    true
  );
  assert.equal(
    shouldSendTabUpdateHeartbeat({ status: 'complete' }, { active: true }),
    false
  );
  assert.equal(
    shouldSendTabUpdateHeartbeat({ url: 'https://example.com' }, { active: false }),
    false
  );
});
