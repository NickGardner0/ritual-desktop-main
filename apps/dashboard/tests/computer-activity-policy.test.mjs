import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");

function loadPolicyModule(isTauri = false) {
  const sourcePath = join(
    process.cwd(),
    "apps/dashboard/lib/computerActivity/policy.ts",
  );
  let source = readFileSync(sourcePath, "utf8");
  source = source.replace(
    /import\s+\{\s*isTauri\s*\}\s+from\s+'@\/lib\/native-gateway'\s*\n/,
    "",
  );
  source = source.replace(
    /import\s+type\s+\{[^}]+\}\s+from\s+'\.\/types'\s*\n/g,
    "",
  );
  source = `function isTauri() { return ${isTauri}; }\n${source}`;

  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;

  const loadedModule = { exports: {} };
  const sandbox = {
    module: loadedModule,
    exports: loadedModule.exports,
    Object,
    Math,
    Number,
    String,
    Array,
    Map,
    Set,
    Date,
  };

  vm.runInNewContext(output, sandbox, { filename: sourcePath });
  return loadedModule.exports;
}

function makeAggregate(totalActiveMs, overrides = {}) {
  return {
    summary: { total_active_ms: totalActiveMs, total_afk_ms: 0 },
    daily: [],
    apps: [],
    domains: [],
    ...overrides,
  };
}

function todayParts() {
  const today = new Date();
  const endDate = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");
  return { today, endDate };
}

function rangeEndingToday(days) {
  const { endDate } = todayParts();
  const start = new Date(`${endDate}T00:00:00`);
  start.setDate(start.getDate() - (days - 1));
  const startDate = [
    start.getFullYear(),
    String(start.getMonth() + 1).padStart(2, "0"),
    String(start.getDate()).padStart(2, "0"),
  ].join("-");
  return { startDate, endDate };
}

const {
  COMPUTER_ACTIVITY_POLICY,
  aggregateHasAnyData,
  asDesktopLocalTruth,
  getInclusiveRangeDays,
  rangeIncludesLocalToday,
  shouldAllowDesktopLocalFallback,
  shouldPreferRecentDesktopLocalTruth,
  shouldReadDesktopAggregateLocalFirst,
  shouldAllowDesktopAggregateLocalFallback,
  shiftDateString,
  getRangeCacheKey,
  buildSummaryFromDailyRows,
  stampReadSource,
  unavailableComputerStats,
} = loadPolicyModule(false);

const desktopPolicy = loadPolicyModule(true);

test("COMPUTER_ACTIVITY_POLICY exports expected range constants", () => {
  assert.equal(COMPUTER_ACTIVITY_POLICY.DESKTOP_STATS_DEFAULT_TIMEOUT_MS, 65000);
  assert.equal(COMPUTER_ACTIVITY_POLICY.DESKTOP_DAILY_TIMEOUT_MS, 65000);
  assert.equal(COMPUTER_ACTIVITY_POLICY.DESKTOP_RECENT_LOCAL_TRUTH_MAX_DAYS, 7);
  assert.equal(COMPUTER_ACTIVITY_POLICY.DESKTOP_LOCAL_FALLBACK_MAX_DAYS, 45);
});

const aggregateHasAnyDataCases = [
  {
    name: "empty aggregate has no data",
    aggregate: makeAggregate(0),
    expected: false,
  },
  {
    name: "nonzero summary counts as data",
    aggregate: makeAggregate(1000),
    expected: true,
  },
  {
    name: "nonempty daily rows count as data",
    aggregate: makeAggregate(0, {
      daily: [{ day: "2026-06-01", active_hours: 1, active_ms: 1000, events_count: 1 }],
    }),
    expected: true,
  },
  {
    name: "nonempty apps count as data",
    aggregate: makeAggregate(0, {
      apps: [{
        app_bundle_id: "com.test",
        app_name: "Test",
        total_active_ms: 1,
        total_events: 1,
        hours: 0,
      }],
    }),
    expected: true,
  },
];

for (const scenario of aggregateHasAnyDataCases) {
  test(`aggregateHasAnyData: ${scenario.name}`, () => {
    assert.equal(aggregateHasAnyData(scenario.aggregate), scenario.expected);
  });
}

test("asDesktopLocalTruth stamps an observable local source", () => {
  const input = makeAggregate(1000, {
    daily: [{ day: "2026-06-01", active_hours: 1, active_ms: 1000, events_count: 1, source: "synced" }],
    apps: [{
      app_bundle_id: "com.test",
      app_name: "Test",
      total_active_ms: 1000,
      total_events: 1,
      hours: 1,
      source: "synced",
    }],
    domains: [{
      domain: "example.com",
      total_active_ms: 1000,
      total_events: 1,
      hours: 1,
      source: "synced",
    }],
    source: "synced",
    state: "synced",
    sync_pending: true,
  });

  const result = asDesktopLocalTruth(input);
  assert.equal(result.source, "local");
  assert.equal(result.read_source, "local");
  assert.equal(result.state, "local");
  assert.equal(result.summary.source, "local");
  assert.equal(result.daily[0].source, "local");
  assert.equal(result.apps[0].source, "local");
  assert.equal(result.domains[0].source, "local");
  assert.equal(result.sync_pending, false);
});

test("stampReadSource and unavailableComputerStats expose local|synced|unavailable", () => {
  const synced = stampReadSource(makeAggregate(10), "synced");
  assert.equal(synced.read_source, "synced");
  assert.equal(synced.source, "synced");

  const unavailable = unavailableComputerStats();
  assert.equal(unavailable.read_source, "unavailable");
  assert.equal(unavailable.source, "unavailable");
  assert.equal(unavailable.summary.total_active_ms, 0);
  assert.equal(unavailable.daily.length, 0);
});

test("getInclusiveRangeDays counts inclusive calendar span", () => {
  assert.equal(
    getInclusiveRangeDays({ startDate: "2026-06-01", endDate: "2026-06-01" }),
    1,
  );
  assert.equal(
    getInclusiveRangeDays({ startDate: "2026-06-01", endDate: "2026-06-07" }),
    7,
  );
});

test("shiftDateString moves dates by offset", () => {
  assert.equal(shiftDateString("2026-06-15", -6), "2026-06-09");
  assert.equal(shiftDateString("2026-06-15", 1), "2026-06-16");
});

test("getRangeCacheKey includes prefix, range, and limit", () => {
  assert.equal(
    getRangeCacheKey("daily", { startDate: "2026-06-01", endDate: "2026-06-07" }),
    "daily:2026-06-01:2026-06-07:na",
  );
  assert.equal(
    getRangeCacheKey("apps", { startDate: "2026-06-01", endDate: "2026-06-07" }, 10),
    "apps:2026-06-01:2026-06-07:10",
  );
});

test("buildSummaryFromDailyRows aggregates active time and events", () => {
  const summary = buildSummaryFromDailyRows([
    { day: "2026-06-01", active_hours: 2, active_ms: 7_200_000, events_count: 10 },
    { day: "2026-06-02", active_hours: 0, active_ms: 0, events_count: 0 },
    { day: "2026-06-03", active_hours: 1, active_ms: 3_600_000, events_count: 5 },
  ], "local");

  assert.equal(summary.total_active_ms, 10_800_000);
  assert.equal(summary.total_events, 15);
  assert.equal(summary.days_tracked, 2);
  assert.equal(summary.source, "local");
});

test("web does not use desktop local fallback", () => {
  assert.equal(
    shouldAllowDesktopLocalFallback({ startDate: "2020-01-01", endDate: "2020-12-31" }),
    false,
  );
  assert.equal(
    shouldAllowDesktopAggregateLocalFallback({ startDate: "2026-06-01", endDate: "2026-06-07" }),
    false,
  );
});

test("desktop allows offline local reads for recent ranges including today", () => {
  const params = rangeEndingToday(7);
  assert.equal(desktopPolicy.shouldAllowDesktopLocalFallback(params), true);
  assert.equal(desktopPolicy.shouldAllowDesktopAggregateLocalFallback(params), true);
});

test("desktop suppresses offline local reads for large historical ranges", () => {
  const params = { startDate: "2020-01-01", endDate: "2020-12-31" };
  assert.equal(desktopPolicy.shouldAllowDesktopLocalFallback(params), false);
  assert.equal(desktopPolicy.shouldAllowDesktopAggregateLocalFallback(params), false);
});

test("shouldPreferRecentDesktopLocalTruth requires tauri and recent range including today", () => {
  const params = rangeEndingToday(7);
  assert.equal(shouldPreferRecentDesktopLocalTruth(params), false);
  assert.equal(desktopPolicy.shouldPreferRecentDesktopLocalTruth(params), true);
});

test("shouldReadDesktopAggregateLocalFirst mirrors recent desktop local truth policy", () => {
  const params = rangeEndingToday(7);
  assert.equal(shouldReadDesktopAggregateLocalFirst(params), false);
  assert.equal(desktopPolicy.shouldReadDesktopAggregateLocalFirst(params), true);
  assert.equal(
    desktopPolicy.shouldReadDesktopAggregateLocalFirst({ startDate: "2020-01-01", endDate: "2020-01-07" }),
    false,
  );
});

test("rangeIncludesLocalToday detects when today falls inside params", () => {
  const { endDate } = todayParts();
  assert.equal(
    rangeIncludesLocalToday({ startDate: "2020-01-01", endDate }),
    true,
  );
  assert.equal(
    rangeIncludesLocalToday({ startDate: "2020-01-01", endDate: "2020-01-31" }),
    false,
  );
});
