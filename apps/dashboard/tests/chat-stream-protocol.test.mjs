import test from "node:test";
import assert from "node:assert/strict";

import { labelForChatPhase, parsePhaseLine } from "../lib/chat-stream-protocol.mjs";

test("parsePhaseLine reads Ritual chat phase events", () => {
  assert.deepEqual(
    parsePhaseLine('__PHASE__{"phase":"context","label":null}__END_PHASE__'),
    { phase: "context", label: null },
  );
  assert.deepEqual(
    parsePhaseLine('__PHASE__{"phase":"tool","label":"Using listHabits..."}__END_PHASE__'),
    { phase: "tool", label: "Using listHabits..." },
  );
  assert.equal(parsePhaseLine('0:"hello"'), null);
});

test("labelForChatPhase prefers server labels and falls back to defaults", () => {
  assert.equal(labelForChatPhase("searching"), "Thinking...");
  assert.equal(labelForChatPhase("tool", "Using listHabits..."), "Using listHabits...");
});
