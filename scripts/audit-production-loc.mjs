#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = join(root, "tools/architecture/production-loc.config.json");
const baselinePath = join(root, "tools/architecture/loc-baseline.json");
const reportPath = join(root, "docs/architecture/LOC_BASELINE.md");
const config = JSON.parse(readFileSync(configPath, "utf8"));
const checkOnly = process.argv.includes("--check");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${command} ${args.join(" ")} failed${detail ? `:\n${detail}` : ""}`);
  }
  return result.stdout.trim();
}

function trackedFiles() {
  const output = run("git", ["ls-files", "-z"]);
  return output.split("\0").filter(Boolean).sort();
}

function matchesAny(value, patterns) {
  return patterns.some((pattern) => new RegExp(pattern).test(value));
}

function filesForBucket(bucket, files) {
  const commonExcludes = config.commonExcludes || [];
  return files.filter((file) => {
    if (!bucket.extensions.includes(extname(file))) return false;
    if (!matchesAny(file, bucket.include)) return false;
    if (matchesAny(file, commonExcludes)) return false;
    if (matchesAny(file, bucket.exclude || [])) return false;
    return true;
  });
}

function countWithTokei(files) {
  if (!files.length) return { files: 0, code: 0, languages: {} };
  const parsed = JSON.parse(run("tokei", ["--output", "json", ...files]));
  const languages = {};
  for (const [language, data] of Object.entries(parsed)) {
    if (language === "Total") continue;
    languages[language] = {
      files: Array.isArray(data.reports) ? data.reports.length : 0,
      code: data.code || 0,
    };
  }
  return {
    files: files.length,
    code: Object.values(languages).reduce((sum, language) => sum + language.code, 0),
    languages,
  };
}

function countNonblankNoncomment(files) {
  let code = 0;
  for (const file of files) {
    for (const line of readFileSync(join(root, file), "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("--")) continue;
      code += 1;
    }
  }
  return { files: files.length, code, languages: { Tinybird: { files: files.length, code } } };
}

function digestSources(bucketFiles) {
  const hash = createHash("sha256");
  for (const [bucketId, files] of bucketFiles) {
    hash.update(`${bucketId}\0`);
    for (const file of files) {
      hash.update(`${file}\0`);
      hash.update(readFileSync(join(root, file)));
      hash.update("\0");
    }
  }
  return hash.digest("hex");
}

function stableMeasurement(value) {
  return {
    methodVersion: value.methodVersion,
    tokeiVersion: value.tokeiVersion,
    sourceDigest: value.sourceDigest,
    buckets: value.buckets,
    total: value.total,
  };
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function renderReport(measurement) {
  const target = config.targetBand;
  const targetMet = measurement.total >= target.minimum && measurement.total <= target.maximum;
  const bucketRows = measurement.buckets
    .map((bucket) => `| ${bucket.label} | ${formatNumber(bucket.files)} | ${formatNumber(bucket.code)} |`)
    .join("\n");
  const historyRows = config.historicalBaselines
    .map((entry) => {
      const delta = measurement.total - entry.lines;
      const signed = `${delta >= 0 ? "+" : "−"}${formatNumber(Math.abs(delta))}`;
      return `| ${entry.label} | ${formatNumber(entry.lines)} | ${signed} | ${entry.provenance} |`;
    })
    .join("\n");
  return `# Canonical authored-production LOC baseline

This is the single executable LOC baseline for the Ritual ship branch. It measures only git-tracked authored production files using the bucket and exclusion contract in \`tools/architecture/production-loc.config.json\`.

- Command: \`npm run audit:loc\`
- Verification: \`npm run audit:loc:check\`
- Head at measurement: \`${measurement.repository.headAtMeasurement}\`
- Source digest: \`${measurement.sourceDigest}\`
- Tokei: \`${measurement.tokeiVersion}\`
- Total: **${formatNumber(measurement.total)}**
- Historical 180,000–185,000 target: **${targetMet ? "met" : "not met"}**

## Current buckets

| Bucket | Files | Code lines |
|---|---:|---:|
${bucketRows}
| **Strict authored production, excluding iOS** | **${formatNumber(measurement.buckets.reduce((sum, bucket) => sum + bucket.files, 0))}** | **${formatNumber(measurement.total)}** |

## Historical reconciliation

| Claim | Lines | Current delta | Provenance |
|---|---:|---:|---|
${historyRows}

The 183.97k number is not a release-branch result and must not be used as proof that the original target was met. The former ~192.6k release value was an undocumented estimate. The original 192,474 count was a valid audit snapshot but described a dirty historical tree. This report supersedes those values for current ship-branch decisions.

The target band is descriptive, not permission to delete working product. If the total remains outside it after evidence-backed dead-code removal and owner consolidation, the architecture documents must report that result honestly.
`;
}

function main() {
  const actualVersion = run("tokei", ["--version"]).match(/tokei\s+([^\s]+)/)?.[1];
  if (actualVersion !== config.tokeiVersion) {
    throw new Error(`Expected tokei ${config.tokeiVersion}, found ${actualVersion || "unknown"}. Install the pinned version before measuring.`);
  }

  const files = trackedFiles();
  const bucketFiles = config.buckets.map((bucket) => [bucket.id, filesForBucket(bucket, files)]);
  const buckets = config.buckets.map((bucket, index) => {
    const selected = bucketFiles[index][1];
    const counted = bucket.counter === "nonblank_noncomment"
      ? countNonblankNoncomment(selected)
      : countWithTokei(selected);
    return { id: bucket.id, label: bucket.label, ...counted };
  });
  const measurement = {
    schemaVersion: 1,
    methodVersion: config.methodVersion,
    tokeiVersion: config.tokeiVersion,
    repository: {
      branchAtMeasurement: run("git", ["branch", "--show-current"]),
      headAtMeasurement: run("git", ["rev-parse", "HEAD"]),
    },
    sourceDigest: digestSources(bucketFiles),
    buckets,
    total: buckets.reduce((sum, bucket) => sum + bucket.code, 0),
  };

  if (checkOnly) {
    if (!existsSync(baselinePath) || !existsSync(reportPath)) {
      throw new Error("LOC baseline artifacts are missing. Run: npm run audit:loc");
    }
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
    if (JSON.stringify(stableMeasurement(baseline)) !== JSON.stringify(stableMeasurement(measurement))) {
      throw new Error("Authored-production LOC drifted from the committed baseline. Review the bucket delta, then run: npm run audit:loc");
    }
    if (readFileSync(reportPath, "utf8") !== renderReport(baseline)) {
      throw new Error("docs/architecture/LOC_BASELINE.md is out of sync. Run: npm run audit:loc");
    }
    console.log(`Canonical production LOC check passed (${measurement.total.toLocaleString("en-US")} lines, ${measurement.sourceDigest.slice(0, 12)}).`);
    return;
  }

  writeFileSync(baselinePath, `${JSON.stringify(measurement, null, 2)}\n`);
  writeFileSync(reportPath, renderReport(measurement));
  console.log(`Wrote canonical production LOC baseline: ${measurement.total.toLocaleString("en-US")} lines.`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
