import test from "node:test";
import assert from "node:assert/strict";

import {
  ENTITY_SUMMARY_TTL_MS,
  EntitySummaryCache,
  clearEntitySummaryCache,
  entitySummaryCacheKey,
  forgetEntitySummary,
  loadEntitySummary,
  peekEntitySummary,
  rememberEntitySummary,
  setEntitySummaryCacheUser,
  shouldPersistEntitySummary,
  subscribeEntitySummary,
} from "../lib/entities/entity-summary-cache.mjs";

function summary(id, extra = {}) {
  return {
    ref: { type: "task", id },
    title: extra.title || `Task ${id}`,
    status: extra.status || "open",
    subtitle: extra.subtitle,
    availability: extra.availability || "ok",
    route: `/tasks?task=${id}`,
    privacyClass: "task",
    ...extra,
  };
}

test("entity summary cache keys are user scoped", () => {
  assert.equal(entitySummaryCacheKey("user-a", { type: "task", id: "t1" }), "user-a:task:t1");
  assert.equal(entitySummaryCacheKey(null, { type: "task", id: "t1" }), "anon:task:t1");
  assert.equal(entitySummaryCacheKey("user-a", { type: "report", id: "a1" }), "user-a:artifact:a1");
});

test("unknown summaries from errors are not persisted", () => {
  assert.equal(shouldPersistEntitySummary(summary("t1", { availability: "unknown" })), false);
  assert.equal(shouldPersistEntitySummary(summary("t1", { availability: "ok" })), true);
  assert.equal(shouldPersistEntitySummary(summary("t1", { availability: "deleted" })), true);
});

test("cache isolates users and does not stick unknown results", async () => {
  clearEntitySummaryCache();
  setEntitySummaryCacheUser("user-a");
  rememberEntitySummary(summary("t1", { title: "A" }), "user-a");
  rememberEntitySummary(summary("t1", { title: "B" }), "user-b");
  assert.equal(peekEntitySummary({ type: "task", id: "t1" }, "user-a")?.title, "A");
  assert.equal(peekEntitySummary({ type: "task", id: "t1" }, "user-b")?.title, "B");

  const unknown = await loadEntitySummary({ type: "task", id: "missing" }, "user-a", async () =>
    summary("missing", { availability: "unknown", title: "Unknown" }),
  );
  assert.equal(unknown.availability, "unknown");
  assert.equal(peekEntitySummary({ type: "task", id: "missing" }, "user-a"), undefined);
});

test("in-flight resolve requests are deduped", async () => {
  clearEntitySummaryCache();
  let calls = 0;
  const loader = () =>
    new Promise((resolve) => {
      calls += 1;
      setTimeout(() => resolve(summary("shared")), 10);
    });
  const [first, second] = await Promise.all([
    loadEntitySummary({ type: "task", id: "shared" }, "user-a", loader),
    loadEntitySummary({ type: "task", id: "shared" }, "user-a", loader),
  ]);
  assert.equal(calls, 1);
  assert.equal(first.title, second.title);
});

test("per-key subscriptions do not notify unrelated refs", () => {
  clearEntitySummaryCache();
  let taskOne = 0;
  let taskTwo = 0;
  const stopOne = subscribeEntitySummary({ type: "task", id: "one" }, () => {
    taskOne += 1;
  }, "user-a");
  const stopTwo = subscribeEntitySummary({ type: "task", id: "two" }, () => {
    taskTwo += 1;
  }, "user-a");
  rememberEntitySummary(summary("one"), "user-a");
  rememberEntitySummary(summary("two", { title: "Other" }), "user-a");
  assert.equal(taskOne, 1);
  assert.equal(taskTwo, 1);
  rememberEntitySummary(summary("one", { status: "completed" }), "user-a");
  assert.equal(taskOne, 2);
  assert.equal(taskTwo, 1);
  stopOne();
  stopTwo();
});

test("expired entries are dropped after TTL", () => {
  const cache = new EntitySummaryCache();
  cache.set("user-a:task:t1", summary("t1"), 1_000);
  assert.equal(cache.get("user-a:task:t1", 1_000 + ENTITY_SUMMARY_TTL_MS - 1)?.title, "Task t1");
  assert.equal(cache.get("user-a:task:t1", 1_000 + ENTITY_SUMMARY_TTL_MS + 1), undefined);
});

test("forget and clear drop cached summaries", () => {
  clearEntitySummaryCache();
  rememberEntitySummary(summary("t1"), "user-a");
  forgetEntitySummary({ type: "task", id: "t1" }, "user-a");
  assert.equal(peekEntitySummary({ type: "task", id: "t1" }, "user-a"), undefined);
  rememberEntitySummary(summary("t2"), "user-a");
  clearEntitySummaryCache();
  assert.equal(peekEntitySummary({ type: "task", id: "t2" }, "user-a"), undefined);
});
