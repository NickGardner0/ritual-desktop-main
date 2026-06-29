"use client";

import type {
  DesktopVaultDeletionReceipt,
  DesktopVaultMigrationManifest,
  DesktopVaultStatus,
} from "./vault-client";
import {
  LOCAL_MIGRATION_CATEGORY_LABELS,
  SUPPORTED_LOCAL_MIGRATION_CATEGORIES,
  type SupportedLocalMigrationCategory,
} from "./vault-migration";

export const SUPPORTED_CLOUD_DELETION_CATEGORIES = SUPPORTED_LOCAL_MIGRATION_CATEGORIES;

export type SupportedCloudDeletionCategory = SupportedLocalMigrationCategory;

export const CLOUD_DELETION_CATEGORY_LABELS = LOCAL_MIGRATION_CATEGORY_LABELS;

export type DeletionPlanCategory = {
  category: SupportedCloudDeletionCategory;
  description: string;
  record_count: number;
  source_hash: string;
  supported: boolean;
  execution: string;
};

export type DeletionPlan = {
  deletes_cloud_data: boolean;
  changes_source_of_truth: boolean;
  requires_local_receipt: boolean;
  total_records: number;
  source_hash: string;
  categories: DeletionPlanCategory[];
  limitations?: string[];
};

export type DeletionExecuteResponse = {
  deletion_id: string;
  local_receipt_id: string;
  deletes_cloud_data: boolean;
  changes_source_of_truth: boolean;
  requested_categories: SupportedCloudDeletionCategory[];
  record_count_before: number;
  deleted_count: number;
  remaining_count: number;
  source_hash_before: string;
  source_hash_after: string;
  completed_at: string;
  categories: Array<{
    category: SupportedCloudDeletionCategory;
    source: string;
    status: string;
    record_count_before: number;
    deleted_count: number;
    source_hash_before: string;
    completed_at: string;
  }>;
  limitations?: string[];
};

export type CloudDeletionResult = {
  deletionId: string;
  categories: SupportedCloudDeletionCategory[];
  plan: DeletionPlan;
  response: DeletionExecuteResponse;
  receipt: DesktopVaultDeletionReceipt | null;
};

export type VaultDeletionClient = {
  initializeVault(userId: string): Promise<DesktopVaultStatus | null>;
  listMigrationManifests(userId: string, limit?: number): Promise<DesktopVaultMigrationManifest[] | null>;
  putDeletionReceipt(input: {
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
  }): Promise<DesktopVaultDeletionReceipt | null>;
};

type ExecuteDeletionOptions = {
  userId: string;
  categories: SupportedCloudDeletionCategory[];
  headers?: HeadersInit;
  fetchImpl?: typeof fetch;
  client?: VaultDeletionClient;
  now?: () => Date;
};

const defaultVaultDeletionClient: VaultDeletionClient = {
  async initializeVault(userId) {
    const { initializeDesktopVault } = await import("./vault-client");
    return initializeDesktopVault(userId);
  },
  async listMigrationManifests(userId, limit) {
    const { listDesktopVaultMigrationManifests } = await import("./vault-client");
    return listDesktopVaultMigrationManifests(userId, limit);
  },
  async putDeletionReceipt(input) {
    const { putDesktopVaultDeletionReceipt } = await import("./vault-client");
    return putDesktopVaultDeletionReceipt(input);
  },
};

function selectedCategories(categories: SupportedCloudDeletionCategory[]): SupportedCloudDeletionCategory[] {
  return SUPPORTED_CLOUD_DELETION_CATEGORIES.filter((category) => categories.includes(category));
}

function completedMigrationCategorySet(manifests: DesktopVaultMigrationManifest[]): Set<string> {
  const migrated = new Set<string>();
  for (const manifest of manifests) {
    if (manifest.status !== "completed") continue;
    if (!manifest.localHash || manifest.localHash !== manifest.sourceHash) continue;
    for (const category of manifest.categories) {
      migrated.add(category);
    }
  }
  return migrated;
}

function assertLocallyMigrated(
  categories: SupportedCloudDeletionCategory[],
  manifests: DesktopVaultMigrationManifest[] | null,
) {
  if (!manifests) {
    throw new Error("Ritual Desktop is required to verify local migration before cloud deletion.");
  }
  const migrated = completedMigrationCategorySet(manifests);
  const missing = categories.filter((category) => !migrated.has(category));
  if (missing.length > 0) {
    throw new Error(`Migrate and verify locally before deleting: ${missing.join(", ")}`);
  }
}

async function fetchJson<T>(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetchImpl(url, init);
  if (!response.ok) {
    throw new Error(`Deletion request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function createDeletionId(now: Date): string {
  const randomPart = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
  return `cloud-delete-${now.toISOString()}-${randomPart}`;
}

async function writeDeletionReceipt(
  client: VaultDeletionClient,
  input: Parameters<VaultDeletionClient["putDeletionReceipt"]>[0],
): Promise<DesktopVaultDeletionReceipt | null> {
  return client.putDeletionReceipt(input);
}

export async function executeCloudBehavioralDeletion({
  userId,
  categories,
  headers,
  fetchImpl = fetch,
  client = defaultVaultDeletionClient,
  now = () => new Date(),
}: ExecuteDeletionOptions): Promise<CloudDeletionResult> {
  const selected = selectedCategories(categories);
  if (selected.length === 0) {
    throw new Error("Select at least one supported deletion category.");
  }

  const vaultStatus = await client.initializeVault(userId);
  if (!vaultStatus) {
    throw new Error("Ritual Desktop is required for cloud deletion receipts.");
  }

  const manifests = await client.listMigrationManifests(userId, 200);
  assertLocallyMigrated(selected, manifests);

  const plan = await fetchJson<DeletionPlan>(fetchImpl, "/api/privacy/deletion-plan", {
    method: "POST",
    cache: "no-store",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(headers || {}),
    },
    body: JSON.stringify({ categories: selected }),
  });

  if (!plan.deletes_cloud_data || !plan.changes_source_of_truth || !plan.requires_local_receipt) {
    throw new Error("Deletion plan did not include the required destructive-operation guards.");
  }

  const startedAt = now().toISOString();
  const deletionId = createDeletionId(new Date(startedAt));
  const localReceiptId = deletionId;
  const runningReceipt = await writeDeletionReceipt(client, {
    userId,
    deletionId,
    categories: selected,
    status: "running",
    sourceHash: plan.source_hash,
    requestedRecordCount: plan.total_records,
    deletedCount: 0,
    backendReceipts: [],
    startedAt,
    completedAt: null,
    error: null,
  });
  if (!runningReceipt) {
    throw new Error("Local deletion receipt could not be written.");
  }

  try {
    const response = await fetchJson<DeletionExecuteResponse>(fetchImpl, "/api/privacy/deletion-execute", {
      method: "POST",
      cache: "no-store",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(headers || {}),
      },
      body: JSON.stringify({
        deletion_id: deletionId,
        categories: selected,
        local_receipt_id: localReceiptId,
        confirm_behavioral_cloud_deletion: true,
      }),
    });

    const completedReceipt = await writeDeletionReceipt(client, {
      userId,
      deletionId,
      categories: selected,
      status: response.remaining_count === 0 ? "completed" : "failed",
      sourceHash: response.source_hash_before,
      requestedRecordCount: response.record_count_before,
      deletedCount: response.deleted_count,
      backendReceipts: response.categories,
      startedAt,
      completedAt: response.completed_at,
      error: response.remaining_count === 0 ? null : `${response.remaining_count} records remain in cloud storage.`,
    });

    return {
      deletionId,
      categories: selected,
      plan,
      response,
      receipt: completedReceipt,
    };
  } catch (error) {
    try {
      await writeDeletionReceipt(client, {
        userId,
        deletionId,
        categories: selected,
        status: "failed",
        sourceHash: plan.source_hash,
        requestedRecordCount: plan.total_records,
        deletedCount: 0,
        backendReceipts: [],
        startedAt,
        completedAt: now().toISOString(),
        error: error instanceof Error ? error.message : "Cloud behavioral deletion failed.",
      });
    } catch {
      // Preserve the original deletion failure for the UI.
    }
    throw error;
  }
}
