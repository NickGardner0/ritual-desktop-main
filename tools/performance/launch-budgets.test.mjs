import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  compareToBudgets,
  median,
  summarizeTrials,
  validateReleaseEvidence,
  validateTrackingTrial,
} from "./launch-budget-core.mjs";

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
    const rss = summarizeTrials(trials, ["webview_rss_bytes"]);
    assert.deepEqual(
      compareToBudgets(
        { webview_bytes: rss.webview_rss_bytes },
        { webview_bytes: config.budgets.rss.webview_bytes },
      ),
      [],
    );
    for (const trial of trials) assert.deepEqual(validateTrackingTrial(trial), []);
  }
});

test("null RSS is not summarized as zero", () => {
  assert.equal(summarizeTrials([{ watcher_rss_bytes: null }], ["watcher_rss_bytes"]).watcher_rss_bytes, null);
});

test("enabled watcher trials reject missing, zero, or unavailable RSS", () => {
  const trial = {
    trial_id: "enabled-1",
    tracking_state: "enabled",
    watcher_pid: 10,
    watcher_readiness_time_ms: 500,
    watcher_rss_bytes: 0,
    watcher_rss_sample_state: "unavailable",
  };
  assert.match(validateTrackingTrial(trial).join("\n"), /nonzero watcher_rss_bytes/);
});

test("incomplete release evidence remains explicit without pretending fixtures are live", () => {
  assert.deepEqual(validateReleaseEvidence(config), { complete: false, failures: [] });
  assert.equal(config.releaseEvidence.status, "incomplete");
  assert.equal(config.fixtureTrials.cold[0].provenance, "fixture");
});
