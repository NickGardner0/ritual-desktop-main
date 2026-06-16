import test from "node:test";
import assert from "node:assert/strict";
import { checkApiClientBoundary } from "../../../scripts/check-no-direct-backend-fetch.mjs";

test("dashboard client code does not call backend URLs directly", () => {
  const { violations } = checkApiClientBoundary();

  assert.equal(
    violations.length,
    0,
    violations.length
      ? `Direct backend fetch violations:\n${violations
          .map((v) => `- ${v.file} (${v.pattern})`)
          .join("\n")}`
      : undefined,
  );
});
