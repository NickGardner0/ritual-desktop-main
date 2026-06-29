"use client";

import type {
  DesktopVaultMigrationManifest,
  DesktopVaultRecord,
  DesktopVaultRecordMetadata,
  DesktopVaultStatus,
} from "./vault-client";

export const SUPPORTED_LOCAL_MIGRATION_CATEGORIES = [
  "ai_conversations",
  "ai_facts",
  "ai_messages",
  "artifacts",
  "financial_accounts",
  "financial_transactions",
  "habit_definitions",
  "habit_logs",
  "import_items",
  "import_runs",
  "location_pings",
  "location_state",
  "reports",
  "tasks",
  "task_events",
  "routines",
  "routine_runs",
  "scheduled_blocks",
  "sms_copilot",
  "wearable_events",
  "wearable_samples",
  "workflows",
] as const;

export type SupportedLocalMigrationCategory = typeof SUPPORTED_LOCAL_MIGRATION_CATEGORIES[number];

export const LOCAL_MIGRATION_CATEGORY_LABELS: Record<SupportedLocalMigrationCategory, string> = {
  ai_conversations: "AI conversations",
  ai_facts: "AI facts",
  ai_messages: "AI messages",
  artifacts: "Artifacts",
  financial_accounts: "Financial accounts",
  financial_transactions: "Financial transactions",
  habit_definitions: "Habit definitions",
  habit_logs: "Habit logs",
  import_items: "Import items",
  import_runs: "Import runs",
  location_pings: "Location pings",
  location_state: "Location state",
  reports: "Reports",
  tasks: "Tasks",
  task_events: "Task events",
  routines: "Routines",
  routine_runs: "Routine runs",
  scheduled_blocks: "Scheduled blocks",
  sms_copilot: "SMS copilot",
  wearable_events: "Wearable events",
  wearable_samples: "Wearable samples",
  workflows: "Workflows",
};

export type MigrationRecord = {
  collection: SupportedLocalMigrationCategory;
  record_id: string;
  record_type: string;
  updated_at?: string | null;
  payload: unknown;
};

export type MigrationPlanCategory = {
  category: SupportedLocalMigrationCategory;
  description: string;
  record_count: number;
  source_hash: string;
  supported: boolean;
};

export type MigrationPlan = {
  deletes_cloud_data: boolean;
  changes_source_of_truth: boolean;
  total_records: number;
  source_hash: string;
  categories: MigrationPlanCategory[];
};

export type MigrationRecordsBatch = {
  deletes_cloud_data: boolean;
  changes_source_of_truth: boolean;
  category: SupportedLocalMigrationCategory;
  returned_count: number;
  total_records: number;
  next_offset?: number | null;
  source_hash: string;
  records: MigrationRecord[];
};

export type LocalVaultMigrationResult = {
  migrationId: string;
  categories: SupportedLocalMigrationCategory[];
  recordCount: number;
  migratedCount: number;
  sourceHash: string;
  localHash: string;
  manifest: DesktopVaultMigrationManifest | null;
};

export type VaultMigrationClient = {
  initializeVault(userId: string): Promise<DesktopVaultStatus | null>;
  putRecord(input: {
    userId: string;
    collection: string;
    recordId: string;
    recordType: string;
    payload: unknown;
    updatedAt?: string;
  }): Promise<DesktopVaultRecordMetadata | null>;
  listRecords<T>(
    userId: string,
    collection: string,
    options?: { limit?: number },
  ): Promise<Array<DesktopVaultRecord<T>> | null>;
  putManifest(input: {
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
  }): Promise<DesktopVaultMigrationManifest | null>;
};

const defaultVaultMigrationClient: VaultMigrationClient = {
  async initializeVault(userId) {
    const { initializeDesktopVault } = await import("./vault-client");
    return initializeDesktopVault(userId);
  },
  async putRecord(input) {
    const { putDesktopVaultRecord } = await import("./vault-client");
    return putDesktopVaultRecord(input);
  },
  async listRecords(userId, collection, options) {
    const { listDesktopVaultRecords } = await import("./vault-client");
    return listDesktopVaultRecords(userId, collection, options);
  },
  async putManifest(input) {
    const { putDesktopVaultMigrationManifest } = await import("./vault-client");
    return putDesktopVaultMigrationManifest(input);
  },
};

type ExecuteMigrationOptions = {
  userId: string;
  categories: SupportedLocalMigrationCategory[];
  headers?: HeadersInit;
  fetchImpl?: typeof fetch;
  client?: VaultMigrationClient;
  batchLimit?: number;
  now?: () => Date;
};

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item === undefined ? null : item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`;
}

async function sha256Hex(text: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("SHA-256 is unavailable in this runtime.");
  }
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function sortMigrationRecords(records: MigrationRecord[]): MigrationRecord[] {
  return [...records].sort((left, right) => {
    const collectionCompare = left.collection.localeCompare(right.collection);
    if (collectionCompare !== 0) return collectionCompare;
    return left.record_id.localeCompare(right.record_id);
  });
}

export async function hashMigrationRecords(records: MigrationRecord[]): Promise<string> {
  return sha256Hex(stableStringify(sortMigrationRecords(records)));
}

function createMigrationId(now: Date): string {
  const randomPart = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
  return `local-vault-${now.toISOString()}-${randomPart}`;
}

async function fetchJson<T>(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetchImpl(url, init);
  if (!response.ok) {
    throw new Error(`Migration request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function vaultRecordToMigrationRecord(
  record: DesktopVaultRecord,
  collection: SupportedLocalMigrationCategory,
): MigrationRecord {
  return {
    collection,
    record_id: record.id,
    record_type: record.recordType,
    updated_at: record.updatedAt,
    payload: record.payload,
  };
}

function selectedCategories(categories: SupportedLocalMigrationCategory[]): SupportedLocalMigrationCategory[] {
  return SUPPORTED_LOCAL_MIGRATION_CATEGORIES.filter((category) => categories.includes(category));
}

export async function executeLocalVaultMigration({
  userId,
  categories,
  headers,
  fetchImpl = fetch,
  client = defaultVaultMigrationClient,
  batchLimit = 250,
  now = () => new Date(),
}: ExecuteMigrationOptions): Promise<LocalVaultMigrationResult> {
  const selected = selectedCategories(categories);
  if (selected.length === 0) {
    throw new Error("Select at least one supported migration category.");
  }

  const vaultStatus = await client.initializeVault(userId);
  if (!vaultStatus) {
    throw new Error("Ritual Desktop is required for local vault migration.");
  }

  const plan = await fetchJson<MigrationPlan>(fetchImpl, "/api/privacy/migration-plan", {
    method: "POST",
    cache: "no-store",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(headers || {}),
    },
    body: JSON.stringify({ categories: selected }),
  });

  if (plan.deletes_cloud_data || plan.changes_source_of_truth) {
    throw new Error("Migration plan attempted a disallowed cloud mutation.");
  }

  const startedAt = now().toISOString();
  const migrationId = createMigrationId(new Date(startedAt));
  let migratedCount = 0;
  let manifest: DesktopVaultMigrationManifest | null = null;
  const fetchedRecords: MigrationRecord[] = [];

  const writeManifest = async (
    status: "running" | "completed" | "failed",
    updates: {
      localHash?: string | null;
      completedAt?: string | null;
      error?: string | null;
    } = {},
  ) => {
    manifest = await client.putManifest({
      userId,
      migrationId,
      categories: selected,
      status,
      sourceHash: plan.source_hash,
      localHash: updates.localHash ?? null,
      recordCount: plan.total_records,
      migratedCount,
      startedAt,
      completedAt: updates.completedAt ?? null,
      error: updates.error ?? null,
    });
  };

  await writeManifest("running");

  try {
    for (const category of selected) {
      let offset = 0;
      let nextOffset: number | null | undefined = 0;
      while (nextOffset != null) {
        const batch = await fetchJson<MigrationRecordsBatch>(
          fetchImpl,
          "/api/privacy/migration-records",
          {
            method: "POST",
            cache: "no-store",
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
              ...(headers || {}),
            },
            body: JSON.stringify({ category, offset, limit: batchLimit }),
          },
        );

        if (batch.deletes_cloud_data || batch.changes_source_of_truth) {
          throw new Error("Migration batch attempted a disallowed cloud mutation.");
        }

        for (const record of batch.records) {
          await client.putRecord({
            userId,
            collection: record.collection,
            recordId: record.record_id,
            recordType: record.record_type,
            payload: record.payload,
            updatedAt: record.updated_at || undefined,
          });
          fetchedRecords.push(record);
          migratedCount += 1;
        }

        nextOffset = batch.next_offset;
        offset = nextOffset ?? 0;
      }
    }

    const fetchedHash = await hashMigrationRecords(fetchedRecords);
    if (fetchedHash !== plan.source_hash || fetchedRecords.length !== plan.total_records) {
      throw new Error("Fetched migration records did not match the backend plan.");
    }

    const expectedIdsByCategory = new Map<SupportedLocalMigrationCategory, Set<string>>();
    for (const record of fetchedRecords) {
      const existing = expectedIdsByCategory.get(record.collection) || new Set<string>();
      existing.add(record.record_id);
      expectedIdsByCategory.set(record.collection, existing);
    }

    const localRecords: MigrationRecord[] = [];
    for (const category of selected) {
      const expectedIds = expectedIdsByCategory.get(category) || new Set<string>();
      const expectedCategoryCount = expectedIds.size;
      const records = await client.listRecords(userId, category, {
        limit: Math.max(expectedCategoryCount + 25, batchLimit),
      });
      if (!records) {
        throw new Error("Local vault records could not be read for verification.");
      }
      for (const record of records) {
        if (!record.tombstone && expectedIds.has(record.id)) {
          localRecords.push(vaultRecordToMigrationRecord(record, category));
        }
      }
    }

    const localHash = await hashMigrationRecords(localRecords);
    if (localHash !== plan.source_hash || localRecords.length !== plan.total_records) {
      throw new Error("Local vault verification failed after migration.");
    }

    const completedAt = now().toISOString();
    await writeManifest("completed", { localHash, completedAt });
    return {
      migrationId,
      categories: selected,
      recordCount: plan.total_records,
      migratedCount,
      sourceHash: plan.source_hash,
      localHash,
      manifest,
    };
  } catch (error) {
    await writeManifest("failed", {
      error: "Local vault migration failed before verification completed.",
      completedAt: now().toISOString(),
    });
    throw error;
  }
}
