import test from "node:test";
import assert from "node:assert/strict";

import {
  collectChatMentionTargets,
  parseEntityMentionTokens,
  persistConversationMentions,
} from "../dist/persistence.js";

test("parses mention tokens and report aliases from chat text", () => {
  assert.deepEqual(parseEntityMentionTokens("see [[report:a1]] and [[habit:h1]] [[report:a1]]"), [
    { type: "artifact", id: "a1" },
    { type: "habit", id: "h1" },
  ]);
});

test("collects user tokens and attached refs for backlinks", () => {
  const targets = collectChatMentionTargets("logged [[habit:h1]]", [
    { type: "calendar", id: "b1" },
    { type: "habit", id: "h1" },
  ]);
  assert.deepEqual(targets, [
    { type: "habit", id: "h1" },
    { type: "calendar_event", id: "b1" },
  ]);
});

test("persists conversation mentions after the conversation id exists", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ items: [] }), { status: 200 });
  };

  try {
    let resolveConversation;
    const conversationIdPromise = new Promise((resolve) => {
      resolveConversation = resolve;
    });
    persistConversationMentions({
      token: "tok",
      conversationIdPromise,
      userContent: "see [[habit:h1]]",
      attachedRefs: [{ type: "task", id: "t1" }],
      assistantRefs: [{ type: "habit_log", id: "l1" }],
    });
    assert.equal(calls.length, 0);
    resolveConversation("conv-1");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
    await Promise.resolve();
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/api\/entities\/references\/sync$/);
  assert.deepEqual(calls[0].body.source, { type: "conversation", id: "conv-1" });
  assert.deepEqual(calls[0].body.targets, [
    { type: "habit", id: "h1" },
    { type: "task", id: "t1" },
  ]);
  assert.equal(calls[0].body.provenance, "user");
  assert.equal(calls[1].body.provenance, "assistant");
  assert.deepEqual(calls[1].body.targets, [{ type: "habit_log", id: "l1" }]);
});
