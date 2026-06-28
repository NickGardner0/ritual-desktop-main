"use client";

import type { Habit, HabitLog } from "../../contexts/habits-context.types";
import type { HabitWriteOutboxItem } from "../habits/local-first-writes";

export const HABIT_DEFINITIONS_COLLECTION = "habit_definitions";
export const HABIT_LOGS_COLLECTION = "habit_logs";
export const HABIT_WRITE_OUTBOX_COLLECTION = "habit_write_outbox";

export type DesktopVaultRecord<T = unknown> = {
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
    const { listDesktopVaultRecords } = await import("./vault-client");
    return listDesktopVaultRecords(userId, collection);
  },
};

function livePayloads<T>(records: Array<DesktopVaultRecord<T>> | null): T[] | null {
  if (!records || records.length === 0) return null;
  const payloads = records
    .filter((record) => record.tombstone !== true)
    .map((record) => record.payload);
  return payloads.length > 0 ? payloads : null;
}

export async function readLocalVaultHabits(
  userId: string,
  client: VaultListClient = desktopVaultListClient,
): Promise<Habit[] | null> {
  try {
    return livePayloads(await client.listRecords<Habit>(userId, HABIT_DEFINITIONS_COLLECTION));
  } catch (error) {
    console.warn("[Privacy] Local vault habit read failed; falling back to backend", error);
    return null;
  }
}

export async function readLocalVaultHabitLogs(
  userId: string,
  client: VaultListClient = desktopVaultListClient,
): Promise<HabitLog[] | null> {
  try {
    const logs = livePayloads(await client.listRecords<HabitLog>(userId, HABIT_LOGS_COLLECTION));
    return logs?.map((log) => ({ ...log, duration: log.duration || 0 })) ?? null;
  } catch (error) {
    console.warn("[Privacy] Local vault habit log read failed; falling back to backend", error);
    return null;
  }
}

export async function readLocalVaultHabitWriteOutboxItems(
  userId: string,
  client: VaultListClient = desktopVaultListClient,
): Promise<HabitWriteOutboxItem[] | null> {
  try {
    const items = livePayloads(
      await client.listRecords<HabitWriteOutboxItem>(userId, HABIT_WRITE_OUTBOX_COLLECTION),
    );
    return items?.sort((a, b) => a.createdAt.localeCompare(b.createdAt)) ?? null;
  } catch (error) {
    console.warn("[Privacy] Local vault habit write outbox read failed", error);
    return null;
  }
}

export async function putLocalVaultHabit(userId: string, habit: Habit) {
  if (!habit.id) return null;
  const { putDesktopVaultRecord } = await import("./vault-client");
  return putDesktopVaultRecord({
    userId,
    collection: HABIT_DEFINITIONS_COLLECTION,
    recordId: habit.id,
    recordType: "habit_definition",
    payload: habit,
    updatedAt: habit.updated_at,
  });
}

export async function putLocalVaultHabitLog(userId: string, log: HabitLog) {
  if (!log.id) return null;
  const { putDesktopVaultRecord } = await import("./vault-client");
  return putDesktopVaultRecord({
    userId,
    collection: HABIT_LOGS_COLLECTION,
    recordId: log.id,
    recordType: "habit_log",
    payload: log,
    updatedAt: log.completed_at,
  });
}

export async function putLocalVaultHabitWriteOutboxItem(
  userId: string,
  item: HabitWriteOutboxItem,
) {
  const { putDesktopVaultRecord } = await import("./vault-client");
  return putDesktopVaultRecord({
    userId,
    collection: HABIT_WRITE_OUTBOX_COLLECTION,
    recordId: item.id,
    recordType: item.kind,
    payload: item,
    updatedAt: item.updatedAt,
  });
}

export async function tombstoneLocalVaultHabit(userId: string, habitId: string) {
  const { tombstoneDesktopVaultRecord } = await import("./vault-client");
  return tombstoneDesktopVaultRecord(
    userId,
    HABIT_DEFINITIONS_COLLECTION,
    habitId,
    "habit_definition",
  );
}

export async function tombstoneLocalVaultHabitLog(userId: string, logId: string) {
  const { tombstoneDesktopVaultRecord } = await import("./vault-client");
  return tombstoneDesktopVaultRecord(userId, HABIT_LOGS_COLLECTION, logId, "habit_log");
}

export async function tombstoneLocalVaultHabitWriteOutboxItem(userId: string, itemId: string) {
  const { tombstoneDesktopVaultRecord } = await import("./vault-client");
  return tombstoneDesktopVaultRecord(
    userId,
    HABIT_WRITE_OUTBOX_COLLECTION,
    itemId,
    "habit_write_outbox",
  );
}
