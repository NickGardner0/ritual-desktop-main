import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canTransitionAssistantTurn,
  isTerminalTurnStatus,
  mutationClientEventId,
} from '../dist/assistant-turn.js';
import { AssistantKernel, AssistantSessionBusyError } from '../dist/assistant-kernel.js';
import { MemoryAssistantTurnStore } from '../dist/assistant-turn-store.js';
import { planToolBatch, mapInBatchMode } from '../dist/tool-batch.js';
import { getToolSideEffect } from '../dist/tool-registry.js';

test('turn states only allow the documented transitions', () => {
  assert.equal(canTransitionAssistantTurn('queued', 'running'), true);
  assert.equal(canTransitionAssistantTurn('running', 'committing'), true);
  assert.equal(canTransitionAssistantTurn('committing', 'completed'), true);
  assert.equal(canTransitionAssistantTurn('queued', 'canceled'), true);
  assert.equal(canTransitionAssistantTurn('running', 'failed_retryable'), true);
  assert.equal(canTransitionAssistantTurn('completed', 'running'), false);
  assert.equal(canTransitionAssistantTurn('canceled', 'queued'), false);
  assert.equal(isTerminalTurnStatus('completed'), true);
  assert.equal(isTerminalTurnStatus('canceled'), true);
  assert.equal(isTerminalTurnStatus('failed_retryable'), false);
});

test('retry of a completed turn replays instead of re-running', async () => {
  const store = new MemoryAssistantTurnStore();
  const kernel = new AssistantKernel();
  const first = await kernel.begin({
    turnId: 'turn-1',
    conversationId: 'conv-1',
    channel: 'dashboard',
    epoch: 1,
    store,
  });
  const running = await kernel.transition(first, 'running', store);
  const committing = await kernel.transition(running, 'committing', store, {
    assistantText: 'hello',
    receiptIds: ['r1'],
  });
  await kernel.transition(committing, 'completed', store);

  const replay = await kernel.begin({
    turnId: 'turn-1',
    conversationId: 'conv-1',
    channel: 'dashboard',
    epoch: 1,
    store,
  });
  assert.equal(replay.status, 'completed');
  assert.equal(replay.assistantText, 'hello');
  assert.deepEqual(replay.receiptIds, ['r1']);
});

test('stale epoch is rejected without changing an accepted turn', async () => {
  const store = new MemoryAssistantTurnStore();
  const kernel = new AssistantKernel();
  await kernel.begin({
    turnId: 'turn-2',
    conversationId: 'conv-1',
    channel: 'dashboard',
    epoch: 1,
    store,
  });
  await assert.rejects(
    () => kernel.begin({
      turnId: 'turn-2',
      conversationId: 'conv-1',
      channel: 'dashboard',
      epoch: 2,
      userMessage: 'different epoch',
      store,
    }),
    /epoch mismatch/,
  );
  assert.equal((await store.get('turn-2'))?.status, 'queued');
});

test('one conversation has at most one active mutation sequence', () => {
  const kernel = new AssistantKernel();
  const turnA = {
    id: 'a',
    conversationId: 'conv-1',
    channel: 'dashboard',
    status: 'running',
    epoch: 1,
    sequence: 1,
    receiptIds: [],
    assistantText: null,
    toolPayload: null,
    error: null,
    createdAt: '',
    updatedAt: '',
    completedAt: null,
  };
  const turnB = { ...turnA, id: 'b' };
  kernel.acquireMutation(turnA);
  assert.throws(() => kernel.acquireMutation(turnB), AssistantSessionBusyError);
  kernel.releaseMutation(turnA);
  kernel.acquireMutation(turnB);
});

test('mutating tools are serial; read-only tools may run concurrently', () => {
  assert.equal(getToolSideEffect('logHabit'), 'mutating');
  assert.equal(getToolSideEffect('createHabit'), 'mutating');
  assert.equal(getToolSideEffect('getHabitStats'), 'read_only');
  assert.equal(getToolSideEffect('unknownTool'), 'mutating');
  assert.equal(planToolBatch(['getHabitStats', 'listHabits']), 'parallel');
  assert.equal(planToolBatch(['getHabitStats', 'logHabit']), 'serial');
});

test('serial batches preserve declared mutation order', async () => {
  const started = [];
  const finished = [];
  await mapInBatchMode(['a', 'b', 'c'], 'serial', async (item) => {
    started.push(item);
    await new Promise((resolve) => setTimeout(resolve, item === 'a' ? 20 : 0));
    finished.push(item);
    return item;
  });
  assert.deepEqual(started, ['a', 'b', 'c']);
  assert.deepEqual(finished, ['a', 'b', 'c']);
});

test('failed turns retry into queued instead of remaining failed', async () => {
  const store = new MemoryAssistantTurnStore();
  const kernel = new AssistantKernel();
  const queued = await kernel.begin({
    turnId: 'turn-3',
    conversationId: 'conv-1',
    channel: 'dashboard',
    epoch: 1,
    store,
  });
  const running = await kernel.transition(queued, 'running', store);
  await kernel.fail(running, store, new Error('provider timeout'));
  const retried = await kernel.begin({
    turnId: 'turn-3',
    conversationId: 'conv-1',
    channel: 'dashboard',
    epoch: 1,
    store,
  });
  assert.equal(retried.status, 'queued');
  assert.equal(retried.error, null);
});

test('retries reuse a stable mutation idempotency key', () => {
  assert.equal(mutationClientEventId('turn-1', 'call-9'), 'turn-1:call-9');
});

test('abort cancels a running turn instead of completing it', async () => {
  const store = new MemoryAssistantTurnStore();
  const kernel = new AssistantKernel();
  const queued = await kernel.begin({
    turnId: 'turn-cancel',
    conversationId: 'conv-1',
    channel: 'dashboard',
    epoch: 1,
    store,
  });
  const running = await kernel.transition(queued, 'running', store);
  const canceled = await kernel.cancel(running, store, 'client_disconnected');
  assert.equal(canceled.status, 'canceled');
  const committed = await kernel.commit(canceled, store, 1, { assistantText: 'should not land' });
  assert.equal(committed.status, 'canceled');
  assert.equal(committed.assistantText, null);
});

test('stale in-flight turns reclaim into queued after process death', async () => {
  const store = new MemoryAssistantTurnStore();
  const kernel = new AssistantKernel();
  const queued = await kernel.begin({
    turnId: 'turn-stale',
    conversationId: 'conv-1',
    channel: 'dashboard',
    epoch: 1,
    store,
  });
  const running = await kernel.transition(queued, 'running', store);
  const staleAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  await store.put({ ...running, updatedAt: staleAt });
  const reclaimed = await kernel.begin({
    turnId: 'turn-stale',
    conversationId: 'conv-1',
    channel: 'dashboard',
    epoch: 1,
    store,
  });
  assert.equal(reclaimed.status, 'queued');
  assert.equal(reclaimed.error, null);
});

test('out-of-order completion cannot restart a completed turn', async () => {
  const store = new MemoryAssistantTurnStore();
  const kernel = new AssistantKernel();
  const queued = await kernel.begin({
    turnId: 'turn-order',
    conversationId: 'conv-1',
    channel: 'dashboard',
    epoch: 1,
    store,
  });
  const running = await kernel.transition(queued, 'running', store);
  const committing = await kernel.transition(running, 'committing', store);
  const completed = await kernel.transition(committing, 'completed', store);
  await assert.rejects(
    () => kernel.transition(completed, 'running', store),
    /Illegal assistant turn transition/,
  );
});
