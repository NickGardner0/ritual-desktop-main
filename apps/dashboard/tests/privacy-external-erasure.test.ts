import test, { describe } from "node:test";
import assert from "node:assert/strict";

import {
  executeExternalErasure,
  planExternalErasure,
  type ExternalErasureClient,
} from "../lib/privacy/external-erasure";
import type {
  DesktopVaultDeletionReceipt,
  DesktopVaultStatus,
} from "../lib/privacy/vault-client";

function createClient() {
  const receipts: DesktopVaultDeletionReceipt[] = [];
  const client: ExternalErasureClient = {
    async initializeVault(): Promise<DesktopVaultStatus> {
      return {
        initialized: true,
        dbPath: "/tmp/vault.db",
        recordCount: 0,
        stagedRecordCount: 0,
        inventoryCount: 0,
        migrationManifestCount: 0,
        deletionReceiptCount: receipts.length,
        activeKeyVersion: 1,
      };
    },
    async putDeletionReceipt(input): Promise<DesktopVaultDeletionReceipt> {
      const receipt: DesktopVaultDeletionReceipt = {
        deletionId: input.deletionId,
        categories: input.categories,
        status: input.status,
        sourceHash: input.sourceHash,
        requestedRecordCount: input.requestedRecordCount,
        deletedCount: input.deletedCount,
        backendReceipts: input.backendReceipts,
        startedAt: input.startedAt || "2026-06-24T00:00:00Z",
        completedAt: input.completedAt || null,
        error: input.error || null,
        updatedAt: input.completedAt || input.startedAt || "2026-06-24T00:00:00Z",
      };
      receipts.push(receipt);
      return receipt;
    },
  };
  return { client, receipts };
}

describe("external erasure client", () => {
  test("plans selected targets", async () => {
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body || "{}"));
      return Response.json({
        deletes_cloud_data: true,
        requires_local_receipt: true,
        targets: body.targets.map((target: string) => ({
          target,
          label: target,
          status: target === "openpanel" ? "manual_required" : "supported_by_api",
        })),
        supported_targets: body.targets,
        planned_at: "2026-06-24T00:00:00Z",
      });
    };

    const plan = await planExternalErasure({
      targets: ["tinybird", "openpanel"],
      fetchImpl,
    });

    assert.equal(plan.targets.length, 2);
    assert.equal(plan.targets[1].status, "manual_required");
  });

  test("writes running and completed local receipts around execution", async () => {
    const { client, receipts } = createClient();
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push(String(url));
      const body = JSON.parse(String(init?.body || "{}"));
      if (String(url).endsWith("/external-erasure-plan")) {
        return Response.json({
          deletes_cloud_data: true,
          requires_local_receipt: true,
          targets: body.targets.map((target: string) => ({
            target,
            label: target,
            status: target === "openpanel" ? "manual_required" : "supported_by_api",
          })),
          supported_targets: body.targets,
          planned_at: "2026-06-24T00:00:00Z",
        });
      }
      return Response.json({
        erasure_id: body.erasure_id,
        local_receipt_id: body.local_receipt_id,
        deletes_cloud_data: true,
        requested_targets: body.targets,
        targets: [
          { target: "tinybird", status: "completed", deleted_count: 3 },
          { target: "openpanel", status: "manual_required", deleted_count: 0 },
        ],
        deleted_count: 3,
        manual_required_count: 1,
        completed_at: "2026-06-24T00:00:01Z",
      });
    };

    const result = await executeExternalErasure({
      userId: "user-1",
      targets: ["tinybird", "openpanel"],
      fetchImpl,
      client,
      now: () => new Date("2026-06-24T00:00:00Z"),
    });

    assert.deepEqual(calls, [
      "/api/privacy/external-erasure-plan",
      "/api/privacy/external-erasure-execute",
    ]);
    assert.equal(result.response.deleted_count, 3);
    assert.equal(result.response.manual_required_count, 1);
    assert.equal(receipts.length, 2);
    assert.equal(receipts[0].status, "running");
    assert.equal(receipts[1].status, "completed");
    assert.match(receipts[1].error || "", /manual provider erasure/);
  });
});
