import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compactApiMessages,
  isDoomLoop,
  pruneBulkyToolResult,
  toolBatchSignature,
} from '../dist/session-drain.js';

test('toolBatchSignature is order-independent', () => {
  assert.equal(
    toolBatchSignature([
      { name: 'listHabits', arguments: '{}' },
      { name: 'getStreaks', arguments: '{"days":7}' },
    ]),
    toolBatchSignature([
      { name: 'getStreaks', arguments: '{"days":7}' },
      { name: 'listHabits', arguments: '{}' },
    ]),
  );
});

test('isDoomLoop stops after three identical tool batches', () => {
  const signature = toolBatchSignature([{ name: 'listHabits', arguments: '{}' }]);
  assert.equal(isDoomLoop([], signature), false);
  assert.equal(isDoomLoop([signature], signature), false);
  assert.equal(isDoomLoop([signature, signature], signature), true);
});

test('compactApiMessages truncates bulky tool dumps and keeps system facts', () => {
  const bulky = 'x'.repeat(20_000);
  const messages = [
    { role: 'system', content: 'user facts stay' },
    { role: 'user', content: 'what did I do' },
    { role: 'tool', content: bulky },
  ];
  const compacted = compactApiMessages(messages);
  assert.equal(compacted[0].content, 'user facts stay');
  assert.ok(String(compacted[2].content).includes('truncated bulky tool result'));
  assert.ok(pruneBulkyToolResult(bulky).length < bulky.length);
});
