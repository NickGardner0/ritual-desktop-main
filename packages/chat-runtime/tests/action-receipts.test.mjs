import test from "node:test";
import assert from "node:assert/strict";

function collectMutationReceipt(toolResults, name, raw) {
  const parsed = JSON.parse(raw);
  if (!parsed.success || !parsed.receipt?.receipt_id) return;
  toolResults.actionReceipts = toolResults.actionReceipts || [];
  toolResults.actionReceipts.push({
    receipt_id: parsed.receipt.receipt_id,
    action_kind: name,
    habit_id: parsed.habit_id ?? null,
    habit_name: parsed.habit_name ?? null,
    was_inserted: parsed.receipt.was_inserted ?? true,
    undoable: parsed.receipt.undoable ?? true,
  });
}

function buildToolPayload(toolResults) {
  const payload = {
    actionReceipts: toolResults.actionReceipts,
  };
  if (!payload.actionReceipts?.length) delete payload.actionReceipts;
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
      receipt: { receipt_id: "r1", was_inserted: true, undoable: true },
    }),
  );
  assert.equal(toolResults.actionReceipts.length, 1);
  assert.equal(toolResults.actionReceipts[0].receipt_id, "r1");
  assert.deepEqual(buildToolPayload(toolResults), {
    actionReceipts: toolResults.actionReceipts,
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
