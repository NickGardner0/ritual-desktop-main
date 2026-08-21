#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compareToBudgets, summarizeTrials } from "../tools/performance/launch-budget-core.mjs";

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
  const timingKeys = Object.keys(config.budgets[kind] || {}).map((key) => key.replace(/_ms$/, "").replace(/_bytes$/, ""));
  const milestoneKeys = config.requiredMilestones;
  const timingSummary = summarizeTrials(trials, milestoneKeys);
  const renamed = {};
  for (const [key, value] of Object.entries(timingSummary)) {
    renamed[`${key}_ms`] = value;
  }
  errors.push(...compareToBudgets(renamed, config.budgets[kind]).map((item) => `${kind} ${item}`));

  const rssSummary = summarizeTrials(trials, ["webview_rss_bytes", "watcher_rss_bytes"]);
  errors.push(
    ...compareToBudgets(
      { webview_bytes: rssSummary.webview_rss_bytes, watcher_bytes: rssSummary.watcher_rss_bytes },
      config.budgets.rss,
    ).map((item) => `${kind} rss ${item}`),
  );
  void timingKeys;
}

const observability = read("apps/dashboard/lib/desktop-bridge/observability.ts");
if (!observability.includes("summarizeLaunchMilestones") || !observability.includes("recordLaunchMilestone")) {
  errors.push("Launch median summarizer is missing");
}

const providers = read("apps/dashboard/components/root-providers.tsx");
const bootstrap = read("apps/dashboard/app/desktop/bootstrap/page-client.tsx");
if (!providers.includes("providers_mounted") || !providers.includes("native_ready")) {
  errors.push("root-providers.tsx is missing required launch milestones");
}
if (!bootstrap.includes("shell_bootstrap")) {
  errors.push("desktop bootstrap is missing the shell_bootstrap launch milestone");
}
if (!providers.includes("webview_rss_bytes") || !providers.includes("watcher_rss_bytes")) {
  errors.push("native_ready telemetry is missing RSS fields");
}

const runtime = read("apps/dashboard/lib/desktop-bridge/runtime.ts");
if (!runtime.includes("webviewRssBytes") || !runtime.includes("watcherRssBytes")) {
  errors.push("DesktopProcessMetrics is missing RSS fields");
}

const rustRuntime = read("apps/desktop/src-tauri/src/desktop_runtime/mod.rs");
if (!rustRuntime.includes("webview_rss_bytes") || !rustRuntime.includes("watcher_rss_bytes")) {
  errors.push("DesktopProcessMetrics is missing RSS fields");
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
  `Launch/RSS budget check passed: 5 cold + 5 warm fixture medians, milestones ${config.requiredMilestones.join(", ")}.`,
);
