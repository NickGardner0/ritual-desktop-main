#!/usr/bin/env node
import process from "node:process";

const DEFAULT_REQUIRED_HABITS = [
  "Sleep Duration",
  "Computer Time",
  "Screen Time",
  "Daily Steps",
  "iPhone Time",
];

const DEFAULT_LOGS_DAYS = 30;

function parseArgs(argv) {
  const args = {
    baseUrl:
      process.env.RITUAL_SMOKE_BASE_URL ||
      process.env.RITUAL_API_BASE_URL ||
      process.env.NEXT_PUBLIC_PYTHON_API_URL ||
      "",
    token:
      process.env.RITUAL_SMOKE_BEARER_TOKEN ||
      process.env.RITUAL_SMOKE_AUTH_TOKEN ||
      process.env.RITUAL_SMOKE_INTERNAL_BACKEND_TOKEN ||
      process.env.INTERNAL_BACKEND_TOKEN ||
      process.env.RITUAL_AUTH_TOKEN ||
      "",
    internalUserId:
      process.env.RITUAL_SMOKE_INTERNAL_USER_ID ||
      process.env.RITUAL_SMOKE_USER_ID ||
      "",
    requiredHabits: parseCsv(process.env.RITUAL_SMOKE_REQUIRED_HABITS) || DEFAULT_REQUIRED_HABITS,
    allowZero: parseCsv(process.env.RITUAL_SMOKE_ALLOW_ZERO) || [],
    allowMissing: parseCsv(process.env.RITUAL_SMOKE_ALLOW_MISSING_HABITS) || [],
    logsDays: Number(process.env.RITUAL_SMOKE_LOGS_DAYS || DEFAULT_LOGS_DAYS),
    timeoutMs: Number(process.env.RITUAL_SMOKE_TIMEOUT_MS || 20000),
    forceFresh: process.env.RITUAL_SMOKE_FORCE_FRESH !== "0",
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      return argv[index];
    };

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (arg === "--base-url") {
      args.baseUrl = next() || "";
    } else if (arg === "--token") {
      args.token = next() || "";
    } else if (arg === "--internal-user-id") {
      args.internalUserId = next() || "";
    } else if (arg === "--required-habits") {
      args.requiredHabits = parseCsv(next()) || [];
    } else if (arg === "--allow-zero") {
      args.allowZero = parseCsv(next()) || [];
    } else if (arg === "--allow-missing") {
      args.allowMissing = parseCsv(next()) || [];
    } else if (arg === "--logs-days") {
      args.logsDays = Number(next() || DEFAULT_LOGS_DAYS);
    } else if (arg === "--timeout-ms") {
      args.timeoutMs = Number(next() || 20000);
    } else if (arg === "--no-force-fresh") {
      args.forceFresh = false;
    } else if (arg === "--json") {
      args.json = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  args.requiredHabits = args.requiredHabits.length ? args.requiredHabits : DEFAULT_REQUIRED_HABITS;
  args.logsDays = Number.isFinite(args.logsDays) && args.logsDays > 0 ? args.logsDays : DEFAULT_LOGS_DAYS;
  args.timeoutMs = Number.isFinite(args.timeoutMs) && args.timeoutMs > 0 ? args.timeoutMs : 20000;
  args.baseUrl = trimTrailingSlash(args.baseUrl);
  return args;
}

function printHelp() {
  console.log(`Usage:
  RITUAL_SMOKE_BASE_URL=https://backend-api-production-a37e.up.railway.app \\
  RITUAL_SMOKE_BEARER_TOKEN=... \\
  npm run smoke:prod:read-models

Options:
  --base-url <url>             Backend or dashboard base URL
  --token <token>              Bearer token for the production user
  --internal-user-id <id>      Clerk user id when using INTERNAL_BACKEND_TOKEN
  --required-habits <csv>      Important all-time habits that must exist and be non-zero
  --allow-zero <csv>           Required habits allowed to be zero for this run
  --allow-missing <csv>        Required habits allowed to be absent for this run
  --logs-days <n>              Logs/calendar smoke range, default ${DEFAULT_LOGS_DAYS}
  --timeout-ms <n>             Per-request timeout, default 20000
  --no-force-fresh             Do not send x-ritual-force-fresh: 1
  --json                       Print machine-readable JSON output

This script is read-only. It does not create, edit, or delete habit logs.

Auth options:
  1. User auth: RITUAL_SMOKE_BEARER_TOKEN=<Clerk session JWT>
  2. Internal auth: RITUAL_SMOKE_INTERNAL_BACKEND_TOKEN=<INTERNAL_BACKEND_TOKEN>
                    RITUAL_SMOKE_INTERNAL_USER_ID=<Clerk user id>`);
}

function parseCsv(value) {
  if (!value) return null;
  return String(value)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function defaultRange(days) {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - Math.max(1, days) + 1);
  return { startDate: isoDate(start), endDate: isoDate(end) };
}

function normalizeName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function namesMatch(actual, expected) {
  const actualName = normalizeName(actual);
  const expectedName = normalizeName(expected);
  return actualName === expectedName || actualName.includes(expectedName);
}

function assert(condition, message, errors) {
  if (!condition) errors.push(message);
}

async function requestJson({ baseUrl, token, internalUserId, path, params = {}, timeoutMs, forceFresh }) {
  const url = new URL(`${baseUrl}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    };
    if (internalUserId) {
      headers["x-internal-user-id"] = internalUserId;
    }
    if (forceFresh) {
      headers["x-ritual-force-fresh"] = "1";
    }

    const started = performance.now();
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    const durationMs = Math.round(performance.now() - started);
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(`${path} returned non-JSON response (${response.status}): ${text.slice(0, 200)}`);
    }

    if (!response.ok) {
      throw new Error(`${path} failed with HTTP ${response.status}: ${JSON.stringify(body).slice(0, 500)}`);
    }

    return { path, status: response.status, durationMs, body };
  } finally {
    clearTimeout(timeout);
  }
}

function metaOf(payload) {
  return payload && typeof payload === "object" ? payload.meta || {} : {};
}

function validateMeta(name, payload, errors) {
  const meta = metaOf(payload);
  assert(meta && typeof meta === "object", `${name} missing meta object`, errors);
  assert(meta.partial !== true, `${name} returned partial: true`, errors);
  assert(Array.isArray(meta.warnings) || meta.warnings === undefined, `${name} meta.warnings is not an array`, errors);
  assert(meta.generatedAt !== undefined, `${name} meta.generatedAt missing`, errors);
  assert(Boolean(meta.source), `${name} meta.source missing`, errors);
}

function habitsByName(payload) {
  const habits = Array.isArray(payload?.habits) ? payload.habits : [];
  return habits.map((habit) => ({
    id: String(habit?.id || ""),
    name: String(habit?.name || ""),
    unit: String(habit?.unit || ""),
  }));
}

function statTotal(payload, habitId) {
  const stat = payload?.overviewStats?.[habitId];
  if (stat && typeof stat === "object" && Number.isFinite(Number(stat.total))) {
    return Number(stat.total);
  }
  const summary = payload?.metricsSummaryMetrics?.[habitId];
  if (summary && typeof summary === "object" && Number.isFinite(Number(summary.total_value))) {
    return Number(summary.total_value);
  }
  return null;
}

function validateImportantTotals(name, payload, config, errors) {
  const habits = habitsByName(payload);
  const allowZero = config.allowZero.map(normalizeName);
  const allowMissing = config.allowMissing.map(normalizeName);

  assert(habits.length > 0, `${name} returned no habits`, errors);
  assert(Object.keys(payload?.overviewStats || {}).length > 0, `${name} returned no overviewStats`, errors);

  for (const expected of config.requiredHabits) {
    const expectedNorm = normalizeName(expected);
    const habit = habits.find((candidate) => namesMatch(candidate.name, expected));
    if (!habit) {
      if (!allowMissing.includes(expectedNorm)) {
        errors.push(`${name} missing required habit "${expected}"`);
      }
      continue;
    }
    const total = statTotal(payload, habit.id);
    if (total === null) {
      errors.push(`${name} missing total for required habit "${habit.name}" (${habit.id})`);
      continue;
    }
    if (total <= 0 && !allowZero.includes(expectedNorm)) {
      errors.push(`${name} required habit "${habit.name}" returned non-positive total: ${total}`);
    }
  }
}

function validateOverview(payload, config, errors) {
  validateMeta("overview-snapshot", payload, errors);
  validateImportantTotals("overview-snapshot", payload, config, errors);
}

function validateMetrics(payload, config, errors) {
  validateMeta("metrics-snapshot", payload, errors);
  validateImportantTotals("metrics-snapshot", payload, config, errors);
  assert(
    Object.keys(payload?.metricsSummaryMetrics || {}).length > 0,
    "metrics-snapshot returned no metricsSummaryMetrics",
    errors,
  );
  assert(
    Object.keys(payload?.metricsAnalyticsData || {}).length > 0,
    "metrics-snapshot returned no metricsAnalyticsData",
    errors,
  );
}

function validateLogs(payload, errors) {
  validateMeta("logs-read-model", payload, errors);
  assert(Array.isArray(payload?.rows), "logs-read-model rows is not an array", errors);
  assert(payload?.pagination && typeof payload.pagination === "object", "logs-read-model missing pagination", errors);
  assert(payload?.sourceCounts && typeof payload.sourceCounts === "object", "logs-read-model missing sourceCounts", errors);
  assert(Array.isArray(payload?.availableHabits), "logs-read-model missing availableHabits", errors);

  const rawIphoneRows = (payload?.rows || []).filter((row) => {
    const source = String(row?.source || "");
    return source === "biome_iphone" && row?.readOnly !== true;
  });
  assert(
    rawIphoneRows.length === 0,
    `logs-read-model exposed ${rawIphoneRows.length} raw biome_iphone rows; expected only daily rollups`,
    errors,
  );

  const iphoneRollups = (payload?.rollups?.iphoneTime || []).length;
  const rowIphoneRollups = (payload?.rows || []).filter((row) => row?.source === "biome_iphone_rollup").length;
  assert(iphoneRollups === rowIphoneRollups, "logs-read-model iPhone rollup count does not match rows", errors);
}

function validateCalendar(payload, errors) {
  validateMeta("calendar-read-model", payload, errors);
  assert(Array.isArray(payload?.days), "calendar-read-model days is not an array", errors);
  assert((payload?.days || []).length > 0, "calendar-read-model returned no days", errors);
  assert(Array.isArray(payload?.habitLogs), "calendar-read-model habitLogs is not an array", errors);
  assert(Array.isArray(payload?.scheduledBlocks), "calendar-read-model scheduledBlocks is not an array", errors);
  assert(Array.isArray(payload?.habits), "calendar-read-model habits is not an array", errors);
}

function summarizePayload(name, result) {
  const payload = result.body;
  if (name === "overview") {
    return {
      path: result.path,
      durationMs: result.durationMs,
      habits: habitsByName(payload).length,
      stats: Object.keys(payload?.overviewStats || {}).length,
      source: metaOf(payload).source,
      partial: metaOf(payload).partial === true,
    };
  }
  if (name === "metrics") {
    return {
      path: result.path,
      durationMs: result.durationMs,
      habits: habitsByName(payload).length,
      stats: Object.keys(payload?.overviewStats || {}).length,
      metricSeries: Object.keys(payload?.metricsAnalyticsData || {}).length,
      source: metaOf(payload).source,
      partial: metaOf(payload).partial === true,
    };
  }
  if (name === "logs") {
    return {
      path: result.path,
      durationMs: result.durationMs,
      rows: Array.isArray(payload?.rows) ? payload.rows.length : 0,
      total: payload?.pagination?.total,
      iphoneRollups: payload?.rollups?.iphoneTime?.length || 0,
      source: metaOf(payload).source,
      partial: metaOf(payload).partial === true,
    };
  }
  return {
    path: result.path,
    durationMs: result.durationMs,
    days: Array.isArray(payload?.days) ? payload.days.length : 0,
    habitLogs: Array.isArray(payload?.habitLogs) ? payload.habitLogs.length : 0,
    source: metaOf(payload).source,
    partial: metaOf(payload).partial === true,
  };
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  if (!config.baseUrl) {
    throw new Error("Missing base URL. Set RITUAL_SMOKE_BASE_URL or pass --base-url.");
  }
  if (!config.token) {
    throw new Error("Missing bearer token. Set RITUAL_SMOKE_BEARER_TOKEN or pass --token.");
  }

  const range = defaultRange(config.logsDays);
  const common = {
    baseUrl: config.baseUrl,
    token: config.token,
    internalUserId: config.internalUserId,
    timeoutMs: config.timeoutMs,
    forceFresh: config.forceFresh,
  };

  const results = {
    overview: await requestJson({ ...common, path: "/api/dashboard/overview-snapshot" }),
    metrics: await requestJson({ ...common, path: "/api/dashboard/metrics-snapshot" }),
    logs: await requestJson({
      ...common,
      path: "/api/logs/read-model",
      params: { start_date: range.startDate, end_date: range.endDate, limit: 200, offset: 0 },
    }),
    calendar: await requestJson({
      ...common,
      path: "/api/calendar/read-model",
      params: { start_date: range.startDate, end_date: range.endDate },
    }),
  };

  const errors = [];
  validateOverview(results.overview.body, config, errors);
  validateMetrics(results.metrics.body, config, errors);
  validateLogs(results.logs.body, errors);
  validateCalendar(results.calendar.body, errors);

  const summary = {
    ok: errors.length === 0,
    baseUrl: config.baseUrl,
    checkedAt: new Date().toISOString(),
    range,
    requiredHabits: config.requiredHabits,
    allowZero: config.allowZero,
    allowMissing: config.allowMissing,
    endpoints: {
      overview: summarizePayload("overview", results.overview),
      metrics: summarizePayload("metrics", results.metrics),
      logs: summarizePayload("logs", results.logs),
      calendar: summarizePayload("calendar", results.calendar),
    },
    errors,
  };

  if (config.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`Production read-model smoke ${summary.ok ? "passed" : "failed"} for ${config.baseUrl}`);
    console.log(`Range: ${range.startDate} to ${range.endDate}`);
    for (const [name, endpoint] of Object.entries(summary.endpoints)) {
      console.log(`- ${name}: ${endpoint.durationMs}ms ${JSON.stringify(endpoint)}`);
    }
    if (errors.length) {
      console.error("\nFailures:");
      for (const error of errors) {
        console.error(`- ${error}`);
      }
    }
  }

  if (errors.length) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`Production read-model smoke failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
