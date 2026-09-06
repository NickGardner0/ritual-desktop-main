export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Number(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(2))
    : sorted[mid];
}

export function summarizeTrials(trials, keys) {
  const summary = {};
  for (const key of keys) {
    summary[key] = median(
      trials
        .map((trial) => trial[key])
        .filter((value) => typeof value === "number" && Number.isFinite(value)),
    );
  }
  return summary;
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateTrackingTrial(trial, { release = false } = {}) {
  const failures = [];
  const prefix = trial.trial_id || "unnamed trial";
  if (release) {
    for (const key of ["trial_id", "raw_artifact_id", "source_sha", "app_version", "architecture", "channel"]) {
      if (!nonEmptyString(trial[key])) failures.push(`${prefix} is missing ${key}`);
    }
    if (trial.provenance !== "live") failures.push(`${prefix} must have live provenance`);
    if (!/^[a-f0-9]{64}$/i.test(trial.raw_artifact_sha256 || "")) {
      failures.push(`${prefix} is missing a full raw_artifact_sha256`);
    }
    if (!/^[a-f0-9]{64}$/i.test(trial.app_artifact_sha256 || "")) {
      failures.push(`${prefix} is missing a full app_artifact_sha256`);
    }
  }
  if (trial.tracking_state === "enabled") {
    if (!(trial.watcher_pid > 0)) failures.push(`${prefix} enabled trial is missing watcher_pid`);
    if (!(trial.watcher_readiness_time_ms >= 0)) {
      failures.push(`${prefix} enabled trial is missing watcher_readiness_time_ms`);
    }
    if (!(trial.watcher_rss_bytes > 0)) {
      failures.push(`${prefix} enabled trial requires nonzero watcher_rss_bytes`);
    }
    if (trial.watcher_rss_sample_state !== "sampled") {
      failures.push(`${prefix} enabled trial must have sampled watcher RSS`);
    }
  } else {
    if (trial.watcher_rss_bytes !== null) {
      failures.push(`${prefix} disabled/never-enabled watcher_rss_bytes must be null`);
    }
    if (trial.watcher_rss_sample_state !== "not_applicable") {
      failures.push(`${prefix} disabled/never-enabled RSS must be not_applicable`);
    }
    if (!nonEmptyString(trial.watcher_rss_reason)) {
      failures.push(`${prefix} disabled/never-enabled RSS requires a reason`);
    }
  }
  return failures;
}

export function validateReleaseEvidence(config) {
  const evidence = config.releaseEvidence || {};
  if (evidence.status !== "complete") {
    return {
      complete: false,
      failures: nonEmptyString(evidence.reason) ? [] : ["Incomplete release evidence requires a reason"],
    };
  }
  const failures = [];
  const trials = Array.isArray(evidence.trials) ? evidence.trials : [];
  for (const trial of trials) failures.push(...validateTrackingTrial(trial, { release: true }));
  for (const architecture of config.requiredArchitectures || []) {
    for (const channel of config.requiredChannels || []) {
      for (const kind of ["cold", "warm"]) {
        for (const trackingState of ["enabled", "disabled"]) {
          const group = trials.filter(
            (trial) =>
              trial.architecture === architecture &&
              trial.channel === channel &&
              trial.kind === kind &&
              (trackingState === "enabled"
                ? trial.tracking_state === "enabled"
                : ["never_enabled", "disabled_by_user", "disabled_no_permission"].includes(
                    trial.tracking_state,
                  )),
          );
          if (group.length !== config.trials) {
            failures.push(
              `${architecture}/${channel}/${kind}/${trackingState} requires exactly ${config.trials} trials, found ${group.length}`,
            );
            continue;
          }
          const timing = summarizeTrials(group, config.requiredMilestones);
          const timingSummary = Object.fromEntries(
            Object.entries(timing).map(([key, value]) => [`${key}_ms`, value]),
          );
          failures.push(
            ...compareToBudgets(timingSummary, config.budgets[kind]).map(
              (failure) => `${architecture}/${channel}/${kind}/${trackingState} ${failure}`,
            ),
          );
          const rss = summarizeTrials(group, ["webview_rss_bytes", "watcher_rss_bytes"]);
          const rssBudgets =
            trackingState === "enabled"
              ? config.budgets.rss
              : { webview_bytes: config.budgets.rss.webview_bytes };
          failures.push(
            ...compareToBudgets(
              {
                webview_bytes: rss.webview_rss_bytes,
                watcher_bytes: rss.watcher_rss_bytes,
              },
              rssBudgets,
            ).map(
              (failure) => `${architecture}/${channel}/${kind}/${trackingState} rss ${failure}`,
            ),
          );
        }
      }
    }
  }
  return { complete: failures.length === 0, failures };
}

export function compareToBudgets(summary, budgets) {
  const failures = [];
  for (const [key, budget] of Object.entries(budgets)) {
    const actual = summary[key];
    if (actual == null) {
      failures.push(`${key} has no median from the required trial set`);
      continue;
    }
    if (actual > budget) {
      failures.push(`${key} median ${actual} exceeds budget ${budget}`);
    }
  }
  return failures;
}
