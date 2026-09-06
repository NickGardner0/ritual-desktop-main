#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const committedOpenApi = join(root, "apps/backend/openapi.json");
const committedClient = join(root, "apps/dashboard/lib/api/generated/backend-client.ts");
const temporaryDirectory = mkdtempSync(join(tmpdir(), "ritual-backend-contracts-"));
const generatedOpenApi = join(temporaryDirectory, "openapi.json");
const generatedClient = join(temporaryDirectory, "backend-client.ts");
function generate() {
  execFileSync(
    "node",
    ["scripts/backend-python.mjs", "--", "scripts/export-backend-openapi.py", "--output", generatedOpenApi],
    { cwd: root, stdio: "pipe" },
  );
  execFileSync(
    "node",
    [
      "scripts/generate-backend-client.mjs",
      "--input",
      generatedOpenApi,
      "--output",
      generatedClient,
    ],
    { cwd: root, stdio: "pipe" },
  );
}

try {
  generate();
  const errors = [];
  if (readFileSync(committedOpenApi, "utf8") !== readFileSync(generatedOpenApi, "utf8")) {
    errors.push("apps/backend/openapi.json is stale relative to the FastAPI application.");
  }
  if (readFileSync(committedClient, "utf8") !== readFileSync(generatedClient, "utf8")) {
    errors.push("the generated dashboard backend client is stale relative to FastAPI OpenAPI.");
  }
  if (errors.length) {
    console.error("Generated backend client check failed:");
    for (const error of errors) console.error(`- ${error}`);
    console.error("Run npm run api:openapi && npm run api:generate-client. The OpenAPI command provisions the canonical locked Python environment.");
    process.exitCode = 1;
  } else {
    console.log("Generated backend client check passed against live FastAPI OpenAPI.");
  }
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
