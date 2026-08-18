import test from "node:test";
import assert from "node:assert/strict";

import {
  getNextStreamingFlushDelay,
  shouldFlushStreamingContent,
} from "../lib/chat-stream-buffer.mjs";

test("shouldFlushStreamingContent flushes first, forced, and interval-ready updates", () => {
  assert.equal(shouldFlushStreamingContent({ lastFlushAt: 0, now: 100 }), true);
  assert.equal(shouldFlushStreamingContent({ force: true, lastFlushAt: 100, now: 101 }), true);
  assert.equal(shouldFlushStreamingContent({ lastFlushAt: 100, now: 115, intervalMs: 16 }), false);
  assert.equal(shouldFlushStreamingContent({ lastFlushAt: 100, now: 116, intervalMs: 16 }), true);
});

test("getNextStreamingFlushDelay returns remaining interval time", () => {
  assert.equal(getNextStreamingFlushDelay({ lastFlushAt: 100, now: 108, intervalMs: 16 }), 8);
  assert.equal(getNextStreamingFlushDelay({ lastFlushAt: 100, now: 120, intervalMs: 16 }), 0);
});

test("streaming flush policy coalesces token-speed updates", () => {
  let lastFlushAt = 0;
  let flushes = 0;

  for (let i = 0; i < 100; i += 1) {
    const now = 1_000 + i * 5;
    if (shouldFlushStreamingContent({ lastFlushAt, now, intervalMs: 16 })) {
      lastFlushAt = now;
      flushes += 1;
    }
  }

  assert.equal(flushes, 25);
});
