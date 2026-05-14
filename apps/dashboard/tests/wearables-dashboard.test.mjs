import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import vm from "node:vm";
import ts from "typescript";

function loadWearablesDashboardModule() {
  const filename = join(process.cwd(), "apps", "dashboard", "lib", "wearables-dashboard.ts");
  const source = readFileSync(filename, "utf-8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  const module = { exports: {} };
  const sandbox = {
    exports: module.exports,
    module,
    require: createRequire(import.meta.url),
  };
  vm.runInNewContext(transpiled, sandbox, { filename });
  return module.exports;
}

const wearablesDashboard = loadWearablesDashboardModule();

test("legacy and inferred sleep metrics resolve to the canonical sleep total", () => {
  assert.equal(
    wearablesDashboard.getWearableMetricType({
      metric_type: "sleep_session",
      integration_source: "whoop",
    }),
    "sleep_total",
  );
  assert.equal(
    wearablesDashboard.getWearableMetricType({
      name: "Sleep Duration",
      metric_type: null,
      integration_source: "whoop",
    }),
    "sleep_total",
  );
  assert.equal(
    wearablesDashboard.isWearableBackedHabit({
      name: "Sleep Duration",
      metric_type: null,
      integration_source: "whoop",
    }),
    true,
  );
});

test("sleep daily totals convert provider minutes into overview hours", () => {
  const rows = wearablesDashboard.buildWearableDailyRows(
    [
      {
        date: "2026-05-14",
        metrics: {
          sleep_total: {
            value: 464.2,
            unit: "minutes",
            aggregation: "daily_total",
            provider: "whoop",
          },
        },
      },
    ],
    "sleep_session",
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].unit, "Hours");
  assert.equal(Number(rows[0].value.toFixed(2)), 7.74);
});
