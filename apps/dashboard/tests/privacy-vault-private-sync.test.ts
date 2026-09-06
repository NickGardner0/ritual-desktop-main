import test, { describe } from "node:test";
import assert from "node:assert/strict";

import {
  ensurePrivateSyncKey,
  listPrivateSyncConflicts,
  pullPrivateSyncEnvelopes,
  pushPrivateSyncEnvelopes,
  resolvePrivateSyncConflict,
  type PrivateSyncEnvelope,
  type VaultPrivateSyncClient,
} from "../lib/privacy/vault-private-sync";
import {
  createPrivateSyncRecoveryKit,
  createTrustedDevicePairingKit,
  importTrustedDevicePairingKit,
  restorePrivateSyncRecoveryKit,
  rotatePrivateSyncKey,
} from "../lib/privacy/vault-private-sync-keyring";
import type {
  DesktopVaultPutInput,
  DesktopVaultRecord,
  DesktopVaultRecordMetadata,
  DesktopVaultStatus,
} from "../lib/privacy/vault-client";

type StoredRecord = DesktopVaultRecord<unknown>;

function recordKey(collection: string, recordId: string): string {
  return `${collection}:${recordId}`;
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function withActivePrivateSyncDevice(handler: typeof fetch): typeof fetch {
  return async (input, init) => {
    const url = requestUrl(input);
    if (url.includes("/api/privacy/e2ee/devices") && !url.includes("/revoke")) {
      const body = JSON.parse(String(init?.body || "{}"));
      return Response.json({
        device_id: body.device_id || "device-test",
        device_name: body.device_name || "This device",
        platform: body.platform || "test",
        status: "active",
        registered_at: "2026-06-23T00:00:00",
        trusted_at: "2026-06-23T00:00:00",
        revoked_at: null,
        last_seen_at: "2026-06-23T00:00:00",
      });
    }
    return handler(input, init);
  };
}

function createVaultClient(initialRecords: StoredRecord[] = []) {
  const store = new Map<string, StoredRecord>();
  for (const record of initialRecords) {
    store.set(recordKey(record.collection, record.id), record);
  }

  const client: VaultPrivateSyncClient = {
    async initializeVault(): Promise<DesktopVaultStatus> {
      return {
        initialized: true,
        dbPath: "/tmp/vault.db",
        recordCount: store.size,
        stagedRecordCount: 0,
        inventoryCount: 0,
        migrationManifestCount: 0,
        deletionReceiptCount: 0,
        activeKeyVersion: 1,
      };
    },
    async getRecord<T>(
      _userId: string,
      collection: string,
      recordId: string,
    ): Promise<DesktopVaultRecord<T> | null> {
      return (store.get(recordKey(collection, recordId)) as DesktopVaultRecord<T>) || null;
    },
    async putRecord<T>(input: DesktopVaultPutInput<T>): Promise<DesktopVaultRecordMetadata> {
      const updatedAt = input.updatedAt || "2026-06-23T00:00:00Z";
      store.set(recordKey(input.collection, input.recordId), {
        id: input.recordId,
        collection: input.collection,
        recordType: input.recordType,
        payload: input.payload,
        updatedAt,
        tombstone: input.tombstone || false,
      });
      return {
        id: input.recordId,
        collection: input.collection,
        recordType: input.recordType,
        updatedAt,
        tombstone: input.tombstone || false,
        keyVersion: 1,
        algorithm: "AES-256-GCM",
      };
    },
    async compareAndSwapRecord<T>(input: DesktopVaultPutInput<T>, expectedUpdatedAt: string | null) {
      const current = store.get(recordKey(input.collection, input.recordId)) as
        | DesktopVaultRecord<T>
        | undefined;
      if ((current?.updatedAt ?? null) !== expectedUpdatedAt) {
        return { applied: false, current: current ?? null };
      }
      const record = await client.putRecord(input);
      return { applied: true, record, current: null };
    },
    async listRecords<T>(
      _userId: string,
      collection: string,
    ): Promise<Array<DesktopVaultRecord<T>>> {
      return [...store.values()].filter((record) => record.collection === collection) as Array<DesktopVaultRecord<T>>;
    },
  };

  return { client, store };
}

describe("private sync envelopes", () => {
  const sensitiveRecords: StoredRecord[] = [
    {
      id: "habit-private",
      collection: "habit_definitions",
      recordType: "habit_definition",
      payload: {
        id: "habit-private",
        name: "Private Medication",
        category: "Health",
      },
      updatedAt: "2026-06-23T00:00:00Z",
      tombstone: false,
    },
    {
      id: "log-private",
      collection: "habit_logs",
      recordType: "habit_log",
      payload: {
        id: "log-private",
        habit_id: "habit-private",
        notes: "sensitive dosage note",
      },
      updatedAt: "2026-06-23T12:00:00Z",
      tombstone: false,
    },
  ];

  test("push posts ciphertext envelopes without plaintext record contents", async () => {
    const { client } = createVaultClient(sensitiveRecords);
    const postedBodies: unknown[] = [];
    const fetchImpl: typeof fetch = withActivePrivateSyncDevice(async (_url, init) => {
      const body = JSON.parse(String(init?.body || "{}"));
      postedBodies.push(body);
      return Response.json({
        accepted_count: body.envelopes.length,
        ignored_count: 0,
        max_server_revision: body.envelopes.length,
        envelopes: body.envelopes.map((envelope: PrivateSyncEnvelope, index: number) => ({
          ...envelope,
          server_revision: index + 1,
        })),
      });
    });

    const result = await pushPrivateSyncEnvelopes({
      userId: "user-1",
      categories: ["habit_definitions", "habit_logs"],
      fetchImpl,
      client,
      now: () => new Date("2026-06-23T00:00:00Z"),
    });

    assert.equal(result.envelopeCount, 2);
    assert.equal(result.acceptedCount, 2);
    assert.equal(postedBodies.length, 1);
    const serializedBody = JSON.stringify(postedBodies[0]);
    assert.doesNotMatch(serializedBody, /Private Medication/);
    assert.doesNotMatch(serializedBody, /sensitive dosage note/);
    const posted = postedBodies[0] as { envelopes: PrivateSyncEnvelope[] };
    assert.equal(posted.envelopes.length, 2);
    assert.ok(posted.envelopes.every((envelope) => envelope.ciphertext.length > 0));
    assert.ok(posted.envelopes.every((envelope) => envelope.nonce.length > 0));

    const second = await pushPrivateSyncEnvelopes({
      userId: "user-1",
      categories: ["habit_definitions", "habit_logs"],
      fetchImpl,
      client,
      now: () => new Date("2026-06-23T00:01:00Z"),
    });
    assert.equal(second.envelopeCount, 0);
    assert.equal(second.skippedUnchangedCount, 2);
    assert.equal(postedBodies.length, 1);
  });

  test("pull decrypts envelopes and writes local vault records", async () => {
    const source = createVaultClient([sensitiveRecords[1]]);
    let remoteEnvelope: PrivateSyncEnvelope | null = null;
    const pushFetch: typeof fetch = withActivePrivateSyncDevice(async (_url, init) => {
      const body = JSON.parse(String(init?.body || "{}"));
      remoteEnvelope = body.envelopes[0];
      return Response.json({
        accepted_count: 1,
        ignored_count: 0,
        max_server_revision: 1,
        envelopes: [{ ...remoteEnvelope, server_revision: 1 }],
      });
    });

    await pushPrivateSyncEnvelopes({
      userId: "user-1",
      categories: ["habit_logs"],
      fetchImpl: pushFetch,
      client: source.client,
      now: () => new Date("2026-06-23T00:00:00Z"),
    });
    assert.ok(remoteEnvelope);

    const keyRecord = source.store.get(recordKey("private_sync_state", "sync-key-v1"));
    assert.ok(keyRecord);
    const target = createVaultClient([keyRecord]);
    const pullFetch: typeof fetch = withActivePrivateSyncDevice(async () => Response.json({
      envelopes: [{ ...remoteEnvelope, server_revision: 1 }],
      returned_count: 1,
      next_since_server_revision: 1,
    }));

    const result = await pullPrivateSyncEnvelopes({
      userId: "user-1",
      fetchImpl: pullFetch,
      client: target.client,
      now: () => new Date("2026-06-23T00:02:00Z"),
    });

    assert.equal(result.appliedCount, 1);
    const restored = target.store.get(recordKey("habit_logs", "log-private"));
    assert.deepEqual(restored?.payload, sensitiveRecords[1].payload);
    const state = target.store.get(recordKey("private_sync_state", "state-v2"));
    assert.equal((state?.payload as { lastPulledServerRevision: number }).lastPulledServerRevision, 1);
  });

  test("rotation keeps old keys available while new pushes use the active key", async () => {
    const source = createVaultClient([sensitiveRecords[1]]);
    const remoteEnvelopes: PrivateSyncEnvelope[] = [];
    let serverRevision = 0;
    const pushFetch: typeof fetch = withActivePrivateSyncDevice(async (_url, init) => {
      const body = JSON.parse(String(init?.body || "{}"));
      const accepted = body.envelopes.map((envelope: PrivateSyncEnvelope) => ({
        ...envelope,
        server_revision: ++serverRevision,
      }));
      remoteEnvelopes.push(...accepted);
      return Response.json({
        accepted_count: accepted.length,
        ignored_count: 0,
        max_server_revision: serverRevision,
        envelopes: accepted,
      });
    });

    await pushPrivateSyncEnvelopes({
      userId: "user-1",
      categories: ["habit_logs"],
      fetchImpl: pushFetch,
      client: source.client,
      now: () => new Date("2026-06-23T00:00:00Z"),
    });
    const rotation = await rotatePrivateSyncKey({
      userId: "user-1",
      client: source.client,
      now: () => new Date("2026-06-23T00:01:00Z"),
    });
    source.store.set(recordKey("habit_logs", "log-second"), {
      id: "log-second",
      collection: "habit_logs",
      recordType: "habit_log",
      payload: { id: "log-second", notes: "rotated key note" },
      updatedAt: "2026-06-23T00:02:00Z",
      tombstone: false,
    });
    await pushPrivateSyncEnvelopes({
      userId: "user-1",
      categories: ["habit_logs"],
      fetchImpl: pushFetch,
      client: source.client,
      now: () => new Date("2026-06-23T00:03:00Z"),
    });

    assert.equal(rotation.previousKeyVersion, 1);
    assert.equal(rotation.activeKeyVersion, 2);
    assert.deepEqual(remoteEnvelopes.map((envelope) => envelope.key_version), [1, 2]);

    const keyRecord = source.store.get(recordKey("private_sync_state", "sync-key-v1"));
    assert.ok(keyRecord);
    const target = createVaultClient([keyRecord]);
    const pullFetch: typeof fetch = withActivePrivateSyncDevice(async () => Response.json({
      envelopes: remoteEnvelopes,
      returned_count: remoteEnvelopes.length,
      next_since_server_revision: serverRevision,
    }));

    const result = await pullPrivateSyncEnvelopes({
      userId: "user-1",
      fetchImpl: pullFetch,
      client: target.client,
      now: () => new Date("2026-06-23T00:04:00Z"),
    });

    assert.equal(result.appliedCount, 2);
    assert.deepEqual(target.store.get(recordKey("habit_logs", "log-private"))?.payload, sensitiveRecords[1].payload);
    assert.deepEqual(target.store.get(recordKey("habit_logs", "log-second"))?.payload, {
      id: "log-second",
      notes: "rotated key note",
    });
  });

  test("recovery kit restores the keyring without exposing raw key material", async () => {
    const source = createVaultClient([sensitiveRecords[1]]);
    let remoteEnvelope: PrivateSyncEnvelope | null = null;
    const pushFetch: typeof fetch = withActivePrivateSyncDevice(async (_url, init) => {
      const body = JSON.parse(String(init?.body || "{}"));
      remoteEnvelope = { ...body.envelopes[0], server_revision: 1 };
      return Response.json({
        accepted_count: 1,
        ignored_count: 0,
        max_server_revision: 1,
        envelopes: [remoteEnvelope],
      });
    });

    await pushPrivateSyncEnvelopes({
      userId: "user-1",
      categories: ["habit_logs"],
      fetchImpl: pushFetch,
      client: source.client,
      now: () => new Date("2026-06-23T00:00:00Z"),
    });
    const kit = await createPrivateSyncRecoveryKit({
      userId: "user-1",
      client: source.client,
      now: () => new Date("2026-06-23T00:01:00Z"),
    });

    const serializedKit = new TextDecoder().decode(kit.bytes);
    assert.doesNotMatch(serializedKit, /keyBase64/);
    assert.doesNotMatch(serializedKit, /Private Medication/);
    assert.ok(kit.phrase.length > 20);

    const target = createVaultClient();
    const restored = await restorePrivateSyncRecoveryKit({
      userId: "user-2",
      bytes: kit.bytes,
      phrase: kit.phrase,
      client: target.client,
      now: () => new Date("2026-06-23T00:02:00Z"),
    });
    assert.deepEqual(restored.availableKeyVersions, [1]);

    assert.ok(remoteEnvelope);
    const pullFetch: typeof fetch = withActivePrivateSyncDevice(async () => Response.json({
      envelopes: [remoteEnvelope],
      returned_count: 1,
      next_since_server_revision: 1,
    }));
    const pulled = await pullPrivateSyncEnvelopes({
      userId: "user-2",
      fetchImpl: pullFetch,
      client: target.client,
      now: () => new Date("2026-06-23T00:03:00Z"),
    });
    assert.equal(pulled.appliedCount, 1);
    assert.deepEqual(target.store.get(recordKey("habit_logs", "log-private"))?.payload, sensitiveRecords[1].payload);
  });

  test("trusted-device pairing kit imports the sender keyring", async () => {
    const source = createVaultClient();
    await ensurePrivateSyncKey({
      userId: "user-1",
      client: source.client,
      now: () => new Date("2026-06-23T00:00:00Z"),
    });
    const kit = await createTrustedDevicePairingKit({
      userId: "user-1",
      client: source.client,
      now: () => new Date("2026-06-23T00:01:00Z"),
    });

    const serializedKit = new TextDecoder().decode(kit.bytes);
    assert.match(serializedKit, /ritual-private-sync-pairing/);
    assert.doesNotMatch(serializedKit, /keyBase64/);

    const target = createVaultClient();
    const imported = await importTrustedDevicePairingKit({
      userId: "user-2",
      bytes: kit.bytes,
      phrase: kit.phrase,
      client: target.client,
      now: () => new Date("2026-06-23T00:02:00Z"),
    });

    assert.equal(imported.activeKeyVersion, 1);
    assert.deepEqual(imported.availableKeyVersions, [1]);
    assert.ok(target.store.get(recordKey("private_sync_state", "sync-key-v1")));
  });

  test("pull records conflicts instead of overwriting local edits", async () => {
    const source = createVaultClient([{
      ...sensitiveRecords[1],
      payload: { id: "log-private", habit_id: "habit-private", notes: "original" },
    }]);
    const remoteEnvelopes: PrivateSyncEnvelope[] = [];
    let serverRevision = 0;
    const pushFetch: typeof fetch = withActivePrivateSyncDevice(async (_url, init) => {
      const body = JSON.parse(String(init?.body || "{}"));
      const accepted = body.envelopes.map((envelope: PrivateSyncEnvelope) => ({
        ...envelope,
        server_revision: ++serverRevision,
      }));
      remoteEnvelopes.push(...accepted);
      return Response.json({
        accepted_count: accepted.length,
        ignored_count: 0,
        max_server_revision: serverRevision,
        envelopes: accepted,
      });
    });

    await pushPrivateSyncEnvelopes({
      userId: "user-1",
      categories: ["habit_logs"],
      fetchImpl: pushFetch,
      client: source.client,
      now: () => new Date("2026-06-23T00:00:00Z"),
    });

    const keyRecord = source.store.get(recordKey("private_sync_state", "sync-key-v1"));
    assert.ok(keyRecord);
    const target = createVaultClient([keyRecord]);
    await pullPrivateSyncEnvelopes({
      userId: "user-1",
      fetchImpl: withActivePrivateSyncDevice(async () => Response.json({
        envelopes: [remoteEnvelopes[0]],
        returned_count: 1,
        next_since_server_revision: 1,
      })),
      client: target.client,
      now: () => new Date("2026-06-23T00:01:00Z"),
    });

    target.store.set(recordKey("habit_logs", "log-private"), {
      id: "log-private",
      collection: "habit_logs",
      recordType: "habit_log",
      payload: { id: "log-private", habit_id: "habit-private", notes: "local edit" },
      updatedAt: "2026-06-23T00:02:00Z",
      tombstone: false,
    });
    source.store.set(recordKey("habit_logs", "log-private"), {
      id: "log-private",
      collection: "habit_logs",
      recordType: "habit_log",
      payload: { id: "log-private", habit_id: "habit-private", notes: "remote edit" },
      updatedAt: "2026-06-23T00:03:00Z",
      tombstone: false,
    });
    await pushPrivateSyncEnvelopes({
      userId: "user-1",
      categories: ["habit_logs"],
      fetchImpl: pushFetch,
      client: source.client,
      now: () => new Date("2026-06-23T00:04:00Z"),
    });

    const result = await pullPrivateSyncEnvelopes({
      userId: "user-1",
      fetchImpl: withActivePrivateSyncDevice(async () => Response.json({
        envelopes: [remoteEnvelopes[1]],
        returned_count: 1,
        next_since_server_revision: 2,
      })),
      client: target.client,
      now: () => new Date("2026-06-23T00:05:00Z"),
    });

    assert.equal(result.appliedCount, 0);
    assert.equal(result.conflictCount, 1);
    assert.deepEqual(target.store.get(recordKey("habit_logs", "log-private"))?.payload, {
      id: "log-private",
      habit_id: "habit-private",
      notes: "local edit",
    });

    const conflicts = await listPrivateSyncConflicts({ userId: "user-1", client: target.client });
    assert.equal(conflicts.length, 1);
    assert.deepEqual(conflicts[0].payload.remoteRecord.payload, {
      id: "log-private",
      habit_id: "habit-private",
      notes: "remote edit",
    });

    const resolved = await resolvePrivateSyncConflict({
      userId: "user-1",
      conflictId: conflicts[0].id,
      resolution: "remote",
      client: target.client,
      now: () => new Date("2026-06-23T00:06:00Z"),
    });
    assert.equal(resolved.appliedRemoteRecord, true);
    assert.deepEqual(target.store.get(recordKey("habit_logs", "log-private"))?.payload, {
      id: "log-private",
      habit_id: "habit-private",
      notes: "remote edit",
    });
    assert.equal((await listPrivateSyncConflicts({ userId: "user-1", client: target.client })).length, 0);
  });

  test("push splits uploads at the backend envelope batch limit", async () => {
    const manyRecords: StoredRecord[] = Array.from({ length: 501 }, (_, index) => ({
      id: `log-${index}`,
      collection: "habit_logs",
      recordType: "habit_log",
      payload: {
        id: `log-${index}`,
        notes: `encrypted note ${index}`,
      },
      updatedAt: `2026-06-23T12:${String(index % 60).padStart(2, "0")}:00Z`,
      tombstone: false,
    }));
    const { client } = createVaultClient(manyRecords);
    const batchSizes: number[] = [];
    const fetchImpl: typeof fetch = withActivePrivateSyncDevice(async (_url, init) => {
      const body = JSON.parse(String(init?.body || "{}"));
      batchSizes.push(body.envelopes.length);
      return Response.json({
        accepted_count: body.envelopes.length,
        ignored_count: 0,
        max_server_revision: batchSizes.reduce((total, size) => total + size, 0),
        envelopes: body.envelopes,
      });
    });

    const result = await pushPrivateSyncEnvelopes({
      userId: "user-1",
      categories: ["habit_logs"],
      fetchImpl,
      client,
      now: () => new Date("2026-06-23T00:00:00Z"),
    });

    assert.equal(result.envelopeCount, 501);
    assert.deepEqual(batchSizes, [500, 1]);
  });

  test("requires a desktop vault and supported categories", async () => {
    const missingDesktopClient: VaultPrivateSyncClient = {
      ...createVaultClient().client,
      async initializeVault() {
        return null;
      },
    };

    await assert.rejects(
      ensurePrivateSyncKey({
        userId: "user-1",
        client: missingDesktopClient,
      }),
      /Ritual Desktop is required/,
    );

    await assert.rejects(
      pushPrivateSyncEnvelopes({
        userId: "user-1",
        categories: [],
        client: createVaultClient().client,
      }),
      /Select at least one supported Private Sync category/,
    );
  });
});
