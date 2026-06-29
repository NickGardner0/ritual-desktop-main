import test, { describe } from "node:test";
import assert from "node:assert/strict";

import {
  executeLocalVaultMigration,
  hashMigrationRecords,
  type MigrationRecord,
} from "../lib/privacy/vault-migration";
import type { DesktopVaultRecord } from "../lib/privacy/vault-client";

describe("local vault migration", () => {
  const records: MigrationRecord[] = [
    {
      collection: "habit_definitions",
      record_id: "habit-1",
      record_type: "habit_definition",
      updated_at: "2026-06-23T00:00:00Z",
      payload: {
        id: "habit-1",
        name: "Private Medication",
        category: "Health",
      },
    },
    {
      collection: "habit_logs",
      record_id: "log-1",
      record_type: "habit_log",
      updated_at: "2026-06-23T12:00:00Z",
      payload: {
        id: "log-1",
        habit_id: "habit-1",
        notes: "sensitive dosage note",
        duration: 0,
      },
    },
  ];

  async function createFetch(sourceHash: string): Promise<typeof fetch> {
    return async (_url, init) => {
      const url = String(_url);
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (url.endsWith("/migration-plan")) {
        return Response.json({
          deletes_cloud_data: false,
          changes_source_of_truth: false,
          total_records: records.length,
          source_hash: sourceHash,
          categories: [
            {
              category: "habit_definitions",
              description: "Habit definitions",
              record_count: 1,
              source_hash: await hashMigrationRecords([records[0]]),
              supported: true,
            },
            {
              category: "habit_logs",
              description: "Habit logs",
              record_count: 1,
              source_hash: await hashMigrationRecords([records[1]]),
              supported: true,
            },
          ],
        });
      }
      if (url.endsWith("/migration-records")) {
        const categoryRecords = records.filter((record) => record.collection === body.category);
        return Response.json({
          deletes_cloud_data: false,
          changes_source_of_truth: false,
          category: body.category,
          returned_count: categoryRecords.length,
          total_records: categoryRecords.length,
          next_offset: null,
          source_hash: await hashMigrationRecords(categoryRecords),
          records: categoryRecords,
        });
      }
      return new Response(null, { status: 404 });
    };
  }

  test("writes records, verifies local hash, and completes manifest", async () => {
    const sourceHash = await hashMigrationRecords(records);
    const written: DesktopVaultRecord[] = [];
    const manifests: Array<{ status: string; migratedCount: number; localHash?: string | null }> = [];
    const result = await executeLocalVaultMigration({
      userId: "user-1",
      categories: ["habit_definitions", "habit_logs"],
      fetchImpl: await createFetch(sourceHash),
      now: () => new Date("2026-06-23T00:00:00Z"),
      client: {
        async initializeVault() {
          return {
            initialized: true,
            dbPath: "/tmp/vault.db",
            recordCount: 0,
            stagedRecordCount: 0,
            inventoryCount: 0,
            migrationManifestCount: 0,
            deletionReceiptCount: 0,
            activeKeyVersion: 1,
          };
        },
        async putRecord(input) {
          written.push({
            id: input.recordId,
            collection: input.collection,
            recordType: input.recordType,
            payload: input.payload,
            updatedAt: input.updatedAt || "",
            tombstone: false,
          });
          return {
            id: input.recordId,
            collection: input.collection,
            recordType: input.recordType,
            updatedAt: input.updatedAt || "",
            tombstone: false,
            keyVersion: 1,
            algorithm: "AES-256-GCM",
          };
        },
        async listRecords<T>(_userId: string, collection: string) {
          return written.filter((record) => record.collection === collection) as Array<DesktopVaultRecord<T>>;
        },
        async putManifest(input) {
          manifests.push({
            status: input.status,
            migratedCount: input.migratedCount,
            localHash: input.localHash,
          });
          return {
            migrationId: input.migrationId,
            categories: input.categories,
            status: input.status,
            sourceHash: input.sourceHash,
            localHash: input.localHash,
            recordCount: input.recordCount,
            migratedCount: input.migratedCount,
            startedAt: input.startedAt || "",
            completedAt: input.completedAt,
            error: input.error,
            updatedAt: input.completedAt || input.startedAt || "",
          };
        },
      },
    });

    assert.equal(result.migratedCount, 2);
    assert.equal(result.localHash, sourceHash);
    assert.deepEqual(manifests.map((manifest) => manifest.status), ["running", "completed"]);
    assert.equal(manifests.at(-1)?.migratedCount, 2);
  });

  test("marks manifest failed when local verification does not match", async () => {
    const sourceHash = await hashMigrationRecords(records);
    const manifests: string[] = [];

    await assert.rejects(
      executeLocalVaultMigration({
        userId: "user-1",
        categories: ["habit_definitions", "habit_logs"],
        fetchImpl: await createFetch(sourceHash),
        now: () => new Date("2026-06-23T00:00:00Z"),
        client: {
          async initializeVault() {
            return {
              initialized: true,
              dbPath: "/tmp/vault.db",
              recordCount: 0,
              stagedRecordCount: 0,
              inventoryCount: 0,
              migrationManifestCount: 0,
              deletionReceiptCount: 0,
              activeKeyVersion: 1,
            };
          },
          async putRecord(input) {
            return {
              id: input.recordId,
              collection: input.collection,
              recordType: input.recordType,
              updatedAt: input.updatedAt || "",
              tombstone: false,
              keyVersion: 1,
              algorithm: "AES-256-GCM",
            };
          },
          async listRecords() {
            return [];
          },
          async putManifest(input) {
            manifests.push(input.status);
            return {
              migrationId: input.migrationId,
              categories: input.categories,
              status: input.status,
              sourceHash: input.sourceHash,
              localHash: input.localHash,
              recordCount: input.recordCount,
              migratedCount: input.migratedCount,
              startedAt: input.startedAt || "",
              completedAt: input.completedAt,
              error: input.error,
              updatedAt: input.completedAt || input.startedAt || "",
            };
          },
        },
      }),
    );

    assert.deepEqual(manifests, ["running", "failed"]);
  });

});
