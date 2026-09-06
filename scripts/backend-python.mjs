#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const requiredPython = "3.12.12";
const requiredFastApi = "0.119.0";
const requiredPydantic = "2.12.2";
const lockPath = join(root, "apps/backend/requirements.lock.txt");
const railwayRequirementPath = join(root, "apps/backend/requirements.txt");
const requirementInputs = ["apps/backend/requirements.in", "apps/backend/requirements-dev.in"];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0) {
    const detail = options.capture
      ? [result.stdout, result.stderr].filter(Boolean).join("\n").trim()
      : "";
    throw new Error(`${command} ${args.join(" ")} failed${detail ? `:\n${detail}` : ""}`);
  }
  return options.capture ? result.stdout.trim() : "";
}

function executableOnPath(name) {
  for (const directory of (process.env.PATH || "").split(delimiter)) {
    const candidate = join(directory, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function pythonVersion(interpreter) {
  return run(interpreter, ["-c", "import platform; print(platform.python_version())"], { capture: true });
}

function sourcePython() {
  if (process.env.BACKEND_PYTHON) {
    const version = pythonVersion(process.env.BACKEND_PYTHON);
    if (version !== requiredPython) {
      throw new Error(`BACKEND_PYTHON must be Python ${requiredPython}; found ${version}.`);
    }
    return process.env.BACKEND_PYTHON;
  }
  const candidates = [executableOnPath("python3.12"), executableOnPath("python3")].filter(Boolean);
  const uv = executableOnPath("uv");
  if (uv) {
    const found = spawnSync(uv, ["python", "find", requiredPython], { cwd: root, encoding: "utf8" });
    if (found.status === 0 && found.stdout.trim()) candidates.push(found.stdout.trim());
  }
  for (const candidate of [...new Set(candidates)]) {
    try {
      if (pythonVersion(candidate) === requiredPython) return candidate;
    } catch {
      // Continue to the next explicit candidate.
    }
  }
  throw new Error(
    `Ritual backend requires Python ${requiredPython}. Install it (for example: uv python install ${requiredPython}) or set BACKEND_PYTHON to that exact interpreter.`,
  );
}

function requirementInputDigest() {
  const hash = createHash("sha256");
  for (const path of requirementInputs) {
    hash.update(`${path}\0`);
    hash.update(readFileSync(join(root, path)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function lockedInterpreter() {
  if (process.env.BACKEND_PYTHON) {
    const overrideVersion = pythonVersion(process.env.BACKEND_PYTHON);
    if (overrideVersion !== requiredPython) {
      throw new Error(`BACKEND_PYTHON must be Python ${requiredPython}; found ${overrideVersion}.`);
    }
  }
  if (!existsSync(lockPath)) {
    throw new Error("Missing apps/backend/requirements.lock.txt. Regenerate it with the documented uv pip compile command.");
  }
  const lockSource = readFileSync(lockPath);
  if (
    !existsSync(railwayRequirementPath)
    || !readFileSync(railwayRequirementPath).equals(lockSource)
  ) {
    throw new Error(
      "Railway requirements.txt drifted from requirements.lock.txt. Run: npm run backend:lock",
    );
  }
  const lockText = lockSource.toString("utf8");
  const recordedInputDigest = lockText.match(/^# ritual-input-sha256: ([a-f0-9]{64})$/m)?.[1];
  if (recordedInputDigest !== requirementInputDigest()) {
    throw new Error("Backend requirement inputs drifted from requirements.lock.txt. Run: npm run backend:lock");
  }
  const recordedPython = lockText.match(/^# ritual-python-version: ([^\s]+)$/m)?.[1];
  if (recordedPython !== requiredPython) {
    throw new Error(`Backend lock targets Python ${recordedPython || "unknown"}; expected ${requiredPython}. Run: npm run backend:lock`);
  }
  const lockHash = createHash("sha256").update(lockSource).digest("hex").slice(0, 16);
  const environment = join(root, ".venv", `backend-py${requiredPython}-${lockHash}`);
  const interpreter = join(environment, "bin", "python");
  if (!existsSync(interpreter)) {
    mkdirSync(join(root, ".venv"), { recursive: true });
    run(sourcePython(), ["-m", "venv", environment]);
    run(interpreter, [
      "-m", "pip", "install", "--disable-pip-version-check", "--require-hashes", "-r", lockPath,
    ]);
  }
  const contract = run(interpreter, [
    "-c",
    "import fastapi, pydantic, platform; print('|'.join((platform.python_version(), fastapi.__version__, pydantic.__version__)))",
  ], { capture: true });
  const expected = `${requiredPython}|${requiredFastApi}|${requiredPydantic}`;
  if (contract !== expected) {
    throw new Error(`Locked backend environment drifted: expected ${expected}, found ${contract}`);
  }
  return interpreter;
}

function main() {
  const separator = process.argv.indexOf("--");
  const args = separator === -1 ? [] : process.argv.slice(separator + 1);
  if (!args.length) {
    throw new Error("Usage: node scripts/backend-python.mjs -- <python arguments>");
  }
  run(lockedInterpreter(), args, {
    env: {
      ...process.env,
      RITUAL_BACKEND_LOCKED_PYTHON: "1",
    },
  });
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
