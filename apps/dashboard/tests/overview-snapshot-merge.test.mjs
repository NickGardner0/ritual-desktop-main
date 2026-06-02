import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");

function loadMergeModule() {
  const filename = join(
    process.cwd(),
    "apps/dashboard/lib/dashboard/overview-snapshot-merge.ts",
  );
  const source = readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const loadedModule = { exports: {} };
  const sandbox = {
    module: loadedModule,
    exports: loadedModule.exports,
    Object,
    Number,
    Math,
  };

  vm.runInNewContext(output, sandbox, { filename });
  return loadedModule.exports;
}

const {
  isDegradedOverviewPayload,
  mergeOverviewStatsPreservingKnownValues,
} = loadMergeModule();

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("degraded overview payload detection catches zeroed refetches", () => {
  const base = {
    caffeine: { total: 450, days_with_data: 4 },
    nicotine: { total: 80, days_with_data: 8 },
  };
  const incoming = {
    caffeine: { total: 0, days_with_data: 0 },
    nicotine: { total: 0, days_with_data: 0 },
  };

  assert.equal(isDegradedOverviewPayload(base, incoming), true);
});

test("merge preserves known non-zero stats when incoming payload zeros them", () => {
  const base = {
    caffeine: { total: 450, days_with_data: 4 },
    workout: { total: 1, days_with_data: 1 },
  };
  const incoming = {
    caffeine: { total: 0, days_with_data: 0 },
    workout: { total: 2, days_with_data: 1 },
  };

  assert.deepEqual(plain(mergeOverviewStatsPreservingKnownValues(base, incoming)), {
    caffeine: { total: 450, days_with_data: 4 },
    workout: { total: 2, days_with_data: 1 },
  });
});

test("merge keeps missing base values when the server omits a habit stat", () => {
  const base = {
    iphone: { total: 113.87, days_with_data: 6 },
  };
  const incoming = {
    workout: { total: 1, days_with_data: 1 },
  };

  assert.deepEqual(plain(mergeOverviewStatsPreservingKnownValues(base, incoming)), {
    iphone: { total: 113.87, days_with_data: 6 },
    workout: { total: 1, days_with_data: 1 },
  });
});
