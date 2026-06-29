import test from "node:test";
import assert from "node:assert/strict";

import {
  getNextStreamingFlushDelay,
  shouldFlushStreamingContent,
} from "../app/(dashboard)/chat/chat-stream-buffer";

test("shouldFlushStreamingContent flushes first, forced, and interval-ready updates", () => {
  assert.equal(shouldFlushStreamingContent({ lastFlushAt: 0, now: 100 }), true);
  assert.equal(shouldFlushStreamingContent({ force: true, lastFlushAt: 100, now: 101 }), true);
  assert.equal(shouldFlushStreamingContent({ lastFlushAt: 100, now: 149, intervalMs: 50 }), false);
  assert.equal(shouldFlushStreamingContent({ lastFlushAt: 100, now: 150, intervalMs: 50 }), true);
});

test("getNextStreamingFlushDelay returns remaining interval time", () => {
  assert.equal(getNextStreamingFlushDelay({ lastFlushAt: 100, now: 125, intervalMs: 50 }), 25);
  assert.equal(getNextStreamingFlushDelay({ lastFlushAt: 100, now: 175, intervalMs: 50 }), 0);
});

test("streaming flush policy coalesces token-speed updates", () => {
  let lastFlushAt = 0;
  let flushes = 0;

  for (let i = 0; i < 100; i += 1) {
    const now = 1_000 + i * 5;
    if (shouldFlushStreamingContent({ lastFlushAt, now, intervalMs: 50 })) {
      lastFlushAt = now;
      flushes += 1;
    }
  }

  assert.equal(flushes, 10);
});
