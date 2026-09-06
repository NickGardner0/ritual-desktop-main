import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  AssistantKernel,
  DurableAssistantTurnStore,
  getAssistantTurnStore,
  MemoryAssistantTurnStore,
  handleChatStreamRequest,
  setOpenAIClientForTests,
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
    userMessageId: 'turn-in-flight:user',
    userMessageText: 'log water',
    acceptedAt: now,
    commitVersion: 0,
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
  setOpenAIClientForTests(null);
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

test('conversation switch rejects a mismatched accepted epoch instead of mutating', async () => {
  const store = new MemoryAssistantTurnStore();
  const kernel = new AssistantKernel();
  await kernel.begin({
    turnId: 'turn-switch',
    conversationId: 'conv-1',
    channel: 'dashboard',
    epoch: 1,
    store,
  });
  await assert.rejects(
    () => kernel.begin({
      turnId: 'turn-switch',
      conversationId: 'conv-1',
      channel: 'dashboard',
      epoch: 2,
      userMessage: 'ignore me',
      store,
    }),
    /epoch mismatch/,
  );
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
  assert.equal(response.status, 500);
  assert.equal((await store.get('turn-switch'))?.status, 'queued');
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

test('authoritative acceptance failure stops before provider or tool execution', async () => {
  let acceptCalls = 0;
  const unavailableStore = {
    async accept() {
      acceptCalls += 1;
      throw new Error('authoritative persistence unavailable');
    },
    async get() { throw new Error('unexpected get'); },
    async put() { throw new Error('unexpected transition'); },
    async commit() { throw new Error('unexpected commit'); },
    async nextSequence() { throw new Error('unexpected sequence'); },
  };
  setAssistantTurnStoreForTests(unavailableStore);
  const response = await handleChatStreamRequest({
    token: 'test-token',
    body: {
      messages: [{ role: 'user', content: 'do not run this' }],
      conversationId: 'conv-1',
      turnId: 'turn-unaccepted',
      epoch: 1,
    },
  });
  assert.equal(response.status, 500);
  assert.equal(acceptCalls, 1);
  assert.match((await response.json()).details, /authoritative persistence unavailable/);
});

test('durable store never substitutes local success for a remote failure', async () => {
  const local = new MemoryAssistantTurnStore();
  const accepted = await local.accept({
    turnId: 'turn-local-only',
    conversationId: 'conv-1',
    channel: 'dashboard',
    epoch: 1,
    userMessage: 'local copy',
    responseMode: 'text',
  });
  const remote = {
    async accept() { throw new Error('remote accept failed'); },
    async get() { throw new Error('remote get failed'); },
    async put() { throw new Error('remote put failed'); },
    async commit() { throw new Error('remote commit failed'); },
    async nextSequence() { throw new Error('remote sequence failed'); },
  };
  const durable = new DurableAssistantTurnStore(remote, local);
  await assert.rejects(() => durable.get(accepted.id), /remote get failed/);
  await assert.rejects(() => durable.put({ ...accepted, status: 'running' }), /remote put failed/);
  await assert.rejects(
    () => durable.accept({
      turnId: 'turn-new',
      conversationId: 'conv-1',
      channel: 'dashboard',
      epoch: 1,
      userMessage: 'must be remote',
      responseMode: 'text',
    }),
    /remote accept failed/,
  );
  await assert.rejects(() => durable.nextSequence('conv-1'), /remote sequence failed/);
  assert.equal((await local.get(accepted.id))?.status, 'queued');
  assert.equal(await local.get('turn-new'), null);
});

test('memory-only turn storage cannot be enabled in a production runtime', () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousStore = process.env.RITUAL_ASSISTANT_TURN_STORE;
  try {
    process.env.NODE_ENV = 'production';
    process.env.RITUAL_ASSISTANT_TURN_STORE = 'memory';
    assert.ok(getAssistantTurnStore('token') instanceof DurableAssistantTurnStore);
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
    process.env.RITUAL_ASSISTANT_TURN_STORE = previousStore;
  }
});

test('provider failure leaves the accepted turn retryable and rejects the stream', async () => {
  const store = new MemoryAssistantTurnStore();
  setAssistantTurnStoreForTests(store);
  setOpenAIClientForTests({
    chat: {
      completions: {
        async create() {
          throw new Error('provider unavailable');
        },
      },
    },
  });
  const response = await handleChatStreamRequest({
    token: 'test-token',
    body: {
      messages: [{ role: 'user', content: 'try a provider call' }],
      conversationId: 'conv-1',
      turnId: 'turn-provider-down',
      epoch: 1,
    },
  });
  assert.equal(response.status, 200);
  await assert.rejects(() => response.text(), /provider unavailable/);
  const stored = await store.get('turn-provider-down');
  assert.equal(stored?.status, 'failed_retryable');
  assert.equal(stored?.assistantText, null);
});
