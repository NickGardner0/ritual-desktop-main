import test from "node:test";
import assert from "node:assert/strict";

/**
 * Lightweight behavioral checks for the chat action-receipt feature flag
 * and payload shaping used by the dashboard chat UI.
 */

function chatActionReceiptsEnabled(envValue) {
  return envValue !== "0";
}

function extractActionReceipts(toolData) {
  if (!toolData || !Array.isArray(toolData.actionReceipts)) {
    return undefined;
  }
  return toolData.actionReceipts;
}

test("chat action receipts enabled by default", () => {
  assert.equal(chatActionReceiptsEnabled(undefined), true);
  assert.equal(chatActionReceiptsEnabled("1"), true);
});

test("chat action receipts can be disabled with 0", () => {
  assert.equal(chatActionReceiptsEnabled("0"), false);
});

test("extracts action receipts from tool payload", () => {
  const receipts = extractActionReceipts({
    actionReceipts: [
      {
        receipt_id: "r1",
        action_kind: "logHabit",
        habit_name: "Walk",
        undoable: true,
      },
    ],
  });
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].receipt_id, "r1");
});

test("missing action receipts stay undefined", () => {
  assert.equal(extractActionReceipts({ stats: [] }), undefined);
  assert.equal(extractActionReceipts(null), undefined);
});
