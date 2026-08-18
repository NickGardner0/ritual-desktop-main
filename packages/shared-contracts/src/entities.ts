import type { PrivacyDataClass } from "./privacy";

export const ENTITY_TYPES = [
  "habit",
  "habit_log",
  "task",
  "routine",
  "artifact",
  "conversation",
  "experiment",
  "calendar_block",
  "day",
  "time_window",
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

export const LAYER_0_ENTITY_TYPES = [
  "habit",
  "habit_log",
  "task",
  "routine",
  "artifact",
  "conversation",
  "calendar_block",
  "day",
  "time_window",
] as const;

export type Layer0EntityType = (typeof LAYER_0_ENTITY_TYPES)[number];

/** Incoming aliases. Stored and returned refs always use the canonical type. */
export const ENTITY_TYPE_ALIASES = {
  report: "artifact",
  calendar: "calendar_block",
} as const;

export type EntityTypeAlias = keyof typeof ENTITY_TYPE_ALIASES;

export type EntityRef = {
  type: EntityType;
  id: string;
};

export type EntityAvailability = "ok" | "unknown" | "deleted" | "forbidden";

export type EntitySummary = {
  ref: EntityRef;
  title: string;
  subtitle?: string;
  status?: string;
  icon?: string;
  route: string;
  updatedAt?: string;
  privacyClass: string;
  availability: EntityAvailability;
};

export type RelatedEntitySource = "fk" | "artifact_link" | "authored";

export type RelatedEntity = {
  ref: EntityRef;
  relationship: string;
  source: RelatedEntitySource;
};

export const AUTHORED_RELATIONSHIPS = [
  "references",
  "mentions",
  "supports",
  "contradicts",
  "evidence_for",
] as const;

export type AuthoredRelationship = (typeof AUTHORED_RELATIONSHIPS)[number];

export const ENTITY_MENTION_TOKEN_PATTERN = /\[\[([a-z_]+):([^\]]+)\]\]/g;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_WINDOW = /^(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2})$/;

const ENTITY_PRIVACY_CLASS: Record<EntityType, PrivacyDataClass> = {
  habit: "habit_definition",
  habit_log: "habit_log",
  task: "task",
  routine: "routine",
  artifact: "ai_content",
  conversation: "ai_content",
  experiment: "task",
  calendar_block: "task",
  day: "habit_log",
  time_window: "habit_log",
};

export function canonicalEntityType(value: unknown): EntityType | null {
  if (typeof value !== "string") return null;
  if ((ENTITY_TYPES as readonly string[]).includes(value)) return value as EntityType;
  if (value in ENTITY_TYPE_ALIASES) {
    return ENTITY_TYPE_ALIASES[value as EntityTypeAlias];
  }
  return null;
}

export function isEntityType(value: unknown): value is EntityType {
  return typeof value === "string" && (ENTITY_TYPES as readonly string[]).includes(value);
}

export function entityTypeToPrivacyClass(type: EntityType): PrivacyDataClass {
  const canonical = canonicalEntityType(type) || type;
  return ENTITY_PRIVACY_CLASS[canonical];
}

export function entityRefKey(ref: EntityRef): string {
  const type = canonicalEntityType(ref.type) || ref.type;
  return `${type}:${ref.id}`;
}

export function entityRoute(type: EntityType, id: string): string {
  const encoded = encodeURIComponent(id);
  const canonical = canonicalEntityType(type) || type;
  switch (canonical) {
    case "habit":
      return `/dashboard?view=metrics&habit=${encoded}`;
    case "habit_log":
      return `/activity?logId=${encoded}`;
    case "task":
      return `/tasks?task=${encoded}`;
    case "routine":
      return `/routines?routine=${encoded}`;
    case "artifact":
      return `/reports?artifactId=${encoded}`;
    case "conversation":
      return `/chat?conversation=${encoded}`;
    case "experiment":
      return `/experiments/${encoded}`;
    case "calendar_block":
      return `/calendar?block=${encoded}`;
    case "day":
      return `/calendar?date=${encoded}`;
    case "time_window": {
      const [from, to] = id.split("/");
      const start = encodeURIComponent(from || id);
      const end = encodeURIComponent(to || from || id);
      return `/activity?from=${start}&to=${end}`;
    }
  }
}

export function unavailableEntitySummary(
  ref: EntityRef,
  availability: Exclude<EntityAvailability, "ok">,
): EntitySummary {
  const title =
    availability === "forbidden"
      ? "Unavailable"
      : availability === "deleted"
        ? "Deleted"
        : "Unknown";
  return {
    ref,
    title,
    route: entityRoute(ref.type, ref.id),
    privacyClass: entityTypeToPrivacyClass(ref.type),
    availability,
  };
}

export function formatEntityMentionToken(ref: EntityRef): string {
  const type = canonicalEntityType(ref.type) || ref.type;
  return `[[${type}:${ref.id}]]`;
}

export function parseEntityMentionTokens(text: string): EntityRef[] {
  const items: EntityRef[] = [];
  const seen = new Set<string>();
  for (const part of splitEntityMentionText(text)) {
    if (part.kind !== "mention") continue;
    const key = entityRefKey(part.ref);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(part.ref);
  }
  return items;
}

export type EntityMentionSegment =
  | { kind: "text"; value: string }
  | { kind: "mention"; ref: EntityRef }
  | { kind: "unknown"; raw: string };

export function splitEntityMentionText(text: string): EntityMentionSegment[] {
  const source = String(text || "");
  const parts: EntityMentionSegment[] = [];
  const pattern = new RegExp(ENTITY_MENTION_TOKEN_PATTERN.source, "g");
  let lastIndex = 0;
  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      parts.push({ kind: "text", value: source.slice(lastIndex, index) });
    }
    const type = canonicalEntityType(match[1]);
    const id = (match[2] || "").trim();
    if (type && id) {
      parts.push({ kind: "mention", ref: { type, id } });
    } else {
      parts.push({ kind: "unknown", raw: match[0] });
    }
    lastIndex = index + match[0].length;
  }
  if (lastIndex < source.length) {
    parts.push({ kind: "text", value: source.slice(lastIndex) });
  }
  return parts;
}

export function insertEntityMentionToken(text: string, ref: EntityRef): string {
  const token = formatEntityMentionToken(ref);
  const replaced = String(text || "").replace(/(^|\s)@([^\s@]*)$/, `$1${token} `);
  if (replaced !== text) return replaced;
  const trimmed = String(text || "").replace(/\s+$/, "");
  return trimmed ? `${trimmed} ${token} ` : `${token} `;
}

export function stripEntityMentionTokens(text: string, titles?: Map<string, string>): string {
  return String(text || "").replace(ENTITY_MENTION_TOKEN_PATTERN, (_all, rawType, rawId) => {
    const type = canonicalEntityType(rawType);
    const id = String(rawId || "").trim();
    if (!type || !id) return "";
    return titles?.get(`${type}:${id}`) || id;
  });
}

export function isDayId(id: string): boolean {
  return ISO_DAY.test(id);
}

export function isTimeWindowId(id: string): boolean {
  const match = id.match(ISO_WINDOW);
  return Boolean(match && match[1] <= match[2]);
}

export type ParsedDateMention =
  | { type: "day"; id: string }
  | { type: "time_window"; id: string };

function formatLocalDay(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfLocalWeek(date: Date): Date {
  const next = new Date(date);
  next.setHours(12, 0, 0, 0);
  next.setDate(next.getDate() - next.getDay());
  return next;
}

export function parseDateMentionQuery(query: string, now: Date = new Date()): ParsedDateMention | null {
  const raw = query.trim().toLowerCase();
  if (!raw) return null;
  if (ISO_DAY.test(raw)) return { type: "day", id: raw };
  const windowMatch = raw.match(ISO_WINDOW);
  if (windowMatch && windowMatch[1] <= windowMatch[2]) {
    return { type: "time_window", id: `${windowMatch[1]}/${windowMatch[2]}` };
  }

  const today = new Date(now);
  today.setHours(12, 0, 0, 0);

  if (raw === "today") return { type: "day", id: formatLocalDay(today) };
  if (raw === "yesterday") {
    const date = new Date(today);
    date.setDate(date.getDate() - 1);
    return { type: "day", id: formatLocalDay(date) };
  }
  if (raw === "tomorrow") {
    const date = new Date(today);
    date.setDate(date.getDate() + 1);
    return { type: "day", id: formatLocalDay(date) };
  }
  if (raw === "this week") {
    const start = startOfLocalWeek(today);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return { type: "time_window", id: `${formatLocalDay(start)}/${formatLocalDay(end)}` };
  }
  if (raw === "last week") {
    const start = startOfLocalWeek(today);
    start.setDate(start.getDate() - 7);
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

export function virtualDateSummary(ref: ParsedDateMention): EntitySummary {
  if (ref.type === "day") {
    const date = new Date(`${ref.id}T12:00:00`);
    const valid = !Number.isNaN(date.getTime());
    return {
      ref: { type: "day", id: ref.id },
      title: valid
        ? date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
        : ref.id,
      subtitle: valid ? date.toLocaleDateString(undefined, { weekday: "long" }) : undefined,
      route: entityRoute("day", ref.id),
      privacyClass: entityTypeToPrivacyClass("day"),
      availability: valid ? "ok" : "unknown",
    };
  }
  const [from, to] = ref.id.split("/");
  return {
    ref: { type: "time_window", id: ref.id },
    title: from && to && from !== to ? `${from} – ${to}` : from || ref.id,
    subtitle: "Date range",
    route: entityRoute("time_window", ref.id),
    privacyClass: entityTypeToPrivacyClass("time_window"),
    availability: isTimeWindowId(ref.id) ? "ok" : "unknown",
  };
}
