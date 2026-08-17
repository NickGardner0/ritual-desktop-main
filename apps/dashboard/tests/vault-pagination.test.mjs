import assert from 'node:assert/strict';
import test from 'node:test';

import { collectVaultRecordPages } from '../lib/privacy/vault-pagination.mjs';

test('vault pagination exhausts datasets larger than the legacy 100,000-record cap', async () => {
  const total = 100_001;
  const pageSize = 5_000;
  let calls = 0;
  const records = await collectVaultRecordPages(async (cursor) => {
    const start = cursor ? Number(cursor) : 0;
    const end = Math.min(start + pageSize, total);
    calls += 1;
    return {
      records: Array.from({ length: end - start }, (_, offset) => start + offset),
      nextCursor: end < total ? String(end) : null,
    };
  });
  assert.equal(records.length, total);
  assert.equal(records[0], 0);
  assert.equal(records.at(-1), total - 1);
  assert.equal(calls, 21);
});

test('vault pagination rejects repeated cursors instead of looping forever', async () => {
  await assert.rejects(
    collectVaultRecordPages(async () => ({ records: [], nextCursor: 'same' })),
    /repeated cursor/,
  );
});
