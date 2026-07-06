"use client";

import type { Routine, RoutineRun, Task } from "@/lib/tasks/types";
import type { TaskRoutineWriteOutboxItem } from "@/lib/tasks/local-first-writes";
import { vaultSync } from "./vault-sync";

export const TASKS_COLLECTION = "tasks";
export const TASK_EVENTS_COLLECTION = "task_events";
export const ROUTINES_COLLECTION = "routines";
export const ROUTINE_RUNS_COLLECTION = "routine_runs";
export const TASK_ROUTINE_WRITE_OUTBOX_COLLECTION = "task_routine_write_outbox";

type DesktopVaultRecord<T = unknown> = {
  id: string;
  collection: string;
  recordType: string;
  payload: T;
  updatedAt: string;
  tombstone: boolean;
};

type VaultListClient = {
  listRecords<T>(userId: string, collection: string): Promise<Array<DesktopVaultRecord<T>> | null>;
};

const desktopVaultListClient: VaultListClient = {
  async listRecords(userId, collection) {
    return vaultSync.listRecords(userId, collection);
  },
};

function livePayloads<T>(records: Array<DesktopVaultRecord<T>> | null): T[] | null {
  if (!records || records.length === 0) return null;
  const payloads = records
    .filter((record) => record.tombstone !== true)
    .map((record) => record.payload);
  return payloads.length > 0 ? payloads : null;
}

export async function readLocalVaultTasks(
  userId: string,
  client: VaultListClient = desktopVaultListClient,
): Promise<Task[] | null> {
  try {
    return livePayloads(await client.listRecords<Task>(userId, TASKS_COLLECTION));
  } catch (error) {
    console.warn("[Privacy] Local vault task read failed; falling back to backend", error);
    return null;
  }
}

export async function readLocalVaultRoutines(
  userId: string,
  client: VaultListClient = desktopVaultListClient,
): Promise<Routine[] | null> {
  try {
    return livePayloads(await client.listRecords<Routine>(userId, ROUTINES_COLLECTION));
  } catch (error) {
    console.warn("[Privacy] Local vault routine read failed; falling back to backend", error);
    return null;
  }
}

export async function readLocalVaultRoutineRuns(
  userId: string,
  client: VaultListClient = desktopVaultListClient,
): Promise<RoutineRun[] | null> {
  try {
    return livePayloads(await client.listRecords<RoutineRun>(userId, ROUTINE_RUNS_COLLECTION));
  } catch (error) {
    console.warn("[Privacy] Local vault routine run read failed; falling back to backend", error);
    return null;
  }
}

export async function readLocalVaultTaskRoutineWriteOutboxItems(
  userId: string,
  client: VaultListClient = desktopVaultListClient,
): Promise<TaskRoutineWriteOutboxItem[] | null> {
  try {
    const items = livePayloads(
      await client.listRecords<TaskRoutineWriteOutboxItem>(userId, TASK_ROUTINE_WRITE_OUTBOX_COLLECTION),
    );
    return items?.sort((a, b) => a.createdAt.localeCompare(b.createdAt)) ?? null;
  } catch (error) {
    console.warn("[Privacy] Local vault task/routine write outbox read failed", error);
    return null;
  }
}

export async function putLocalVaultTask(userId: string, task: Task) {
  return vaultSync.putRecord({
    userId,
    collection: TASKS_COLLECTION,
    recordId: task.id,
    recordType: "task",
    payload: task,
    updatedAt: task.updated_at || task.created_at || new Date().toISOString(),
  });
}

export async function putLocalVaultRoutine(userId: string, routine: Routine) {
  return vaultSync.putRecord({
    userId,
    collection: ROUTINES_COLLECTION,
    recordId: routine.id,
    recordType: "routine",
    payload: routine,
    updatedAt: routine.updated_at || routine.created_at || new Date().toISOString(),
  });
}

export async function putLocalVaultTaskRoutineWriteOutboxItem(
  userId: string,
  item: TaskRoutineWriteOutboxItem,
) {
  return vaultSync.putRecord({
    userId,
    collection: TASK_ROUTINE_WRITE_OUTBOX_COLLECTION,
    recordId: item.id,
    recordType: item.kind,
    payload: item,
    updatedAt: item.updatedAt,
  });
}

export async function tombstoneLocalVaultTask(userId: string, taskId: string) {
  return vaultSync.tombstoneRecord(userId, TASKS_COLLECTION, taskId, "task");
}

export async function tombstoneLocalVaultRoutine(userId: string, routineId: string) {
  return vaultSync.tombstoneRecord(userId, ROUTINES_COLLECTION, routineId, "routine");
}
