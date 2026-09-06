import test, { describe } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";

import {
  DEFAULT_RITUAL_VAULT_EXPORT_CATEGORIES,
  RITUAL_VAULT_CHECKSUMS_PATH,
  RITUAL_VAULT_MANIFEST_PATH,
  RITUAL_VAULT_ROOT,
  createRitualVaultArchive,
  createEncryptedRitualVaultArchive,
  createRitualVaultFileSet,
  decryptEncryptedRitualVaultArchive,
  importRitualVaultArchive,
  previewRitualVaultArchive,
  writeRitualVaultFolderMirror,
  type RitualVaultClient,
} from "../lib/privacy/ritual-vault-export";
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

function createVaultClient(initialRecords: StoredRecord[] = []) {
  const store = new Map<string, StoredRecord>();
  for (const record of initialRecords) {
    store.set(recordKey(record.collection, record.id), record);
  }

  const client: RitualVaultClient = {
    async initializeVault(): Promise<DesktopVaultStatus> {
      return {
        initialized: true,
        dbPath: "/tmp/vault.db",
        recordCount: store.size,
        stagedRecordCount: 0,
        inventoryCount: 0,
        migrationManifestCount: 1,
        deletionReceiptCount: 1,
        activeKeyVersion: 1,
      };
    },
    async listRecords<T>(
      _userId: string,
      collection: string,
    ): Promise<Array<DesktopVaultRecord<T>>> {
      return [...store.values()].filter((record) => record.collection === collection) as Array<DesktopVaultRecord<T>>;
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
    async listMigrationManifests() {
      return [{
        migrationId: "migration-1",
        categories: ["habit_definitions"],
        status: "completed",
        sourceHash: "source-hash",
        localHash: "source-hash",
        recordCount: 1,
        migratedCount: 1,
        startedAt: "2026-06-23T00:00:00Z",
        completedAt: "2026-06-23T00:00:01Z",
        error: null,
        updatedAt: "2026-06-23T00:00:01Z",
      }];
    },
    async listDeletionReceipts() {
      return [{
        deletionId: "delete-1",
        categories: ["habit_definitions"],
        status: "completed",
        sourceHash: "source-hash",
        requestedRecordCount: 1,
        deletedCount: 1,
        backendReceipts: [],
        startedAt: "2026-06-23T00:00:00Z",
        completedAt: "2026-06-23T00:00:01Z",
        error: null,
        updatedAt: "2026-06-23T00:00:01Z",
      }];
    },
  };

  return { client, store };
}

describe("Ritual Vault export/import", () => {
  const records: StoredRecord[] = [
    {
      id: "habit-private",
      collection: "habit_definitions",
      recordType: "habit_definition",
      payload: { id: "habit-private", name: "Private Medication", category: "Health" },
      updatedAt: "2026-06-23T00:00:00Z",
      tombstone: false,
    },
    {
      id: "log-private",
      collection: "habit_logs",
      recordType: "habit_log",
      payload: { id: "log-private", habit_id: "habit-private", notes: "sensitive dosage note" },
      updatedAt: "2026-06-23T12:00:00Z",
      tombstone: false,
    },
    {
      id: "financial-transaction-private",
      collection: "financial_transactions",
      recordType: "financial_transaction",
      payload: { id: "financial-transaction-private", name: "Private Purchase", amount: 42.5 },
      updatedAt: "2026-06-23T12:00:00Z",
      tombstone: false,
    },
    {
      id: "ai-message-private",
      collection: "ai_messages",
      recordType: "ai_message",
      payload: { id: "ai-message-private", content: "private AI message" },
      updatedAt: "2026-06-23T12:00:00Z",
      tombstone: false,
    },
  ];

  test("default archive excludes sensitive categories and includes schema/checksums", async () => {
    const { client } = createVaultClient(records);
    const archive = await createRitualVaultArchive({
      userId: "user-1",
      client,
      now: () => new Date("2026-06-24T00:00:00Z"),
    });
    const zip = await JSZip.loadAsync(archive.bytes);
    const manifestText = await zip.file(`${RITUAL_VAULT_ROOT}/${RITUAL_VAULT_MANIFEST_PATH}`)?.async("string");
    const checksumsText = await zip.file(`${RITUAL_VAULT_ROOT}/${RITUAL_VAULT_CHECKSUMS_PATH}`)?.async("string");

    assert.ok(manifestText);
    assert.ok(checksumsText);
    assert.equal(archive.manifest.privacy.includeSensitive, false);
    assert.ok(archive.manifest.privacy.excludedSensitiveCategories.includes("financial_transactions"));
    assert.deepEqual(archive.manifest.categories.map((item) => item.category), DEFAULT_RITUAL_VAULT_EXPORT_CATEGORIES);

    const serializedArchive = JSON.stringify(await Promise.all(
      Object.values(zip.files).map((file) => file.dir ? "" : file.async("string")),
    ));
    assert.doesNotMatch(serializedArchive, /Private Purchase/);
    assert.doesNotMatch(serializedArchive, /private AI message/);

    const preview = await previewRitualVaultArchive(archive.bytes);
    assert.equal(preview.recordCount, 2);
    assert.equal(preview.categoryCounts.habit_definitions, 1);
    assert.equal(preview.categoryCounts.habit_logs, 1);
  });

  test("sensitive export includes financial and AI records when explicitly requested", async () => {
    const { client } = createVaultClient(records);
    const archive = await createRitualVaultArchive({
      userId: "user-1",
      client,
      includeSensitive: true,
      categories: ["habit_definitions", "financial_transactions", "ai_messages"],
      now: () => new Date("2026-06-24T00:00:00Z"),
    });
    const zip = await JSZip.loadAsync(archive.bytes);
    const financialJsonl = await zip.file(`${RITUAL_VAULT_ROOT}/data/financial_transactions.jsonl`)?.async("string");
    const aiJsonl = await zip.file(`${RITUAL_VAULT_ROOT}/data/ai_messages.jsonl`)?.async("string");

    assert.match(financialJsonl || "", /Private Purchase/);
    assert.match(aiJsonl || "", /private AI message/);
    assert.equal(archive.manifest.privacy.includeSensitive, true);
    assert.deepEqual(archive.manifest.privacy.excludedSensitiveCategories, []);
  });

  test("folder mirror writes the same manifest and checksum files without zip wrapping", async () => {
    const { client } = createVaultClient(records);
    const fileSet = await createRitualVaultFileSet({
      userId: "user-1",
      client,
      now: () => new Date("2026-06-24T00:00:00Z"),
    });
    assert.ok(fileSet.files[RITUAL_VAULT_MANIFEST_PATH]);
    assert.ok(fileSet.files[RITUAL_VAULT_CHECKSUMS_PATH]);
    assert.ok(fileSet.files["data/habit_definitions.jsonl"]);
    assert.ok(fileSet.files["markdown/habit_logs.md"]);
    assert.doesNotMatch(JSON.stringify(fileSet.files), /Private Purchase/);

    const mkdirs: string[] = [];
    const written = new Map<string, string>();
    const mirror = await writeRitualVaultFolderMirror({
      userId: "user-1",
      client,
      folderPath: "/tmp/Ritual",
      now: () => new Date("2026-06-24T00:00:00Z"),
      async mkdirImpl(path) {
        mkdirs.push(path);
      },
      async writeTextFileImpl(path, data) {
        written.set(path, data);
      },
    });

    assert.equal(mirror.folderPath, "/tmp/Ritual");
    assert.equal(mirror.recordCount, 2);
    assert.ok(mkdirs.includes("/tmp/Ritual/data"));
    assert.ok(mkdirs.includes("/tmp/Ritual/markdown"));
    assert.ok(written.has("/tmp/Ritual/manifest.json"));
    assert.ok(written.has("/tmp/Ritual/checksums.sha256"));
    assert.ok(written.has("/tmp/Ritual/data/habit_logs.jsonl"));
  });

  test("imports a verified archive into a fresh local vault", async () => {
    const source = createVaultClient(records);
    const archive = await createRitualVaultArchive({
      userId: "user-1",
      client: source.client,
      now: () => new Date("2026-06-24T00:00:00Z"),
    });
    const target = createVaultClient();
    const result = await importRitualVaultArchive({
      userId: "user-2",
      bytes: archive.bytes,
      client: target.client,
    });

    assert.equal(result.importedCount, 2);
    assert.deepEqual(result.categories, ["habit_definitions", "habit_logs"]);
    assert.deepEqual(
      target.store.get(recordKey("habit_logs", "log-private"))?.payload,
      records[1].payload,
    );
  });

  test("encrypted archive wrapper hides plaintext and decrypts to a valid vault", async () => {
    const { client } = createVaultClient(records);
    const encrypted = await createEncryptedRitualVaultArchive({
      userId: "user-1",
      client,
      passphrase: "correct horse battery staple",
      now: () => new Date("2026-06-24T00:00:00Z"),
    });

    const serializedOuterArchive = new TextDecoder().decode(encrypted.bytes);
    assert.match(serializedOuterArchive, /ritual-vault-encrypted/);
    assert.doesNotMatch(serializedOuterArchive, /Private Medication/);
    assert.doesNotMatch(serializedOuterArchive, /sensitive dosage note/);
    assert.doesNotMatch(serializedOuterArchive, /financial_transactions/);

    const decryptedBytes = await decryptEncryptedRitualVaultArchive({
      bytes: encrypted.bytes,
      passphrase: "correct horse battery staple",
    });
    const preview = await previewRitualVaultArchive(decryptedBytes);
    assert.equal(preview.recordCount, 2);
    assert.equal(preview.categoryCounts.habit_definitions, 1);
    assert.equal(preview.categoryCounts.habit_logs, 1);

    await assert.rejects(
      decryptEncryptedRitualVaultArchive({
        bytes: encrypted.bytes,
        passphrase: "wrong horse battery staple",
      }),
    );
  });

  test("rejects tampered archives before import", async () => {
    const { client } = createVaultClient(records);
    const archive = await createRitualVaultArchive({
      userId: "user-1",
      client,
      now: () => new Date("2026-06-24T00:00:00Z"),
    });
    const zip = await JSZip.loadAsync(archive.bytes);
    zip.file(`${RITUAL_VAULT_ROOT}/data/habit_logs.jsonl`, "{\"tampered\":true}\n");
    const tampered = await zip.generateAsync({ type: "uint8array" });

    await assert.rejects(
      previewRitualVaultArchive(tampered),
      /checksum mismatch/,
    );
  });
});
