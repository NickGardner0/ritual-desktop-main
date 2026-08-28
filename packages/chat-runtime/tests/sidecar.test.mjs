import test from 'node:test';
import assert from 'node:assert/strict';

import { startChatRuntimeSidecar } from '../dist/sidecar.js';

test('chat-runtime sidecar serves health without OpenAI', async () => {
  const { server, port, host } = await startChatRuntimeSidecar(0);
  const address = server.address();
  const boundPort = typeof address === 'object' && address ? address.port : port;
  try {
    const response = await fetch(`http://${host}:${boundPort}/health`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.service, 'ritual-chat-runtime');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
