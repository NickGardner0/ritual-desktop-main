import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildWeeklyOverviewCanvasPayload,
  getStrictThisWeekRange,
} from "../lib/ai/chat-stream/weekly-overview-utils.mjs";

function readSnapshot(name) {
  const path = join(
    process.cwd(),
    "apps",
    "dashboard",
    "tests",
    "__snapshots__",
    name,
  );
  return JSON.parse(readFileSync(path, "utf-8"));
}

test("getStrictThisWeekRange uses calendar week (Mon -> today) for fixed timestamp", () => {
  const now = new Date("2026-02-27T18:00:00Z");
  const result = getStrictThisWeekRange("America/Los_Angeles", now);
  const snapshot = readSnapshot(
    "weekly-overview-this-week-range.snapshot.json",
  );

  assert.deepEqual(result, snapshot);
});

test("buildWeeklyOverviewCanvasPayload matches snapshot contract", () => {
  const payload = buildWeeklyOverviewCanvasPayload({
    startDate: "2026-02-23",
    endDate: "2026-02-27",
    days: 5,
    allHabits: [
      {
        id: "h1",
        name: "Sleep Duration",
        unit: "hours",
        total: 43.77,
        average: 7.29,
        min: 4.37,
        max: 8.6,
        days_with_data: 6,
        total_entries: 6,
      },
      {
        id: "h2",
        name: "Caffeine Consumption",
        unit: "mg",
        total: 453,
        average: 225,
        min: 200,
        max: 250,
        days_with_data: 2,
        total_entries: 2,
      },
      {
        id: "h3",
        name: "Nicotine Consumption",
        unit: "mg",
        total: 65,
        average: 16.25,
        min: 9,
        max: 20,
        days_with_data: 4,
        total_entries: 4,
      },
      {
        id: "h4",
        name: "Meditation",
        unit: "minutes",
        total: 0,
        average: 0,
        min: 0,
        max: 0,
        days_with_data: 0,
        total_entries: 0,
      },
    ],
    dailyByHabitId: new Map([
      [
        "h1",
        [
          { date: "2026-02-23", value: 4.37, entries: [{}] },
          { date: "2026-02-24", value: 8.6, entries: [{}] },
        ],
      ],
      [
        "h2",
        [
          { date: "2026-02-24", value: 200, entries: [{}] },
          { date: "2026-02-26", value: 253, entries: [{}] },
        ],
      ],
      [
        "h3",
        [
          { date: "2026-02-23", value: 9, entries: [{}] },
          { date: "2026-02-24", value: 20, entries: [{}] },
        ],
      ],
    ]),
    watcherDailyRows: [
      { day: "2026-02-23", active_hours: 0.23, events_count: 21, apps_count: 3 },
      { day: "2026-02-24", active_hours: 4.08, events_count: 45, apps_count: 5 },
      { day: "2026-02-25", active_hours: 8.04, events_count: 56, apps_count: 6 },
      { day: "2026-02-26", active_hours: 9.35, events_count: 66, apps_count: 6 },
    ],
    topApps: [
      { app_name: "Cursor", hours: 7.2, total_events: 120 },
      { app_name: "Google Chrome", hours: 6.1, total_events: 140 },
    ],
    topDomains: [
      { domain: "github.com", hours: 2.4, total_events: 52 },
      { domain: "prometheus.io", hours: 1.9, total_events: 36 },
    ],
  });

  const snapshot = readSnapshot(
    "weekly-overview-canvas-payload.snapshot.json",
  );
  assert.deepEqual(payload, snapshot);
});

test("buildWeeklyOverviewCanvasPayload excludes manual computer habit when watcher data exists", () => {
  const payload = buildWeeklyOverviewCanvasPayload({
    startDate: "2026-02-23",
    endDate: "2026-02-27",
    days: 5,
    allHabits: [
      {
        id: "h1",
        name: "Computer Use",
        unit: "hours",
        total: 8.97,
        average: 8.97,
        min: 8.97,
        max: 8.97,
        days_with_data: 1,
        total_entries: 1,
      },
      {
        id: "h2",
        name: "Coding",
        unit: "hours",
        total: 10,
        average: 10,
        min: 10,
        max: 10,
        days_with_data: 1,
        total_entries: 1,
      },
    ],
    dailyByHabitId: new Map([
      ["h1", [{ date: "2026-02-26", value: 8.97, entries: [{}] }]],
      ["h2", [{ date: "2026-02-26", value: 10, entries: [{}] }]],
    ]),
    watcherDailyRows: [
      { day: "2026-02-26", active_hours: 9.77, events_count: 1032, apps_count: 7 },
    ],
    topApps: [],
    topDomains: [],
  });

  const habitNames = payload.habits.map((habit) => habit.name);
  assert.equal(habitNames.includes("Computer Use"), false);
  assert.equal(habitNames.includes("Coding"), true);
  assert.equal(payload.computer_activity.total_hours, 9.77);
});

test("buildWeeklyOverviewCanvasPayload keeps manual computer habit when watcher data is absent", () => {
  const payload = buildWeeklyOverviewCanvasPayload({
    startDate: "2026-02-23",
    endDate: "2026-02-27",
    days: 5,
    allHabits: [
      {
        id: "h1",
        name: "Computer Use",
        unit: "hours",
        total: 8.97,
        average: 8.97,
        min: 8.97,
        max: 8.97,
        days_with_data: 1,
        total_entries: 1,
      },
    ],
    dailyByHabitId: new Map([
      ["h1", [{ date: "2026-02-26", value: 8.97, entries: [{}] }]],
    ]),
    watcherDailyRows: [],
    topApps: [],
    topDomains: [],
  });

  assert.equal(payload.habits.length, 1);
  assert.equal(payload.habits[0].name, "Computer Time");
});
