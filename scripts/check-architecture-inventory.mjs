#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const inventory = JSON.parse(readFileSync(join(root, "tools/architecture/current-state.json"), "utf8"));
const errors = [];

function walkRoutes(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) files.push(...walkRoutes(path));
    else if (entry === "route.ts") files.push(relative(root, path));
  }
  return files;
}

const routes = walkRoutes(join(root, "apps/dashboard/app/api"));
if (routes.length !== inventory.dashboardApi.routeCount) {
  errors.push(`Dashboard route inventory drifted: expected ${inventory.dashboardApi.routeCount}, found ${routes.length}`);
}
if (inventory.scheduler.jobs.length !== inventory.scheduler.jobCount) {
  errors.push("Scheduler inventory jobCount does not match its job list");
}
const schedulerRegistrySource = readFileSync(join(root, inventory.scheduler.owner), "utf8");
const schedulerExecutionSource = readFileSync(join(root, inventory.scheduler.executionOwner), "utf8");
const registryJobs = [...schedulerRegistrySource.matchAll(/SchedulerJobDefinition\("([^"]+)"/g)]
  .map((match) => match[1]);
if (registryJobs.length !== inventory.scheduler.jobCount) {
  errors.push(`Scheduler registry drifted: expected ${inventory.scheduler.jobCount}, found ${registryJobs.length}`);
}
for (const job of inventory.scheduler.jobs) {
  if (!registryJobs.includes(job)) errors.push(`Scheduler registry is missing ${job}`);
  if (!schedulerExecutionSource.includes(`"${job}"`)) errors.push(`Scheduler execution owner is missing ${job}`);
}
for (const adapter of inventory.scheduler.retainedExternalAdapters) {
  const adapterSource = readFileSync(join(root, adapter.path), "utf8");
  if (!adapterSource.includes(adapter.claimFunction)) {
    errors.push(`Retained scheduler adapter ${adapter.path} bypasses ${adapter.claimFunction}`);
  }
}
for (const path of [inventory.scheduler.owner, inventory.scheduler.executionOwner, inventory.scheduler.startupOwner, ...inventory.chatEntrypoints]) {
  if (!existsSync(join(root, path))) errors.push(`Inventory path is missing: ${path}`);
}

const acl = spawnSync("node", ["scripts/check-tauri-command-acl.mjs"], { cwd: root, encoding: "utf8" });
if (acl.status !== 0) {
  errors.push(`NativeGateway contract failed: ${(acl.stderr || acl.stdout).trim()}`);
} else {
  const match = acl.stdout.match(/\((\d+) registered, (\d+) allowed, (\d+) frontend-invoked, (\d+) typed signatures\)/);
  const expected = inventory.nativeGateway;
  if (!match || Number(match[1]) !== expected.registered || Number(match[2]) !== expected.allowed || Number(match[3]) !== expected.frontendInvoked || Number(match[4]) !== expected.typedSignatures) {
    errors.push(`NativeGateway inventory drifted: ${acl.stdout.trim()}`);
  }
}

const extra = inventory.nativeGateway.unregisteredTypedSignature;
const extraSource = readFileSync(join(root, extra.path), "utf8");
const handlerSource = readFileSync(join(root, "apps/desktop/src-tauri/src/main.rs"), "utf8");
if (!extraSource.includes(`fn ${extra.name}`) || !extraSource.includes("#[tauri::command]")) {
  errors.push(`Classified extra typed signature no longer exists at ${extra.path}`);
}
const handlerStart = handlerSource.indexOf("tauri::generate_handler![");
const handlerBlock = handlerSource.slice(handlerStart, handlerSource.indexOf("])", handlerStart));
if (handlerBlock.includes(extra.name)) errors.push(`${extra.name} is now registered but still classified as unreachable`);

if (errors.length) {
  console.error("Architecture inventory check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Architecture inventory passed (${routes.length} routes, ${inventory.scheduler.jobCount} jobs, ${inventory.nativeGateway.registered} NativeGateway commands).`);
