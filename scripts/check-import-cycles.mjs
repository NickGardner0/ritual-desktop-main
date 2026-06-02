#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, relative, resolve } from "node:path";

const root = process.cwd();
const scanRoots = [
  "apps/dashboard/app",
  "apps/dashboard/components",
  "apps/dashboard/contexts",
  "apps/dashboard/hooks",
  "apps/dashboard/lib",
  "packages/chat-runtime/src",
].map((item) => join(root, item));
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);
const ignoredDirs = new Set(["node_modules", ".next", "dist", "target", "__pycache__"]);
const importPattern =
  /(?:import\s+(?:type\s+)?(?:[^'"]+?\s+from\s+)?|export\s+(?:type\s+)?[^'"]*?\s+from\s+|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g;

function walk(dir, files = []) {
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir)) {
    if (ignoredDirs.has(entry)) continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) walk(fullPath, files);
    else if (sourceExtensions.has(extname(entry))) files.push(fullPath);
  }
  return files;
}

const files = scanRoots.flatMap((dir) => walk(dir)).sort();
const fileSet = new Set(files.map((file) => normalize(file)));

function resolveImport(fromFile, specifier) {
  if (!specifier.startsWith(".") && !specifier.startsWith("@/")) return null;
  const base = specifier.startsWith("@/")
    ? join(root, "apps/dashboard", specifier.slice(2))
    : resolve(dirname(fromFile), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.mjs`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
    join(base, "index.js"),
    join(base, "index.jsx"),
  ].map((candidate) => normalize(candidate));
  return candidates.find((candidate) => fileSet.has(candidate)) || null;
}

const graph = new Map();
for (const file of files) {
  const source = readFileSync(file, "utf8");
  const imports = new Set();
  importPattern.lastIndex = 0;
  let match;
  while ((match = importPattern.exec(source))) {
    const resolvedImport = resolveImport(file, match[1]);
    if (resolvedImport && resolvedImport !== normalize(file)) {
      imports.add(resolvedImport);
    }
  }
  graph.set(normalize(file), [...imports].sort());
}

const visiting = new Set();
const visited = new Set();
const stack = [];
const cycles = [];
const seenCycles = new Set();

function recordCycle(file) {
  const start = stack.indexOf(file);
  const cycle = [...stack.slice(start), file];
  const labels = cycle.map((item) => relative(root, item));
  const key = labels.slice(0, -1).sort().join("|");
  if (!seenCycles.has(key)) {
    seenCycles.add(key);
    cycles.push(labels);
  }
}

function visit(file) {
  if (visited.has(file)) return;
  if (visiting.has(file)) {
    recordCycle(file);
    return;
  }
  visiting.add(file);
  stack.push(file);
  for (const next of graph.get(file) || []) {
    visit(next);
  }
  stack.pop();
  visiting.delete(file);
  visited.add(file);
}

for (const file of graph.keys()) {
  visit(file);
}

if (cycles.length) {
  console.error("Import cycle check failed:");
  for (const cycle of cycles) {
    console.error(`- ${cycle.join(" -> ")}`);
  }
  process.exit(1);
}

console.log(`Import cycle check passed: ${graph.size} files scanned.`);
