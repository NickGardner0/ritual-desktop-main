import test from 'node:test';
import assert from 'node:assert/strict';

import { startAgentSidecar } from '../dist/sidecar.js';

test('agent sidecar serves health and rejects unauthenticated agent posts', async () => {
  const { server, port, host } = await startAgentSidecar(0);
  const address = server.address();
  const boundPort = typeof address === 'object' && address ? address.port : port;
  const origin = `http://${host}:${boundPort}`;
  try {
    const health = await fetch(`${origin}/health`);
    assert.equal(health.status, 200);
    const body = await health.json();
    assert.equal(body.ok, true);
    assert.equal(body.agent, true);

    const unauthorized = await fetch(`${origin}/agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 's1', commandId: 'c1', text: 'hi' }),
    });
    assert.equal(unauthorized.status, 401);

    const missing = await fetch(`${origin}/agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
      body: JSON.stringify({ sessionId: 's1' }),
    });
    assert.equal(missing.status, 400);

    const items = await fetch(`${origin}/agent/items?sessionId=missing`, {
      headers: { Authorization: 'Bearer test-token' },
    });
    assert.equal(items.status, 200);
    const itemBody = await items.json();
    assert.deepEqual(itemBody.items, []);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
