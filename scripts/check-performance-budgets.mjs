#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const root = process.cwd();
const budgetPath = join(root, "tools/performance/budgets.json");
const config = JSON.parse(readFileSync(budgetPath, "utf8"));
const budgets = config.budgets || {};
const errors = [];

function lineCount(file) {
  return readFileSync(join(root, file), "utf8").split("\n").length;
}

function findFiles(args) {
  return execFileSync("find", args, { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

function walkSourceFiles(dir, extensions, files = []) {
  const ignored = new Set(["node_modules", ".next", "dist", "target", ".venv", "venv", "__pycache__"]);
  for (const entry of readdirSync(join(root, dir))) {
    if (ignored.has(entry)) continue;
    const relativePath = `${dir}/${entry}`;
    const absolutePath = join(root, relativePath);
    const stat = statSync(absolutePath);
    if (stat.isDirectory()) {
      walkSourceFiles(relativePath, extensions, files);
    } else if (extensions.has(extname(entry))) {
      files.push(relativePath);
    }
  }
  return files;
}

const dashboardApiRoutes = findFiles(["apps/dashboard/app/api", "-name", "route.ts"]);
if (dashboardApiRoutes.length > budgets.dashboardApiRoutesMax) {
  errors.push(`Dashboard API route count exceeded: ${dashboardApiRoutes.length}/${budgets.dashboardApiRoutesMax}`);
}

const dashboardSources = walkSourceFiles("apps/dashboard", new Set([".ts", ".tsx"]));
for (const file of dashboardSources) {
  const lines = lineCount(file);
  const isGenerated = file.startsWith("apps/dashboard/lib/api/generated/");
  const maxLines = isGenerated
    ? budgets.dashboardGeneratedFileMaxLines
    : budgets.dashboardTsxFileMaxLines;
  if (lines > maxLines) {
    errors.push(`Dashboard source file exceeds line budget: ${file} ${lines}/${maxLines}`);
  }
}

for (const file of [
  "apps/backend/services/whoop_service.py",
  "apps/backend/services/oura_service.py",
  "apps/backend/services/garmin_service.py",
]) {
  const lines = lineCount(file);
  if (lines > budgets.backendProviderServiceMaxLines) {
    errors.push(`Provider service exceeds line budget: ${file} ${lines}/${budgets.backendProviderServiceMaxLines}`);
  }
}

for (const [file, maxLines] of Object.entries(budgets.trackedFileMaxLines || {})) {
  if (!existsSync(join(root, file))) {
    errors.push(`Tracked performance file is missing: ${file}`);
    continue;
  }
  const lines = lineCount(file);
  if (lines > maxLines) {
    errors.push(`Tracked file grew beyond budget: ${file} ${lines}/${maxLines}`);
  }
}

if (errors.length) {
  console.error("Performance budget check failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(
  `Performance budget check passed: ${dashboardApiRoutes.length} API routes, ${dashboardSources.length} dashboard files checked.`,
);
