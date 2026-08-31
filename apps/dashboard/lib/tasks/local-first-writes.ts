"use client";

import type { Routine, RoutineCreateInput, RoutineUpdateInput, Task, TaskCreateInput, TaskUpdateInput } from './types';

type ClockInput = number | Date | string;

export type LocalFirstMetadata = {
  client_event_id: string;
  sync_status: 'pending' | 'failed' | 'synced';
};

export type OptimisticTask = Task & LocalFirstMetadata;
export type OptimisticRoutine = Routine & LocalFirstMetadata;
export type TaskRoutineOutboxStatus = 'pending' | 'failed' | 'synced';

export type TaskCreateOutboxItem = {
  id: string;
  user_id: string;
  kind: 'task_create';
  status: TaskRoutineOutboxStatus;
  entityId: string;
  clientEventId: string;
  serverEntityId?: string;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
  payload: {
    input: TaskCreateInput;
    optimisticRecord: OptimisticTask;
  };
};

export type TaskUpdateOutboxItem = {
  id: string;
  user_id: string;
  kind: 'task_update';
  status: TaskRoutineOutboxStatus;
  entityId: string;
  clientEventId: string;
  serverEntityId?: string;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
  payload: {
    patch: TaskUpdateInput;
    optimisticRecord: OptimisticTask;
  };
};

export type RoutineCreateOutboxItem = {
  id: string;
  user_id: string;
  kind: 'routine_create';
  status: TaskRoutineOutboxStatus;
  entityId: string;
  clientEventId: string;
  serverEntityId?: string;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
  payload: {
    input: RoutineCreateInput;
    optimisticRecord: OptimisticRoutine;
  };
};

export type RoutineUpdateOutboxItem = {
  id: string;
  user_id: string;
  kind: 'routine_update';
  status: TaskRoutineOutboxStatus;
  entityId: string;
  clientEventId: string;
  serverEntityId?: string;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
  payload: {
    patch: RoutineUpdateInput;
    optimisticRecord: OptimisticRoutine;
  };
};

export type TaskRoutineWriteOutboxItem =
  | TaskCreateOutboxItem
  | TaskUpdateOutboxItem
  | RoutineCreateOutboxItem
  | RoutineUpdateOutboxItem;

function toIsoString(value: ClockInput = Date.now()): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return new Date(value).toISOString();
}

function toTimestamp(value: ClockInput = Date.now()): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') return new Date(value).getTime();
  return value;
}

function sanitizeIdSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'record';
}

export function createTaskRoutineClientEventId({
  kind,
  entityId,
  now = Date.now(),
  random = Math.random,
}: {
  kind: TaskRoutineWriteOutboxItem['kind'];
  entityId: string;
  now?: ClockInput;
  random?: () => number;
}): string {
  const randomPart = Math.floor(random() * 36 ** 8)
    .toString(36)
    .padStart(8, '0')
    .slice(0, 8);
  return [kind, sanitizeIdSegment(entityId), toTimestamp(now), randomPart].join(':');
}

export function createLocalTaskRoutineRecordId(prefix: 'task' | 'routine', clientEventId: string): string {
  return `local-${prefix}-${sanitizeIdSegment(clientEventId)}`;
}

export function buildOptimisticTask(
  input: TaskCreateInput,
  userId: string,
  options: { clientEventId?: string; now?: ClockInput } = {},
): OptimisticTask {
  const clientEventId = options.clientEventId || input.client_event_id || createTaskRoutineClientEventId({
    kind: 'task_create',
    entityId: input.title,
    now: options.now,
  });
  const nowIso = toIsoString(options.now);
  return {
    id: createLocalTaskRoutineRecordId('task', clientEventId),
    user_id: userId,
    title: input.title,
    notes: input.notes ?? null,
    status: input.status || 'open',
    priority: input.priority || 'none',
    due_at: input.due_at ?? null,
    scheduled_for: input.scheduled_for ?? null,
    completed_at: input.status === 'completed' ? nowIso : null,
    source: input.source || 'manual',
    project: input.project ?? null,
    category: input.category ?? null,
    tags: input.tags || [],
    routine_id: null,
    routine_run_id: null,
    linked_habit_id: null,
    linked_artifact_id: null,
    client_event_id: clientEventId,
    created_at: nowIso,
    updated_at: nowIso,
    sync_status: 'pending',
  };
}

export function buildOptimisticTaskUpdate(
  task: Task,
  patch: TaskUpdateInput,
  userId: string,
  options: { clientEventId?: string; now?: ClockInput } = {},
): OptimisticTask {
  const clientEventId = options.clientEventId || createTaskRoutineClientEventId({
    kind: 'task_update',
    entityId: task.id,
    now: options.now,
  });
  const nowIso = toIsoString(options.now);
  return {
    ...task,
    ...patch,
    user_id: userId,
    completed_at: patch.status === 'completed'
      ? patch.completed_at ?? task.completed_at ?? nowIso
      : patch.status
        ? null
        : patch.completed_at ?? task.completed_at,
    updated_at: nowIso,
    client_event_id: clientEventId,
    sync_status: 'pending',
  };
}

export function buildOptimisticRoutine(
  input: RoutineCreateInput,
  userId: string,
  options: { clientEventId?: string; now?: ClockInput } = {},
): OptimisticRoutine {
  const clientEventId = options.clientEventId || input.client_event_id || createTaskRoutineClientEventId({
    kind: 'routine_create',
    entityId: input.title,
    now: options.now,
  });
  const nowIso = toIsoString(options.now);
  return {
    id: createLocalTaskRoutineRecordId('routine', clientEventId),
    user_id: userId,
    title: input.title,
    description: input.description ?? null,
    status: input.status || 'scheduled',
    kind: input.kind || 'task',
    trigger_type: input.trigger_type || 'daily',
    trigger_config: input.trigger_config || { interval: 1 },
    timezone: input.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York',
    priority: input.priority || 'none',
    tags: input.tags || [],
    task_template: input.task_template || { title: input.title, notes: null, project: null, category: null, tags: [], linked_habit_id: null },
    ai_workflow_definition_id: input.ai_workflow_definition_id ?? null,
    first_run_at: input.first_run_at ?? null,
    ends_at: input.ends_at ?? null,
    last_run_at: null,
    next_run_at: null,
    cadence_summary: 'Pending sync',
    next_preview: [],
    created_at: nowIso,
    updated_at: nowIso,
    client_event_id: clientEventId,
    sync_status: 'pending',
  };
}

export function buildOptimisticRoutineUpdate(
  routine: Routine,
  patch: RoutineUpdateInput,
  userId: string,
  options: { clientEventId?: string; now?: ClockInput } = {},
): OptimisticRoutine {
  const clientEventId = options.clientEventId || createTaskRoutineClientEventId({
    kind: 'routine_update',
    entityId: routine.id,
    now: options.now,
  });
  return {
    ...routine,
    ...patch,
    user_id: userId,
    updated_at: toIsoString(options.now),
    client_event_id: clientEventId,
    sync_status: 'pending',
  };
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

function isLiveOutboxItem(item: TaskRoutineWriteOutboxItem): boolean {
  return item.status === 'pending' || item.status === 'failed';
}

export function mergeTasksWithOutbox(
  tasks: Task[] | null | undefined,
  outboxItems: TaskRoutineWriteOutboxItem[] | null | undefined,
): Task[] {
  let merged = tasks ? tasks.slice() : [];
  for (const item of outboxItems || []) {
    if (!isLiveOutboxItem(item)) continue;
    if (item.kind !== 'task_create' && item.kind !== 'task_update') continue;
    merged = upsertById(merged, item.payload.optimisticRecord);
  }
  return merged;
}

function taskUpdatedAt(task: Task): number {
  return Date.parse(task.updated_at || task.completed_at || task.created_at || '') || 0;
}

export function mergeTaskSources(
  remote: Task[] | null | undefined,
  vault: Task[] | null | undefined,
  outboxItems: TaskRoutineWriteOutboxItem[] | null | undefined,
): Task[] {
  const byId = new Map<string, Task>();
  for (const task of remote || []) byId.set(task.id, task);
  for (const task of vault || []) {
    const existing = byId.get(task.id);
    if (!existing || taskUpdatedAt(task) >= taskUpdatedAt(existing)) {
      byId.set(task.id, task);
    }
  }
  return mergeTasksWithOutbox([...byId.values()], outboxItems);
}

export function mergeRoutinesWithOutbox(
  routines: Routine[] | null | undefined,
  outboxItems: TaskRoutineWriteOutboxItem[] | null | undefined,
): Routine[] {
  let merged = routines ? routines.slice() : [];
  for (const item of outboxItems || []) {
    if (!isLiveOutboxItem(item)) continue;
    if (item.kind !== 'routine_create' && item.kind !== 'routine_update') continue;
    merged = upsertById(merged, item.payload.optimisticRecord);
  }
  return merged;
}

function buildOutboxBase<K extends TaskRoutineWriteOutboxItem['kind']>(
  userId: string,
  kind: K,
  entityId: string,
  clientEventId: string,
  now: ClockInput,
): {
  id: string;
  user_id: string;
  kind: K;
  status: 'pending';
  entityId: string;
  clientEventId: string;
  createdAt: string;
  updatedAt: string;
} {
  const nowIso = toIsoString(now);
  return {
    id: `outbox-${sanitizeIdSegment(clientEventId)}`,
    user_id: userId,
    kind,
    status: 'pending' as const,
    entityId,
    clientEventId,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export function buildTaskCreateOutboxItem(
  userId: string,
  input: TaskCreateInput,
  optimisticRecord: OptimisticTask,
  now: ClockInput = Date.now(),
): TaskCreateOutboxItem {
  return {
    ...buildOutboxBase(userId, 'task_create', optimisticRecord.id, optimisticRecord.client_event_id, now),
    payload: { input: { ...input, client_event_id: optimisticRecord.client_event_id }, optimisticRecord },
  };
}

export function buildTaskUpdateOutboxItem(
  userId: string,
  patch: TaskUpdateInput,
  optimisticRecord: OptimisticTask,
  now: ClockInput = Date.now(),
): TaskUpdateOutboxItem {
  return {
    ...buildOutboxBase(userId, 'task_update', optimisticRecord.id, optimisticRecord.client_event_id, now),
    payload: { patch, optimisticRecord },
  };
}

export function buildRoutineCreateOutboxItem(
  userId: string,
  input: RoutineCreateInput,
  optimisticRecord: OptimisticRoutine,
  now: ClockInput = Date.now(),
): RoutineCreateOutboxItem {
  return {
    ...buildOutboxBase(userId, 'routine_create', optimisticRecord.id, optimisticRecord.client_event_id, now),
    payload: { input: { ...input, client_event_id: optimisticRecord.client_event_id }, optimisticRecord },
  };
}

export function buildRoutineUpdateOutboxItem(
  userId: string,
  patch: RoutineUpdateInput,
  optimisticRecord: OptimisticRoutine,
  now: ClockInput = Date.now(),
): RoutineUpdateOutboxItem {
  return {
    ...buildOutboxBase(userId, 'routine_update', optimisticRecord.id, optimisticRecord.client_event_id, now),
    payload: { patch, optimisticRecord },
  };
}

export function shouldReplayTaskRoutineOutboxItem(item: TaskRoutineWriteOutboxItem): boolean {
  if ((item.kind === 'task_update' || item.kind === 'routine_update') && item.entityId.startsWith('local-')) {
    return false;
  }
  return item.status === 'pending' || item.status === 'failed';
}

export function rewriteTaskRoutineOutboxItemEntityId(
  item: TaskRoutineWriteOutboxItem,
  serverEntityId: string | null | undefined,
  now: ClockInput = Date.now(),
): TaskRoutineWriteOutboxItem {
  if (!serverEntityId || (item.kind !== 'task_update' && item.kind !== 'routine_update')) return item;
  if (item.entityId === serverEntityId) return item;
  return { ...item, entityId: serverEntityId, updatedAt: toIsoString(now) };
}

export function markTaskRoutineOutboxItemFailed(
  item: TaskRoutineWriteOutboxItem,
  lastError: string,
  now: ClockInput = Date.now(),
): TaskRoutineWriteOutboxItem {
  return {
    ...item,
    status: 'failed',
    lastError,
    updatedAt: toIsoString(now),
  };
}

export function markTaskRoutineOutboxItemSynced(
  item: TaskRoutineWriteOutboxItem,
  now: ClockInput = Date.now(),
  serverEntityId?: string,
): TaskRoutineWriteOutboxItem {
  return {
    ...item,
    status: 'synced',
    serverEntityId: serverEntityId || item.serverEntityId,
    lastError: undefined,
    updatedAt: toIsoString(now),
  };
}
