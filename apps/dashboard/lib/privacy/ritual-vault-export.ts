"use client";

import JSZip from "jszip";

import type {
  DesktopVaultDeletionReceipt,
  DesktopVaultMigrationManifest,
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
  PRIVATE_SYNC_WEB_CRYPTO_ALGORITHM,
  base64ToBytes,
  bytesToBase64,
  deriveAesGcmKeyFromPassphrase,
  randomBytes,
  sha256Hex as sha256BytesHex,
  utf8Bytes,
  utf8String,
  webCrypto,
} from "./vault-private-sync-crypto";

export const RITUAL_VAULT_FORMAT = "ritual-vault";
export const RITUAL_VAULT_ENCRYPTED_FORMAT = "ritual-vault-encrypted";
export const RITUAL_VAULT_FORMAT_VERSION = "1.0.0";
export const RITUAL_VAULT_ROOT = "Ritual Vault";
export const RITUAL_VAULT_SCHEMA_PATH = "schema/ritual-vault.schema.json";
export const RITUAL_VAULT_MANIFEST_PATH = "manifest.json";
export const RITUAL_VAULT_CHECKSUMS_PATH = "checksums.sha256";
const MAX_EXPORT_RECORDS_PER_CATEGORY = 100_000;
const RITUAL_VAULT_KDF = "PBKDF2-SHA256";
const RITUAL_VAULT_KDF_ITERATIONS = 250_000;

export type RitualVaultCategory = SupportedLocalMigrationCategory;

export const SENSITIVE_RITUAL_VAULT_CATEGORIES = [
  "ai_conversations",
  "ai_facts",
  "ai_messages",
  "artifacts",
  "financial_accounts",
  "financial_transactions",
  "import_items",
  "import_runs",
  "location_pings",
  "location_state",
  "reports",
  "sms_copilot",
  "workflows",
] as const satisfies readonly RitualVaultCategory[];

const SENSITIVE_RITUAL_VAULT_CATEGORY_SET = new Set<RitualVaultCategory>(SENSITIVE_RITUAL_VAULT_CATEGORIES);

export const DEFAULT_RITUAL_VAULT_EXPORT_CATEGORIES = SUPPORTED_LOCAL_MIGRATION_CATEGORIES.filter(
  (category) => !SENSITIVE_RITUAL_VAULT_CATEGORY_SET.has(category),
);

export const RITUAL_VAULT_SENSITIVE_DEFAULT_EXCLUSIONS = [
  "raw URLs",
  "window titles",
  "OCR text",
  "screenshots",
  "visible text captures",
  "raw provider payloads",
  "raw location",
  "AI conversations and facts",
  "financial transactions",
];

type VaultExportRecord = {
  collection: RitualVaultCategory;
  record_id: string;
  record_type: string;
  updated_at: string;
  tombstone: boolean;
  payload: unknown;
};

export type RitualVaultManifestCategory = {
  category: RitualVaultCategory;
  label: string;
  recordCount: number;
  dataPath: string;
  markdownPath: string;
  sensitive: boolean;
};

export type RitualVaultManifest = {
  format: typeof RITUAL_VAULT_FORMAT;
  version: typeof RITUAL_VAULT_FORMAT_VERSION;
  exportedAt: string;
  generator: "ritual-desktop";
  source: "local_vault";
  privacy: {
    includeSensitive: boolean;
    excludedSensitiveCategories: RitualVaultCategory[];
    sensitiveDefaultExclusions: string[];
  };
  categories: RitualVaultManifestCategory[];
  metadata: {
    migrationManifestCount: number;
    deletionReceiptCount: number;
  };
};

export type RitualVaultExportOptions = {
  userId: string;
  categories?: RitualVaultCategory[];
  includeSensitive?: boolean;
  includeTombstones?: boolean;
  client?: RitualVaultClient;
  now?: () => Date;
};

export type RitualVaultArchive = {
  bytes: Uint8Array;
  fileName: string;
  manifest: RitualVaultManifest;
  checksums: Record<string, string>;
  recordCount: number;
};

export type RitualVaultFileSet = {
  files: Record<string, string>;
  fileName: string;
  manifest: RitualVaultManifest;
  checksums: Record<string, string>;
  recordCount: number;
};

export type RitualVaultFolderMirrorResult = RitualVaultFileSet & {
  folderPath: string;
  mirroredAt: string;
  fileCount: number;
};

export type RitualVaultEncryptedArchiveFile = {
  format: typeof RITUAL_VAULT_ENCRYPTED_FORMAT;
  version: typeof RITUAL_VAULT_FORMAT_VERSION;
  createdAt: string;
  innerFileName: string;
  kdf: {
    name: typeof RITUAL_VAULT_KDF;
    iterations: number;
    salt: string;
  };
  encryption: {
    name: typeof PRIVATE_SYNC_WEB_CRYPTO_ALGORITHM;
    nonce: string;
  };
  ciphertextSha256: string;
  ciphertext: string;
};

export type RitualVaultEncryptedArchive = {
  bytes: Uint8Array;
  fileName: string;
  encryptedFile: RitualVaultEncryptedArchiveFile;
  innerArchive: RitualVaultArchive;
  recordCount: number;
  manifest: RitualVaultManifest;
};

export type RitualVaultPreview = {
  manifest: RitualVaultManifest;
  recordCount: number;
  categoryCounts: Record<string, number>;
  checksumCount: number;
};

export type RitualVaultImportResult = {
  importedCount: number;
  skippedCount: number;
  categories: RitualVaultCategory[];
  preview: RitualVaultPreview;
};

export type RitualVaultClient = {
  initializeVault(userId: string): Promise<DesktopVaultStatus | null>;
  listRecords<T>(
    userId: string,
    collection: string,
    options?: { since?: string; limit?: number },
  ): Promise<Array<DesktopVaultRecord<T>> | null>;
  putRecord<T>(input: DesktopVaultPutInput<T>): Promise<DesktopVaultRecordMetadata | null>;
  listMigrationManifests?(userId: string, limit?: number): Promise<DesktopVaultMigrationManifest[] | null>;
  listDeletionReceipts?(userId: string, limit?: number): Promise<DesktopVaultDeletionReceipt[] | null>;
};

export const RITUAL_VAULT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://ritual.local/schemas/ritual-vault.schema.json",
  title: "Ritual Vault",
  type: "object",
  required: ["format", "version", "exportedAt", "source", "categories"],
  properties: {
    format: { const: RITUAL_VAULT_FORMAT },
    version: { const: RITUAL_VAULT_FORMAT_VERSION },
    exportedAt: { type: "string" },
    source: { const: "local_vault" },
    categories: {
      type: "array",
      items: {
        type: "object",
        required: ["category", "recordCount", "dataPath", "markdownPath"],
        properties: {
          category: { type: "string" },
          recordCount: { type: "number" },
          dataPath: { type: "string" },
          markdownPath: { type: "string" },
        },
      },
    },
  },
};

const defaultRitualVaultClient: RitualVaultClient = {
  async initializeVault(userId) {
    const { initializeDesktopVault } = await import("./vault-client");
    return initializeDesktopVault(userId);
  },
  async listRecords(userId, collection, options) {
    const { listDesktopVaultRecords } = await import("./vault-client");
    return listDesktopVaultRecords(userId, collection, options);
  },
  async putRecord(input) {
    const { putDesktopVaultRecord } = await import("./vault-client");
    return putDesktopVaultRecord(input);
  },
  async listMigrationManifests(userId, limit) {
    const { listDesktopVaultMigrationManifests } = await import("./vault-client");
    return listDesktopVaultMigrationManifests(userId, limit);
  },
  async listDeletionReceipts(userId, limit) {
    const { listDesktopVaultDeletionReceipts } = await import("./vault-client");
    return listDesktopVaultDeletionReceipts(userId, limit);
  },
};

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item === undefined ? null : item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}

async function sha256Hex(text: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("SHA-256 is unavailable in this runtime.");
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function selectedCategories(
  requested: RitualVaultCategory[] | undefined,
  includeSensitive: boolean,
): RitualVaultCategory[] {
  const source = requested?.length
    ? requested
    : includeSensitive
      ? SUPPORTED_LOCAL_MIGRATION_CATEGORIES
      : DEFAULT_RITUAL_VAULT_EXPORT_CATEGORIES;
  return SUPPORTED_LOCAL_MIGRATION_CATEGORIES.filter((category) => {
    if (!source.includes(category)) return false;
    return includeSensitive || !SENSITIVE_RITUAL_VAULT_CATEGORY_SET.has(category);
  });
}

function toVaultExportRecord(record: DesktopVaultRecord, collection: RitualVaultCategory): VaultExportRecord {
  return {
    collection,
    record_id: record.id,
    record_type: record.recordType,
    updated_at: record.updatedAt,
    tombstone: record.tombstone,
    payload: record.payload,
  };
}

function dataPathForCategory(category: RitualVaultCategory): string {
  return `data/${category}.jsonl`;
}

function markdownPathForCategory(category: RitualVaultCategory): string {
  return `markdown/${category}.md`;
}

function createCategoryJsonl(records: VaultExportRecord[]): string {
  return records.map((record) => stableStringify(record)).join("\n") + (records.length ? "\n" : "");
}

function createCategoryMarkdown(category: RitualVaultCategory, records: VaultExportRecord[]): string {
  const label = LOCAL_MIGRATION_CATEGORY_LABELS[category];
  const lines = [`# ${label}`, "", `Records: ${records.length}`, ""];
  for (const record of records) {
    lines.push(`## ${record.record_type} ${record.record_id}`);
    lines.push("");
    lines.push(`- Updated: ${record.updated_at}`);
    lines.push(`- Tombstone: ${record.tombstone ? "yes" : "no"}`);
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(record.payload, null, 2));
    lines.push("```");
    lines.push("");
  }
  return lines.join("\n");
}

function parseJsonl<T>(content: string): T[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

function rootPath(path: string): string {
  return `${RITUAL_VAULT_ROOT}/${path}`;
}

function createFileName(now: Date): string {
  return `ritual-vault-${now.toISOString().slice(0, 10)}.zip`;
}

function createEncryptedFileName(now: Date): string {
  return `ritual-vault-${now.toISOString().slice(0, 10)}.encrypted.json`;
}

function joinFsPath(root: string, path: string): string {
  return `${root.replace(/[\\/]+$/, "")}/${path}`;
}

function dirname(path: string): string | null {
  const index = path.lastIndexOf("/");
  return index > 0 ? path.slice(0, index) : null;
}

async function addChecksums(files: Record<string, string>): Promise<Record<string, string>> {
  const checksums: Record<string, string> = {};
  for (const path of Object.keys(files).sort()) {
    checksums[path] = await sha256Hex(files[path]);
  }
  return checksums;
}

function renderChecksums(checksums: Record<string, string>): string {
  return Object.entries(checksums)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, hash]) => `${hash}  ${path}`)
    .join("\n") + "\n";
}

function parseChecksums(content: string): Record<string, string> {
  const checksums: Record<string, string> = {};
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    const match = line.match(/^([a-f0-9]{64})\s+(.+)$/);
    if (!match) throw new Error("Ritual Vault checksum file is invalid.");
    checksums[match[2].trim()] = match[1];
  }
  return checksums;
}

function assertManifest(value: unknown): asserts value is RitualVaultManifest {
  const manifest = value as Partial<RitualVaultManifest>;
  if (
    !manifest
    || manifest.format !== RITUAL_VAULT_FORMAT
    || manifest.version !== RITUAL_VAULT_FORMAT_VERSION
    || manifest.source !== "local_vault"
    || !Array.isArray(manifest.categories)
  ) {
    throw new Error("Selected file is not a supported Ritual Vault archive.");
  }
}

async function readZipText(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(rootPath(path));
  if (!file) throw new Error(`Ritual Vault archive is missing ${path}.`);
  return file.async("string");
}

function assertPassphrase(passphrase: string) {
  if (passphrase.trim().length < 12) {
    throw new Error("Encrypted Ritual Vault archives require a passphrase of at least 12 characters.");
  }
}

function assertEncryptedArchive(value: unknown): asserts value is RitualVaultEncryptedArchiveFile {
  const archive = value as Partial<RitualVaultEncryptedArchiveFile>;
  if (
    !archive
    || archive.format !== RITUAL_VAULT_ENCRYPTED_FORMAT
    || archive.version !== RITUAL_VAULT_FORMAT_VERSION
    || archive.kdf?.name !== RITUAL_VAULT_KDF
    || archive.encryption?.name !== PRIVATE_SYNC_WEB_CRYPTO_ALGORITHM
    || !archive.ciphertext
  ) {
    throw new Error("Selected file is not a supported encrypted Ritual Vault archive.");
  }
}

export async function createRitualVaultFileSet({
  userId,
  categories,
  includeSensitive = false,
  includeTombstones = false,
  client = defaultRitualVaultClient,
  now = () => new Date(),
}: RitualVaultExportOptions): Promise<RitualVaultFileSet> {
  const vaultStatus = await client.initializeVault(userId);
  if (!vaultStatus) {
    throw new Error("Ritual Desktop is required for Ritual Vault export.");
  }
  const exportedAt = now();

  const selected = selectedCategories(categories, includeSensitive);
  if (selected.length === 0) {
    throw new Error("Select at least one exportable Ritual Vault category.");
  }

  const files: Record<string, string> = {};
  const manifestCategories: RitualVaultManifestCategory[] = [];
  let recordCount = 0;

  for (const category of selected) {
    const records = await client.listRecords(userId, category, { limit: MAX_EXPORT_RECORDS_PER_CATEGORY });
    if (!records) {
      throw new Error("Local vault records could not be read for Ritual Vault export.");
    }
    const exportRecords = records
      .filter((record) => includeTombstones || !record.tombstone)
      .map((record) => toVaultExportRecord(record, category));
    const dataPath = dataPathForCategory(category);
    const markdownPath = markdownPathForCategory(category);
    files[dataPath] = createCategoryJsonl(exportRecords);
    files[markdownPath] = createCategoryMarkdown(category, exportRecords);
    manifestCategories.push({
      category,
      label: LOCAL_MIGRATION_CATEGORY_LABELS[category],
      recordCount: exportRecords.length,
      dataPath,
      markdownPath,
      sensitive: SENSITIVE_RITUAL_VAULT_CATEGORY_SET.has(category),
    });
    recordCount += exportRecords.length;
  }

  const migrationManifests = await client.listMigrationManifests?.(userId, 1000) || [];
  const deletionReceipts = await client.listDeletionReceipts?.(userId, 1000) || [];
  files["metadata/migration-manifests.json"] = JSON.stringify(migrationManifests, null, 2);
  files["metadata/deletion-receipts.json"] = JSON.stringify(deletionReceipts, null, 2);
  files[RITUAL_VAULT_SCHEMA_PATH] = JSON.stringify(RITUAL_VAULT_SCHEMA, null, 2);

  const excludedSensitiveCategories = includeSensitive
    ? []
    : [...SENSITIVE_RITUAL_VAULT_CATEGORIES].filter((category) => !selected.includes(category));
  const manifest: RitualVaultManifest = {
    format: RITUAL_VAULT_FORMAT,
    version: RITUAL_VAULT_FORMAT_VERSION,
    exportedAt: exportedAt.toISOString(),
    generator: "ritual-desktop",
    source: "local_vault",
    privacy: {
      includeSensitive,
      excludedSensitiveCategories,
      sensitiveDefaultExclusions: RITUAL_VAULT_SENSITIVE_DEFAULT_EXCLUSIONS,
    },
    categories: manifestCategories,
    metadata: {
      migrationManifestCount: migrationManifests.length,
      deletionReceiptCount: deletionReceipts.length,
    },
  };
  files[RITUAL_VAULT_MANIFEST_PATH] = JSON.stringify(manifest, null, 2);

  const checksums = await addChecksums(files);
  files[RITUAL_VAULT_CHECKSUMS_PATH] = renderChecksums(checksums);

  return {
    files,
    fileName: createFileName(exportedAt),
    manifest,
    checksums,
    recordCount,
  };
}

export async function createRitualVaultArchive(
  options: RitualVaultExportOptions,
): Promise<RitualVaultArchive> {
  const fileSet = await createRitualVaultFileSet(options);

  const zip = new JSZip();
  for (const [path, content] of Object.entries(fileSet.files)) {
    zip.file(rootPath(path), content);
  }

  return {
    bytes: await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }),
    fileName: fileSet.fileName,
    manifest: fileSet.manifest,
    checksums: fileSet.checksums,
    recordCount: fileSet.recordCount,
  };
}

export async function writeRitualVaultFolderMirror({
  folderPath,
  mkdirImpl,
  writeTextFileImpl,
  ...options
}: RitualVaultExportOptions & {
  folderPath: string;
  mkdirImpl?: (path: string, options?: { recursive?: boolean }) => Promise<void>;
  writeTextFileImpl?: (path: string, data: string) => Promise<void>;
}): Promise<RitualVaultFolderMirrorResult> {
  const fileSet = await createRitualVaultFileSet(options);
  const fs = mkdirImpl && writeTextFileImpl
    ? { mkdir: mkdirImpl, writeTextFile: writeTextFileImpl }
    : await import("@tauri-apps/plugin-fs");
  const root = folderPath.trim();
  if (!root) {
    throw new Error("Ritual Vault folder path is required.");
  }

  await fs.mkdir(root, { recursive: true });
  const directories = new Set<string>();
  for (const path of Object.keys(fileSet.files)) {
    const dir = dirname(path);
    if (dir) directories.add(dir);
  }
  for (const dir of [...directories].sort()) {
    await fs.mkdir(joinFsPath(root, dir), { recursive: true });
  }
  for (const [path, content] of Object.entries(fileSet.files).sort(([left], [right]) => left.localeCompare(right))) {
    await fs.writeTextFile(joinFsPath(root, path), content);
  }

  return {
    ...fileSet,
    folderPath: root,
    mirroredAt: fileSet.manifest.exportedAt,
    fileCount: Object.keys(fileSet.files).length,
  };
}

export async function createEncryptedRitualVaultArchive({
  passphrase,
  ...archiveOptions
}: RitualVaultExportOptions & {
  passphrase: string;
}): Promise<RitualVaultEncryptedArchive> {
  assertPassphrase(passphrase);
  const innerArchive = await createRitualVaultArchive(archiveOptions);
  const createdAt = archiveOptions.now?.() || new Date();
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const key = await deriveAesGcmKeyFromPassphrase({
    passphrase,
    salt,
    iterations: RITUAL_VAULT_KDF_ITERATIONS,
  });
  const ciphertext = new Uint8Array(await webCrypto().subtle.encrypt(
    {
      name: PRIVATE_SYNC_WEB_CRYPTO_ALGORITHM,
      iv: nonce,
    },
    key,
    innerArchive.bytes,
  ));
  const encryptedFile: RitualVaultEncryptedArchiveFile = {
    format: RITUAL_VAULT_ENCRYPTED_FORMAT,
    version: RITUAL_VAULT_FORMAT_VERSION,
    createdAt: createdAt.toISOString(),
    innerFileName: innerArchive.fileName,
    kdf: {
      name: RITUAL_VAULT_KDF,
      iterations: RITUAL_VAULT_KDF_ITERATIONS,
      salt: bytesToBase64(salt),
    },
    encryption: {
      name: PRIVATE_SYNC_WEB_CRYPTO_ALGORITHM,
      nonce: bytesToBase64(nonce),
    },
    ciphertextSha256: await sha256BytesHex(ciphertext),
    ciphertext: bytesToBase64(ciphertext),
  };

  return {
    bytes: utf8Bytes(JSON.stringify(encryptedFile, null, 2)),
    fileName: createEncryptedFileName(createdAt),
    encryptedFile,
    innerArchive,
    recordCount: innerArchive.recordCount,
    manifest: innerArchive.manifest,
  };
}

export async function decryptEncryptedRitualVaultArchive({
  bytes,
  passphrase,
}: {
  bytes: Uint8Array;
  passphrase: string;
}): Promise<Uint8Array> {
  assertPassphrase(passphrase);
  const encryptedFile = JSON.parse(utf8String(bytes)) as RitualVaultEncryptedArchiveFile;
  assertEncryptedArchive(encryptedFile);
  const ciphertext = base64ToBytes(encryptedFile.ciphertext);
  const actualCiphertextHash = await sha256BytesHex(ciphertext);
  if (actualCiphertextHash !== encryptedFile.ciphertextSha256) {
    throw new Error("Encrypted Ritual Vault ciphertext checksum mismatch.");
  }
  const key = await deriveAesGcmKeyFromPassphrase({
    passphrase,
    salt: base64ToBytes(encryptedFile.kdf.salt),
    iterations: encryptedFile.kdf.iterations,
  });
  const plaintext = await webCrypto().subtle.decrypt(
    {
      name: PRIVATE_SYNC_WEB_CRYPTO_ALGORITHM,
      iv: base64ToBytes(encryptedFile.encryption.nonce),
    },
    key,
    ciphertext,
  );
  return new Uint8Array(plaintext);
}

export async function previewRitualVaultArchive(bytes: Uint8Array): Promise<RitualVaultPreview> {
  const zip = await JSZip.loadAsync(bytes);
  const manifest = JSON.parse(await readZipText(zip, RITUAL_VAULT_MANIFEST_PATH));
  assertManifest(manifest);
  const checksums = parseChecksums(await readZipText(zip, RITUAL_VAULT_CHECKSUMS_PATH));

  for (const [path, expected] of Object.entries(checksums)) {
    const actual = await sha256Hex(await readZipText(zip, path));
    if (actual !== expected) {
      throw new Error(`Ritual Vault checksum mismatch for ${path}.`);
    }
  }

  const categoryCounts: Record<string, number> = {};
  let recordCount = 0;
  for (const category of manifest.categories) {
    const records = parseJsonl<VaultExportRecord>(await readZipText(zip, category.dataPath));
    categoryCounts[category.category] = records.length;
    recordCount += records.length;
  }

  return {
    manifest,
    recordCount,
    categoryCounts,
    checksumCount: Object.keys(checksums).length,
  };
}

export async function importRitualVaultArchive({
  userId,
  bytes,
  categories,
  client = defaultRitualVaultClient,
}: {
  userId: string;
  bytes: Uint8Array;
  categories?: RitualVaultCategory[];
  client?: RitualVaultClient;
}): Promise<RitualVaultImportResult> {
  const vaultStatus = await client.initializeVault(userId);
  if (!vaultStatus) {
    throw new Error("Ritual Desktop is required for Ritual Vault import.");
  }

  const zip = await JSZip.loadAsync(bytes);
  const preview = await previewRitualVaultArchive(bytes);
  const allowed = categories?.length ? new Set(categories) : null;
  let importedCount = 0;
  let skippedCount = 0;
  const importedCategories: RitualVaultCategory[] = [];

  for (const manifestCategory of preview.manifest.categories) {
    if (allowed && !allowed.has(manifestCategory.category)) {
      skippedCount += preview.categoryCounts[manifestCategory.category] || 0;
      continue;
    }
    const records = parseJsonl<VaultExportRecord>(await readZipText(zip, manifestCategory.dataPath));
    if (records.length > 0) {
      importedCategories.push(manifestCategory.category);
    }
    for (const record of records) {
      await client.putRecord({
        userId,
        collection: record.collection,
        recordId: record.record_id,
        recordType: record.record_type,
        payload: record.payload,
        updatedAt: record.updated_at,
        tombstone: record.tombstone,
      });
      importedCount += 1;
    }
  }

  return {
    importedCount,
    skippedCount,
    categories: importedCategories,
    preview,
  };
}

export async function saveRitualVaultArchive(options: RitualVaultExportOptions): Promise<RitualVaultArchive & {
  savedPath?: string;
}> {
  const archive = await createRitualVaultArchive(options);
  const [{ save }, { writeFile }] = await Promise.all([
    import("@tauri-apps/plugin-dialog"),
    import("@tauri-apps/plugin-fs"),
  ]);
  const destination = await save({
    defaultPath: archive.fileName,
    filters: [{ name: "Ritual Vault", extensions: ["zip"] }],
  });
  if (!destination) return archive;
  await writeFile(destination, archive.bytes);
  return { ...archive, savedPath: destination };
}

export async function saveEncryptedRitualVaultArchive(
  options: RitualVaultExportOptions & { passphrase: string },
): Promise<RitualVaultEncryptedArchive & {
  savedPath?: string;
}> {
  const archive = await createEncryptedRitualVaultArchive(options);
  const [{ save }, { writeFile }] = await Promise.all([
    import("@tauri-apps/plugin-dialog"),
    import("@tauri-apps/plugin-fs"),
  ]);
  const destination = await save({
    defaultPath: archive.fileName,
    filters: [{ name: "Encrypted Ritual Vault", extensions: ["json"] }],
  });
  if (!destination) return archive;
  await writeFile(destination, archive.bytes);
  return { ...archive, savedPath: destination };
}

export async function openAndImportRitualVaultArchive(options: {
  userId: string;
  client?: RitualVaultClient;
  passphrase?: string;
}): Promise<RitualVaultImportResult | null> {
  const [{ open }, { readFile }] = await Promise.all([
    import("@tauri-apps/plugin-dialog"),
    import("@tauri-apps/plugin-fs"),
  ]);
  const selected = await open({
    multiple: false,
    filters: [{ name: "Ritual Vault", extensions: ["zip", "json"] }],
  });
  if (!selected || Array.isArray(selected)) return null;
  const selectedBytes = await readFile(selected);
  const bytes = options.passphrase
    ? await decryptEncryptedRitualVaultArchive({
      bytes: selectedBytes,
      passphrase: options.passphrase,
    })
    : selectedBytes;
  return importRitualVaultArchive({
    userId: options.userId,
    bytes,
    client: options.client,
  });
}
