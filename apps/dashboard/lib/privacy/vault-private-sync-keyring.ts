"use client";

import type {
  DesktopVaultPutInput,
  DesktopVaultRecord,
  DesktopVaultRecordMetadata,
  DesktopVaultStatus,
} from "./vault-client";
import {
  PRIVATE_SYNC_WEB_CRYPTO_ALGORITHM,
  base64ToBytes,
  bytesToBase64,
  deriveAesGcmKeyFromPassphrase,
  randomBase64Key,
  randomBytes,
  sha256Hex,
  stableStringify,
  utf8Bytes,
  utf8String,
  webCrypto,
} from "./vault-private-sync-crypto";

export const PRIVATE_SYNC_STATE_COLLECTION = "private_sync_state";
export const PRIVATE_SYNC_KEY_RECORD_ID = "sync-key-v1";
export const PRIVATE_SYNC_RECOVERY_RECORD_ID = "recovery-v1";
export const PRIVATE_SYNC_PAIRING_RECORD_ID = "pairing-v1";
export const PRIVATE_SYNC_KEY_VERSION = 1;

const PRIVATE_SYNC_KEYRING_VERSION = "1.0.0";
const PRIVATE_SYNC_RECOVERY_FORMAT = "ritual-private-sync-recovery";
const PRIVATE_SYNC_PAIRING_FORMAT = "ritual-private-sync-pairing";
const PRIVATE_SYNC_KDF = "PBKDF2-SHA256";
const PRIVATE_SYNC_KDF_ITERATIONS = 250_000;

export type PrivateSyncLegacyKeyPayload = {
  algorithm: "AES-GCM";
  keyVersion: number;
  keyBase64: string;
  clientId: string;
  createdAt: string;
};

export type PrivateSyncKeyringKey = {
  keyVersion: number;
  keyBase64: string;
  createdAt: string;
  retiredAt?: string | null;
};

export type PrivateSyncKeyringPayload = {
  algorithm: "AES-GCM";
  version: typeof PRIVATE_SYNC_KEYRING_VERSION;
  activeKeyVersion: number;
  clientId: string;
  createdAt: string;
  rotatedAt?: string | null;
  keys: PrivateSyncKeyringKey[];
};

export type PrivateSyncActiveKey = {
  keyVersion: number;
  keyBase64: string;
  clientId: string;
  createdAt: string;
};

export type PrivateSyncKeyringStatus = {
  keyVersion: number;
  clientId: string;
  createdAt: string;
  created: boolean;
  availableKeyVersions: number[];
};

export type PrivateSyncKeyRotationResult = {
  previousKeyVersion: number;
  activeKeyVersion: number;
  availableKeyVersions: number[];
  rotatedAt: string;
};

export type PrivateSyncRecoveryKit = {
  bytes: Uint8Array;
  fileName: string;
  phrase: string;
  format: typeof PRIVATE_SYNC_RECOVERY_FORMAT | typeof PRIVATE_SYNC_PAIRING_FORMAT;
  keyVersions: number[];
  clientId: string;
  createdAt: string;
  savedPath?: string;
};

export type PrivateSyncRecoveryRestoreResult = {
  format: typeof PRIVATE_SYNC_RECOVERY_FORMAT | typeof PRIVATE_SYNC_PAIRING_FORMAT;
  activeKeyVersion: number;
  availableKeyVersions: number[];
  clientId: string;
  restoredAt: string;
};

type PrivateSyncKeyRecordPayload = PrivateSyncLegacyKeyPayload | PrivateSyncKeyringPayload;

type PrivateSyncKeyringVaultClient = {
  initializeVault(userId: string): Promise<DesktopVaultStatus | null>;
  getRecord<T>(userId: string, collection: string, recordId: string): Promise<DesktopVaultRecord<T> | null>;
  putRecord<T>(input: DesktopVaultPutInput<T>): Promise<DesktopVaultRecordMetadata | null>;
};

type PrivateSyncEncryptedKeyringFile = {
  format: typeof PRIVATE_SYNC_RECOVERY_FORMAT | typeof PRIVATE_SYNC_PAIRING_FORMAT;
  version: typeof PRIVATE_SYNC_KEYRING_VERSION;
  createdAt: string;
  clientId: string;
  activeKeyVersion: number;
  keyVersions: number[];
  kdf: {
    name: typeof PRIVATE_SYNC_KDF;
    iterations: number;
    salt: string;
  };
  encryption: {
    name: typeof PRIVATE_SYNC_WEB_CRYPTO_ALGORITHM;
    nonce: string;
  };
  phraseVerifierSha256: string;
  ciphertextSha256: string;
  ciphertext: string;
};

const defaultKeyringClient: PrivateSyncKeyringVaultClient = {
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
};

function createClientId(): string {
  return globalThis.crypto?.randomUUID?.() || `client-${Math.random().toString(36).slice(2)}`;
}

function assertVaultKeyringPayload(value: unknown): asserts value is PrivateSyncKeyringPayload {
  const candidate = value as Partial<PrivateSyncKeyringPayload>;
  if (
    !candidate
    || candidate.algorithm !== "AES-GCM"
    || !candidate.clientId
    || !candidate.activeKeyVersion
    || !Array.isArray(candidate.keys)
    || candidate.keys.length === 0
  ) {
    throw new Error("Private Sync keyring payload is invalid.");
  }
}

export function normalizePrivateSyncKeyring(
  value: PrivateSyncKeyRecordPayload | null | undefined,
  now: Date,
): PrivateSyncKeyringPayload {
  if (value && Array.isArray((value as PrivateSyncKeyringPayload).keys)) {
    const keyring = value as PrivateSyncKeyringPayload;
    assertVaultKeyringPayload(keyring);
    return {
      ...keyring,
      version: PRIVATE_SYNC_KEYRING_VERSION,
      keys: keyring.keys
        .filter((key) => key.keyBase64 && key.keyVersion > 0)
        .sort((left, right) => left.keyVersion - right.keyVersion),
    };
  }

  if ((value as PrivateSyncLegacyKeyPayload | undefined)?.keyBase64) {
    const legacy = value as PrivateSyncLegacyKeyPayload;
    return {
      algorithm: "AES-GCM",
      version: PRIVATE_SYNC_KEYRING_VERSION,
      activeKeyVersion: legacy.keyVersion || PRIVATE_SYNC_KEY_VERSION,
      clientId: legacy.clientId || createClientId(),
      createdAt: legacy.createdAt || now.toISOString(),
      rotatedAt: null,
      keys: [{
        keyVersion: legacy.keyVersion || PRIVATE_SYNC_KEY_VERSION,
        keyBase64: legacy.keyBase64,
        createdAt: legacy.createdAt || now.toISOString(),
        retiredAt: null,
      }],
    };
  }

  return {
    algorithm: "AES-GCM",
    version: PRIVATE_SYNC_KEYRING_VERSION,
    activeKeyVersion: PRIVATE_SYNC_KEY_VERSION,
    clientId: createClientId(),
    createdAt: now.toISOString(),
    rotatedAt: null,
    keys: [{
      keyVersion: PRIVATE_SYNC_KEY_VERSION,
      keyBase64: randomBase64Key(),
      createdAt: now.toISOString(),
      retiredAt: null,
    }],
  };
}

async function writeKeyring(
  userId: string,
  client: PrivateSyncKeyringVaultClient,
  payload: PrivateSyncKeyringPayload,
  now: Date,
) {
  await client.putRecord({
    userId,
    collection: PRIVATE_SYNC_STATE_COLLECTION,
    recordId: PRIVATE_SYNC_KEY_RECORD_ID,
    recordType: "private_sync_keyring",
    payload,
    updatedAt: now.toISOString(),
  });
}

export async function readOrCreatePrivateSyncKeyring(
  userId: string,
  client: PrivateSyncKeyringVaultClient,
  now: Date,
): Promise<{ payload: PrivateSyncKeyringPayload; created: boolean }> {
  const existing = await client.getRecord<PrivateSyncKeyRecordPayload>(
    userId,
    PRIVATE_SYNC_STATE_COLLECTION,
    PRIVATE_SYNC_KEY_RECORD_ID,
  );
  const payload = normalizePrivateSyncKeyring(existing?.payload, now);
  const created = !existing?.payload;
  const normalizedLegacy = Boolean(existing?.payload && (existing.payload as PrivateSyncLegacyKeyPayload).keyBase64);
  if (created || normalizedLegacy) {
    await writeKeyring(userId, client, payload, now);
  }
  return { payload, created };
}

export function activePrivateSyncKey(payload: PrivateSyncKeyringPayload): PrivateSyncActiveKey {
  const key = payload.keys.find((candidate) => candidate.keyVersion === payload.activeKeyVersion);
  if (!key) {
    throw new Error("Active Private Sync key is missing from the local keyring.");
  }
  return {
    keyVersion: key.keyVersion,
    keyBase64: key.keyBase64,
    clientId: payload.clientId,
    createdAt: key.createdAt,
  };
}

export function privateSyncKeyForVersion(
  payload: PrivateSyncKeyringPayload,
  keyVersion: number,
): PrivateSyncActiveKey {
  const key = payload.keys.find((candidate) => candidate.keyVersion === keyVersion);
  if (!key) {
    throw new Error(`Private Sync key version ${keyVersion} is not available in the local keyring.`);
  }
  return {
    keyVersion: key.keyVersion,
    keyBase64: key.keyBase64,
    clientId: payload.clientId,
    createdAt: key.createdAt,
  };
}

export function privateSyncKeyringStatus(
  keyring: PrivateSyncKeyringPayload,
  created: boolean,
): PrivateSyncKeyringStatus {
  const active = activePrivateSyncKey(keyring);
  return {
    keyVersion: active.keyVersion,
    clientId: keyring.clientId,
    createdAt: active.createdAt,
    created,
    availableKeyVersions: keyring.keys.map((key) => key.keyVersion),
  };
}

export async function rotatePrivateSyncKey({
  userId,
  client = defaultKeyringClient,
  now = () => new Date(),
}: {
  userId: string;
  client?: PrivateSyncKeyringVaultClient;
  now?: () => Date;
}): Promise<PrivateSyncKeyRotationResult> {
  const vaultStatus = await client.initializeVault(userId);
  if (!vaultStatus) {
    throw new Error("Ritual Desktop is required for Private Sync key rotation.");
  }

  const rotatedAt = now();
  const { payload } = await readOrCreatePrivateSyncKeyring(userId, client, rotatedAt);
  const previousKeyVersion = payload.activeKeyVersion;
  const nextKeyVersion = Math.max(...payload.keys.map((key) => key.keyVersion)) + 1;
  const nextPayload: PrivateSyncKeyringPayload = {
    ...payload,
    activeKeyVersion: nextKeyVersion,
    rotatedAt: rotatedAt.toISOString(),
    keys: [
      ...payload.keys.map((key) => (
        key.keyVersion === previousKeyVersion && !key.retiredAt
          ? { ...key, retiredAt: rotatedAt.toISOString() }
          : key
      )),
      {
        keyVersion: nextKeyVersion,
        keyBase64: randomBase64Key(),
        createdAt: rotatedAt.toISOString(),
        retiredAt: null,
      },
    ],
  };
  await writeKeyring(userId, client, nextPayload, rotatedAt);
  return {
    previousKeyVersion,
    activeKeyVersion: nextKeyVersion,
    availableKeyVersions: nextPayload.keys.map((key) => key.keyVersion),
    rotatedAt: rotatedAt.toISOString(),
  };
}

export async function mergePrivateSyncKeyringKeys({
  userId,
  keys,
  client = defaultKeyringClient,
  now = () => new Date(),
}: {
  userId: string;
  keys: PrivateSyncKeyringKey[];
  client?: PrivateSyncKeyringVaultClient;
  now?: () => Date;
}): Promise<PrivateSyncKeyringPayload> {
  const timestamp = now();
  const { payload } = await readOrCreatePrivateSyncKeyring(userId, client, timestamp);
  const byVersion = new Map<number, PrivateSyncKeyringKey>();
  for (const key of payload.keys) {
    byVersion.set(key.keyVersion, key);
  }
  for (const key of keys) {
    if (!key.keyBase64 || key.keyVersion < 1) continue;
    byVersion.set(key.keyVersion, {
      ...key,
      retiredAt: key.retiredAt ?? null,
    });
  }
  const mergedKeys = [...byVersion.values()].sort((left, right) => left.keyVersion - right.keyVersion);
  const nextPayload: PrivateSyncKeyringPayload = {
    ...payload,
    keys: mergedKeys,
    activeKeyVersion: Math.max(payload.activeKeyVersion, ...mergedKeys.map((key) => key.keyVersion)),
  };
  await writeKeyring(userId, client, nextPayload, timestamp);
  return nextPayload;
}

function createRecoveryPhrase(): string {
  const hex = Array.from(randomBytes(18))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return hex.match(/.{1,6}/g)?.join("-") || hex;
}

function fileNameForKit(format: typeof PRIVATE_SYNC_RECOVERY_FORMAT | typeof PRIVATE_SYNC_PAIRING_FORMAT, now: Date) {
  const suffix = format === PRIVATE_SYNC_RECOVERY_FORMAT ? "recovery-kit" : "pairing-kit";
  return `ritual-private-sync-${suffix}-${now.toISOString().slice(0, 10)}.json`;
}

async function phraseVerifier(phrase: string, saltBase64: string): Promise<string> {
  return sha256Hex(utf8Bytes(`${saltBase64}:${phrase}`));
}

async function createEncryptedKit({
  userId,
  format,
  client,
  now,
}: {
  userId: string;
  format: typeof PRIVATE_SYNC_RECOVERY_FORMAT | typeof PRIVATE_SYNC_PAIRING_FORMAT;
  client: PrivateSyncKeyringVaultClient;
  now: Date;
}): Promise<PrivateSyncRecoveryKit> {
  const { payload } = await readOrCreatePrivateSyncKeyring(userId, client, now);
  const phrase = createRecoveryPhrase();
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const saltBase64 = bytesToBase64(salt);
  const key = await deriveAesGcmKeyFromPassphrase({
    passphrase: phrase,
    salt,
    iterations: PRIVATE_SYNC_KDF_ITERATIONS,
  });
  const plaintext = utf8Bytes(stableStringify(payload));
  const ciphertext = new Uint8Array(await webCrypto().subtle.encrypt(
    { name: PRIVATE_SYNC_WEB_CRYPTO_ALGORITHM, iv: nonce },
    key,
    plaintext,
  ));
  const wrapper: PrivateSyncEncryptedKeyringFile = {
    format,
    version: PRIVATE_SYNC_KEYRING_VERSION,
    createdAt: now.toISOString(),
    clientId: payload.clientId,
    activeKeyVersion: payload.activeKeyVersion,
    keyVersions: payload.keys.map((item) => item.keyVersion),
    kdf: {
      name: PRIVATE_SYNC_KDF,
      iterations: PRIVATE_SYNC_KDF_ITERATIONS,
      salt: saltBase64,
    },
    encryption: {
      name: PRIVATE_SYNC_WEB_CRYPTO_ALGORITHM,
      nonce: bytesToBase64(nonce),
    },
    phraseVerifierSha256: await phraseVerifier(phrase, saltBase64),
    ciphertextSha256: await sha256Hex(ciphertext),
    ciphertext: bytesToBase64(ciphertext),
  };
  const bytes = utf8Bytes(JSON.stringify(wrapper, null, 2));

  await client.putRecord({
    userId,
    collection: PRIVATE_SYNC_STATE_COLLECTION,
    recordId: format === PRIVATE_SYNC_RECOVERY_FORMAT ? PRIVATE_SYNC_RECOVERY_RECORD_ID : PRIVATE_SYNC_PAIRING_RECORD_ID,
    recordType: format === PRIVATE_SYNC_RECOVERY_FORMAT ? "private_sync_recovery" : "private_sync_pairing",
    payload: {
      format,
      version: PRIVATE_SYNC_KEYRING_VERSION,
      createdAt: wrapper.createdAt,
      clientId: wrapper.clientId,
      activeKeyVersion: wrapper.activeKeyVersion,
      keyVersions: wrapper.keyVersions,
      phraseVerifierSha256: wrapper.phraseVerifierSha256,
      kitSha256: await sha256Hex(bytes),
    },
    updatedAt: now.toISOString(),
  });

  return {
    bytes,
    fileName: fileNameForKit(format, now),
    phrase,
    format,
    keyVersions: wrapper.keyVersions,
    clientId: payload.clientId,
    createdAt: now.toISOString(),
  };
}

async function restoreEncryptedKit({
  userId,
  bytes,
  phrase,
  expectedFormat,
  client,
  now,
}: {
  userId: string;
  bytes: Uint8Array;
  phrase: string;
  expectedFormat: typeof PRIVATE_SYNC_RECOVERY_FORMAT | typeof PRIVATE_SYNC_PAIRING_FORMAT;
  client: PrivateSyncKeyringVaultClient;
  now: Date;
}): Promise<PrivateSyncRecoveryRestoreResult> {
  const wrapper = JSON.parse(utf8String(bytes)) as PrivateSyncEncryptedKeyringFile;
  if (
    wrapper.format !== expectedFormat
    || wrapper.version !== PRIVATE_SYNC_KEYRING_VERSION
    || wrapper.kdf?.name !== PRIVATE_SYNC_KDF
    || wrapper.encryption?.name !== PRIVATE_SYNC_WEB_CRYPTO_ALGORITHM
  ) {
    throw new Error("Selected Private Sync kit is not supported.");
  }
  const salt = base64ToBytes(wrapper.kdf.salt);
  const verifier = await phraseVerifier(phrase, wrapper.kdf.salt);
  if (verifier !== wrapper.phraseVerifierSha256) {
    throw new Error("Private Sync recovery phrase does not match this kit.");
  }
  const ciphertext = base64ToBytes(wrapper.ciphertext);
  const actualCiphertextHash = await sha256Hex(ciphertext);
  if (actualCiphertextHash !== wrapper.ciphertextSha256) {
    throw new Error("Private Sync kit ciphertext checksum failed.");
  }
  const key = await deriveAesGcmKeyFromPassphrase({
    passphrase: phrase,
    salt,
    iterations: wrapper.kdf.iterations,
  });
  const plaintext = await webCrypto().subtle.decrypt(
    {
      name: PRIVATE_SYNC_WEB_CRYPTO_ALGORITHM,
      iv: base64ToBytes(wrapper.encryption.nonce),
    },
    key,
    ciphertext,
  );
  const keyring = normalizePrivateSyncKeyring(
    JSON.parse(utf8String(plaintext)) as PrivateSyncKeyRecordPayload,
    now,
  );
  await writeKeyring(userId, client, keyring, now);
  return {
    format: wrapper.format,
    activeKeyVersion: keyring.activeKeyVersion,
    availableKeyVersions: keyring.keys.map((item) => item.keyVersion),
    clientId: keyring.clientId,
    restoredAt: now.toISOString(),
  };
}

export async function createPrivateSyncRecoveryKit({
  userId,
  client = defaultKeyringClient,
  now = () => new Date(),
}: {
  userId: string;
  client?: PrivateSyncKeyringVaultClient;
  now?: () => Date;
}): Promise<PrivateSyncRecoveryKit> {
  const vaultStatus = await client.initializeVault(userId);
  if (!vaultStatus) {
    throw new Error("Ritual Desktop is required for Private Sync recovery.");
  }
  return createEncryptedKit({
    userId,
    format: PRIVATE_SYNC_RECOVERY_FORMAT,
    client,
    now: now(),
  });
}

export async function restorePrivateSyncRecoveryKit({
  userId,
  bytes,
  phrase,
  client = defaultKeyringClient,
  now = () => new Date(),
}: {
  userId: string;
  bytes: Uint8Array;
  phrase: string;
  client?: PrivateSyncKeyringVaultClient;
  now?: () => Date;
}): Promise<PrivateSyncRecoveryRestoreResult> {
  const vaultStatus = await client.initializeVault(userId);
  if (!vaultStatus) {
    throw new Error("Ritual Desktop is required for Private Sync recovery.");
  }
  return restoreEncryptedKit({
    userId,
    bytes,
    phrase,
    expectedFormat: PRIVATE_SYNC_RECOVERY_FORMAT,
    client,
    now: now(),
  });
}

export async function createTrustedDevicePairingKit({
  userId,
  client = defaultKeyringClient,
  now = () => new Date(),
}: {
  userId: string;
  client?: PrivateSyncKeyringVaultClient;
  now?: () => Date;
}): Promise<PrivateSyncRecoveryKit> {
  const vaultStatus = await client.initializeVault(userId);
  if (!vaultStatus) {
    throw new Error("Ritual Desktop is required for Private Sync pairing.");
  }
  return createEncryptedKit({
    userId,
    format: PRIVATE_SYNC_PAIRING_FORMAT,
    client,
    now: now(),
  });
}

export async function importTrustedDevicePairingKit({
  userId,
  bytes,
  phrase,
  client = defaultKeyringClient,
  now = () => new Date(),
}: {
  userId: string;
  bytes: Uint8Array;
  phrase: string;
  client?: PrivateSyncKeyringVaultClient;
  now?: () => Date;
}): Promise<PrivateSyncRecoveryRestoreResult> {
  const vaultStatus = await client.initializeVault(userId);
  if (!vaultStatus) {
    throw new Error("Ritual Desktop is required for Private Sync pairing.");
  }
  return restoreEncryptedKit({
    userId,
    bytes,
    phrase,
    expectedFormat: PRIVATE_SYNC_PAIRING_FORMAT,
    client,
    now: now(),
  });
}

export async function savePrivateSyncRecoveryKit(options: {
  userId: string;
  client?: PrivateSyncKeyringVaultClient;
  now?: () => Date;
}): Promise<PrivateSyncRecoveryKit> {
  const kit = await createPrivateSyncRecoveryKit(options);
  const [{ save }, { writeFile }] = await Promise.all([
    import("@tauri-apps/plugin-dialog"),
    import("@tauri-apps/plugin-fs"),
  ]);
  const destination = await save({
    defaultPath: kit.fileName,
    filters: [{ name: "Private Sync Recovery", extensions: ["json"] }],
  });
  if (!destination) return kit;
  await writeFile(destination, kit.bytes);
  return { ...kit, savedPath: destination };
}

export async function saveTrustedDevicePairingKit(options: {
  userId: string;
  client?: PrivateSyncKeyringVaultClient;
  now?: () => Date;
}): Promise<PrivateSyncRecoveryKit> {
  const kit = await createTrustedDevicePairingKit(options);
  const [{ save }, { writeFile }] = await Promise.all([
    import("@tauri-apps/plugin-dialog"),
    import("@tauri-apps/plugin-fs"),
  ]);
  const destination = await save({
    defaultPath: kit.fileName,
    filters: [{ name: "Private Sync Pairing", extensions: ["json"] }],
  });
  if (!destination) return kit;
  await writeFile(destination, kit.bytes);
  return { ...kit, savedPath: destination };
}

export async function openAndRestorePrivateSyncRecoveryKit(options: {
  userId: string;
  phrase: string;
  client?: PrivateSyncKeyringVaultClient;
  now?: () => Date;
}): Promise<PrivateSyncRecoveryRestoreResult | null> {
  const [{ open }, { readFile }] = await Promise.all([
    import("@tauri-apps/plugin-dialog"),
    import("@tauri-apps/plugin-fs"),
  ]);
  const selected = await open({
    multiple: false,
    filters: [{ name: "Private Sync Recovery", extensions: ["json"] }],
  });
  if (!selected || Array.isArray(selected)) return null;
  return restorePrivateSyncRecoveryKit({
    ...options,
    bytes: await readFile(selected),
  });
}

export async function openAndImportTrustedDevicePairingKit(options: {
  userId: string;
  phrase: string;
  client?: PrivateSyncKeyringVaultClient;
  now?: () => Date;
}): Promise<PrivateSyncRecoveryRestoreResult | null> {
  const [{ open }, { readFile }] = await Promise.all([
    import("@tauri-apps/plugin-dialog"),
    import("@tauri-apps/plugin-fs"),
  ]);
  const selected = await open({
    multiple: false,
    filters: [{ name: "Private Sync Pairing", extensions: ["json"] }],
  });
  if (!selected || Array.isArray(selected)) return null;
  return importTrustedDevicePairingKit({
    ...options,
    bytes: await readFile(selected),
  });
}
