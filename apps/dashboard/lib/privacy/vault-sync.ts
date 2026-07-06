"use client";

import type {
  DesktopVaultDeletionReceipt,
  DesktopVaultDeletionReceiptInput,
  DesktopVaultMigrationManifest,
  DesktopVaultMigrationManifestInput,
  DesktopVaultPutInput,
  DesktopVaultRecord,
  DesktopVaultRecordMetadata,
  DesktopVaultStatus,
} from "./vault-client";
import {
  LocalStorageVaultStorage,
  getVaultRecord,
  listVaultRecords,
  putVaultRecord,
} from "./local-vault";
import type { VaultRecord, VaultRecordType, VaultStorage } from "./local-vault";

export type {
  DesktopVaultDeletionReceipt,
  DesktopVaultDeletionReceiptInput,
  DesktopVaultMigrationManifest,
  DesktopVaultMigrationManifestInput,
  DesktopVaultPutInput,
  DesktopVaultRecord,
  DesktopVaultRecordMetadata,
  DesktopVaultStatus,
} from "./vault-client";

type BrowserVaultEnvelope<T = unknown> = {
  collection: string;
  recordType: string;
  payload: T;
};

type BrowserVaultOptions = {
  passphrase: string;
  storage?: VaultStorage;
};

export type VaultSyncListOptions = {
  since?: string;
  limit?: number;
};

export interface VaultSyncAdapter {
  readonly kind: "tauri" | "webcrypto" | "memory";
  initialize(userId: string): Promise<DesktopVaultStatus | null>;
  getStatus(userId?: string | null): Promise<DesktopVaultStatus | null>;
  getRecord<T>(userId: string, collection: string, recordId: string): Promise<DesktopVaultRecord<T> | null>;
  listRecords<T>(
    userId: string,
    collection: string,
    options?: VaultSyncListOptions,
  ): Promise<Array<DesktopVaultRecord<T>> | null>;
  putRecord<T>(input: DesktopVaultPutInput<T>): Promise<DesktopVaultRecordMetadata | null>;
  tombstoneRecord(
    userId: string,
    collection: string,
    recordId: string,
    recordType: string,
  ): Promise<DesktopVaultRecordMetadata | null>;
  putMigrationManifest(input: DesktopVaultMigrationManifestInput): Promise<DesktopVaultMigrationManifest | null>;
  listMigrationManifests(userId: string, limit?: number): Promise<DesktopVaultMigrationManifest[] | null>;
  putDeletionReceipt(input: DesktopVaultDeletionReceiptInput): Promise<DesktopVaultDeletionReceipt | null>;
  listDeletionReceipts(userId: string, limit?: number): Promise<DesktopVaultDeletionReceipt[] | null>;
}

export class VaultSync {
  constructor(private readonly adapter: VaultSyncAdapter) {}

  get kind() {
    return this.adapter.kind;
  }

  initialize(userId: string) {
    return this.adapter.initialize(userId);
  }

  getStatus(userId?: string | null) {
    return this.adapter.getStatus(userId);
  }

  getRecord<T>(userId: string, collection: string, recordId: string) {
    return this.adapter.getRecord<T>(userId, collection, recordId);
  }

  listRecords<T>(userId: string, collection: string, options: VaultSyncListOptions = {}) {
    return this.adapter.listRecords<T>(userId, collection, options);
  }

  putRecord<T>(input: DesktopVaultPutInput<T>) {
    return this.adapter.putRecord(input);
  }

  tombstoneRecord(userId: string, collection: string, recordId: string, recordType: string) {
    return this.adapter.tombstoneRecord(userId, collection, recordId, recordType);
  }

  putMigrationManifest(input: DesktopVaultMigrationManifestInput) {
    return this.adapter.putMigrationManifest(input);
  }

  listMigrationManifests(userId: string, limit = 20) {
    return this.adapter.listMigrationManifests(userId, limit);
  }

  putDeletionReceipt(input: DesktopVaultDeletionReceiptInput) {
    return this.adapter.putDeletionReceipt(input);
  }

  listDeletionReceipts(userId: string, limit = 20) {
    return this.adapter.listDeletionReceipts(userId, limit);
  }
}

export class TauriVaultAdapter implements VaultSyncAdapter {
  readonly kind = "tauri" as const;

  async initialize(userId: string) {
    const { initializeDesktopVault } = await import("./vault-client");
    return initializeDesktopVault(userId);
  }

  async getStatus(userId?: string | null) {
    const { getDesktopVaultStatus } = await import("./vault-client");
    return getDesktopVaultStatus(userId);
  }

  async getRecord<T>(userId: string, collection: string, recordId: string) {
    const { getDesktopVaultRecord } = await import("./vault-client");
    return getDesktopVaultRecord<T>(userId, collection, recordId);
  }

  async listRecords<T>(userId: string, collection: string, options: VaultSyncListOptions = {}) {
    const { listDesktopVaultRecords } = await import("./vault-client");
    return listDesktopVaultRecords<T>(userId, collection, options);
  }

  async putRecord<T>(input: DesktopVaultPutInput<T>) {
    const { putDesktopVaultRecord } = await import("./vault-client");
    return putDesktopVaultRecord(input);
  }

  async tombstoneRecord(userId: string, collection: string, recordId: string, recordType: string) {
    const { tombstoneDesktopVaultRecord } = await import("./vault-client");
    return tombstoneDesktopVaultRecord(userId, collection, recordId, recordType);
  }

  async putMigrationManifest(input: DesktopVaultMigrationManifestInput) {
    const { putDesktopVaultMigrationManifest } = await import("./vault-client");
    return putDesktopVaultMigrationManifest(input);
  }

  async listMigrationManifests(userId: string, limit = 20) {
    const { listDesktopVaultMigrationManifests } = await import("./vault-client");
    return listDesktopVaultMigrationManifests(userId, limit);
  }

  async putDeletionReceipt(input: DesktopVaultDeletionReceiptInput) {
    const { putDesktopVaultDeletionReceipt } = await import("./vault-client");
    return putDesktopVaultDeletionReceipt(input);
  }

  async listDeletionReceipts(userId: string, limit = 20) {
    const { listDesktopVaultDeletionReceipts } = await import("./vault-client");
    return listDesktopVaultDeletionReceipts(userId, limit);
  }
}

export class WebCryptoVaultAdapter implements VaultSyncAdapter {
  readonly kind = "webcrypto" as const;
  private readonly storage: VaultStorage;
  private readonly passphrase: string;

  constructor({ passphrase, storage = new LocalStorageVaultStorage() }: BrowserVaultOptions) {
    this.passphrase = passphrase;
    this.storage = storage;
  }

  async initialize(_userId: string): Promise<DesktopVaultStatus> {
    const records = await listVaultRecords<BrowserVaultEnvelope>(this.storage, this.passphrase);
    return this.status(records.length);
  }

  async getStatus(_userId?: string | null): Promise<DesktopVaultStatus> {
    const records = await listVaultRecords<BrowserVaultEnvelope>(this.storage, this.passphrase);
    return this.status(records.length);
  }

  async getRecord<T>(
    _userId: string,
    collection: string,
    recordId: string,
  ): Promise<DesktopVaultRecord<T> | null> {
    const record = await getVaultRecord<BrowserVaultEnvelope<T>>(
      this.storage,
      this.passphrase,
      this.browserRecordId(collection, recordId),
    );
    return record ? this.toDesktopRecord(record) : null;
  }

  async listRecords<T>(
    _userId: string,
    collection: string,
    options: VaultSyncListOptions = {},
  ): Promise<Array<DesktopVaultRecord<T>>> {
    const records = await listVaultRecords<BrowserVaultEnvelope<T>>(this.storage, this.passphrase);
    const filtered = records
      .filter((record) => record.payload.collection === collection)
      .map((record) => this.toDesktopRecord(record))
      .filter((record) => !options.since || record.updatedAt >= options.since);
    return typeof options.limit === "number" ? filtered.slice(0, options.limit) : filtered;
  }

  async putRecord<T>(input: DesktopVaultPutInput<T>): Promise<DesktopVaultRecordMetadata> {
    const updatedAt = input.updatedAt || new Date().toISOString();
    await putVaultRecord<BrowserVaultEnvelope<T>>(this.storage, this.passphrase, {
      id: this.browserRecordId(input.collection, input.recordId),
      type: input.recordType as VaultRecordType,
      payload: {
        collection: input.collection,
        recordType: input.recordType,
        payload: input.payload,
      },
      updatedAt,
      tombstone: input.tombstone === true,
    });
    return this.metadata(input.collection, input.recordId, input.recordType, updatedAt, input.tombstone === true);
  }

  tombstoneRecord(
    userId: string,
    collection: string,
    recordId: string,
    recordType: string,
  ): Promise<DesktopVaultRecordMetadata> {
    return this.putRecord({
      userId,
      collection,
      recordId,
      recordType,
      payload: null,
      tombstone: true,
    });
  }

  async putMigrationManifest(_input: DesktopVaultMigrationManifestInput): Promise<null> {
    return null;
  }

  async listMigrationManifests(_userId: string, _limit = 20): Promise<null> {
    return null;
  }

  async putDeletionReceipt(_input: DesktopVaultDeletionReceiptInput): Promise<null> {
    return null;
  }

  async listDeletionReceipts(_userId: string, _limit = 20): Promise<null> {
    return null;
  }

  private browserRecordId(collection: string, recordId: string) {
    return `${collection}:${recordId}`;
  }

  private toDesktopRecord<T>(record: VaultRecord<BrowserVaultEnvelope<T>>): DesktopVaultRecord<T> {
    const idPrefix = `${record.payload.collection}:`;
    return {
      id: record.id.startsWith(idPrefix) ? record.id.slice(idPrefix.length) : record.id,
      collection: record.payload.collection,
      recordType: record.payload.recordType,
      payload: record.payload.payload,
      updatedAt: record.updatedAt || new Date().toISOString(),
      tombstone: record.tombstone === true,
    };
  }

  private metadata(
    collection: string,
    recordId: string,
    recordType: string,
    updatedAt: string,
    tombstone: boolean,
  ): DesktopVaultRecordMetadata {
    return {
      id: recordId,
      collection,
      recordType,
      updatedAt,
      tombstone,
      keyVersion: 1,
      algorithm: "AES-GCM",
    };
  }

  private status(recordCount: number): DesktopVaultStatus {
    return {
      initialized: true,
      dbPath: "webcrypto:local-storage",
      recordCount,
      stagedRecordCount: 0,
      inventoryCount: 0,
      migrationManifestCount: 0,
      deletionReceiptCount: 0,
      activeKeyVersion: 1,
    };
  }
}

export class InMemoryVaultAdapter implements VaultSyncAdapter {
  readonly kind = "memory" as const;
  private readonly records = new Map<string, DesktopVaultRecord>();
  private readonly migrationManifests: DesktopVaultMigrationManifest[] = [];
  private readonly deletionReceipts: DesktopVaultDeletionReceipt[] = [];

  async initialize(_userId: string): Promise<DesktopVaultStatus> {
    return this.status();
  }

  async getStatus(_userId?: string | null): Promise<DesktopVaultStatus> {
    return this.status();
  }

  async getRecord<T>(_userId: string, collection: string, recordId: string): Promise<DesktopVaultRecord<T> | null> {
    return (this.records.get(this.key(collection, recordId)) as DesktopVaultRecord<T> | undefined) ?? null;
  }

  async listRecords<T>(
    _userId: string,
    collection: string,
    options: VaultSyncListOptions = {},
  ): Promise<Array<DesktopVaultRecord<T>>> {
    const records = [...this.records.values()]
      .filter((record) => record.collection === collection)
      .filter((record) => !options.since || record.updatedAt >= options.since)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) as Array<DesktopVaultRecord<T>>;
    return typeof options.limit === "number" ? records.slice(0, options.limit) : records;
  }

  async putRecord<T>(input: DesktopVaultPutInput<T>): Promise<DesktopVaultRecordMetadata> {
    const updatedAt = input.updatedAt || new Date().toISOString();
    const record: DesktopVaultRecord<T> = {
      id: input.recordId,
      collection: input.collection,
      recordType: input.recordType,
      payload: input.payload,
      updatedAt,
      tombstone: input.tombstone === true,
    };
    this.records.set(this.key(input.collection, input.recordId), record as DesktopVaultRecord);
    return this.metadata(input.collection, input.recordId, input.recordType, updatedAt, input.tombstone === true);
  }

  tombstoneRecord(
    userId: string,
    collection: string,
    recordId: string,
    recordType: string,
  ): Promise<DesktopVaultRecordMetadata> {
    return this.putRecord({ userId, collection, recordId, recordType, payload: null, tombstone: true });
  }

  async putMigrationManifest(input: DesktopVaultMigrationManifestInput): Promise<DesktopVaultMigrationManifest> {
    const manifest: DesktopVaultMigrationManifest = {
      ...input,
      startedAt: input.startedAt || new Date().toISOString(),
      completedAt: input.completedAt,
      error: input.error,
      updatedAt: new Date().toISOString(),
    };
    this.migrationManifests.unshift(manifest);
    return manifest;
  }

  async listMigrationManifests(_userId: string, limit = 20): Promise<DesktopVaultMigrationManifest[]> {
    return this.migrationManifests.slice(0, limit);
  }

  async putDeletionReceipt(input: DesktopVaultDeletionReceiptInput): Promise<DesktopVaultDeletionReceipt> {
    const receipt: DesktopVaultDeletionReceipt = {
      ...input,
      startedAt: input.startedAt || new Date().toISOString(),
      completedAt: input.completedAt,
      error: input.error,
      updatedAt: new Date().toISOString(),
    };
    this.deletionReceipts.unshift(receipt);
    return receipt;
  }

  async listDeletionReceipts(_userId: string, limit = 20): Promise<DesktopVaultDeletionReceipt[]> {
    return this.deletionReceipts.slice(0, limit);
  }

  private key(collection: string, recordId: string) {
    return `${collection}:${recordId}`;
  }

  private metadata(
    collection: string,
    recordId: string,
    recordType: string,
    updatedAt: string,
    tombstone: boolean,
  ): DesktopVaultRecordMetadata {
    return {
      id: recordId,
      collection,
      recordType,
      updatedAt,
      tombstone,
      keyVersion: 1,
      algorithm: "memory",
    };
  }

  private status(): DesktopVaultStatus {
    return {
      initialized: true,
      dbPath: "memory",
      recordCount: this.records.size,
      stagedRecordCount: 0,
      inventoryCount: 0,
      migrationManifestCount: this.migrationManifests.length,
      deletionReceiptCount: this.deletionReceipts.length,
      activeKeyVersion: 1,
    };
  }
}

export const vaultSync = new VaultSync(new TauriVaultAdapter());
