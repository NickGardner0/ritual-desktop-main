/**
 * Tests for the @ritual/agent loop: idempotency, crash-before-execute,
 * approval resume, after=seq replay.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MemorySessionStore } from '../dist/store-memory.js';
import { admit, run, resumeAfterApproval } from '../dist/loop.js';
import { defineTool } from '../dist/types.js';

// ---------------------------------------------------------------------------
// Fake model engine — returns predictable responses
// ---------------------------------------------------------------------------

function fakeModel(responses) {
  let callIndex = 0;
  return {
    stream(input) {
      const response = responses[callIndex++] ?? { text: 'done', toolCalls: [] };
      return {
        async *[Symbol.asyncIterator]() {
          if (response.text) {
            yield { type: 'text_delta', text: response.text };
          }
          if (response.toolCalls) {
            for (let i = 0; i < response.toolCalls.length; i++) {
              const tc = response.toolCalls[i];
              yield {
                type: 'tool_call_delta',
                index: i,
                id: tc.id,
                name: tc.name,
                arguments: JSON.stringify(tc.arguments ?? {}),
              };
            }
          }
          yield { type: 'done', finishReason: 'stop' };
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

const readTool = defineTool({
  name: 'listHabits',
  description: 'List habits',
  parameters: { type: 'object', properties: {} },
  sideEffect: 'read_only',
  execute: async () => JSON.stringify({ habits: ['sleep', 'water'] }),
});

const mutateTool = defineTool({
  name: 'logHabit',
  description: 'Log a habit',
  parameters: { type: 'object', properties: { habitName: { type: 'string' } }, required: ['habitName'] },
  sideEffect: 'mutating',
  execute: async () => JSON.stringify({ receipt_id: 'r1', action_kind: 'logHabit', habit_id: 'h1', habit_name: 'sleep', was_inserted: true, undoable: true }),
  toReceipt: (result) => {
    try { const p = JSON.parse(result); return p.receipt_id ? p : null; } catch { return null; }
  },
  toEntityRefs: (result) => {
    try {
      const p = JSON.parse(result);
      const refs = [];
      if (p.habit_id) refs.push({ type: 'habit', id: p.habit_id, title: p.habit_name });
      return refs;
    } catch { return []; }
  },
});

const tools = [readTool, mutateTool];
const systemPrompt = () => 'You are Ritual.';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('@ritual/agent loop', () => {
  let store;

  beforeEach(() => {
    store = new MemorySessionStore();
  });

  it('admit is idempotent by commandId', async () => {
    const config = { store, model: fakeModel([]), tools, systemPrompt };
    const r1 = await admit(config, 'sess1', 'user1', 'cmd1', 'hello');
    assert.equal(r1.alreadyAdmitted, false);
    assert.equal(r1.seq, 1);

    const r2 = await admit(config, 'sess1', 'user1', 'cmd1', 'hello again');
    assert.equal(r2.alreadyAdmitted, true);
    assert.equal(r2.seq, 1);

    const items = await store.getItems('sess1');
    assert.equal(items.length, 1);
    assert.equal(items[0].payload.text, 'hello');
  });

  it('read-only tool executes without approval', async () => {
    const model = fakeModel([
      { toolCalls: [{ id: 'tc1', name: 'listHabits', arguments: {} }] },
      { text: 'You track sleep and water.' },
    ]);
    const config = { store, model, tools, systemPrompt };
    await admit(config, 's1', 'u1', 'c1', 'list my habits');

    const result = await run(config, 's1');
    assert.equal(result.pausedForApproval, undefined);

    const items = await store.getItems('s1');
    const types = items.map((i) => i.type);
    assert.deepEqual(types, ['user', 'tool_called', 'tool_result', 'assistant_text']);
  });

  it('mutating tool pauses for approval', async () => {
    const model = fakeModel([
      { toolCalls: [{ id: 'tc1', name: 'logHabit', arguments: { habitName: 'sleep' } }] },
    ]);
    const config = { store, model, tools, systemPrompt };
    await admit(config, 's1', 'u1', 'c1', 'log 8 hours sleep');

    const result = await run(config, 's1');
    assert.equal(result.pausedForApproval, true);

    const items = await store.getItems('s1');
    const types = items.map((i) => i.type);
    assert.deepEqual(types, ['user', 'tool_called', 'approval_ask']);
  });

  it('approval resume executes tool and continues loop', async () => {
    const callCount = { n: 0 };
    const trackingMutateTool = defineTool({
      ...mutateTool,
      execute: async () => {
        callCount.n++;
        return JSON.stringify({ receipt_id: 'r1', action_kind: 'logHabit', habit_id: 'h1', habit_name: 'sleep', was_inserted: true });
      },
    });

    const model = fakeModel([
      { toolCalls: [{ id: 'tc1', name: 'logHabit', arguments: { habitName: 'sleep' } }] },
      // After approval+execute, the loop continues and the model finishes
      { text: 'Logged sleep!' },
    ]);
    const config = { store, model, tools: [readTool, trackingMutateTool], systemPrompt };
    await admit(config, 's1', 'u1', 'c1', 'log sleep');

    const r1 = await run(config, 's1');
    assert.equal(r1.pausedForApproval, true);
    assert.equal(callCount.n, 0); // not yet executed

    const items = await store.getItems('s1');
    const askItem = items.find((i) => i.type === 'approval_ask');

    const r2 = await resumeAfterApproval(config, 's1', askItem.seq, 'allow');
    assert.equal(callCount.n, 1); // now executed
    assert.equal(r2.pausedForApproval, undefined);

    const allItems = await store.getItems('s1');
    const types = allItems.map((i) => i.type);
    assert.ok(types.includes('approval'));
    assert.ok(types.includes('tool_result'));
    assert.ok(types.includes('assistant_text'));
  });

  it('denial sends error to model and continues', async () => {
    const model = fakeModel([
      { toolCalls: [{ id: 'tc1', name: 'logHabit', arguments: { habitName: 'sleep' } }] },
      // After denial, model gets the error and responds
      { text: 'OK, I won\'t log that.' },
    ]);
    const config = { store, model, tools, systemPrompt };
    await admit(config, 's1', 'u1', 'c1', 'log sleep');

    await run(config, 's1');
    const items = await store.getItems('s1');
    const askItem = items.find((i) => i.type === 'approval_ask');

    const r2 = await resumeAfterApproval(config, 's1', askItem.seq, 'deny');
    const allItems = await store.getItems('s1');
    const resultItem = allItems.find((i) => i.type === 'tool_result');
    assert.equal(resultItem.payload.status, 'error');
  });

  it('crash-before-execute: tool_called persisted but no side effect', async () => {
    let executed = false;
    const crashTool = defineTool({
      name: 'logHabit',
      description: 'Log',
      parameters: { type: 'object', properties: {} },
      sideEffect: 'mutating',
      execute: async () => { executed = true; return '{}'; },
    });

    const model = fakeModel([
      { toolCalls: [{ id: 'tc1', name: 'logHabit', arguments: {} }] },
    ]);
    const config = { store, model, tools: [crashTool], systemPrompt };
    await admit(config, 's1', 'u1', 'c1', 'log');

    // Run — mutating tool will pause for approval, not execute
    await run(config, 's1');

    const items = await store.getItems('s1');
    assert.ok(items.some((i) => i.type === 'tool_called'));
    assert.equal(executed, false); // Law 5: persisted before execute, paused before execute
  });

  it('after=seq replay returns only newer items', async () => {
    const config = { store, model: fakeModel([{ text: 'hi' }]), tools, systemPrompt };
    await admit(config, 's1', 'u1', 'c1', 'hello');
    await run(config, 's1');

    const allItems = await store.getItems('s1');
    assert.ok(allItems.length >= 2);

    const afterFirst = await store.getItems('s1', 1);
    assert.ok(afterFirst.length < allItems.length);
    assert.ok(afterFirst.every((i) => i.seq > 1));
  });

  it('session lock prevents concurrent runs', async () => {
    const model = fakeModel([{ text: 'hi' }]);
    const config = { store, model, tools, systemPrompt };
    await admit(config, 's1', 'u1', 'c1', 'hello');

    // Manually lock
    await store.tryLock('s1');

    await assert.rejects(
      () => run(config, 's1'),
      { message: 'Session is already running' },
    );

    // Unlock and retry
    await store.unlock('s1');
    const result = await run(config, 's1');
    assert.equal(result.pausedForApproval, undefined);
  });

  it('always_allow skips approval on subsequent calls', async () => {
    let execCount = 0;
    const trackTool = defineTool({
      ...mutateTool,
      execute: async () => { execCount++; return JSON.stringify({ success: true }); },
    });

    const model = fakeModel([
      // First call — will pause
      { toolCalls: [{ id: 'tc1', name: 'logHabit', arguments: { habitName: 'sleep' } }] },
      { text: 'done1' },
      // Second call — should not pause (always_allow)
      { toolCalls: [{ id: 'tc2', name: 'logHabit', arguments: { habitName: 'water' } }] },
      { text: 'done2' },
    ]);
    const config = { store, model, tools: [readTool, trackTool], systemPrompt };

    // First admit + run → pauses
    await admit(config, 's1', 'u1', 'c1', 'log sleep');
    await run(config, 's1');

    const items1 = await store.getItems('s1');
    const ask = items1.find((i) => i.type === 'approval_ask');
    await resumeAfterApproval(config, 's1', ask.seq, 'always_allow');
    assert.equal(execCount, 1);

    // Second admit + run → should NOT pause because logHabit is always-allowed
    await admit(config, 's1', 'u1', 'c2', 'log water');
    const r2 = await run(config, 's1');
    assert.equal(r2.pausedForApproval, undefined);
    assert.equal(execCount, 2);
  });
});
