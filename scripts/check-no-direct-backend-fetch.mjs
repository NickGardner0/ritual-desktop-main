#!/usr/bin/env node
/**
 * Ensures browser-facing dashboard code uses the /api BFF proxy instead of
 * direct NEXT_PUBLIC_PYTHON_API_URL or localhost:8000 fetches.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const FORBIDDEN_PATTERNS = [
  /NEXT_PUBLIC_PYTHON_API_URL/,
  /127\.0\.0\.1:8000/,
  /localhost:8000/,
];

const ALLOWED_PREFIXES = [
  "apps/dashboard/lib/server/",
  "apps/dashboard/app/api/",
  "apps/dashboard/src/trigger/",
  "apps/dashboard/lib/api/trigger-client.ts",
  "apps/dashboard/lib/api/server-client.ts",
  "apps/dashboard/lib/server/proxy-helper.ts",
  "apps/dashboard/lib/api-config.ts",
  "apps/dashboard/app/actions/",
  "apps/dashboard/jobs/",
  "apps/dashboard/.env.example",
];

export function loadGrandfather(grandfatherPath) {
  if (!existsSync(grandfatherPath)) return new Set();
  const data = JSON.parse(readFileSync(grandfatherPath, "utf8"));
  return new Set(Array.isArray(data.files) ? data.files : []);
}

export function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walk(path, acc);
      continue;
    }
    if (!/\.(ts|tsx|js|jsx|mjs)$/.test(entry)) continue;
    acc.push(path);
  }
  return acc;
}

export function checkApiClientBoundary(options = {}) {
  const root = options.root ?? process.cwd();
  const dashboardRoot = join(root, "apps/dashboard");
  const grandfatherPath =
    options.grandfatherPath ?? join(root, "tools/api-client-boundary-grandfather.json");

  const grandfather = loadGrandfather(grandfatherPath);
  const files = walk(dashboardRoot);
  const violations = [];

  for (const file of files) {
    const rel = relative(root, file).replace(/\\/g, "/");
    if (ALLOWED_PREFIXES.some((prefix) => rel.startsWith(prefix))) continue;
    if (grandfather.has(rel)) continue;

    const content = readFileSync(file, "utf8");
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(content)) {
        violations.push({ file: rel, pattern: pattern.source });
        break;
      }
    }
  }

  return { files, violations };
}

function main() {
  const { files, violations } = checkApiClientBoundary();

  if (violations.length) {
    console.error("Direct backend fetch boundary violations:");
    for (const v of violations) {
      console.error(`- ${v.file} (matched ${v.pattern})`);
    }
    console.error(
      "\nUse apps/dashboard/lib/api/client.ts and relative /api paths instead.",
    );
    process.exit(1);
  }

  console.log(
    `API client boundary passed (${files.length} dashboard files scanned).`,
  );
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  main();
}
