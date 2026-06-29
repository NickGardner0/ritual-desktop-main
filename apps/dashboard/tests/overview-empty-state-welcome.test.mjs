import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const overviewEmptyStatePath = join(
  process.cwd(),
  "apps",
  "dashboard",
  "components",
  "analytics",
  "overview",
  "OverviewEmptyState.tsx",
);

const overviewStartCommandsPath = join(
  process.cwd(),
  "apps",
  "dashboard",
  "components",
  "analytics",
  "overview",
  "OverviewStartCommands.tsx",
);

test("overview empty state uses the current compact command group", () => {
  const source = [
    readFileSync(overviewEmptyStatePath, "utf-8"),
    readFileSync(overviewStartCommandsPath, "utf-8"),
  ].join("\n");

  for (const legacyText of [
    "GET STARTED",
    "CONFIGURE",
    "Customize Appearance",
    "Explore Integrations",
    "Welcome to Ritual",
  ]) {
    assert.equal(
      source.includes(legacyText),
      false,
      `Legacy welcome text should not be reintroduced: ${legacyText}`,
    );
  }

  for (const currentText of [
    "New Tracker",
    "Import Data",
    "Connect Devices",
    "Open Command Palette",
    "Open Settings",
  ]) {
    assert.equal(
      source.includes(currentText),
      true,
      `Current welcome command is missing: ${currentText}`,
    );
  }
});
