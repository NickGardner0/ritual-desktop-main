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
    /import\s+\{\s*isTauri\s*\}\s+from\s+'@\/lib\/tauri-utils'\s*\n/,
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

const {
  COMPUTER_ACTIVITY_POLICY,
  preferDesktopLocalAggregate,
  aggregateHasAnyData,
  asDesktopLocalTruth,
  getInclusiveRangeDays,
  rangeIncludesLocalToday,
  shouldAllowDesktopLocalFallback,
  shouldPreferRecentDesktopLocalTruth,
  shouldAllowDesktopAggregateLocalFallback,
  shouldSupplementTodayFromLocal,
  shouldUseShortRangeNativeFallback,
  mergeTodayRow,
  shiftDateString,
  getRangeCacheKey,
  buildSummaryFromDailyRows,
} = loadPolicyModule(false);

const desktopPolicy = loadPolicyModule(true);

test("COMPUTER_ACTIVITY_POLICY exports expected range constants", () => {
  assert.equal(COMPUTER_ACTIVITY_POLICY.DESKTOP_STATS_DEFAULT_TIMEOUT_MS, 65000);
  assert.equal(COMPUTER_ACTIVITY_POLICY.DESKTOP_DAILY_TIMEOUT_MS, 65000);
  assert.equal(COMPUTER_ACTIVITY_POLICY.SHORT_RANGE_LOCAL_FALLBACK_MAX_DAYS, 2);
  assert.equal(COMPUTER_ACTIVITY_POLICY.DESKTOP_RECENT_LOCAL_TRUTH_MAX_DAYS, 7);
  assert.equal(COMPUTER_ACTIVITY_POLICY.DESKTOP_LOCAL_FALLBACK_MAX_DAYS, 45);
  assert.equal(COMPUTER_ACTIVITY_POLICY.DESKTOP_SUMMARY_CORRECTION_WINDOW_DAYS, 7);
  assert.equal(COMPUTER_ACTIVITY_POLICY.DESKTOP_LOCAL_TRUTH_MIN_DELTA_MS, 5 * 60 * 1000);
});

const preferDesktopLocalAggregateCases = [
  {
    name: "prefers local when delta exceeds minimum threshold",
    backendMs: 3_600_000,
    localMs: 3_600_000 + COMPUTER_ACTIVITY_POLICY.DESKTOP_LOCAL_TRUTH_MIN_DELTA_MS + 1,
    expected: true,
  },
  {
    name: "does not prefer local when delta equals threshold",
    backendMs: 3_600_000,
    localMs: 3_600_000 + COMPUTER_ACTIVITY_POLICY.DESKTOP_LOCAL_TRUTH_MIN_DELTA_MS,
    expected: false,
  },
  {
    name: "does not prefer local when backend is higher",
    backendMs: 5_000_000,
    localMs: 4_000_000,
    expected: false,
  },
  {
    name: "does not prefer local when local is zero",
    backendMs: 0,
    localMs: 0,
    expected: false,
  },
  {
    name: "prefers local over empty backend when local has data",
    backendMs: 0,
    localMs: COMPUTER_ACTIVITY_POLICY.DESKTOP_LOCAL_TRUTH_MIN_DELTA_MS + 1,
    expected: true,
  },
];

for (const scenario of preferDesktopLocalAggregateCases) {
  test(`preferDesktopLocalAggregate: ${scenario.name}`, () => {
    const backend = makeAggregate(scenario.backendMs);
    const local = makeAggregate(scenario.localMs);
    assert.equal(
      preferDesktopLocalAggregate(backend, local),
      scenario.expected,
    );
  });
}

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

test("asDesktopLocalTruth rewrites source metadata", () => {
  const input = makeAggregate(1000, {
    daily: [{ day: "2026-06-01", active_hours: 1, active_ms: 1000, events_count: 1, source: "tauri_fallback" }],
    apps: [{
      app_bundle_id: "com.test",
      app_name: "Test",
      total_active_ms: 1000,
      total_events: 1,
      hours: 1,
      source: "tauri_fallback",
    }],
    domains: [{
      domain: "example.com",
      total_active_ms: 1000,
      total_events: 1,
      hours: 1,
      source: "tauri_fallback",
    }],
    source: "tauri_fallback",
    state: "tauri_fallback",
    sync_pending: true,
  });

  const result = asDesktopLocalTruth(input);
  assert.equal(result.source, "tauri_local_truth");
  assert.equal(result.state, "desktop_local_truth");
  assert.equal(result.summary.source, "tauri_local_truth");
  assert.equal(result.daily[0].source, "tauri_fallback");
  assert.equal(result.apps[0].source, "tauri_fallback");
  assert.equal(result.domains[0].source, "tauri_fallback");
  assert.equal(result.sync_pending, false);
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
  ], "test_source");

  assert.equal(summary.total_active_ms, 10_800_000);
  assert.equal(summary.total_events, 15);
  assert.equal(summary.days_tracked, 2);
  assert.equal(summary.source, "test_source");
});

test("mergeTodayRow replaces missing or zero backend today with local today", () => {
  const today = new Date();
  const todayString = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");

  const backendRows = [
    { day: "2026-06-01", active_hours: 1, active_ms: 1000, events_count: 1 },
  ];
  const localRows = [
    { day: todayString, active_hours: 2, active_ms: 2000, events_count: 2, source: "tauri_fallback" },
  ];

  const merged = mergeTodayRow(backendRows, localRows);
  assert.equal(merged.length, 2);
  assert.equal(merged[1].day, todayString);
  assert.equal(merged[1].active_ms, 2000);
  assert.equal(merged[1].source, "tauri_fallback");
});

const desktopFallbackEligibilityCases = [
  {
    name: "web always allows local fallback helper",
    isTauri: false,
    fn: "shouldAllowDesktopLocalFallback",
    params: { startDate: "2020-01-01", endDate: "2020-12-31" },
    expected: true,
  },
  {
    name: "desktop allows fallback for short range including today",
    isTauri: true,
    fn: "shouldAllowDesktopLocalFallback",
    params: null,
    expected: true,
    dynamicTodayRange: 7,
  },
  {
    name: "desktop suppresses fallback for large historical range",
    isTauri: true,
    fn: "shouldAllowDesktopLocalFallback",
    params: { startDate: "2020-01-01", endDate: "2020-12-31" },
    expected: false,
  },
  {
    name: "desktop aggregate fallback only on tauri",
    isTauri: true,
    fn: "shouldAllowDesktopAggregateLocalFallback",
    params: { startDate: "2020-01-01", endDate: "2020-12-31" },
    expected: true,
  },
  {
    name: "web aggregate fallback helper returns false",
    isTauri: false,
    fn: "shouldAllowDesktopAggregateLocalFallback",
    params: { startDate: "2026-06-01", endDate: "2026-06-07" },
    expected: false,
  },
];

for (const scenario of desktopFallbackEligibilityCases) {
  test(`desktop policy eligibility: ${scenario.name}`, () => {
    const mod = loadPolicyModule(scenario.isTauri);
    let params = scenario.params;
    if (scenario.dynamicTodayRange) {
      const today = new Date();
      const endDate = [
        today.getFullYear(),
        String(today.getMonth() + 1).padStart(2, "0"),
        String(today.getDate()).padStart(2, "0"),
      ].join("-");
      const start = new Date(`${endDate}T00:00:00`);
      start.setDate(start.getDate() - (scenario.dynamicTodayRange - 1));
      const startDate = [
        start.getFullYear(),
        String(start.getMonth() + 1).padStart(2, "0"),
        String(start.getDate()).padStart(2, "0"),
      ].join("-");
      params = { startDate, endDate };
    }

    assert.equal(mod[scenario.fn](params), scenario.expected);
  });
}

test("shouldPreferRecentDesktopLocalTruth requires tauri and recent range including today", () => {
  const today = new Date();
  const endDate = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");
  const start = new Date(`${endDate}T00:00:00`);
  start.setDate(start.getDate() - 6);
  const startDate = [
    start.getFullYear(),
    String(start.getMonth() + 1).padStart(2, "0"),
    String(start.getDate()).padStart(2, "0"),
  ].join("-");
  const params = { startDate, endDate };

  assert.equal(shouldPreferRecentDesktopLocalTruth(params), false);
  assert.equal(desktopPolicy.shouldPreferRecentDesktopLocalTruth(params), true);
});

test("shouldSupplementTodayFromLocal is desktop-only when backend today is missing", () => {
  const today = new Date();
  const todayString = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");
  const params = { startDate: todayString, endDate: todayString };

  assert.equal(shouldSupplementTodayFromLocal(params, []), false);
  assert.equal(desktopPolicy.shouldSupplementTodayFromLocal(params, []), true);
  assert.equal(
    desktopPolicy.shouldSupplementTodayFromLocal(params, [{
      day: todayString,
      active_hours: 1,
      active_ms: 1000,
      events_count: 1,
    }]),
    false,
  );
});

test("shouldUseShortRangeNativeFallback allows only very short ranges including today", () => {
  const today = new Date();
  const endDate = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");

  assert.equal(
    shouldUseShortRangeNativeFallback({ startDate: endDate, endDate }),
    true,
  );

  const start = new Date(`${endDate}T00:00:00`);
  start.setDate(start.getDate() - 6);
  const startDate = [
    start.getFullYear(),
    String(start.getMonth() + 1).padStart(2, "0"),
    String(start.getDate()).padStart(2, "0"),
  ].join("-");

  assert.equal(
    shouldUseShortRangeNativeFallback({ startDate, endDate }),
    false,
  );
});

test("rangeIncludesLocalToday detects when today falls inside params", () => {
  const today = new Date();
  const todayString = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");

  assert.equal(
    rangeIncludesLocalToday({ startDate: "2020-01-01", endDate: todayString }),
    true,
  );
  assert.equal(
    rangeIncludesLocalToday({ startDate: "2020-01-01", endDate: "2020-01-31" }),
    false,
  );
});
