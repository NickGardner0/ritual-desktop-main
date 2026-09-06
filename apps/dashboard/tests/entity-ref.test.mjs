import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const ENTITY_ROUTES = {
  habit: (id) => `/dashboard?view=metrics&habit=${encodeURIComponent(id)}`,
  habit_log: (id) => `/activity?logId=${encodeURIComponent(id)}`,
  task: (id) => `/tasks?task=${encodeURIComponent(id)}`,
  routine: (id) => `/routines?routine=${encodeURIComponent(id)}`,
  artifact: (id) => `/reports?artifactId=${encodeURIComponent(id)}`,
  conversation: (id) => `/chat?conversation=${encodeURIComponent(id)}`,
  experiment: (id) => `/experiments/${encodeURIComponent(id)}`,
  calendar_event: (id) => `/calendar?event=${encodeURIComponent(id)}`,
  calendar_occurrence: (id) => `/calendar?occurrence=${encodeURIComponent(id)}`,
  day: (id) => `/calendar?date=${encodeURIComponent(id)}`,
  time_window: (id) => {
    const [from, to] = id.split("/");
    return `/activity?from=${encodeURIComponent(from || id)}&to=${encodeURIComponent(to || from || id)}`;
  },
};

const ENTITY_TYPE_ALIASES = {
  report: "artifact",
  calendar: "calendar_event",
};

function canonicalEntityType(value) {
  if (ENTITY_ROUTES[value]) return value;
  return ENTITY_TYPE_ALIASES[value] || null;
}

function entityProtocolEnabled({ envValue, storageValue } = {}) {
  if (envValue === "0") return false;
  if (storageValue === "0") return false;
  return true;
}

function mentionQueryFromInput(value) {
  const match = value.match(/(?:^|\s)@([^\s@]*)$/);
  return match ? match[1] : null;
}

function mergeEntitySummaries(...groups) {
  const seen = new Set();
  const merged = [];
  for (const group of groups) {
    for (const item of group) {
      const key = `${item.ref.type}:${item.ref.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
  }
  return merged;
}

function summariesFromSearchBuckets(payload) {
  const items = [];
  for (const hit of payload.artifacts?.hits || []) {
    items.push({
      ref: { type: "artifact", id: String(hit.id) },
      title: String(hit.title || "Report"),
    });
  }
  for (const hit of payload.conversations?.hits || []) {
    items.push({
      ref: { type: "conversation", id: String(hit.conversation_id || hit.id) },
      title: String(hit.title || "Conversation"),
    });
  }
  return items;
}

function unavailableTitle(availability) {
  if (availability === "forbidden") return "Unavailable";
  if (availability === "deleted") return "Deleted";
  return "Unknown";
}

test("canonical entity routes cover layer 0 types and experiments", () => {
  assert.equal(ENTITY_ROUTES.habit("h1"), "/dashboard?view=metrics&habit=h1");
  assert.equal(ENTITY_ROUTES.habit_log("log 1"), "/activity?logId=log%201");
  assert.equal(ENTITY_ROUTES.task("t1"), "/tasks?task=t1");
  assert.equal(ENTITY_ROUTES.routine("r1"), "/routines?routine=r1");
  assert.equal(ENTITY_ROUTES.artifact("a1"), "/reports?artifactId=a1");
  assert.equal(ENTITY_ROUTES.conversation("c1"), "/chat?conversation=c1");
  assert.equal(ENTITY_ROUTES.experiment("e1"), "/experiments/e1");
  assert.equal(ENTITY_ROUTES.calendar_event("e1"), "/calendar?event=e1");
  assert.equal(ENTITY_ROUTES.calendar_occurrence("o1"), "/calendar?occurrence=o1");
  assert.equal(ENTITY_ROUTES.day("2026-08-17"), "/calendar?date=2026-08-17");
  assert.equal(ENTITY_ROUTES.time_window("2026-08-11/2026-08-17"), "/activity?from=2026-08-11&to=2026-08-17");
});

test("report and calendar aliases canonicalize to existing types", () => {
  assert.equal(canonicalEntityType("report"), "artifact");
  assert.equal(canonicalEntityType("calendar"), "calendar_event");
  assert.equal(ENTITY_ROUTES[canonicalEntityType("report")]("a1"), "/reports?artifactId=a1");
  assert.equal(ENTITY_ROUTES[canonicalEntityType("calendar")]("e1"), "/calendar?event=e1");
});

test("entity protocol flag is on unless explicitly disabled", () => {
  assert.equal(entityProtocolEnabled(), true);
  assert.equal(entityProtocolEnabled({ envValue: "0" }), false);
  assert.equal(entityProtocolEnabled({ storageValue: "0" }), false);
});

test("unknown and forbidden fallbacks never leak a title", () => {
  assert.equal(unavailableTitle("unknown"), "Unknown");
  assert.equal(unavailableTitle("deleted"), "Deleted");
  assert.equal(unavailableTitle("forbidden"), "Unavailable");
});

test("mention query reads the trailing @token", () => {
  assert.equal(mentionQueryFromInput("see @wal"), "wal");
  assert.equal(mentionQueryFromInput("@"), "");
  assert.equal(mentionQueryFromInput("hello there"), null);
});

test("search buckets normalize artifacts and conversations", () => {
  const items = summariesFromSearchBuckets({
    artifacts: { hits: [{ id: "a1", title: "Morning brief" }] },
    conversations: { hits: [{ conversation_id: "c1", title: "Walk recap" }] },
  });
  const merged = mergeEntitySummaries(items, [
    { ref: { type: "artifact", id: "a1" }, title: "Duplicate" },
  ]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].title, "Morning brief");
  assert.equal(merged[1].ref.type, "conversation");
});

const ENTITY_MENTION_TOKEN_PATTERN = /\[\[([a-z_]+):([^\]]+)\]\]/g;

function formatEntityMentionToken(ref) {
  const type = canonicalEntityType(ref.type) || ref.type;
  return `[[${type}:${ref.id}]]`;
}

function splitEntityMentionText(text) {
  const source = String(text || "");
  const parts = [];
  const pattern = new RegExp(ENTITY_MENTION_TOKEN_PATTERN.source, "g");
  let lastIndex = 0;
  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) parts.push({ kind: "text", value: source.slice(lastIndex, index) });
    const type = canonicalEntityType(match[1]);
    const id = String(match[2] || "").trim();
    if (type && id) parts.push({ kind: "mention", ref: { type, id } });
    else parts.push({ kind: "unknown", raw: match[0] });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < source.length) parts.push({ kind: "text", value: source.slice(lastIndex) });
  return parts;
}

function parseEntityMentionTokens(text) {
  return splitEntityMentionText(text)
    .filter((part) => part.kind === "mention")
    .map((part) => part.ref)
    .filter((ref, index, items) => items.findIndex((item) => item.type === ref.type && item.id === ref.id) === index);
}

function insertEntityMentionToken(text, ref) {
  const token = formatEntityMentionToken(ref);
  const replaced = String(text || "").replace(/(^|\s)@([^\s@]*)$/, `$1${token} `);
  if (replaced !== text) return replaced;
  const trimmed = String(text || "").replace(/\s+$/, "");
  return trimmed ? `${trimmed} ${token} ` : `${token} `;
}

function parseDateMentionQuery(query, now = new Date("2026-08-17T12:00:00")) {
  const raw = query.trim().toLowerCase();
  const isoDay = /^\d{4}-\d{2}-\d{2}$/;
  const isoWindow = /^(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2})$/;
  if (isoDay.test(raw)) return { type: "day", id: raw };
  const windowMatch = raw.match(isoWindow);
  if (windowMatch && windowMatch[1] <= windowMatch[2]) {
    return { type: "time_window", id: `${windowMatch[1]}/${windowMatch[2]}` };
  }
  const formatLocalDay = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };
  const today = new Date(now);
  today.setHours(12, 0, 0, 0);
  if (raw === "today") return { type: "day", id: formatLocalDay(today) };
  if (raw === "yesterday") {
    const date = new Date(today);
    date.setDate(date.getDate() - 1);
    return { type: "day", id: formatLocalDay(date) };
  }
  if (raw === "this week") {
    const start = new Date(today);
    start.setDate(start.getDate() - start.getDay());
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return { type: "time_window", id: `${formatLocalDay(start)}/${formatLocalDay(end)}` };
  }
  if (raw === "last 7 days") {
    const start = new Date(today);
    start.setDate(start.getDate() - 6);
    return { type: "time_window", id: `${formatLocalDay(start)}/${formatLocalDay(today)}` };
  }
  return null;
}

function entityPillMeta(summary) {
  const type = summary.ref.type;
  if (type === "task") {
    const labels = {
      open: "Not Started",
      in_progress: "In Progress",
      in_review: "In Review",
      completed: "Completed",
      canceled: "Canceled",
      skipped: "Canceled",
      archived: "Archived",
    };
    const status = (summary.status || "").trim();
    return labels[status] || status || (summary.subtitle || "").trim() || undefined;
  }
  const preferred =
    type === "habit_log" || type === "artifact" || type === "day" || type === "time_window"
      ? summary.subtitle || summary.status
      : summary.status || summary.subtitle;
  return (preferred || "").trim() || undefined;
}

test("mention tokens round-trip and canonicalize report aliases", () => {
  const inserted = insertEntityMentionToken("see @rep", { type: "report", id: "a1" });
  assert.equal(inserted, "see [[artifact:a1]] ");
  const parsed = parseEntityMentionTokens("Notes [[report:a1]] and [[artifact:a1]] [[calendar:b1]]");
  assert.deepEqual(parsed, [
    { type: "artifact", id: "a1" },
    { type: "calendar_event", id: "b1" },
  ]);
});

test("unknown mention tokens stay unknown", () => {
  const parts = splitEntityMentionText("hello [[widget:abc]] world");
  assert.deepEqual(parts, [
    { kind: "text", value: "hello " },
    { kind: "unknown", raw: "[[widget:abc]]" },
    { kind: "text", value: " world" },
  ]);
});

test("relative dates canonicalize in local timezone with Sunday weeks", () => {
  assert.deepEqual(parseDateMentionQuery("today"), { type: "day", id: "2026-08-17" });
  assert.deepEqual(parseDateMentionQuery("yesterday"), { type: "day", id: "2026-08-16" });
  assert.deepEqual(parseDateMentionQuery("this week"), { type: "time_window", id: "2026-08-16/2026-08-22" });
  assert.deepEqual(parseDateMentionQuery("last 7 days"), { type: "time_window", id: "2026-08-11/2026-08-17" });
});

test("compact pills prefer status or a short subtitle", () => {
  assert.equal(entityPillMeta({ ref: { type: "task", id: "t1" }, status: "open", subtitle: "Personal" }), "Not Started");
  assert.equal(entityPillMeta({ ref: { type: "task", id: "t2" }, status: "completed" }), "Completed");
  assert.equal(entityPillMeta({ ref: { type: "habit_log", id: "l1" }, status: "completed", subtitle: "2026-08-17" }), "2026-08-17");
  assert.equal(entityPillMeta({ ref: { type: "calendar_event", id: "e1" }, status: "confirmed", subtitle: "2026-08-17T09:00:00" }), "confirmed");
  assert.equal(entityPillMeta({ ref: { type: "artifact", id: "a1" }, subtitle: "notebook", status: "published" }), "notebook");
});

test("entity link picker ignores stale search completions and skips empty-query cloud", async () => {
  const source = await readFile(new URL("../components/entities/entity-link-picker.tsx", import.meta.url), "utf8");
  assert.match(source, /let cancelled = false/);
  assert.match(source, /if \(cancelled\) return/);
  assert.match(source, /trimmed\s*\n\s*\?[\s\S]*apiOperationWithAuth/);
  assert.match(source, /Promise\.resolve\(\{ items: \[\] as EntitySummary\[\] \}\)/);
  assert.match(source, /parseDateMentionQuery\(query\) \? \[\.\.\.AUTOCOMPLETE_TYPES, "habit_log"\] : AUTOCOMPLETE_TYPES/);
});

test("local entity search defaults skip habit logs and cap vault reads", async () => {
  const source = await readFile(new URL("../lib/entities/resolve.ts", import.meta.url), "utf8");
  const defaults = source.match(/const DEFAULT_LOCAL_SEARCH_TYPES: EntityType\[\] = \[([\s\S]*?)\];/);
  assert.ok(defaults);
  assert.equal(defaults[1].includes("habit_log"), false);
  assert.match(source, /maxRecords: cap/);
});

test("entity summary cache is user scoped, TTL'd, and does not persist unknown", async () => {
  const source = await readFile(new URL("../lib/entities/entity-summary-cache.mjs", import.meta.url), "utf8");
  assert.match(source, /\$\{owner\}:\$\{entityRefKey\(ref\)\}/);
  assert.match(source, /availability !== "unknown"/);
  assert.match(source, /this\.inflight = new Map/);
  assert.match(source, /subscribe\(key, listener\)/);
});

test("live entity pills subscribe per ref instead of a global epoch", async () => {
  const source = await readFile(new URL("../components/entities/live-entity-pill.tsx", import.meta.url), "utf8");
  assert.match(source, /subscribeEntitySummary\(entityRef,/);
  assert.doesNotMatch(source, /subscribeEntitySummaries\(/);
});

test("query cache restores only after Clerk identity is loaded", async () => {
  const source = await readFile(new URL("../components/providers.tsx", import.meta.url), "utf8");
  assert.match(source, /if \(typeof window === 'undefined' \|\| !isLoaded\) return/);
  assert.match(source, /\$\{QUERY_CACHE_STORAGE_KEY\}:\$\{userId\}/);
  assert.match(source, /clearEntitySummaryCache\(\)/);
  assert.match(source, /setEntitySummaryCacheUser\(currentUserId\)/);
  assert.doesNotMatch(source, /hydrate\(queryClient[\s\S]*useState/);
});
