import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { InMemoryVaultAdapter, VaultSync } from "../lib/privacy/vault-sync";

describe("VaultSync facade", () => {
  test("stores, lists, and tombstones records through the interface", async () => {
    const vault = new VaultSync(new InMemoryVaultAdapter());

    await vault.initialize("user-1");
    const metadata = await vault.putRecord({
      userId: "user-1",
      collection: "habit_definitions",
      recordId: "habit-1",
      recordType: "habit_definition",
      payload: { id: "habit-1", name: "Read" },
      updatedAt: "2026-07-05T00:00:00Z",
    });

    assert.equal(metadata?.id, "habit-1");

    const records = await vault.listRecords<{ id: string; name: string }>("user-1", "habit_definitions");
    assert.equal(records?.length, 1);
    assert.equal(records?.[0].payload.name, "Read");

    const tombstone = await vault.tombstoneRecord(
      "user-1",
      "habit_definitions",
      "habit-1",
      "habit_definition",
    );
    assert.equal(tombstone?.tombstone, true);

    const updated = await vault.getRecord("user-1", "habit_definitions", "habit-1");
    assert.equal(updated?.tombstone, true);
  });

  test("keeps migration manifests and deletion receipts behind the same facade", async () => {
    const vault = new VaultSync(new InMemoryVaultAdapter());

    await vault.putMigrationManifest({
      userId: "user-1",
      migrationId: "migration-1",
      categories: ["habit_definitions"],
      status: "completed",
      sourceHash: "source",
      recordCount: 1,
      migratedCount: 1,
    });
    await vault.putDeletionReceipt({
      userId: "user-1",
      deletionId: "delete-1",
      categories: ["habit_definitions"],
      status: "completed",
      sourceHash: "source",
      requestedRecordCount: 1,
      deletedCount: 1,
      backendReceipts: [],
    });

    const manifests = await vault.listMigrationManifests("user-1");
    const receipts = await vault.listDeletionReceipts("user-1");
    assert.equal(manifests?.length, 1);
    assert.equal(receipts?.length, 1);
  });
});
