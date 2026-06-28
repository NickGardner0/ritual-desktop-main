"use client";

import type { Habit, HabitLog } from "../../contexts/habits-context.types";

export type LocalFirstCreateHabitInput = {
  name: string;
  category: string;
  icon?: string;
  is_custom?: boolean;
  integration_source?: string | null;
  unit_type?: string | null;
  sensor_type?: string | null;
  metric_type?: string | null;
};

export type HabitLogMutationInput = Omit<HabitLog, "id"> & {
  id?: string;
  habit_name?: string;
  client_event_id?: string;
};

export type LocalFirstMetadata = {
  client_event_id: string;
  sync_status: "pending" | "failed" | "synced";
};

export type OptimisticHabitLog = HabitLog & LocalFirstMetadata;
export type OptimisticHabit = Habit & LocalFirstMetadata;

export type HabitWriteOutboxStatus = "pending" | "failed" | "synced";

export type HabitLogCreateOutboxItem = {
  id: string;
  user_id: string;
  kind: "habit_log_create";
  status: HabitWriteOutboxStatus;
  entityId: string;
  clientEventId: string;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
  payload: {
    input: HabitLogMutationInput;
    optimisticRecord: OptimisticHabitLog;
  };
};

export type HabitCreateOutboxItem = {
  id: string;
  user_id: string;
  kind: "habit_create";
  status: HabitWriteOutboxStatus;
  entityId: string;
  clientEventId: string;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
  payload: {
    input: LocalFirstCreateHabitInput;
    optimisticRecord: OptimisticHabit;
  };
};

export type HabitWriteOutboxItem = HabitLogCreateOutboxItem | HabitCreateOutboxItem;

type ClockInput = number | Date | string;

type ClientEventIdOptions = {
  kind: "habit_log_create" | "habit_create";
  entityId: string;
  date?: string;
  now?: ClockInput;
  random?: () => number;
};

function toIsoString(value: ClockInput = Date.now()): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return new Date(value).toISOString();
}

function toTimestamp(value: ClockInput = Date.now()): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") return new Date(value).getTime();
  return value;
}

function sanitizeIdSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "record";
}

export function createHabitClientEventId({
  kind,
  entityId,
  date,
  now = Date.now(),
  random = Math.random,
}: ClientEventIdOptions): string {
  const randomPart = Math.floor(random() * 36 ** 8)
    .toString(36)
    .padStart(8, "0")
    .slice(0, 8);
  return [
    kind,
    sanitizeIdSegment(entityId),
    date ? sanitizeIdSegment(date) : "na",
    toTimestamp(now),
    randomPart,
  ].join(":");
}

export function createLocalHabitRecordId(prefix: "habit" | "habit-log", clientEventId: string): string {
  return `local-${prefix}-${sanitizeIdSegment(clientEventId)}`;
}

export function buildOptimisticHabitLog(
  input: HabitLogMutationInput,
  userId: string,
  options: {
    clientEventId?: string;
    now?: ClockInput;
  } = {},
): OptimisticHabitLog {
  const clientEventId = options.clientEventId || input.client_event_id || createHabitClientEventId({
    kind: "habit_log_create",
    entityId: input.habit_id,
    date: input.date,
    now: options.now,
  });
  const completedAt = input.completed_at || toIsoString(options.now);

  return {
    ...input,
    id: input.id || createLocalHabitRecordId("habit-log", clientEventId),
    user_id: userId,
    duration: Number.isFinite(Number(input.duration)) ? Number(input.duration) : 0,
    completed_at: completedAt,
    status: input.status || "completed",
    integration_source: input.integration_source || "manual",
    client_event_id: clientEventId,
    sync_status: "pending",
  };
}

export function buildOptimisticHabit(
  input: LocalFirstCreateHabitInput,
  userId: string,
  options: {
    clientEventId?: string;
    now?: ClockInput;
  } = {},
): OptimisticHabit {
  const clientEventId = options.clientEventId || createHabitClientEventId({
    kind: "habit_create",
    entityId: input.name,
    now: options.now,
  });
  const nowIso = toIsoString(options.now);

  return {
    id: createLocalHabitRecordId("habit", clientEventId),
    user_id: userId,
    name: input.name,
    category: input.category,
    icon: input.icon || undefined,
    is_custom: input.is_custom ?? true,
    integration_source: input.integration_source || "manual",
    unit_type: input.unit_type || undefined,
    metric_type: input.metric_type || undefined,
    created_at: nowIso,
    updated_at: nowIso,
    client_event_id: clientEventId,
    sync_status: "pending",
  };
}

export function buildHabitLogCreateOutboxItem(
  userId: string,
  input: HabitLogMutationInput,
  optimisticRecord: OptimisticHabitLog,
  now: ClockInput = Date.now(),
): HabitLogCreateOutboxItem {
  const nowIso = toIsoString(now);
  return {
    id: `outbox-${sanitizeIdSegment(optimisticRecord.client_event_id)}`,
    user_id: userId,
    kind: "habit_log_create",
    status: "pending",
    entityId: optimisticRecord.id || optimisticRecord.client_event_id,
    clientEventId: optimisticRecord.client_event_id,
    createdAt: nowIso,
    updatedAt: nowIso,
    payload: {
      input: {
        ...input,
        id: optimisticRecord.id,
        client_event_id: optimisticRecord.client_event_id,
      },
      optimisticRecord,
    },
  };
}

export function buildHabitCreateOutboxItem(
  userId: string,
  input: LocalFirstCreateHabitInput,
  optimisticRecord: OptimisticHabit,
  now: ClockInput = Date.now(),
): HabitCreateOutboxItem {
  const nowIso = toIsoString(now);
  return {
    id: `outbox-${sanitizeIdSegment(optimisticRecord.client_event_id)}`,
    user_id: userId,
    kind: "habit_create",
    status: "pending",
    entityId: optimisticRecord.id || optimisticRecord.client_event_id,
    clientEventId: optimisticRecord.client_event_id,
    createdAt: nowIso,
    updatedAt: nowIso,
    payload: {
      input,
      optimisticRecord,
    },
  };
}

function isLiveOutboxItem(item: HabitWriteOutboxItem): boolean {
  return item.status === "pending" || item.status === "failed";
}

export function upsertById<T extends { id?: string }>(records: T[], record: T): T[] {
  const recordId = record.id;
  if (!recordId) return [record, ...records];

  const index = records.findIndex((existing) => existing.id === recordId);
  if (index < 0) return [record, ...records];

  const next = records.slice();
  next[index] = record;
  return next;
}

export function mergeHabitsWithOutbox(
  habits: Habit[] | null | undefined,
  outboxItems: HabitWriteOutboxItem[] | null | undefined,
): Habit[] {
  let merged = habits ? habits.slice() : [];
  for (const item of outboxItems || []) {
    if (item.kind !== "habit_create" || !isLiveOutboxItem(item)) continue;
    merged = upsertById(merged, item.payload.optimisticRecord);
  }
  return merged;
}

export function mergeHabitLogsWithOutbox(
  logs: HabitLog[] | null | undefined,
  outboxItems: HabitWriteOutboxItem[] | null | undefined,
): HabitLog[] {
  let merged = logs ? logs.slice() : [];
  for (const item of outboxItems || []) {
    if (item.kind !== "habit_log_create" || !isLiveOutboxItem(item)) continue;
    merged = upsertById(merged, item.payload.optimisticRecord);
  }
  return merged;
}

export function getHabitLogOptimisticDelta(log: Pick<HabitLog, "amount" | "duration">): number {
  const amount = Number(log.amount);
  if (Number.isFinite(amount) && amount > 0) return amount;

  const duration = Number(log.duration);
  if (Number.isFinite(duration) && duration > 0) return duration;

  return 1;
}

export function getHabitLogOptimisticUnit(
  log: Pick<HabitLog, "unit">,
  habit?: Pick<Habit, "unit_type"> | null,
): string {
  return log.unit || habit?.unit_type || "count";
}

export function markOutboxItemFailed(
  item: HabitWriteOutboxItem,
  lastError: string,
  now: ClockInput = Date.now(),
): HabitWriteOutboxItem {
  return {
    ...item,
    status: "failed",
    lastError,
    updatedAt: toIsoString(now),
  };
}

export function markOutboxItemSynced(
  item: HabitWriteOutboxItem,
  now: ClockInput = Date.now(),
): HabitWriteOutboxItem {
  return {
    ...item,
    status: "synced",
    lastError: undefined,
    updatedAt: toIsoString(now),
  };
}

export function shouldReplayHabitOutboxItem(item: HabitWriteOutboxItem): boolean {
  if (item.kind === "habit_create") return item.status === "pending";
  return item.status === "pending" || item.status === "failed";
}
