import test from "node:test";
import assert from "node:assert/strict";

import {
  getRegisteredToolNames,
  getToolOwner,
  getToolSchema,
  getToolsForChannel,
  toolNames,
  toolRegistry,
  toolSchemas,
  validateToolRegistry,
} from "../dist/tool-registry.js";

test("tool registry covers every OpenAI tool schema exactly once", () => {
  assert.deepEqual(validateToolRegistry(), []);
  assert.equal(toolRegistry.size, toolSchemas.length);
  assert.equal(getRegisteredToolNames().length, toolNames.length);
});

test("registered tool schemas expose function names and JSON object parameters", () => {
  for (const name of toolNames) {
    const schema = getToolSchema(name);
    assert.equal(schema.type, "function");
    assert.equal(schema.function.name, name);
    assert.equal(schema.function.parameters?.type, "object");
  }
});

test("mutating habit tools remain available in the shared registry", () => {
  for (const name of ["logHabit", "createHabit"]) {
    const entry = toolRegistry.get(name);
    assert.ok(entry, `${name} should be registered`);
    assert.deepEqual(entry.channels, ["dashboard"]);
  }
});

test("tool registry records executor ownership and dashboard schemas", () => {
  assert.equal(getToolOwner("getDailyBiometrics"), "biometrics");
  assert.equal(getToolOwner("getActivitySummary"), "computer-activity");

  const dashboardToolNames = getToolsForChannel("dashboard").map((tool) => tool.function.name);
  assert.ok(dashboardToolNames.includes("logHabit"));
  assert.ok(dashboardToolNames.includes("getCalendarEvents"));
});
