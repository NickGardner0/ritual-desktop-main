import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyModelEngineError,
  collectModelEngineResponse,
  defaultModelEngine,
  ModelEngineError,
  setOpenAIClientForTests,
} from '../dist/index.js';

test('provider-neutral event collection assembles text and ordered tool calls', async () => {
  const adapter = {
    async *stream() {
      yield { type: 'text_delta', text: 'Hello ' };
      yield { type: 'tool_call_delta', index: 1, id: 'call-2', name: 'list', arguments: '{"a":' };
      yield { type: 'tool_call_delta', index: 0, id: 'call-1', name: 'get', arguments: '{}' };
      yield { type: 'tool_call_delta', index: 1, name: 'Habits', arguments: '1}' };
      yield { type: 'text_delta', text: 'world' };
      yield { type: 'done', finishReason: 'tool_calls' };
    },
  };

  const response = await collectModelEngineResponse(adapter, { model: 'fixture', messages: [] });
  assert.equal(response.content, 'Hello world');
  assert.deepEqual(response.toolCalls, [
    { id: 'call-1', name: 'get', arguments: '{}' },
    { id: 'call-2', name: 'listHabits', arguments: '{"a":1}' },
  ]);
});

test('OpenAI adapter is the only provider boundary and decodes streamed events', async () => {
  let request = null;
  setOpenAIClientForTests({
    chat: {
      completions: {
        async create(params) {
          request = params;
          return {
            async *[Symbol.asyncIterator]() {
              yield { choices: [{ delta: { content: '{"ok":' } }] };
              yield {
                choices: [{
                  delta: {
                    content: 'true}',
                    tool_calls: [{ index: 0, id: 'call-1', function: { name: 'getHabits', arguments: '{}' } }],
                  },
                  finish_reason: 'stop',
                }],
              };
            },
          };
        },
      },
    },
  });

  try {
    const response = await collectModelEngineResponse(defaultModelEngine, {
      model: 'gpt-fixture',
      messages: [{ role: 'user', content: 'hello' }],
      responseFormat: 'json_object',
    });
    assert.equal(request.stream, true);
    assert.deepEqual(request.response_format, { type: 'json_object' });
    assert.equal(response.content, '{"ok":true}');
    assert.deepEqual(response.toolCalls, [{ id: 'call-1', name: 'getHabits', arguments: '{}' }]);
  } finally {
    setOpenAIClientForTests(null);
  }
});

test('provider errors are classified without leaking provider state into the kernel', () => {
  assert.equal(classifyModelEngineError({ status: 429 }), 'retryable_provider');
  assert.equal(classifyModelEngineError(new Error('network temporarily unavailable')), 'retryable_provider');
  assert.equal(classifyModelEngineError(new Error('invalid request')), 'fatal_provider');
  const error = new ModelEngineError('rate limited', 'retryable_provider');
  assert.equal(error.kind, 'retryable_provider');
});

test('an already-aborted provider request never opens a provider stream', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => collectModelEngineResponse(defaultModelEngine, {
      model: 'gpt-fixture',
      messages: [],
      signal: controller.signal,
    }),
    (error) => error?.name === 'AbortError',
  );
});
