#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const configPath = join(root, "tools/dead-code/entrypoints.json");
const config = JSON.parse(readFileSync(configPath, "utf8"));
const errors = [];

function walk(dir, files = []) {
  if (!existsSync(dir)) {
    return files;
  }
  for (const entry of readdirSync(dir)) {
    if (["node_modules", "target", ".next", "dist", ".git", ".venv", "venv", "__pycache__"].includes(entry)) {
      continue;
    }
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      walk(fullPath, files);
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

for (const entrypoint of config.entrypoints || []) {
  if (!existsSync(join(root, entrypoint))) {
    errors.push(`Configured entrypoint does not exist: ${entrypoint}`);
  }
}

for (const removedPath of config.removedPaths || []) {
  if (existsSync(join(root, removedPath))) {
    errors.push(`Removed/dead path still exists: ${removedPath}`);
  }
}

const searchableRoots = ["apps", "packages", "scripts"]
  .map((item) => join(root, item))
  .filter((item) => existsSync(item));
const files = searchableRoots.flatMap((dir) => walk(dir));
const ownScript = join(root, "scripts/check-dead-code.mjs");
const recorderGuardScript = join(root, "scripts/check-removed-recorder.sh");

for (const file of files) {
  if (
    file === ownScript
    || file === recorderGuardScript
    || /\.(png|jpg|jpeg|gif|webp|otf|ttf|db|json|pyc)$/.test(file)
  ) {
    continue;
  }
  const source = readFileSync(file, "utf8");
  for (const pattern of config.forbiddenImportPatterns || []) {
    if (source.includes(pattern)) {
      errors.push(`${file.slice(root.length + 1)} references removed/dead surface "${pattern}"`);
    }
  }
}

if (errors.length) {
  console.error("Dead-code guard failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("Dead-code guard passed.");
