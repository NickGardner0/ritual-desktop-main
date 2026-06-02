#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const manifest = JSON.parse(
  readFileSync(join(root, "tools/ops/backend-scripts.manifest.json"), "utf8"),
);

const failures = [];

for (const [script, entry] of Object.entries(manifest.scripts || {})) {
  const scriptPath = join(root, manifest.scriptsRoot || "apps/backend/scripts", script);
  try {
    if (entry.runtime === "python") {
      execFileSync("python3", ["-m", "py_compile", scriptPath], {
        cwd: root,
        stdio: "pipe",
      });
    } else if (entry.runtime === "shell") {
      execFileSync("bash", ["-n", scriptPath], {
        cwd: root,
        stdio: "pipe",
      });
    } else {
      failures.push(`${script}: unsupported runtime ${entry.runtime}`);
    }
  } catch (error) {
    failures.push(`${script}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failures.length) {
  console.error("Backend ops smoke check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Backend ops smoke check passed: ${Object.keys(manifest.scripts || {}).length} scripts syntax-checked.`);
