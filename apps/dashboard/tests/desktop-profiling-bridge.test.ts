import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDesktopProfilingBridgeCommandUrl,
  normalizeDesktopProfilingBridgeBase,
} from "../lib/desktop-bridge/profiling-bridge";

test("normalizeDesktopProfilingBridgeBase only accepts localhost HTTP origins", () => {
  assert.equal(
    normalizeDesktopProfilingBridgeBase("http://127.0.0.1:3031/"),
    "http://127.0.0.1:3031",
  );
  assert.equal(
    normalizeDesktopProfilingBridgeBase("http://localhost:3031"),
    "http://localhost:3031",
  );
  assert.equal(normalizeDesktopProfilingBridgeBase("https://127.0.0.1:3031"), null);
  assert.equal(normalizeDesktopProfilingBridgeBase("http://example.com:3031"), null);
  assert.equal(normalizeDesktopProfilingBridgeBase(""), null);
});

test("buildDesktopProfilingBridgeCommandUrl encodes command names", () => {
  assert.equal(
    buildDesktopProfilingBridgeCommandUrl("http://127.0.0.1:3031", "vault list"),
    "http://127.0.0.1:3031/v1/tauri/vault%20list",
  );
});
