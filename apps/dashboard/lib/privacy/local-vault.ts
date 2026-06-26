export type VaultRecordType =
  | "habit_definition"
  | "habit_log"
  | "daily_note"
  | "computer_activity"
  | "health_metric"
  | "ai_content";

export type VaultRecord<T = unknown> = {
  id: string;
  type: VaultRecordType;
  payload: T;
  updatedAt?: string;
  tombstone?: boolean;
};

export type EncryptedVaultRecord = {
  id: string;
  type: VaultRecordType;
  updatedAt: string;
  tombstone: boolean;
  algorithm: "AES-GCM";
  kdf: "PBKDF2-SHA256";
  salt: string;
  iv: string;
  ciphertext: string;
};

export interface VaultStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  keys(prefix: string): Promise<string[]>;
}

const VAULT_RECORD_PREFIX = "ritual.vault.record.";
const KEY_ITERATIONS = 210_000;

function requireSubtle(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("WebCrypto is required for the local vault");
  }
  return subtle;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveVaultKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const subtle = requireSubtle();
  const material = await subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: KEY_ITERATIONS,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function recordKey(id: string): string {
  return `${VAULT_RECORD_PREFIX}${id}`;
}

export async function encryptVaultRecord<T>(
  record: VaultRecord<T>,
  passphrase: string,
): Promise<EncryptedVaultRecord> {
  if (!passphrase.trim()) {
    throw new Error("A vault passphrase is required");
  }
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveVaultKey(passphrase, salt);
  const plaintext = new TextEncoder().encode(JSON.stringify(record.payload));
  const encrypted = await requireSubtle().encrypt({ name: "AES-GCM", iv }, key, plaintext);

  return {
    id: record.id,
    type: record.type,
    updatedAt: record.updatedAt || new Date().toISOString(),
    tombstone: record.tombstone === true,
    algorithm: "AES-GCM",
    kdf: "PBKDF2-SHA256",
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
  };
}

export async function decryptVaultRecord<T>(
  encrypted: EncryptedVaultRecord,
  passphrase: string,
): Promise<VaultRecord<T>> {
  const salt = base64ToBytes(encrypted.salt);
  const iv = base64ToBytes(encrypted.iv);
  const ciphertext = base64ToBytes(encrypted.ciphertext);
  const key = await deriveVaultKey(passphrase, salt);
  const plaintext = await requireSubtle().decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return {
    id: encrypted.id,
    type: encrypted.type,
    updatedAt: encrypted.updatedAt,
    tombstone: encrypted.tombstone,
    payload: JSON.parse(new TextDecoder().decode(plaintext)) as T,
  };
}

export async function putVaultRecord<T>(
  storage: VaultStorage,
  passphrase: string,
  record: VaultRecord<T>,
): Promise<EncryptedVaultRecord> {
  const encrypted = await encryptVaultRecord(record, passphrase);
  await storage.set(recordKey(record.id), JSON.stringify(encrypted));
  return encrypted;
}

export async function getVaultRecord<T>(
  storage: VaultStorage,
  passphrase: string,
  id: string,
): Promise<VaultRecord<T> | null> {
  const raw = await storage.get(recordKey(id));
  if (!raw) return null;
  return decryptVaultRecord<T>(JSON.parse(raw) as EncryptedVaultRecord, passphrase);
}

export async function listVaultRecords<T>(
  storage: VaultStorage,
  passphrase: string,
): Promise<Array<VaultRecord<T>>> {
  const keys = await storage.keys(VAULT_RECORD_PREFIX);
  const records: Array<VaultRecord<T>> = [];
  for (const key of keys) {
    const raw = await storage.get(key);
    if (!raw) continue;
    records.push(await decryptVaultRecord<T>(JSON.parse(raw) as EncryptedVaultRecord, passphrase));
  }
  return records.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

export class MemoryVaultStorage implements VaultStorage {
  readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }

  async keys(prefix: string): Promise<string[]> {
    return [...this.values.keys()].filter((key) => key.startsWith(prefix)).sort();
  }
}

export class LocalStorageVaultStorage implements VaultStorage {
  async get(key: string): Promise<string | null> {
    return window.localStorage.getItem(key);
  }

  async set(key: string, value: string): Promise<void> {
    window.localStorage.setItem(key, value);
  }

  async delete(key: string): Promise<void> {
    window.localStorage.removeItem(key);
  }

  async keys(prefix: string): Promise<string[]> {
    return Object.keys(window.localStorage)
      .filter((key) => key.startsWith(prefix))
      .sort();
  }
}
