import test from 'node:test';
import assert from 'node:assert/strict';

import {
  handleChatStreamRequest,
  handleSmsChatRequest,
  handleSmsProactiveRequest,
  splitSmsSegments,
  tools,
} from '../dist/index.js';
import {
  createChatStreamResponse,
  parsePhaseLine,
} from '../dist/stream-response.js';

test('handleChatStreamRequest rejects empty token', async () => {
  const response = await handleChatStreamRequest({
    token: '',
    body: {
      messages: [],
    },
  });

  assert.equal(response.status, 401);
  assert.match(await response.text(), /Unauthorized/);
});

test('createChatStreamResponse preserves Ritual wire format', async () => {
  const response = createChatStreamResponse({
    conversationId: 'conv_123',
    source: {
      type: 'complete',
      text: 'hello world from ritual',
    },
    canvasToolPayload: {
      weeklyOverview: { success: true },
    },
  });

  const text = await response.text();
  assert.match(text, /__CONVERSATION_ID__conv_123__END_CONVERSATION_ID__/);
  assert.match(text, /__TOOL_DATA__/);
  assert.match(text, /0:"hello world from ritual"/);
});

test('createChatStreamResponse emits phase events before text', async () => {
  const response = createChatStreamResponse({
    conversationId: 'conv_phase',
    source: {
      type: 'events',
      events: (async function* () {
        yield { type: 'phase', phase: 'context' };
        yield { type: 'phase', phase: 'searching' };
        yield { type: 'text', text: 'token-one' };
      })(),
    },
    canvasToolPayload: null,
    prefaceLine: '__STREAM_OPEN__',
  });

  const text = await response.text();
  assert.match(text, /__STREAM_OPEN__/);
  assert.match(text, /__PHASE__/);
  assert.equal(parsePhaseLine('__PHASE__{"phase":"context","label":null}__END_PHASE__')?.phase, 'context');
  assert.match(text, /0:"token-one"/);
});

test('createChatStreamResponse supports deferred conversation and tool payloads', async () => {
  const response = createChatStreamResponse({
    conversationId: null,
    conversationIdPromise: Promise.resolve('conv_deferred'),
    source: {
      type: 'stream',
      tokens: (async function* () {
        await new Promise((resolve) => setTimeout(resolve, 5));
        yield 'streamed text';
      })(),
    },
    canvasToolPayload: null,
    canvasToolPayloadPromise: Promise.resolve({
      dailyOverview: { success: true },
    }),
    prefaceLine: '__STREAM_OPEN__',
  });

  const text = await response.text();
  assert.match(text, /__CONVERSATION_ID__conv_deferred__END_CONVERSATION_ID__/);
  assert.match(text, /__TOOL_DATA__/);
  assert.match(text, /__STREAM_OPEN__/);
  assert.match(text, /0:"streamed text"/);
});

test('handleSmsChatRequest rejects missing internal secret before model calls', async () => {
  const response = await handleSmsChatRequest(new Request('http://localhost/sms', {
    method: 'POST',
    body: JSON.stringify({
      user_id: 'user_1',
      conversation_id: 'conv_1',
      user_message: 'how was my sleep?',
      recent_messages: [],
    }),
  }));

  assert.equal(response.status, 401);
  assert.match(await response.text(), /Unauthorized/);
});

test('handleSmsProactiveRequest rejects missing internal secret before model calls', async () => {
  const response = await handleSmsProactiveRequest(new Request('http://localhost/sms/proactive', {
    method: 'POST',
    body: JSON.stringify({
      user_id: 'user_1',
      trigger_type: 'morning',
      trigger_prompt: 'Send a morning brief.',
    }),
  }));

  assert.equal(response.status, 401);
  assert.match(await response.text(), /Unauthorized/);
});

test('splitSmsSegments preserves safe multi-segment wire format', () => {
  assert.deepEqual(splitSmsSegments('one\n---\ntwo'), ['one', 'two']);
  assert.deepEqual(splitSmsSegments('single message'), ['single message']);
  assert.deepEqual(splitSmsSegments(''), ["Sorry, I couldn't process that. Try again?"]);
  assert.deepEqual(splitSmsSegments('a\n---\nb\n---\nc\n---\nd\n---\ne'), ['a\n---\nb\n---\nc\n---\nd\n---\ne']);
});

test('runtime tool export preserves OpenAI function-call contract', () => {
  const toolNames = tools.map((tool) => tool.function.name);
  assert.deepEqual(toolNames, [
    'getHabitStats',
    'getDailyBreakdown',
    'getCorrelation',
    'listHabits',
    'getHabitTrends',
    'getWeeklyOverview',
    'getDailyOverview',
    'getMonthlyOverview',
    'getHabitAnomalies',
    'getComputerTimeSpentBreakdown',
    'getActivitySummary',
    'getDailyBiometrics',
    'getScreenTimeSummary',
    'getCalendarEvents',
    'getStreaks',
    'logHabit',
    'createHabit',
    'getSmsPreferences',
    'updateSmsPreferences',
  ]);

  assert.equal(toolNames.length, 19);
  assert.equal(new Set(toolNames).size, toolNames.length);

  for (const name of toolNames) {
    assert.match(name, /^[a-zA-Z][a-zA-Z0-9]*$/);
  }
});
