import test from 'node:test';
import assert from 'node:assert/strict';

import {
  acknowledgeOutboxHead,
  createSerializedExecutor,
  enqueueOutboxEvent,
  getServerCandidates,
  hydrateOutboxState,
  isSameHeartbeat,
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

test('hydrateOutboxState migrates the legacy queue and preserves versioned retry state', () => {
  assert.deepEqual(hydrateOutboxState(null, [{ id: 'legacy' }]), {
    version: 1,
    pending: [{ id: 'legacy' }],
    reconnectAttempts: 0,
    retryAt: 0,
  });

  assert.deepEqual(
    hydrateOutboxState({
      version: 1,
      pending: [{ id: 'current' }],
      reconnectAttempts: 3,
      retryAt: 400,
    }, [{ id: 'legacy' }]),
    {
      version: 1,
      pending: [{ id: 'current' }],
      reconnectAttempts: 3,
      retryAt: 400,
    }
  );
});

test('serialized outbox commit cannot overwrite an enqueue that arrives during replay', async () => {
  let stored = hydrateOutboxState(null, [{ id: 'e1', url: 'https://one.test' }]);
  const serialize = createSerializedExecutor();
  let releaseSend;
  const sendBlocked = new Promise((resolve) => { releaseSend = resolve; });

  const replay = serialize(async () => {
    const snapshot = stored;
    await sendBlocked;
    stored = acknowledgeOutboxHead(snapshot);
  });
  const enqueue = serialize(async () => {
    stored = enqueueOutboxEvent(stored, { id: 'e2', url: 'https://two.test' }, 50, 2);
  });

  releaseSend();
  await Promise.all([replay, enqueue]);
  assert.deepEqual(stored.pending.map((event) => event.id), ['e2']);
});

test('enqueueOutboxEvent de-dupes adjacent heartbeats and retains the newest bounded set', () => {
  let state = hydrateOutboxState(null);
  state = enqueueOutboxEvent(state, { id: 'a', url: 'https://one.test' }, 2, 1);
  state = enqueueOutboxEvent(state, { id: 'duplicate', url: 'https://one.test' }, 2, 2);
  state = enqueueOutboxEvent(state, { id: 'b', url: 'https://two.test' }, 2, 3);
  state = enqueueOutboxEvent(state, { id: 'c', url: 'https://three.test' }, 2, 4);

  assert.deepEqual(state.pending.map((event) => event.id), ['b', 'c']);
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
