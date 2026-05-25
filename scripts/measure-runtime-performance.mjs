#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const outputPath = process.argv.includes("--output")
  ? process.argv[process.argv.indexOf("--output") + 1]
  : "reports/runtime-performance-current.json";
const port = Number(process.argv.includes("--port") ? process.argv[process.argv.indexOf("--port") + 1] : 3100);
const skipBuild = args.has("--skip-build");
const skipStart = args.has("--skip-start");

function directoryBytes(dir) {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    total += stat.isDirectory() ? directoryBytes(path) : stat.size;
  }
  return total;
}

function readPackageVersion(packageName) {
  const packagePath = join(root, "node_modules", packageName, "package.json");
  if (!existsSync(packagePath)) return null;
  return JSON.parse(readFileSync(packagePath, "utf8")).version || null;
}

function runCommand(name, command, commandArgs, options = {}) {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    const child = spawn(command, commandArgs, {
      cwd: options.cwd || root,
      env: { ...process.env, CI: "1", ...(options.env || {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output = [];
    const capture = (chunk) => {
      output.push(chunk.toString());
      if (output.join("").length > 20000) {
        output.splice(0, output.length - 8);
      }
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    child.on("close", (code) => {
      resolve({
        name,
        command: [command, ...commandArgs].join(" "),
        status: code === 0 ? "success" : "failed",
        exit_code: code,
        duration_ms: Math.round(performance.now() - startedAt),
        output_tail: output.join("").slice(-12000),
      });
    });
  });
}

async function waitForHttp(url, timeoutMs) {
  const startedAt = performance.now();
  let lastError = null;
  while (performance.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      return {
        status: "ready",
        status_code: response.status,
        ready_ms: Math.round(performance.now() - startedAt),
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  return {
    status: "timeout",
    ready_ms: Math.round(performance.now() - startedAt),
    error: lastError,
  };
}

async function measureStart() {
  const dashboardCwd = join(root, "apps/dashboard");
  const startedAt = performance.now();
  const child = spawn("npx", ["next", "start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: dashboardCwd,
    env: { ...process.env, NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = [];
  const capture = (chunk) => output.push(chunk.toString());
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);

  const readiness = await waitForHttp(`http://127.0.0.1:${port}`, 30000);
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("close", resolve));

  return {
    name: "next-start-readiness",
    command: `npx next start -p ${port} -H 127.0.0.1`,
    status: readiness.status === "ready" ? "success" : "failed",
    duration_ms: Math.round(performance.now() - startedAt),
    readiness,
    output_tail: output.join("").slice(-12000),
  };
}

const measurements = {
  collected_at: new Date().toISOString(),
  node_version: process.version,
  next_version: readPackageVersion("next"),
  commands: [],
  artifacts: {},
};

if (!skipBuild) {
  measurements.commands.push(await runCommand("production-build", "npm", ["run", "build"]));
}

measurements.artifacts.next_build_bytes = directoryBytes(join(root, "apps/dashboard/.next"));
measurements.artifacts.next_static_bytes = directoryBytes(join(root, "apps/dashboard/.next/static"));
measurements.artifacts.server_app_bytes = directoryBytes(join(root, "apps/dashboard/.next/server/app"));

if (!skipStart) {
  if (existsSync(join(root, "apps/dashboard/.next"))) {
    measurements.commands.push(await measureStart());
  } else {
    measurements.commands.push({
      name: "next-start-readiness",
      status: "skipped",
      reason: "apps/dashboard/.next does not exist; run without --skip-build first.",
    });
  }
}

mkdirSync(dirname(join(root, outputPath)), { recursive: true });
writeFileSync(join(root, outputPath), `${JSON.stringify(measurements, null, 2)}\n`);
console.log(`Wrote runtime performance measurements to ${outputPath}`);

if (measurements.commands.some((command) => command.status === "failed")) {
  process.exit(1);
}
