"use client";

import type {
  DesktopVaultPutInput,
  DesktopVaultRecord,
  DesktopVaultRecordMetadata,
  DesktopVaultStatus,
} from "./vault-client";
import {
  LOCAL_MIGRATION_CATEGORY_LABELS,
  SUPPORTED_LOCAL_MIGRATION_CATEGORIES,
  type SupportedLocalMigrationCategory,
} from "./vault-migration";
import {
  PRIVATE_SYNC_STATE_COLLECTION,
  activePrivateSyncKey,
  privateSyncKeyForVersion,
  privateSyncKeyringStatus,
  readOrCreatePrivateSyncKeyring,
  type PrivateSyncActiveKey,
  type PrivateSyncKeyringPayload,
} from "./vault-private-sync-keyring";
import {
  base64ToBytes,
  bytesToBase64,
  importAesGcmKey,
  sha256Hex,
  stableStringify,
  utf8Bytes,
  utf8String,
  webCrypto,
} from "./vault-private-sync-crypto";
import {
  PRIVATE_SYNC_DEVICE_HEADER,
  registerPrivateSyncDevice,
} from "./vault-private-sync-devices";

export const SUPPORTED_PRIVATE_SYNC_CATEGORIES = SUPPORTED_LOCAL_MIGRATION_CATEGORIES;

export type SupportedPrivateSyncCategory = SupportedLocalMigrationCategory;

export const PRIVATE_SYNC_CATEGORY_LABELS = LOCAL_MIGRATION_CATEGORY_LABELS;

const PRIVATE_SYNC_STATE_RECORD_ID = "state-v1";
const PRIVATE_SYNC_CONFLICTS_COLLECTION = "private_sync_conflicts";
const PRIVATE_SYNC_ALGORITHM = "AES-256-GCM";
const MAX_PRIVATE_SYNC_BATCH = 500;
const MAX_LOCAL_LIST_RECORDS = 100_000;

type PrivateSyncPushedRecord = {
  revision: number;
  plaintextSha256: string;
  ciphertextSha256: string;
  pushedAt: string;
};

type PrivateSyncStatePayload = {
  lastPulledServerRevision: number;
  pushed: Record<string, PrivateSyncPushedRecord>;
};

export type PrivateSyncKeyStatus = {
  keyVersion: number;
  clientId: string;
  createdAt: string;
  created: boolean;
  availableKeyVersions: number[];
};

export type PrivateSyncEnvelope = {
  envelope_id: string;
  collection: SupportedPrivateSyncCategory;
  record_id: string;
  record_type: string;
  revision: number;
  server_revision?: number;
  key_version: number;
  algorithm: typeof PRIVATE_SYNC_ALGORITHM;
  nonce: string;
  ciphertext: string;
  aad: string;
  ciphertext_sha256: string;
  tombstone: boolean;
  client_updated_at?: string | null;
  client_id?: string | null;
};

export type PrivateSyncPutResponse = {
  accepted_count: number;
  ignored_count: number;
  max_server_revision: number;
  envelopes: PrivateSyncEnvelope[];
};

export type PrivateSyncListResponse = {
  envelopes: PrivateSyncEnvelope[];
  returned_count: number;
  next_since_server_revision: number;
};

export type PrivateSyncPushResult = {
  selectedCategories: SupportedPrivateSyncCategory[];
  scannedCount: number;
  envelopeCount: number;
  skippedUnchangedCount: number;
  acceptedCount: number;
  ignoredCount: number;
  maxServerRevision: number;
};

export type PrivateSyncPullResult = {
  pulledCount: number;
  appliedCount: number;
  conflictCount: number;
  nextSinceServerRevision: number;
};

export type VaultPrivateSyncClient = {
  initializeVault(userId: string): Promise<DesktopVaultStatus | null>;
  getRecord<T>(userId: string, collection: string, recordId: string): Promise<DesktopVaultRecord<T> | null>;
  putRecord<T>(input: DesktopVaultPutInput<T>): Promise<DesktopVaultRecordMetadata | null>;
  listRecords<T>(
    userId: string,
    collection: string,
    options?: { since?: string; limit?: number },
  ): Promise<Array<DesktopVaultRecord<T>> | null>;
};

const defaultVaultPrivateSyncClient: VaultPrivateSyncClient = {
  async initializeVault(userId) {
    const { initializeDesktopVault } = await import("./vault-client");
    return initializeDesktopVault(userId);
  },
  async getRecord(userId, collection, recordId) {
    const { getDesktopVaultRecord } = await import("./vault-client");
    return getDesktopVaultRecord(userId, collection, recordId);
  },
  async putRecord(input) {
    const { putDesktopVaultRecord } = await import("./vault-client");
    return putDesktopVaultRecord(input);
  },
  async listRecords(userId, collection, options) {
    const { listDesktopVaultRecords } = await import("./vault-client");
    return listDesktopVaultRecords(userId, collection, options);
  },
};

type EnsurePrivateSyncKeyOptions = {
  userId: string;
  client?: VaultPrivateSyncClient;
  now?: () => Date;
};

type PushPrivateSyncOptions = {
  userId: string;
  categories: SupportedPrivateSyncCategory[];
  headers?: HeadersInit;
  fetchImpl?: typeof fetch;
  client?: VaultPrivateSyncClient;
  now?: () => Date;
};

type PullPrivateSyncOptions = {
  userId: string;
  headers?: HeadersInit;
  fetchImpl?: typeof fetch;
  client?: VaultPrivateSyncClient;
  now?: () => Date;
};

type PrivateSyncPlainRecord = {
  collection: SupportedPrivateSyncCategory;
  record_id: string;
  record_type: string;
  updated_at: string;
  tombstone: boolean;
  payload: unknown;
};

export type PrivateSyncConflictPayload = {
  envelopeId: string;
  collection: SupportedPrivateSyncCategory;
  recordId: string;
  recordType: string;
  serverRevision: number;
  detectedAt: string;
  status: "pending" | "resolved";
  localRecord: PrivateSyncPlainRecord;
  remoteRecord: PrivateSyncPlainRecord;
  previousPlaintextSha256?: string;
  remotePlaintextSha256: string;
};

export type PrivateSyncConflictResolution = "local" | "remote";

export type PrivateSyncConflictResolveResult = {
  conflictId: string;
  resolution: PrivateSyncConflictResolution;
  appliedRemoteRecord: boolean;
};

function selectedCategories(categories: SupportedPrivateSyncCategory[]): SupportedPrivateSyncCategory[] {
  return SUPPORTED_PRIVATE_SYNC_CATEGORIES.filter((category) => categories.includes(category));
}

function createRevision(record: DesktopVaultRecord): number {
  const parsed = Date.parse(record.updatedAt);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Date.now();
}

function createEnvelopeId(collection: string, recordId: string): string {
  return `${collection}:${recordId}`;
}

function defaultState(): PrivateSyncStatePayload {
  return {
    lastPulledServerRevision: 0,
    pushed: {},
  };
}

function normalizeState(value: PrivateSyncStatePayload | null | undefined): PrivateSyncStatePayload {
  return {
    lastPulledServerRevision:
      typeof value?.lastPulledServerRevision === "number" && value.lastPulledServerRevision >= 0
        ? value.lastPulledServerRevision
        : 0,
    pushed: value?.pushed && typeof value.pushed === "object" ? value.pushed : {},
  };
}

async function readState(
  userId: string,
  client: VaultPrivateSyncClient,
): Promise<PrivateSyncStatePayload> {
  const record = await client.getRecord<PrivateSyncStatePayload>(
    userId,
    PRIVATE_SYNC_STATE_COLLECTION,
    PRIVATE_SYNC_STATE_RECORD_ID,
  );
  return normalizeState(record?.payload);
}

async function writeState(
  userId: string,
  client: VaultPrivateSyncClient,
  state: PrivateSyncStatePayload,
  now: Date,
) {
  await client.putRecord({
    userId,
    collection: PRIVATE_SYNC_STATE_COLLECTION,
    recordId: PRIVATE_SYNC_STATE_RECORD_ID,
    recordType: "private_sync_state",
    payload: state,
    updatedAt: now.toISOString(),
  });
}

async function ensureInitialized(userId: string, client: VaultPrivateSyncClient) {
  const vaultStatus = await client.initializeVault(userId);
  if (!vaultStatus) {
    throw new Error("Ritual Desktop is required for Private Sync.");
  }
}

export async function ensurePrivateSyncKey({
  userId,
  client = defaultVaultPrivateSyncClient,
  now = () => new Date(),
}: EnsurePrivateSyncKeyOptions): Promise<PrivateSyncKeyStatus> {
  await ensureInitialized(userId, client);
  const keyring = await readOrCreatePrivateSyncKeyring(userId, client, now());
  return privateSyncKeyringStatus(keyring.payload, keyring.created);
}

function plainRecordFromVault(
  record: DesktopVaultRecord,
  collection: SupportedPrivateSyncCategory,
): PrivateSyncPlainRecord {
  return {
    collection,
    record_id: record.id,
    record_type: record.recordType,
    updated_at: record.updatedAt,
    tombstone: record.tombstone,
    payload: record.payload,
  };
}

async function hashPlainRecord(record: PrivateSyncPlainRecord): Promise<string> {
  return sha256Hex(utf8Bytes(stableStringify(record)));
}

async function encryptRecord(
  record: DesktopVaultRecord,
  collection: SupportedPrivateSyncCategory,
  keyPayload: PrivateSyncActiveKey,
): Promise<{ envelope: PrivateSyncEnvelope; plaintextSha256: string }> {
  const revision = createRevision(record);
  const plainRecord = plainRecordFromVault(record, collection);
  const plaintext = stableStringify(plainRecord);
  const plaintextSha256 = await sha256Hex(utf8Bytes(plaintext));
  const aadJson = stableStringify({
    algorithm: PRIVATE_SYNC_ALGORITHM,
    collection,
    key_version: keyPayload.keyVersion,
    record_id: record.id,
    record_type: record.recordType,
    revision,
  });
  const aadBytes = utf8Bytes(aadJson);
  const nonce = new Uint8Array(12);
  webCrypto().getRandomValues(nonce);
  const cryptoKey = await importAesGcmKey(keyPayload.keyBase64);
  const ciphertextBuffer = await webCrypto().subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonce,
      additionalData: aadBytes,
    },
    cryptoKey,
    utf8Bytes(plaintext),
  );
  const ciphertext = new Uint8Array(ciphertextBuffer);
  const ciphertextSha256 = await sha256Hex(ciphertext);

  return {
    plaintextSha256,
    envelope: {
      envelope_id: createEnvelopeId(collection, record.id),
      collection,
      record_id: record.id,
      record_type: record.recordType,
      revision,
      key_version: keyPayload.keyVersion,
      algorithm: PRIVATE_SYNC_ALGORITHM,
      nonce: bytesToBase64(nonce),
      ciphertext: bytesToBase64(ciphertext),
      aad: bytesToBase64(aadBytes),
      ciphertext_sha256: ciphertextSha256,
      tombstone: record.tombstone,
      client_updated_at: record.updatedAt,
    },
  };
}

async function decryptEnvelope(
  envelope: PrivateSyncEnvelope,
  keyring: PrivateSyncKeyringPayload,
): Promise<PrivateSyncPlainRecord> {
  if (envelope.algorithm !== PRIVATE_SYNC_ALGORITHM) {
    throw new Error(`Unsupported Private Sync envelope algorithm: ${envelope.algorithm}`);
  }

  const keyPayload = privateSyncKeyForVersion(keyring, envelope.key_version);
  const cryptoKey = await importAesGcmKey(keyPayload.keyBase64);
  const plaintextBuffer = await webCrypto().subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64ToBytes(envelope.nonce),
      additionalData: base64ToBytes(envelope.aad),
    },
    cryptoKey,
    base64ToBytes(envelope.ciphertext),
  );
  return JSON.parse(utf8String(plaintextBuffer)) as PrivateSyncPlainRecord;
}

function conflictRecordId(envelope: PrivateSyncEnvelope): string {
  return `${envelope.envelope_id}:${envelope.server_revision || envelope.revision}`;
}

async function writeConflictRecord({
  userId,
  client,
  envelope,
  localRecord,
  remoteRecord,
  previousPlaintextSha256,
  remotePlaintextSha256,
  now,
}: {
  userId: string;
  client: VaultPrivateSyncClient;
  envelope: PrivateSyncEnvelope;
  localRecord: PrivateSyncPlainRecord;
  remoteRecord: PrivateSyncPlainRecord;
  previousPlaintextSha256?: string;
  remotePlaintextSha256: string;
  now: Date;
}) {
  const payload: PrivateSyncConflictPayload = {
    envelopeId: envelope.envelope_id,
    collection: remoteRecord.collection,
    recordId: remoteRecord.record_id,
    recordType: remoteRecord.record_type,
    serverRevision: envelope.server_revision || envelope.revision,
    detectedAt: now.toISOString(),
    status: "pending",
    localRecord,
    remoteRecord,
    previousPlaintextSha256,
    remotePlaintextSha256,
  };
  await client.putRecord({
    userId,
    collection: PRIVATE_SYNC_CONFLICTS_COLLECTION,
    recordId: conflictRecordId(envelope),
    recordType: "private_sync_conflict",
    payload,
    updatedAt: now.toISOString(),
  });
}

async function fetchJson<T>(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetchImpl(url, init);
  if (!response.ok) {
    throw new Error(`Private Sync request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function requestHeaders(headers?: HeadersInit): Headers {
  const prepared = new Headers(headers);
  prepared.set("Content-Type", "application/json");
  return prepared;
}

async function activeDeviceHeaders({
  userId,
  headers,
  fetchImpl,
  client,
  now,
}: {
  userId: string;
  headers?: HeadersInit;
  fetchImpl: typeof fetch;
  client: VaultPrivateSyncClient;
  now: () => Date;
}): Promise<Headers> {
  const device = await registerPrivateSyncDevice({
    userId,
    headers,
    fetchImpl,
    client,
    now,
  });
  if (device.status !== "active") {
    throw new Error("Private Sync device is pending trust from another device.");
  }
  const prepared = requestHeaders(headers || {});
  prepared.set(PRIVATE_SYNC_DEVICE_HEADER, device.device_id);
  return prepared;
}

function chunkEnvelopes(envelopes: PrivateSyncEnvelope[]): PrivateSyncEnvelope[][] {
  const chunks: PrivateSyncEnvelope[][] = [];
  for (let index = 0; index < envelopes.length; index += MAX_PRIVATE_SYNC_BATCH) {
    chunks.push(envelopes.slice(index, index + MAX_PRIVATE_SYNC_BATCH));
  }
  return chunks;
}

export async function pushPrivateSyncEnvelopes({
  userId,
  categories,
  headers,
  fetchImpl = fetch,
  client = defaultVaultPrivateSyncClient,
  now = () => new Date(),
}: PushPrivateSyncOptions): Promise<PrivateSyncPushResult> {
  const selected = selectedCategories(categories);
  if (selected.length === 0) {
    throw new Error("Select at least one supported Private Sync category.");
  }

  await ensureInitialized(userId, client);
  const keyring = await readOrCreatePrivateSyncKeyring(userId, client, now());
  const activeKey = activePrivateSyncKey(keyring.payload);
  const syncHeaders = await activeDeviceHeaders({
    userId,
    headers,
    fetchImpl,
    client,
    now,
  });
  const state = await readState(userId, client);
  const envelopes: PrivateSyncEnvelope[] = [];
  const pushedUpdates: Array<{
    envelopeId: string;
    revision: number;
    plaintextSha256: string;
    ciphertextSha256: string;
  }> = [];
  let scannedCount = 0;
  let skippedUnchangedCount = 0;

  for (const category of selected) {
    const records = await client.listRecords(userId, category, { limit: MAX_LOCAL_LIST_RECORDS });
    if (!records) {
      throw new Error("Local vault records could not be read for Private Sync.");
    }
    for (const record of records) {
      scannedCount += 1;
      const encrypted = await encryptRecord(record, category, activeKey);
      const previous = state.pushed[encrypted.envelope.envelope_id];
      if (
        previous
        && previous.revision === encrypted.envelope.revision
        && previous.plaintextSha256 === encrypted.plaintextSha256
      ) {
        skippedUnchangedCount += 1;
        continue;
      }
      envelopes.push(encrypted.envelope);
      pushedUpdates.push({
        envelopeId: encrypted.envelope.envelope_id,
        revision: encrypted.envelope.revision,
        plaintextSha256: encrypted.plaintextSha256,
        ciphertextSha256: encrypted.envelope.ciphertext_sha256,
      });
    }
  }

  if (envelopes.length === 0) {
    return {
      selectedCategories: selected,
      scannedCount,
      envelopeCount: 0,
      skippedUnchangedCount,
      acceptedCount: 0,
      ignoredCount: 0,
      maxServerRevision: state.lastPulledServerRevision,
    };
  }

  let acceptedCount = 0;
  let ignoredCount = 0;
  let maxServerRevision = state.lastPulledServerRevision;
  for (const envelopeBatch of chunkEnvelopes(envelopes)) {
    const response = await fetchJson<PrivateSyncPutResponse>(fetchImpl, "/api/privacy/e2ee/envelopes", {
      method: "POST",
      cache: "no-store",
      credentials: "include",
      headers: syncHeaders,
      body: JSON.stringify({
        client_id: activeKey.clientId,
        envelopes: envelopeBatch,
      }),
    });
    acceptedCount += response.accepted_count;
    ignoredCount += response.ignored_count;
    maxServerRevision = Math.max(maxServerRevision, response.max_server_revision);
  }

  const pushedAt = now().toISOString();
  for (const update of pushedUpdates) {
    state.pushed[update.envelopeId] = {
      revision: update.revision,
      plaintextSha256: update.plaintextSha256,
      ciphertextSha256: update.ciphertextSha256,
      pushedAt,
    };
  }
  await writeState(userId, client, state, new Date(pushedAt));

  return {
    selectedCategories: selected,
    scannedCount,
    envelopeCount: envelopes.length,
    skippedUnchangedCount,
    acceptedCount,
    ignoredCount,
    maxServerRevision,
  };
}

export async function pullPrivateSyncEnvelopes({
  userId,
  headers,
  fetchImpl = fetch,
  client = defaultVaultPrivateSyncClient,
  now = () => new Date(),
}: PullPrivateSyncOptions): Promise<PrivateSyncPullResult> {
  await ensureInitialized(userId, client);
  const keyring = await readOrCreatePrivateSyncKeyring(userId, client, now());
  const syncHeaders = await activeDeviceHeaders({
    userId,
    headers,
    fetchImpl,
    client,
    now,
  });
  const state = await readState(userId, client);
  let sinceServerRevision = state.lastPulledServerRevision;
  let pulledCount = 0;
  let appliedCount = 0;
  let conflictCount = 0;
  while (true) {
    const response = await fetchJson<PrivateSyncListResponse>(
      fetchImpl,
      `/api/privacy/e2ee/envelopes?since_server_revision=${sinceServerRevision}&limit=${MAX_PRIVATE_SYNC_BATCH}`,
      {
        method: "GET",
        cache: "no-store",
        credentials: "include",
        headers: syncHeaders,
      },
    );

    pulledCount += response.returned_count;
    for (const envelope of response.envelopes) {
      const plainRecord = await decryptEnvelope(envelope, keyring.payload);
      const remoteHash = await hashPlainRecord(plainRecord);
      const existing = await client.getRecord(
        userId,
        plainRecord.collection,
        plainRecord.record_id,
      );
      const previous = state.pushed[envelope.envelope_id];
      if (existing && previous) {
        const localRecord = plainRecordFromVault(existing, plainRecord.collection);
        const localHash = await hashPlainRecord(localRecord);
        if (localHash !== previous.plaintextSha256 && localHash !== remoteHash) {
          await writeConflictRecord({
            userId,
            client,
            envelope,
            localRecord,
            remoteRecord: plainRecord,
            previousPlaintextSha256: previous.plaintextSha256,
            remotePlaintextSha256: remoteHash,
            now: now(),
          });
          conflictCount += 1;
          continue;
        }
      }
      await client.putRecord({
        userId,
        collection: plainRecord.collection,
        recordId: plainRecord.record_id,
        recordType: plainRecord.record_type,
        payload: plainRecord.payload,
        updatedAt: plainRecord.updated_at,
        tombstone: plainRecord.tombstone,
      });
      state.pushed[envelope.envelope_id] = {
        revision: envelope.revision,
        plaintextSha256: remoteHash,
        ciphertextSha256: envelope.ciphertext_sha256,
        pushedAt: now().toISOString(),
      };
      appliedCount += 1;
    }

    if (
      response.returned_count < MAX_PRIVATE_SYNC_BATCH
      || response.next_since_server_revision <= sinceServerRevision
    ) {
      sinceServerRevision = response.next_since_server_revision;
      break;
    }
    sinceServerRevision = response.next_since_server_revision;
  }

  state.lastPulledServerRevision = sinceServerRevision;
  await writeState(userId, client, state, now());

  return {
    pulledCount,
    appliedCount,
    conflictCount,
    nextSinceServerRevision: sinceServerRevision,
  };
}

export async function listPrivateSyncConflicts({
  userId,
  client = defaultVaultPrivateSyncClient,
}: {
  userId: string;
  client?: VaultPrivateSyncClient;
}): Promise<Array<DesktopVaultRecord<PrivateSyncConflictPayload>>> {
  await ensureInitialized(userId, client);
  const records = await client.listRecords<PrivateSyncConflictPayload>(
    userId,
    PRIVATE_SYNC_CONFLICTS_COLLECTION,
    { limit: MAX_LOCAL_LIST_RECORDS },
  );
  if (!records) {
    throw new Error("Local vault conflicts could not be read.");
  }
  return records.filter((record) => !record.tombstone && record.payload?.status === "pending");
}

export async function resolvePrivateSyncConflict({
  userId,
  conflictId,
  resolution,
  client = defaultVaultPrivateSyncClient,
  now = () => new Date(),
}: {
  userId: string;
  conflictId: string;
  resolution: PrivateSyncConflictResolution;
  client?: VaultPrivateSyncClient;
  now?: () => Date;
}): Promise<PrivateSyncConflictResolveResult> {
  await ensureInitialized(userId, client);
  const conflict = await client.getRecord<PrivateSyncConflictPayload>(
    userId,
    PRIVATE_SYNC_CONFLICTS_COLLECTION,
    conflictId,
  );
  if (!conflict || conflict.tombstone || conflict.payload?.status !== "pending") {
    throw new Error("Private Sync conflict was not found.");
  }

  const resolvedAt = now();
  if (resolution === "remote") {
    const remote = conflict.payload.remoteRecord;
    await client.putRecord({
      userId,
      collection: remote.collection,
      recordId: remote.record_id,
      recordType: remote.record_type,
      payload: remote.payload,
      updatedAt: remote.updated_at,
      tombstone: remote.tombstone,
    });
    const state = await readState(userId, client);
    state.pushed[conflict.payload.envelopeId] = {
      revision: conflict.payload.serverRevision,
      plaintextSha256: conflict.payload.remotePlaintextSha256,
      ciphertextSha256: "",
      pushedAt: resolvedAt.toISOString(),
    };
    await writeState(userId, client, state, resolvedAt);
  }

  await client.putRecord({
    userId,
    collection: PRIVATE_SYNC_CONFLICTS_COLLECTION,
    recordId: conflictId,
    recordType: "private_sync_conflict",
    payload: {
      ...conflict.payload,
      status: "resolved",
      resolvedAt: resolvedAt.toISOString(),
      resolution,
    },
    updatedAt: resolvedAt.toISOString(),
    tombstone: true,
  });

  return {
    conflictId,
    resolution,
    appliedRemoteRecord: resolution === "remote",
  };
}
