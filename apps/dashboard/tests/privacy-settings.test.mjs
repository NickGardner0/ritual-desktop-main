import test, { describe } from "node:test";
import assert from "node:assert/strict";

describe("shared privacy policy", () => {
  test("blocks sensitive analytics in Local Only by default", async () => {
    const { canSendToCloud } = await import("../../../packages/shared-contracts/dist/privacy.js");

    const decision = canSendToCloud({
      mode: "local_only",
      dataClass: "habit_log",
      destination: "tinybird",
      purpose: "analytics",
      consents: {},
    });

    assert.equal(decision.allowed, false);
    assert.match(decision.reason, /local-only/i);
  });

  test("redacts sensitive analytics properties", async () => {
    const { redactAnalyticsProperties } = await import("../../../packages/shared-contracts/dist/privacy.js");

    const result = redactAnalyticsProperties({
      habitName: "Medication",
      logId: "log_123",
      durationSeconds: 120,
      source: "manual",
    });

    assert.deepEqual(result, {
      habitName: "[redacted]",
      logId: "[redacted]",
      durationSeconds: 120,
      source: "manual",
    });
  });
});
