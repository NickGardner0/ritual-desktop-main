import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  AssistantKernel,
  MemoryAssistantTurnStore,
  handleChatStreamRequest,
  setAssistantTurnStoreForTests,
} from '../dist/index.js';

function runningRecord(overrides = {}) {
  const now = new Date().toISOString();
  return {
    id: 'turn-in-flight',
    conversationId: 'conv-1',
    channel: 'dashboard',
    status: 'running',
    epoch: 1,
    sequence: 1,
    receiptIds: [],
    assistantText: null,
    toolPayload: null,
    error: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    ...overrides,
  };
}

afterEach(() => {
  setAssistantTurnStoreForTests(null);
});

test('client disconnect cancels the turn before model work and does not complete', async () => {
  const store = new MemoryAssistantTurnStore();
  setAssistantTurnStoreForTests(store);
  const signal = AbortSignal.abort();
  const response = await handleChatStreamRequest({
    token: 'test-token',
    body: {
      messages: [{ role: 'user', content: 'log water' }],
      conversationId: 'conv-1',
      turnId: 'turn-abort',
      epoch: 1,
    },
    signal,
  });
  assert.equal(response.status, 409);
  const body = JSON.parse(await response.text());
  assert.equal(body.error, 'Turn canceled');
  const stored = await store.get('turn-abort');
  assert.equal(stored?.status, 'canceled');
  assert.equal(stored?.assistantText, null);
});

test('duplicate delivery of an in-flight turn does not start a second loop', async () => {
  const store = new MemoryAssistantTurnStore();
  setAssistantTurnStoreForTests(store);
  await store.put(runningRecord({ id: 'turn-dup' }));
  const response = await handleChatStreamRequest({
    token: 'test-token',
    body: {
      messages: [{ role: 'user', content: 'log water' }],
      conversationId: 'conv-1',
      turnId: 'turn-dup',
      epoch: 1,
    },
  });
  assert.equal(response.status, 409);
  const body = JSON.parse(await response.text());
  assert.equal(body.error, 'Turn in flight');
  const stored = await store.get('turn-dup');
  assert.equal(stored?.status, 'running');
});

test('conversation switch (stale epoch) cancels instead of mutating', async () => {
  const store = new MemoryAssistantTurnStore();
  const kernel = new AssistantKernel();
  await kernel.begin({
    turnId: 'turn-switch',
    conversationId: 'conv-1',
    channel: 'dashboard',
    epoch: 1,
    store,
  });
  const canceled = await kernel.begin({
    turnId: 'turn-switch',
    conversationId: 'conv-1',
    channel: 'dashboard',
    epoch: 2,
    store,
  });
  assert.equal(canceled.status, 'canceled');
  assert.equal(canceled.error, 'stale_epoch');
  setAssistantTurnStoreForTests(store);
  const response = await handleChatStreamRequest({
    token: 'test-token',
    body: {
      messages: [{ role: 'user', content: 'ignore me' }],
      conversationId: 'conv-1',
      turnId: 'turn-switch',
      epoch: 2,
    },
  });
  assert.equal(response.status, 409);
  assert.equal((await store.get('turn-switch'))?.status, 'canceled');
});

test('provider timeout fails the turn and a retry requeues the same id', async () => {
  const store = new MemoryAssistantTurnStore();
  const kernel = new AssistantKernel();
  const queued = await kernel.begin({
    turnId: 'turn-timeout',
    conversationId: 'conv-1',
    channel: 'dashboard',
    epoch: 1,
    store,
  });
  const running = await kernel.transition(queued, 'running', store);
  await kernel.fail(running, store, new Error('provider timeout'));
  const retried = await kernel.begin({
    turnId: 'turn-timeout',
    conversationId: 'conv-1',
    channel: 'dashboard',
    epoch: 1,
    store,
  });
  assert.equal(retried.status, 'queued');
  assert.equal(retried.id, 'turn-timeout');
});
