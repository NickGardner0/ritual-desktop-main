#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const manifestPath = join(root, "tools/ops/backend-scripts.manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const allowedStatuses = new Set(Object.keys(manifest.statuses || {}));
const scriptsRoot = join(root, manifest.scriptsRoot || "apps/backend/scripts");

const actualScripts = readdirSync(scriptsRoot)
  .filter((name) => /\.(py|sh)$/.test(name))
  .filter((name) => name !== "__init__.py")
  .sort();
const manifestScripts = Object.keys(manifest.scripts || {}).sort();
const actualSet = new Set(actualScripts);
const manifestSet = new Set(manifestScripts);
const errors = [];

for (const script of actualScripts) {
  if (!manifestSet.has(script)) {
    errors.push(`Missing manifest entry for ${script}`);
  }
}

for (const script of manifestScripts) {
  if (!actualSet.has(script)) {
    errors.push(`Manifest entry has no matching script: ${script}`);
  }
  const entry = manifest.scripts[script];
  if (!entry?.owner) {
    errors.push(`Manifest entry needs owner: ${script}`);
  }
  if (!entry?.runtime || !["python", "shell"].includes(entry.runtime)) {
    errors.push(`Manifest entry needs runtime python|shell: ${script}`);
  }
  if (typeof entry?.smoke_test !== "string" || entry.smoke_test.trim().length < 10) {
    errors.push(`Manifest entry needs smoke_test command: ${script}`);
  }
  if (typeof entry?.review_action !== "string" || entry.review_action.trim().length < 20) {
    errors.push(`Manifest entry needs review_action: ${script}`);
  }
  if (!allowedStatuses.has(entry?.status)) {
    errors.push(`Manifest entry has invalid status "${entry?.status}" for ${script}`);
  }
}

if (errors.length) {
  console.error("Backend ops script manifest check failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Backend ops script manifest passed: ${actualScripts.length} scripts covered.`);
