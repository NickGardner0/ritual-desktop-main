#!/usr/bin/env node
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const apiRoot = join(root, "apps/dashboard/app/api");
const budget = Number(process.env.RITUAL_DASHBOARD_API_ROUTE_BUDGET || 39);

function routeFiles(dir) {
  const entries = readdirSync(dir);
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...routeFiles(path));
    } else if (entry === "route.ts") {
      files.push(path);
    }
  }
  return files;
}

const routes = routeFiles(apiRoot);
if (routes.length > budget) {
  console.error(
    `Dashboard API route budget exceeded: ${routes.length}/${budget}. Use the shared proxy helper or generated backend client before adding routes.`,
  );
  process.exit(1);
}

console.log(`Dashboard API route budget passed: ${routes.length}/${budget}.`);
