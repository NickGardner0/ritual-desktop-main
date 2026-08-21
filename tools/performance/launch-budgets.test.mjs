import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compareToBudgets, median, summarizeTrials } from "./launch-budget-core.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const config = JSON.parse(readFileSync(join(root, "tools/performance/launch-budgets.json"), "utf8"));

test("median uses the middle of five trials", () => {
  assert.equal(median([8, 1, 3, 2, 7]), 3);
});

test("five-trial cold and warm medians stay inside launch/RSS budgets", () => {
  for (const kind of ["cold", "warm"]) {
    const trials = config.fixtureTrials[kind];
    assert.equal(trials.length, 5);
    const timing = summarizeTrials(trials, config.requiredMilestones);
    const failures = compareToBudgets(
      {
        providers_mounted_ms: timing.providers_mounted,
        native_ready_ms: timing.native_ready,
        shell_bootstrap_ms: timing.shell_bootstrap,
      },
      config.budgets[kind],
    );
    assert.deepEqual(failures, []);
    const rss = summarizeTrials(trials, ["webview_rss_bytes", "watcher_rss_bytes"]);
    assert.deepEqual(
      compareToBudgets(
        { webview_bytes: rss.webview_rss_bytes, watcher_bytes: rss.watcher_rss_bytes },
        config.budgets.rss,
      ),
      [],
    );
  }
});
