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
    summary[key] = median(trials.map((trial) => Number(trial[key])).filter((value) => Number.isFinite(value)));
  }
  return summary;
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
