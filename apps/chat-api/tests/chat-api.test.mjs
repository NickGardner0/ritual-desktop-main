import test from 'node:test';
import assert from 'node:assert/strict';

import { createChatRouter } from '../dist/routes/chat.js';

test('GET /healthz returns ok', async () => {
  const app = createChatRouter();
  const response = await app.request('http://localhost/healthz');

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test('POST /chat/stream returns 401 without bearer token', async () => {
  const app = createChatRouter();
  const response = await app.request('http://localhost/chat/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messages: [] }),
  });

  assert.equal(response.status, 401);
});

test('POST /chat/stream forwards runtime response after token verification', async () => {
  const app = createChatRouter({
    verifyToken: async () => 'jwt-123',
    handleChatStream: async () => new Response('__STREAM_OPEN__\n0:"ok"\n', {
      headers: {
        'Content-Type': 'text/event-stream',
      },
    }),
  });

  const response = await app.request('http://localhost/chat/stream', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer jwt-123',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'hello' }],
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(await response.text(), '__STREAM_OPEN__\n0:"ok"\n');
});
