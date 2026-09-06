#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  compareToBudgets,
  summarizeTrials,
  validateReleaseEvidence,
  validateTrackingTrial,
} from "../tools/performance/launch-budget-core.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(readFileSync(join(root, "tools/performance/launch-budgets.json"), "utf8"));
const errors = [];

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

if (config.trials !== 5) {
  errors.push(`Launch budget config must require 5 trials, found ${config.trials}`);
}

for (const kind of ["cold", "warm"]) {
  const trials = config.fixtureTrials?.[kind] || [];
  if (trials.length !== 5) {
    errors.push(`${kind} launch budget requires exactly 5 trials, found ${trials.length}`);
    continue;
  }
  for (const trial of trials) {
    errors.push(...validateTrackingTrial(trial).map((item) => `${kind} ${item}`));
  }
  const timingKeys = Object.keys(config.budgets[kind] || {}).map((key) => key.replace(/_ms$/, "").replace(/_bytes$/, ""));
  const milestoneKeys = config.requiredMilestones;
  const timingSummary = summarizeTrials(trials, milestoneKeys);
  const renamed = {};
  for (const [key, value] of Object.entries(timingSummary)) {
    renamed[`${key}_ms`] = value;
  }
  errors.push(...compareToBudgets(renamed, config.budgets[kind]).map((item) => `${kind} ${item}`));

  const rssSummary = summarizeTrials(trials, ["webview_rss_bytes"]);
  errors.push(
    ...compareToBudgets(
      { webview_bytes: rssSummary.webview_rss_bytes },
      { webview_bytes: config.budgets.rss.webview_bytes },
    ).map((item) => `${kind} rss ${item}`),
  );
  void timingKeys;
}

const releaseEvidence = validateReleaseEvidence(config);
errors.push(...releaseEvidence.failures.map((item) => `release evidence ${item}`));
if (process.env.RITUAL_REQUIRE_LIVE_LAUNCH_EVIDENCE === "1" && !releaseEvidence.complete) {
  errors.push("release evidence is incomplete (RITUAL_REQUIRE_LIVE_LAUNCH_EVIDENCE=1)");
}

const observability = read("apps/dashboard/lib/desktop-bridge/observability.ts");
if (!observability.includes("summarizeLaunchMilestones") || !observability.includes("recordLaunchMilestone")) {
  errors.push("Launch median summarizer is missing");
}

const providers = read("apps/dashboard/components/root-providers.tsx");
if (!providers.includes("providers_mounted") || !providers.includes("native_ready")) {
  errors.push("root-providers.tsx is missing required launch milestones");
}
if (!providers.includes("shell_bootstrap")) {
  errors.push("root-providers.tsx is missing the shell_bootstrap launch milestone");
}
if (!providers.includes("shell_paint")) {
  errors.push("root-providers.tsx is missing the shell_paint launch milestone");
}
if (!providers.includes("webview_rss_bytes") || !providers.includes("watcher_rss_bytes")) {
  errors.push("native_ready telemetry is missing RSS fields");
}
for (const event of ["watcher-start-requested", "watcher-ready", "watcher-failed", "watcher-rss-sampled"]) {
  if (!providers.includes(event)) errors.push(`root-providers.tsx is missing watcher event ${event}`);
}

const runtime = read("apps/dashboard/lib/desktop-bridge/runtime.ts");
if (!runtime.includes("webviewRssBytes") || !runtime.includes("watcherRssBytes")) {
  errors.push("DesktopProcessMetrics is missing RSS fields");
}

const rustRuntime = read("apps/desktop/src-tauri/src/desktop_runtime/mod.rs");
if (!rustRuntime.includes("webview_rss_bytes") || !rustRuntime.includes("watcher_rss_bytes")) {
  errors.push("DesktopProcessMetrics is missing RSS fields");
}

const captureScript = read("scripts/capture-desktop-launch-evidence.mjs");
for (const field of ["raw_artifact_sha256", "app_artifact_sha256", "watcher_readiness_time_ms", "watcher_pid", "watcher_rss_bytes"]) {
  if (!captureScript.includes(field)) errors.push(`Launch capture script is missing ${field}`);
}

const oauthStore = read("apps/dashboard/lib/server/oauth-code-store.ts");
if (oauthStore.includes("setInterval")) {
  errors.push("OAuth store-code must not keep process-level intervals");
}

if (errors.length) {
  console.error("Launch/RSS budget check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `Launch fixture budget check passed: 5 cold + 5 warm parser trials, milestones ${config.requiredMilestones.join(", ")}; release evidence ${releaseEvidence.complete ? "complete" : "incomplete"}.`,
);
