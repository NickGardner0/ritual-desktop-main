import test from "node:test";
import assert from "node:assert/strict";

function collectMutationReceipt(toolResults, name, raw) {
  const parsed = JSON.parse(raw);
  if (!parsed.success || !parsed.receipt?.receipt_id) return;
  const receipt = {
    receipt_id: parsed.receipt.receipt_id,
    action_kind: name,
    habit_id: parsed.habit_id ?? parsed.receipt.habit_id ?? null,
    habit_name: parsed.habit_name ?? parsed.receipt.habit_name ?? null,
    was_inserted: parsed.receipt.was_inserted ?? true,
    undoable: parsed.receipt.undoable ?? true,
    log_id: parsed.log?.id ?? parsed.receipt.log_id ?? null,
  };
  toolResults.actionReceipts = toolResults.actionReceipts || [];
  toolResults.actionReceipts.push(receipt);
  toolResults.entityRefs = toolResults.entityRefs || [];
  if (receipt.habit_id) {
    toolResults.entityRefs.push({
      type: "habit",
      id: receipt.habit_id,
      title: receipt.habit_name || undefined,
    });
  }
  if (receipt.log_id) {
    toolResults.entityRefs.push({
      type: "habit_log",
      id: receipt.log_id,
      title: receipt.habit_name || undefined,
    });
  }
}

function buildToolPayload(toolResults) {
  const payload = {
    actionReceipts: toolResults.actionReceipts,
    entityRefs: toolResults.entityRefs,
  };
  if (!payload.actionReceipts?.length) delete payload.actionReceipts;
  if (!payload.entityRefs?.length) delete payload.entityRefs;
  return Object.keys(payload).length ? payload : null;
}

test("collects logHabit receipts into tool results", () => {
  const toolResults = {};
  collectMutationReceipt(
    toolResults,
    "logHabit",
    JSON.stringify({
      success: true,
      habit_id: "h1",
      habit_name: "Walk",
      log: { id: "l1" },
      receipt: { receipt_id: "r1", was_inserted: true, undoable: true },
    }),
  );
  assert.equal(toolResults.actionReceipts.length, 1);
  assert.equal(toolResults.actionReceipts[0].receipt_id, "r1");
  assert.deepEqual(toolResults.entityRefs, [
    { type: "habit", id: "h1", title: "Walk" },
    { type: "habit_log", id: "l1", title: "Walk" },
  ]);
  assert.deepEqual(buildToolPayload(toolResults), {
    actionReceipts: toolResults.actionReceipts,
    entityRefs: toolResults.entityRefs,
  });
});

test("ignores mutations without receipt ids", () => {
  const toolResults = {};
  collectMutationReceipt(
    toolResults,
    "createHabit",
    JSON.stringify({ success: true, habit_id: "h1", habit_name: "Meditate" }),
  );
  assert.equal(toolResults.actionReceipts, undefined);
  assert.equal(buildToolPayload(toolResults), null);
});

test("calendar events collect calendar_block refs", () => {
  const toolResults = { entityRefs: [] };
  const parsed = {
    success: true,
    events: [
      { id: "b1", title: "Deep work" },
      { title: "No id" },
    ],
  };
  for (const event of parsed.events) {
    if (!event.id) continue;
    toolResults.entityRefs.push({ type: "calendar_block", id: event.id, title: event.title });
  }
  assert.deepEqual(toolResults.entityRefs, [{ type: "calendar_block", id: "b1", title: "Deep work" }]);
});
