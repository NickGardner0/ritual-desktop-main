#!/usr/bin/env node
/**
 * Pin ritual-watcher and ritual-vision-helper by SHA-256.
 * Rebuilds must update apps/desktop/src-tauri/binaries/sidecar-lock.json.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const lockPath = join(root, "apps/desktop/src-tauri/binaries/sidecar-lock.json");
const binariesDir = join(root, "apps/desktop/src-tauri/binaries");
const requiredTriple = process.env.RITUAL_REQUIRE_SIDECAR_TRIPLE?.trim() || "";

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function main() {
  if (!existsSync(lockPath)) {
    console.error(`Missing sidecar lock: ${lockPath}`);
    process.exit(1);
  }

  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  const sidecars = lock.sidecars || {};
  const shippedTargets = new Set(lock.shippedTargets || []);
  const errors = [];
  const checked = [];

  if (!shippedTargets.size) {
    errors.push("sidecar-lock.json must declare shippedTargets");
  }

  if (requiredTriple && !shippedTargets.has(requiredTriple)) {
    errors.push(
      `Required triple ${requiredTriple} is not a shipped sidecar target. 0.1.1 ships Apple Silicon only (${[...shippedTargets].join(", ") || "none"}).`,
    );
  }

  for (const [name, spec] of Object.entries(sidecars)) {
    const targets = spec.targets || {};
    for (const [triple, target] of Object.entries(targets)) {
      const file = join(binariesDir, target.file);
      const required = requiredTriple ? triple === requiredTriple : shippedTargets.has(triple);
      if (!existsSync(file)) {
        if (required) {
          errors.push(`Required sidecar missing: ${name} (${triple}) at ${file}`);
        }
        continue;
      }
      const actual = sha256File(file);
      checked.push(`${name} ${triple}`);
      if (actual !== target.sha256) {
        errors.push(
          `${name} (${triple}) hash mismatch.\n  expected ${target.sha256}\n  actual   ${actual}\n  Rebuild the helper, then update sidecar-lock.json.`,
        );
      }
    }
  }

  if (requiredTriple) {
    const lockedTriples = Object.values(sidecars).flatMap((spec) => Object.keys(spec.targets || {}));
    if (!lockedTriples.includes(requiredTriple) && shippedTargets.has(requiredTriple)) {
      errors.push(`sidecar-lock.json has no entry for required triple ${requiredTriple}`);
    }
  }

  if (errors.length) {
    console.error("Sidecar pin check failed:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log(`Sidecar pin check passed (${checked.length} binaries): ${checked.join(", ") || "none present"}`);
}

main();
