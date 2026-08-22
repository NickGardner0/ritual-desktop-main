import test from 'node:test';
import assert from 'node:assert/strict';

import { handleChatStreamRequest } from '../dist/index.js';
import { setOpenAIClientForTests } from '../dist/model-engine/index.js';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function textChunk(content) {
  return { choices: [{ delta: { content } }] };
}

function createDelayedStreamClient(delayMs, chunks) {
  return {
    chat: {
      completions: {
        create: async (params) => {
          if (!params.stream) {
            throw new Error('expected streaming OpenAI call');
          }
          return {
            async *[Symbol.asyncIterator]() {
              await delay(delayMs);
              for (const chunk of chunks) {
                yield chunk;
              }
            },
          };
        },
      },
    },
  };
}

test('handleChatStreamRequest opens the HTTP body before the first model token', async () => {
  setOpenAIClientForTests(createDelayedStreamClient(80, [textChunk('Hello')]));
  try {
    const startedAt = Date.now();
    const response = await handleChatStreamRequest({
      token: 'test-token',
      body: {
        messages: [{ role: 'user', content: 'hello there' }],
      },
    });
    assert.ok(Date.now() - startedAt < 75, 'response should return before the delayed model token');
    assert.equal(response.headers.get('Content-Type'), 'text/event-stream');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const first = await reader.read();
    text += decoder.decode(first.value || new Uint8Array(), { stream: true });
    assert.match(text, /__STREAM_OPEN__/);

    while (!text.includes('Hello')) {
      const next = await reader.read();
      if (next.done) break;
      text += decoder.decode(next.value || new Uint8Array(), { stream: true });
    }

    assert.match(text, /__PHASE__/);
    assert.match(text, /0:"Hello"/);
  } finally {
    setOpenAIClientForTests(null);
  }
});
