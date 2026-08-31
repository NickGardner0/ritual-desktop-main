import test from 'node:test';
import assert from 'node:assert/strict';

import { startChatRuntimeSidecar } from '../dist/sidecar.js';

test('chat-runtime sidecar serves health on both routes without OpenAI', async () => {
  const { server, port, host } = await startChatRuntimeSidecar(0);
  const address = server.address();
  const boundPort = typeof address === 'object' && address ? address.port : port;
  try {
    for (const path of ['/health', '/chat/health']) {
      const response = await fetch(`http://${host}:${boundPort}${path}`);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.ok, true);
      assert.equal(body.service, 'ritual-chat-runtime');
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
