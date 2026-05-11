import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");

function loadBuilder() {
  const sourcePath = join(
    process.cwd(),
    "apps/dashboard/components/analytics/metric-context-builder.ts",
  );
  const source = readFileSync(sourcePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    console,
    Date,
    Intl,
    Math,
    Number,
    String,
    Array,
    Map,
    Set,
    encodeURIComponent,
  };

  vm.runInNewContext(output, sandbox, { filename: sourcePath });
  return module.exports;
}

const {
  buildMetricContextModel,
  getMetricContextFetchWindow,
} = loadBuilder();

test("manual habit context summarizes selected range and previous equal range", () => {
  const model = buildMetricContextModel({
    habit: { id: "reading", name: "Daily Reading", unit_type: "Pages" },
    displayValue: "90 Pages",
    dateRange: {
      from: new Date("2026-05-08T00:00:00"),
      to: new Date("2026-05-11T00:00:00"),
    },
    dailyRows: [
      { day: "2026-05-04", value: 10, entries_count: 1 },
      { day: "2026-05-05", value: 20, entries_count: 1 },
      { day: "2026-05-06", value: 10, entries_count: 1 },
      { day: "2026-05-07", value: 0, entries_count: 0 },
      { day: "2026-05-08", value: 30, entries_count: 1 },
      { day: "2026-05-09", value: 20, entries_count: 1 },
      { day: "2026-05-10", value: 40, entries_count: 1 },
      { day: "2026-05-11", value: 0, entries_count: 0 },
    ],
  });

  assert.equal(model.periodLabel, "May 8 - May 11");
  assert.equal(model.analysisPeriodLabel, "May 8 - May 11");
  assert.equal(model.snapshot.totalLabel, "90 Pages");
  assert.equal(model.snapshot.averageLabel, "30 Pages");
  assert.equal(model.snapshot.minLabel, "20 Pages");
  assert.equal(model.snapshot.maxLabel, "40 Pages");
  assert.equal(model.snapshot.trackedDaysLabel, "3 / 4");
  assert.equal(model.trend.currentTotal, 90);
  assert.equal(model.trend.previousTotal, 40);
  assert.equal(model.trend.direction, "up");
  assert.deepEqual(
    model.recentRows.map((row) => row.date),
    ["2026-05-10", "2026-05-09", "2026-05-08"],
  );
});

test("all-time context keeps all-time snapshot and compares recent seven days", () => {
  const window = getMetricContextFetchWindow(undefined, new Date("2026-05-11T12:00:00"));
  assert.deepEqual(
    {
      startDate: window.startDate,
      endDate: window.endDate,
      currentStartDate: window.currentStartDate,
      currentEndDate: window.currentEndDate,
      previousStartDate: window.previousStartDate,
      previousEndDate: window.previousEndDate,
      mode: window.mode,
    },
    {
      startDate: "2026-04-28",
      endDate: "2026-05-11",
      currentStartDate: "2026-05-05",
      currentEndDate: "2026-05-11",
      previousStartDate: "2026-04-28",
      previousEndDate: "2026-05-04",
      mode: "recent",
    },
  );

  const model = buildMetricContextModel({
    habit: { id: "coding", name: "Coding", unit_type: "Hours" },
    displayValue: "840.19 Hours",
    currentDate: new Date("2026-05-11T12:00:00"),
    displayStats: {
      unitLabel: "Hours",
      sumFormatted: "840.19 Hours",
      avgFormatted: "2.4 Hours",
      minFormatted: "0.1 Hours",
      maxFormatted: "12 Hours",
      trackedDays: 365,
      daysWithData: 210,
    },
    dailyRows: [
      { day: "2026-04-28", value: 1 },
      { day: "2026-04-29", value: 1 },
      { day: "2026-05-05", value: 2 },
      { day: "2026-05-06", value: 3 },
    ],
  });

  assert.equal(model.periodLabel, "All time");
  assert.equal(model.analysisPeriodLabel, "past 7 days");
  assert.equal(model.snapshot.totalLabel, "840.19 Hours");
  assert.equal(model.trend.currentTotal, 5);
  assert.equal(model.trend.previousTotal, 2);
});

test("empty context returns safe zero sections", () => {
  const model = buildMetricContextModel({
    habit: { id: "sauna", name: "Sauna", unit_type: "Minutes" },
    displayValue: "0 Minutes",
    currentDate: new Date("2026-05-11T12:00:00"),
    dailyRows: [],
  });

  assert.equal(model.snapshot.totalLabel, "0 Minutes");
  assert.equal(model.snapshot.trackedDaysLabel, "0 / 7");
  assert.equal(model.trend.currentTotal, 0);
  assert.equal(model.trend.previousTotal, 0);
  assert.equal(model.recentRows.length, 0);
  assert.match(model.emptyState, /No Sauna rows found/);
});

test("computer context uses watcher daily rows plus top apps and websites", () => {
  const model = buildMetricContextModel({
    habit: { id: "computer", name: "Computer Time", unit_type: "Hours" },
    displayValue: "271.38 Hours",
    currentDate: new Date("2026-05-11T12:00:00"),
    isComputerTime: true,
    displayStats: {
      unitLabel: "Hours",
      sumFormatted: "271.38 Hours",
      avgFormatted: "5.2 Hours",
      minFormatted: "0.5 Hours",
      maxFormatted: "9.5 Hours",
      trackedDays: 70,
      daysWithData: 62,
    },
    computerDailyRows: [
      { day: "2026-05-04", active_hours: 1, events_count: 10 },
      { day: "2026-05-05", active_hours: 2, events_count: 20 },
      { day: "2026-05-06", active_hours: 3, events_count: 30 },
      { day: "2026-05-07", active_hours: 4, events_count: 40 },
      { day: "2026-05-08", active_hours: 5, events_count: 50 },
      { day: "2026-05-09", active_hours: 6, events_count: 60 },
      { day: "2026-05-10", active_hours: 7, events_count: 70 },
      { day: "2026-05-11", active_hours: 8, events_count: 80 },
    ],
    computerTopApps: [
      { app_name: "Cursor", hours: 12.5, total_events: 100 },
      { app_bundle_id: "com.apple.Safari", total_active_ms: 3_600_000, total_events: 20 },
    ],
    computerTopDomains: [
      { domain: "localhost", hours: 4.25, total_events: 44 },
    ],
  });

  assert.equal(model.unitLabel, "Hours");
  assert.equal(model.trend.currentTotal, 35);
  assert.equal(model.trend.previousTotal, 1);
  assert.equal(model.topApps[0].label, "Cursor");
  assert.equal(model.topApps[0].value, "12.5 Hours");
  assert.equal(model.topDomains[0].label, "localhost");
  assert.equal(model.topDomains[0].value, "4.25 Hours");
});

test("context includes deterministic insight cards and source metadata", () => {
  const model = buildMetricContextModel({
    habit: {
      id: "sleep",
      name: "Sleep Duration",
      unit_type: "Hours",
      integration_source: "apple_health",
    },
    displayValue: "1,461.1 Hours",
    currentDate: new Date("2026-05-11T12:00:00"),
    dailyRows: [
      { day: "2026-05-05", value: 7 },
      { day: "2026-05-06", value: 7.5 },
      { day: "2026-05-07", value: 8 },
      { day: "2026-05-08", value: 6 },
      { day: "2026-05-09", value: 7 },
      { day: "2026-05-10", value: 8.25 },
      { day: "2026-05-11", value: 7.25 },
      { day: "2026-04-28", value: 6 },
      { day: "2026-04-29", value: 6 },
    ],
  });

  assert.equal(model.insightCards.length, 4);
  assert.equal(model.insightCards[0].label, "Change");
  assert.equal(model.insightCards[1].label, "Consistency");
  assert.equal(model.insightCards[1].value, "7 / 7");
  assert.equal(model.sourceSignals[0].label, "Source");
  assert.equal(model.sourceSignals[0].value, "Apple Health");
});

test("nearby signals compare selected high days against peer metrics without causal language", () => {
  const model = buildMetricContextModel({
    habit: { id: "coding", name: "Coding", unit_type: "Hours" },
    displayValue: "20 Hours",
    dateRange: {
      from: new Date("2026-05-05T00:00:00"),
      to: new Date("2026-05-11T00:00:00"),
    },
    dailyRows: [
      { day: "2026-05-05", value: 1 },
      { day: "2026-05-06", value: 2 },
      { day: "2026-05-07", value: 7 },
      { day: "2026-05-08", value: 1 },
      { day: "2026-05-09", value: 8 },
      { day: "2026-05-10", value: 0 },
      { day: "2026-05-11", value: 1 },
    ],
    peerDailyRows: [
      {
        habitId: "caffeine",
        habitName: "Caffeine",
        unitLabel: "MG",
        rows: [
          { day: "2026-05-05", value: 80 },
          { day: "2026-05-06", value: 100 },
          { day: "2026-05-07", value: 240 },
          { day: "2026-05-08", value: 60 },
          { day: "2026-05-09", value: 260 },
          { day: "2026-05-11", value: 70 },
        ],
      },
    ],
  });

  const caffeineSignals = model.relatedSignals.filter((signal) => signal.label === "Caffeine");
  assert.ok(caffeineSignals.length >= 1);
  assert.ok(caffeineSignals.some((signal) => signal.detail.includes("highest day") || signal.detail.includes("higher days")));
  assert.ok(caffeineSignals.every((signal) => !/caused|because/i.test(signal.detail)));
});
