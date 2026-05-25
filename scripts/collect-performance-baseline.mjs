#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { mkdirSync } from "node:fs";

const root = process.cwd();
const outputPath = process.argv[2] || "reports/performance-baseline-current.json";

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

function lineCount(file) {
  return readFileSync(join(root, file), "utf8").split("\n").length;
}

const dashboardSources = walkSourceFiles("apps/dashboard", new Set([".ts", ".tsx"]));
const backendSources = walkSourceFiles("apps/backend", new Set([".py"]));
const apiRoutes = findFiles(["apps/dashboard/app/api", "-name", "route.ts", "-print"]);
const largestDashboardFiles = dashboardSources
  .map((file) => ({ file, lines: lineCount(file), bytes: statSync(join(root, file)).size }))
  .sort((a, b) => b.lines - a.lines)
  .slice(0, 20);

const baseline = {
  collected_at: new Date().toISOString(),
  source_metrics: {
    dashboard_api_routes: apiRoutes.length,
    dashboard_source_files: dashboardSources.length,
    dashboard_source_bytes: dashboardSources.reduce((sum, file) => sum + statSync(join(root, file)).size, 0),
    backend_python_files: backendSources.length,
    backend_python_bytes: backendSources.reduce((sum, file) => sum + statSync(join(root, file)).size, 0),
    largest_dashboard_files: largestDashboardFiles,
  },
  notes: [
    "This is a source-level baseline. For release performance, run after `npm run build` and compare Next build output plus app startup timings.",
    "Use this file before and after large refactors to catch source-size and route-count regressions.",
  ],
};

mkdirSync(dirname(join(root, outputPath)), { recursive: true });
writeFileSync(join(root, outputPath), `${JSON.stringify(baseline, null, 2)}\n`);
console.log(`Wrote performance baseline to ${outputPath}`);
