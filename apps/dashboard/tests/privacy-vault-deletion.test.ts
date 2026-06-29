import test, { describe } from "node:test";
import assert from "node:assert/strict";

import {
  executeCloudBehavioralDeletion,
  type DeletionExecuteResponse,
  type DeletionPlan,
} from "../lib/privacy/vault-deletion";
import type {
  DesktopVaultDeletionReceipt,
  DesktopVaultMigrationManifest,
} from "../lib/privacy/vault-client";

describe("cloud behavioral deletion", () => {
  const plan: DeletionPlan = {
    deletes_cloud_data: true,
    changes_source_of_truth: true,
    requires_local_receipt: true,
    total_records: 2,
    source_hash: "source-hash",
    categories: [
      {
        category: "habit_definitions",
        description: "Habit definitions",
        record_count: 1,
        source_hash: "habit-hash",
        supported: true,
        execution: "backend_turso_delete",
      },
      {
        category: "habit_logs",
        description: "Habit logs",
        record_count: 1,
        source_hash: "log-hash",
        supported: true,
        execution: "backend_turso_delete",
      },
    ],
  };

  const completedManifest: DesktopVaultMigrationManifest = {
    migrationId: "migration-1",
    categories: ["habit_definitions", "habit_logs"],
    status: "completed",
    sourceHash: "source-hash",
    localHash: "source-hash",
    recordCount: 2,
    migratedCount: 2,
    startedAt: "2026-06-23T00:00:00Z",
    completedAt: "2026-06-23T00:00:01Z",
    error: null,
    updatedAt: "2026-06-23T00:00:01Z",
  };

  function createFetch(calls: string[]): typeof fetch {
    return async (_url, init) => {
      const url = String(_url);
      calls.push(url);
      if (url.endsWith("/deletion-plan")) {
        return Response.json(plan);
      }
      if (url.endsWith("/deletion-execute")) {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        const response: DeletionExecuteResponse = {
          deletion_id: body.deletion_id,
          local_receipt_id: body.local_receipt_id,
          deletes_cloud_data: true,
          changes_source_of_truth: true,
          requested_categories: body.categories,
          record_count_before: 2,
          deleted_count: 2,
          remaining_count: 0,
          source_hash_before: "source-hash",
          source_hash_after: "empty-hash",
          completed_at: "2026-06-23T00:00:02Z",
          categories: [
            {
              category: "habit_logs",
              source: "backend_turso",
              status: "deleted",
              record_count_before: 1,
              deleted_count: 1,
              source_hash_before: "log-hash",
              completed_at: "2026-06-23T00:00:02Z",
            },
            {
              category: "habit_definitions",
              source: "backend_turso",
              status: "deleted",
              record_count_before: 1,
              deleted_count: 1,
              source_hash_before: "habit-hash",
              completed_at: "2026-06-23T00:00:02Z",
            },
          ],
        };
        return Response.json(response);
      }
      return new Response(null, { status: 404 });
    };
  }

  function createClient(
    manifests: DesktopVaultMigrationManifest[] | null,
    receipts: Array<{ status: string; deletedCount: number }>,
  ) {
    return {
      async initializeVault() {
        return {
          initialized: true,
          dbPath: "/tmp/vault.db",
          recordCount: 2,
          stagedRecordCount: 0,
          inventoryCount: 0,
          migrationManifestCount: manifests?.length || 0,
          deletionReceiptCount: 0,
          activeKeyVersion: 1,
        };
      },
      async listMigrationManifests() {
        return manifests;
      },
      async putDeletionReceipt(input: {
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
      }): Promise<DesktopVaultDeletionReceipt> {
        receipts.push({ status: input.status, deletedCount: input.deletedCount });
        return {
          deletionId: input.deletionId,
          categories: input.categories,
          status: input.status,
          sourceHash: input.sourceHash,
          requestedRecordCount: input.requestedRecordCount,
          deletedCount: input.deletedCount,
          backendReceipts: input.backendReceipts,
          startedAt: input.startedAt || "",
          completedAt: input.completedAt,
          error: input.error,
          updatedAt: input.completedAt || input.startedAt || "",
        };
      },
    };
  }

  test("writes a running receipt before backend execution and completes it", async () => {
    const calls: string[] = [];
    const receipts: Array<{ status: string; deletedCount: number }> = [];
    const result = await executeCloudBehavioralDeletion({
      userId: "user-1",
      categories: ["habit_definitions", "habit_logs"],
      fetchImpl: createFetch(calls),
      now: () => new Date("2026-06-23T00:00:00Z"),
      client: createClient([completedManifest], receipts),
    });

    assert.equal(result.response.deleted_count, 2);
    assert.deepEqual(calls, ["/api/privacy/deletion-plan", "/api/privacy/deletion-execute"]);
    assert.deepEqual(receipts, [
      { status: "running", deletedCount: 0 },
      { status: "completed", deletedCount: 2 },
    ]);
  });

  test("refuses deletion without completed local migration manifest", async () => {
    const calls: string[] = [];
    const receipts: Array<{ status: string; deletedCount: number }> = [];

    await assert.rejects(
      executeCloudBehavioralDeletion({
        userId: "user-1",
        categories: ["habit_definitions", "habit_logs"],
        fetchImpl: createFetch(calls),
        now: () => new Date("2026-06-23T00:00:00Z"),
        client: createClient([], receipts),
      }),
      /Migrate and verify locally before deleting/,
    );

    assert.deepEqual(calls, []);
    assert.deepEqual(receipts, []);
  });
});
