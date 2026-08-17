"use client";

import { invokeDesktopCommand } from "../desktop-bridge/commands";
import { isDesktopTauriRuntime } from "../desktop-bridge/environment";

export type DesktopVaultStatus = {
  initialized: boolean;
  dbPath: string;
  recordCount: number;
  stagedRecordCount: number;
  inventoryCount: number;
  migrationManifestCount: number;
  deletionReceiptCount: number;
  activeKeyVersion: number;
  latestInventoryAt?: string | null;
  latestMigrationCompletedAt?: string | null;
  latestDeletionCompletedAt?: string | null;
};

export type DesktopVaultRecord<T = unknown> = {
  id: string;
  collection: string;
  recordType: string;
  payload: T;
  updatedAt: string;
  tombstone: boolean;
};

export type DesktopVaultPutInput<T = unknown> = {
  userId: string;
  collection: string;
  recordId: string;
  recordType: string;
  payload: T;
  updatedAt?: string;
  tombstone?: boolean;
};

export type DesktopVaultRecordMetadata = {
  id: string;
  collection: string;
  recordType: string;
  updatedAt: string;
  tombstone: boolean;
  keyVersion: number;
  algorithm: string;
};

export type DesktopVaultRecordsPage<T = unknown> = {
  records: Array<DesktopVaultRecord<T>>;
  nextCursor?: string | null;
};

export type DesktopVaultCompareAndSwapResult<T = unknown> = {
  applied: boolean;
  record?: DesktopVaultRecordMetadata | null;
  current?: DesktopVaultRecord<T> | null;
};

export type DesktopVaultMigrationManifestInput = {
  userId: string;
  migrationId: string;
  categories: string[];
  status: "running" | "completed" | "failed";
  sourceHash: string;
  localHash?: string | null;
  recordCount: number;
  migratedCount: number;
  startedAt?: string;
  completedAt?: string | null;
  error?: string | null;
};

export type DesktopVaultMigrationManifest = {
  migrationId: string;
  categories: string[];
  status: "running" | "completed" | "failed";
  sourceHash: string;
  localHash?: string | null;
  recordCount: number;
  migratedCount: number;
  startedAt: string;
  completedAt?: string | null;
  error?: string | null;
  updatedAt: string;
};

export type DesktopVaultDeletionReceiptInput = {
  userId: string;
  deletionId: string;
  categories: string[];
  status: "running" | "completed" | "failed";
  sourceHash: string;
  requestedRecordCount: number;
  deletedCount: number;
  backendReceipts: unknown;
  startedAt?: string;
  completedAt?: string | null;
  error?: string | null;
};

export type DesktopVaultDeletionReceipt = {
  deletionId: string;
  categories: string[];
  status: "running" | "completed" | "failed";
  sourceHash: string;
  requestedRecordCount: number;
  deletedCount: number;
  backendReceipts: unknown;
  startedAt: string;
  completedAt?: string | null;
  error?: string | null;
  updatedAt: string;
};

export function canUseDesktopVault(): boolean {
  return isDesktopTauriRuntime();
}

export async function initializeDesktopVault(userId: string): Promise<DesktopVaultStatus | null> {
  if (!canUseDesktopVault()) return null;
  return invokeDesktopCommand<DesktopVaultStatus>("vault_initialize", { userId });
}

export async function getDesktopVaultStatus(userId?: string | null): Promise<DesktopVaultStatus | null> {
  if (!canUseDesktopVault()) return null;
  return invokeDesktopCommand<DesktopVaultStatus>("vault_get_status", { userId: userId || null });
}

export async function putDesktopVaultRecord<T>(
  input: DesktopVaultPutInput<T>,
): Promise<DesktopVaultRecordMetadata | null> {
  if (!canUseDesktopVault()) return null;
  return invokeDesktopCommand<DesktopVaultRecordMetadata>("vault_put_record", { input });
}

export async function getDesktopVaultRecord<T>(
  userId: string,
  collection: string,
  recordId: string,
): Promise<DesktopVaultRecord<T> | null> {
  if (!canUseDesktopVault()) return null;
  return invokeDesktopCommand<DesktopVaultRecord<T> | null>("vault_get_record", {
    userId,
    collection,
    recordId,
  });
}

export async function listDesktopVaultRecords<T>(
  userId: string,
  collection: string,
  options: { since?: string; limit?: number } = {},
): Promise<Array<DesktopVaultRecord<T>> | null> {
  if (!canUseDesktopVault()) return null;
  const requestedPageSize = Math.min(Math.max(options.limit || 2_000, 1), 5_000);
  const records: Array<DesktopVaultRecord<T>> = [];
  let cursor: string | null = null;
  try {
    do {
      const page: DesktopVaultRecordsPage<T> = await invokeDesktopCommand<DesktopVaultRecordsPage<T>>("vault_list_records_page", {
        userId,
        collection,
        cursor,
        limit: requestedPageSize,
      });
      records.push(...page.records);
      cursor = page.nextCursor || null;
    } while (cursor);
    return options.since
      ? records.filter((record) => record.updatedAt > options.since!)
      : records;
  } catch (error) {
    if (records.length > 0) throw error;
    // Compatibility with native clients released before cursor pagination.
    return invokeDesktopCommand<Array<DesktopVaultRecord<T>>>("vault_list_records", {
      userId,
      collection,
      since: options.since || null,
      limit: options.limit || null,
    });
  }
}

export async function compareAndSwapDesktopVaultRecord<T>(
  record: DesktopVaultPutInput<T>,
  expectedUpdatedAt: string | null,
): Promise<DesktopVaultCompareAndSwapResult<T> | null> {
  if (!canUseDesktopVault()) return null;
  return invokeDesktopCommand<DesktopVaultCompareAndSwapResult<T>>("vault_compare_and_swap", {
    input: { record, expectedUpdatedAt },
  });
}

export async function tombstoneDesktopVaultRecord(
  userId: string,
  collection: string,
  recordId: string,
  recordType: string,
): Promise<DesktopVaultRecordMetadata | null> {
  if (!canUseDesktopVault()) return null;
  return invokeDesktopCommand<DesktopVaultRecordMetadata>("vault_tombstone_record", {
    userId,
    collection,
    recordId,
    recordType,
  });
}

export async function putDesktopVaultMigrationManifest(
  input: DesktopVaultMigrationManifestInput,
): Promise<DesktopVaultMigrationManifest | null> {
  if (!canUseDesktopVault()) return null;
  return invokeDesktopCommand<DesktopVaultMigrationManifest>("vault_put_migration_manifest", { input });
}

export async function listDesktopVaultMigrationManifests(
  userId: string,
  limit = 20,
): Promise<DesktopVaultMigrationManifest[] | null> {
  if (!canUseDesktopVault()) return null;
  return invokeDesktopCommand<DesktopVaultMigrationManifest[]>("vault_list_migration_manifests", {
    userId,
    limit,
  });
}

export async function putDesktopVaultDeletionReceipt(
  input: DesktopVaultDeletionReceiptInput,
): Promise<DesktopVaultDeletionReceipt | null> {
  if (!canUseDesktopVault()) return null;
  return invokeDesktopCommand<DesktopVaultDeletionReceipt>("vault_put_deletion_receipt", { input });
}

export async function listDesktopVaultDeletionReceipts(
  userId: string,
  limit = 20,
): Promise<DesktopVaultDeletionReceipt[] | null> {
  if (!canUseDesktopVault()) return null;
  return invokeDesktopCommand<DesktopVaultDeletionReceipt[]>("vault_list_deletion_receipts", {
    userId,
    limit,
  });
}
