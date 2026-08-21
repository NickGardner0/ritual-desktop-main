"use client";

import {
  canonicalEntityType,
  entityRefKey,
  entityRoute,
  entityTypeToPrivacyClass,
  isDayId,
  isTimeWindowId,
  parseDateMentionQuery,
  unavailableEntitySummary,
  virtualDateSummary,
  type EntityRef,
  type EntitySummary,
  type EntityType,
} from "@ritual/shared-contracts";
import { apiJson, apiOperationWithAuth } from "@/lib/api/client";
import {
  HABIT_DEFINITIONS_COLLECTION,
  HABIT_LOGS_COLLECTION,
} from "@/lib/privacy/habit-vault-adapter";
import {
  ROUTINES_COLLECTION,
  TASKS_COLLECTION,
} from "@/lib/privacy/task-vault-adapter";
import { canUseDesktopVault, getDesktopVaultRecord, listDesktopVaultRecords } from "@/lib/privacy/vault-client";
import type { Habit, HabitLog } from "@/contexts/habits-context.types";
import type { Routine, Task } from "@/lib/tasks/types";
import {
  loadEntitySummary,
  readCachedEntitySummary,
  writeCachedEntitySummary,
} from "@/lib/entities/entity-summary-cache.mjs";

const VAULT_COLLECTIONS: Partial<Record<EntityType, string>> = {
  habit: HABIT_DEFINITIONS_COLLECTION,
  habit_log: HABIT_LOGS_COLLECTION,
  task: TASKS_COLLECTION,
  routine: ROUTINES_COLLECTION,
  calendar_block: "scheduled_blocks",
};

type ScheduledBlockVault = {
  id: string;
  title: string;
  notes?: string | null;
  day: string;
  start_minutes?: number;
  end_minutes?: number;
  startMinutes?: number;
  endMinutes?: number;
  updated_at?: string;
};

function minutesLabel(minutes: number | undefined): string {
  const total = Math.max(0, Number(minutes || 0));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function canonicalizeRef(ref: EntityRef): EntityRef {
  return {
    type: canonicalEntityType(ref.type) || ref.type,
    id: ref.id,
  };
}

type AuthGetter = (opts?: { skipCache?: boolean }) => Promise<string | null>;

export function entityLookupPath(
  type: EntityType | string,
  id: string,
  kind: "summary" | "related" | "references" = "summary",
): string {
  if (id.includes("/")) {
    const params = new URLSearchParams({ entity_type: type, entity_id: id });
    if (kind === "summary") return `/api/entities/summary?${params.toString()}`;
    return `/api/entities/${kind}?${params.toString()}`;
  }
  const base = `/api/entities/${type}/${encodeURIComponent(id)}`;
  return kind === "summary" ? base : `${base}/${kind}`;
}

export function summaryFromCloud(item: {
  availability?: EntitySummary["availability"] | null;
  icon?: string | null;
  privacyClass: string;
  ref: EntityRef;
  route: string;
  status?: string | null;
  subtitle?: string | null;
  title: string;
  updatedAt?: string | null;
}): EntitySummary {
  return {
    ref: item.ref,
    title: item.title,
    subtitle: item.subtitle ?? undefined,
    status: item.status ?? undefined,
    icon: item.icon ?? undefined,
    route: item.route,
    updatedAt: item.updatedAt ?? undefined,
    privacyClass: item.privacyClass,
    availability: item.availability ?? "ok",
  };
}

function summaryFromHabit(habit: Habit): EntitySummary | null {
  if (!habit.id) return null;
  return {
    ref: { type: "habit", id: habit.id },
    title: habit.name,
    subtitle: habit.category,
    icon: habit.icon,
    route: entityRoute("habit", habit.id),
    updatedAt: habit.updated_at,
    privacyClass: entityTypeToPrivacyClass("habit"),
    availability: "ok",
  };
}

function summaryFromLog(log: HabitLog): EntitySummary | null {
  if (!log.id) return null;
  return {
    ref: { type: "habit_log", id: log.id },
    title: log.habit_name || "Log",
    subtitle: log.date,
    status: log.status,
    route: entityRoute("habit_log", log.id),
    updatedAt: log.completed_at,
    privacyClass: entityTypeToPrivacyClass("habit_log"),
    availability: "ok",
  };
}

export function summaryFromTask(task: Task): EntitySummary {
  return {
    ref: { type: "task", id: task.id },
    title: task.title,
    subtitle: task.category || task.source,
    status: task.status,
    route: entityRoute("task", task.id),
    updatedAt: task.updated_at || undefined,
    privacyClass: entityTypeToPrivacyClass("task"),
    availability: "ok",
  };
}

function summaryFromRoutine(routine: Routine): EntitySummary {
  return {
    ref: { type: "routine", id: routine.id },
    title: routine.title,
    subtitle: routine.kind,
    status: routine.status,
    route: entityRoute("routine", routine.id),
    updatedAt: routine.updated_at || undefined,
    privacyClass: entityTypeToPrivacyClass("routine"),
    availability: "ok",
  };
}

function summaryFromCalendarBlock(block: ScheduledBlockVault): EntitySummary | null {
  if (!block.id) return null;
  const start = block.start_minutes ?? block.startMinutes ?? 0;
  const end = block.end_minutes ?? block.endMinutes ?? start;
  return {
    ref: { type: "calendar_block", id: block.id },
    title: block.title || "Calendar block",
    subtitle: `${block.day} · ${minutesLabel(start)}–${minutesLabel(end)}`,
    status: `${minutesLabel(start)}–${minutesLabel(end)}`,
    route: entityRoute("calendar_block", block.id),
    updatedAt: block.updated_at,
    privacyClass: entityTypeToPrivacyClass("calendar_block"),
    availability: "ok",
  };
}

async function resolveFromVault(ref: EntityRef, userId: string): Promise<EntitySummary | null> {
  const collection = VAULT_COLLECTIONS[ref.type];
  if (!collection || !canUseDesktopVault()) return null;
  const record = await getDesktopVaultRecord(userId, collection, ref.id);
  if (!record) return null;
  if (record.tombstone) return unavailableEntitySummary(ref, "deleted");
  if (ref.type === "habit") return summaryFromHabit(record.payload as Habit);
  if (ref.type === "habit_log") return summaryFromLog(record.payload as HabitLog);
  if (ref.type === "task") return summaryFromTask(record.payload as Task);
  if (ref.type === "routine") return summaryFromRoutine(record.payload as Routine);
  if (ref.type === "calendar_block") return summaryFromCalendarBlock(record.payload as ScheduledBlockVault);
  return null;
}

export async function resolveEntity(
  ref: EntityRef,
  options: { userId?: string | null; getToken?: AuthGetter } = {},
): Promise<EntitySummary> {
  ref = canonicalizeRef(ref);
  return loadEntitySummary(ref, options.userId, async () => {
    if (ref.type === "day" || ref.type === "time_window") {
      const parsed =
        ref.type === "day" && isDayId(ref.id)
          ? { type: "day" as const, id: ref.id }
          : ref.type === "time_window" && isTimeWindowId(ref.id)
            ? { type: "time_window" as const, id: ref.id }
            : null;
      return parsed
        ? virtualDateSummary(parsed)
        : unavailableEntitySummary(ref, "unknown");
    }

    if (options.userId) {
      try {
        const local = await resolveFromVault(ref, options.userId);
        if (local) return local;
      } catch (error) {
        console.warn("[entities] vault resolve failed", error);
      }
    }

    try {
      if (options.getToken) {
        return summaryFromCloud(
          await apiOperationWithAuth(
            "get_entity_summary_query_api_entities_summary_get",
            options.getToken,
            { query: { entity_type: ref.type, entity_id: ref.id } },
            options.userId,
          ),
        );
      }
      return await apiJson<EntitySummary>(entityLookupPath(ref.type, ref.id), {
        userId: options.userId,
      });
    } catch {
      return unavailableEntitySummary(ref, "unknown");
    }
  });
}

export async function resolveEntities(
  refs: EntityRef[],
  options: { userId?: string | null; getToken?: AuthGetter } = {},
): Promise<EntitySummary[]> {
  const unique: EntityRef[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const canonical = canonicalizeRef(ref);
    const key = entityRefKey(canonical);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(canonical);
  }

  const remaining: EntityRef[] = [];
  const resolved = new Map<string, EntitySummary>();
  for (const ref of unique) {
    const key = entityRefKey(ref);
    const cached = readCachedEntitySummary(ref, options.userId);
    if (cached) {
      resolved.set(key, cached);
      continue;
    }
    if (ref.type === "day" || ref.type === "time_window") {
      const local = await resolveEntity(ref, options);
      resolved.set(key, local);
      continue;
    }
    if (options.userId) {
      try {
        const local = await resolveFromVault(ref, options.userId);
        if (local) {
          writeCachedEntitySummary(ref, options.userId, local);
          resolved.set(key, local);
          continue;
        }
      } catch {
        // Fall through to cloud batch.
      }
    }
    remaining.push(ref);
  }

  if (remaining.length) {
    try {
      const response = options.getToken
        ? await apiOperationWithAuth(
            "resolve_entities_api_entities_resolve_post",
            options.getToken,
            { body: { refs: remaining } },
            options.userId,
          )
        : await apiJson<{ items: EntitySummary[] }>("/api/entities/resolve", {
            method: "POST",
            body: JSON.stringify({ refs: remaining }),
            userId: options.userId,
          });
      for (const item of response.items || []) {
        const summary = summaryFromCloud(item);
        writeCachedEntitySummary(item.ref, options.userId, summary);
        resolved.set(entityRefKey(item.ref), summary);
      }
    } catch (error) {
      console.warn("[entities] batch resolve failed", error);
      for (const ref of remaining) {
        resolved.set(entityRefKey(ref), unavailableEntitySummary(ref, "unknown"));
      }
    }
  }

  return unique.map((ref) => resolved.get(entityRefKey(ref)) || unavailableEntitySummary(ref, "unknown"));
}

const DEFAULT_LOCAL_SEARCH_TYPES: EntityType[] = [
  "habit",
  "task",
  "routine",
  "calendar_block",
  "day",
  "time_window",
];

export type SearchLocalEntitiesOptions = {
  types?: EntityType[];
  limit?: number;
};

function normalizeSearchOptions(
  typesOrOptions?: EntityType[] | SearchLocalEntitiesOptions,
): SearchLocalEntitiesOptions {
  if (Array.isArray(typesOrOptions)) return { types: typesOrOptions };
  return typesOrOptions || {};
}

export async function searchLocalEntities(
  userId: string,
  query: string,
  typesOrOptions?: EntityType[] | SearchLocalEntitiesOptions,
): Promise<EntitySummary[]> {
  const options = normalizeSearchOptions(typesOrOptions);
  const cap = Math.max(1, Math.min(options.limit || 20, 40));
  if (!canUseDesktopVault() && !parseDateMentionQuery(query)) return [];
  const needle = query.trim().toLowerCase();
  const parsedDate = parseDateMentionQuery(query);
  const wanted = new Set(
    (options.types?.length ? options.types : DEFAULT_LOCAL_SEARCH_TYPES)
      .map((item) => canonicalEntityType(item) || item)
      .filter((item): item is EntityType => Boolean(item)),
  );
  const items: EntitySummary[] = [];
  if (parsedDate && wanted.has(parsedDate.type)) {
    items.push(virtualDateSummary(parsedDate));
  }
  if (!canUseDesktopVault()) return items.slice(0, cap);

  const matches = (value: string | null | undefined) => {
    if (!needle) return true;
    return (value || "").toLowerCase().includes(needle);
  };

  const listSlice = <T,>(collection: string) =>
    listDesktopVaultRecords<T>(userId, collection, { maxRecords: cap, limit: cap });

  if (wanted.has("habit")) {
    const records = await listSlice<Habit>(HABIT_DEFINITIONS_COLLECTION);
    for (const record of records || []) {
      if (record.tombstone) continue;
      if (!matches(record.payload.name) && !matches(record.payload.category)) continue;
      const summary = summaryFromHabit(record.payload);
      if (summary) items.push(summary);
    }
  }
  if (wanted.has("habit_log")) {
    const records = await listSlice<HabitLog>(HABIT_LOGS_COLLECTION);
    for (const record of records || []) {
      if (record.tombstone) continue;
      if (!matches(record.payload.habit_name) && !matches(record.payload.notes) && !matches(record.payload.date)) continue;
      const summary = summaryFromLog(record.payload);
      if (summary) items.push(summary);
    }
  }
  if (wanted.has("task")) {
    const records = await listSlice<Task>(TASKS_COLLECTION);
    for (const record of records || []) {
      if (record.tombstone) continue;
      if (!matches(record.payload.title) && !matches(record.payload.notes || "")) continue;
      items.push(summaryFromTask(record.payload));
    }
  }
  if (wanted.has("routine")) {
    const records = await listSlice<Routine>(ROUTINES_COLLECTION);
    for (const record of records || []) {
      if (record.tombstone) continue;
      if (!matches(record.payload.title) && !matches(record.payload.description || "")) continue;
      items.push(summaryFromRoutine(record.payload));
    }
  }
  if (wanted.has("calendar_block")) {
    const records = await listSlice<ScheduledBlockVault>("scheduled_blocks");
    for (const record of records || []) {
      if (record.tombstone) continue;
      const payload = record.payload;
      if (!matches(payload.title) && !matches(payload.notes || "") && !matches(payload.day)) continue;
      const summary = summaryFromCalendarBlock(payload);
      if (summary) items.push(summary);
    }
  }
  return items.slice(0, cap);
}

export {
  clearEntitySummaryCache,
  forgetEntitySummary,
  rememberEntitySummary,
  setEntitySummaryCacheUser,
  subscribeEntitySummary,
  subscribeEntitySummaries,
} from "@/lib/entities/entity-summary-cache.mjs";
