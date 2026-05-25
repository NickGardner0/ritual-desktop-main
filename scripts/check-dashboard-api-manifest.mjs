#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const apiRoot = join(root, "apps/dashboard/app/api");
const manifestPath = join(root, "tools/dashboard-api-routes.manifest.json");

function routeFiles(dir) {
  const entries = readdirSync(dir);
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...routeFiles(path));
    } else if (entry === "route.ts") {
      files.push(relative(root, path));
    }
  }
  return files.sort();
}

if (!existsSync(manifestPath)) {
  console.error("Missing dashboard API route manifest: tools/dashboard-api-routes.manifest.json");
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const allowedCategories = new Set(manifest.categories || []);
const manifestRoutes = manifest.routes || {};
const actualRoutes = routeFiles(apiRoot);
const actualRouteSet = new Set(actualRoutes);
const manifestRouteSet = new Set(Object.keys(manifestRoutes));

let failed = false;

for (const route of actualRoutes) {
  const entry = manifestRoutes[route];
  if (!entry) {
    console.error(`Dashboard API route is missing from manifest: ${route}`);
    failed = true;
    continue;
  }

  if (!allowedCategories.has(entry.category)) {
    console.error(`Dashboard API route has invalid category "${entry.category}": ${route}`);
    failed = true;
  }

  if (typeof entry.reason !== "string" || entry.reason.trim().length < 20) {
    console.error(`Dashboard API route needs a concrete reason in the manifest: ${route}`);
    failed = true;
  }
}

for (const route of manifestRouteSet) {
  if (!actualRouteSet.has(route)) {
    console.error(`Dashboard API manifest contains a stale route: ${route}`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}

console.log(`Dashboard API route manifest passed: ${actualRoutes.length} routes allowlisted.`);
