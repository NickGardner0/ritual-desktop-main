"use client";

import type {
  DesktopVaultPutInput,
  DesktopVaultRecord,
  DesktopVaultRecordMetadata,
  DesktopVaultStatus,
} from "./vault-client";
import { PRIVATE_SYNC_STATE_COLLECTION } from "./vault-private-sync-keyring";

export const PRIVATE_SYNC_DEVICE_RECORD_ID = "device-v1";
export const PRIVATE_SYNC_DEVICE_HEADER = "x-ritual-private-sync-device-id";

export type PrivateSyncDeviceStatus = "pending" | "active" | "revoked";

export type PrivateSyncLocalDevicePayload = {
  deviceId: string;
  deviceName: string;
  platform: string;
  createdAt: string;
};

export type PrivateSyncDevice = {
  device_id: string;
  device_name: string;
  platform?: string | null;
  public_key?: string | null;
  status: PrivateSyncDeviceStatus;
  registered_at?: string | null;
  trusted_at?: string | null;
  revoked_at?: string | null;
  last_seen_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type PrivateSyncDeviceListResponse = {
  devices: PrivateSyncDevice[];
  device_count: number;
};

export type PrivateSyncDeviceRevokeResponse = {
  device_id: string;
  revoked: boolean;
  revoked_at: string;
};

export type PrivateSyncKeyGrant = {
  grant_id: string;
  sender_device_id: string;
  recipient_device_id: string;
  key_version: number;
  algorithm: "AES-256-GCM";
  nonce: string;
  ciphertext: string;
  aad: string;
  ciphertext_sha256: string;
  created_at?: string | null;
  updated_at?: string | null;
};

export type PrivateSyncKeyGrantInput = Omit<PrivateSyncKeyGrant, "sender_device_id" | "created_at" | "updated_at">;

export type PrivateSyncKeyGrantPutResponse = {
  accepted_count: number;
  ignored_count: number;
  grants: PrivateSyncKeyGrant[];
};

export type PrivateSyncKeyGrantListResponse = {
  grants: PrivateSyncKeyGrant[];
  grant_count: number;
};

export type PrivateSyncDeviceVaultClient = {
  initializeVault(userId: string): Promise<DesktopVaultStatus | null>;
  getRecord<T>(userId: string, collection: string, recordId: string): Promise<DesktopVaultRecord<T> | null>;
  putRecord<T>(input: DesktopVaultPutInput<T>): Promise<DesktopVaultRecordMetadata | null>;
};

const defaultDeviceClient: PrivateSyncDeviceVaultClient = {
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

function createDeviceId(): string {
  return `device-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`;
}

function defaultPlatform(): string {
  if (typeof navigator === "undefined") return "unknown";
  const userAgent = navigator.userAgent.toLowerCase();
  if (userAgent.includes("mac")) return "macos";
  if (userAgent.includes("win")) return "windows";
  if (userAgent.includes("linux")) return "linux";
  return "desktop";
}

function defaultDeviceName(platform: string): string {
  if (platform === "macos") return "This Mac";
  if (platform === "windows") return "This Windows PC";
  if (platform === "linux") return "This Linux device";
  return "This device";
}

function normalizeLocalDevice(
  value: PrivateSyncLocalDevicePayload | null | undefined,
  now: Date,
): PrivateSyncLocalDevicePayload {
  if (value?.deviceId && value.deviceName && value.platform && value.createdAt) {
    return value;
  }
  const platform = defaultPlatform();
  return {
    deviceId: createDeviceId(),
    deviceName: defaultDeviceName(platform),
    platform,
    createdAt: now.toISOString(),
  };
}

export async function readOrCreatePrivateSyncLocalDevice({
  userId,
  client = defaultDeviceClient,
  now = () => new Date(),
}: {
  userId: string;
  client?: PrivateSyncDeviceVaultClient;
  now?: () => Date;
}): Promise<{ payload: PrivateSyncLocalDevicePayload; created: boolean }> {
  const vaultStatus = await client.initializeVault(userId);
  if (!vaultStatus) {
    throw new Error("Ritual Desktop is required for Private Sync device registration.");
  }
  const existing = await client.getRecord<PrivateSyncLocalDevicePayload>(
    userId,
    PRIVATE_SYNC_STATE_COLLECTION,
    PRIVATE_SYNC_DEVICE_RECORD_ID,
  );
  const timestamp = now();
  const payload = normalizeLocalDevice(existing?.payload, timestamp);
  const created = !existing?.payload;
  if (created) {
    await client.putRecord({
      userId,
      collection: PRIVATE_SYNC_STATE_COLLECTION,
      recordId: PRIVATE_SYNC_DEVICE_RECORD_ID,
      recordType: "private_sync_device",
      payload,
      updatedAt: timestamp.toISOString(),
    });
  }
  return { payload, created };
}

export async function privateSyncDeviceHeaders({
  userId,
  headers,
  client = defaultDeviceClient,
  now = () => new Date(),
}: {
  userId: string;
  headers?: HeadersInit;
  client?: PrivateSyncDeviceVaultClient;
  now?: () => Date;
}): Promise<{ headers: Headers; localDevice: PrivateSyncLocalDevicePayload }> {
  const { payload } = await readOrCreatePrivateSyncLocalDevice({ userId, client, now });
  const prepared = new Headers(headers || {});
  prepared.set(PRIVATE_SYNC_DEVICE_HEADER, payload.deviceId);
  return { headers: prepared, localDevice: payload };
}

async function fetchJson<T>(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetchImpl(url, init);
  if (!response.ok) {
    throw new Error(`Private Sync device request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function jsonHeaders(headers: Headers): Headers {
  const prepared = new Headers(headers);
  prepared.set("Content-Type", "application/json");
  return prepared;
}

export async function registerPrivateSyncDevice({
  userId,
  headers,
  fetchImpl = fetch,
  client = defaultDeviceClient,
  now = () => new Date(),
}: {
  userId: string;
  headers?: HeadersInit;
  fetchImpl?: typeof fetch;
  client?: PrivateSyncDeviceVaultClient;
  now?: () => Date;
}): Promise<PrivateSyncDevice> {
  const prepared = await privateSyncDeviceHeaders({ userId, headers, client, now });
  return fetchJson<PrivateSyncDevice>(fetchImpl, "/api/privacy/e2ee/devices", {
    method: "POST",
    cache: "no-store",
    credentials: "include",
    headers: jsonHeaders(prepared.headers),
    body: JSON.stringify({
      device_id: prepared.localDevice.deviceId,
      device_name: prepared.localDevice.deviceName,
      platform: prepared.localDevice.platform,
    }),
  });
}

export async function listPrivateSyncDevices({
  userId,
  headers,
  fetchImpl = fetch,
  client = defaultDeviceClient,
  now = () => new Date(),
}: {
  userId: string;
  headers?: HeadersInit;
  fetchImpl?: typeof fetch;
  client?: PrivateSyncDeviceVaultClient;
  now?: () => Date;
}): Promise<PrivateSyncDeviceListResponse> {
  const prepared = await privateSyncDeviceHeaders({ userId, headers, client, now });
  return fetchJson<PrivateSyncDeviceListResponse>(fetchImpl, "/api/privacy/e2ee/devices", {
    method: "GET",
    cache: "no-store",
    credentials: "include",
    headers: jsonHeaders(prepared.headers),
  });
}

export async function revokePrivateSyncDevice({
  userId,
  deviceId,
  headers,
  fetchImpl = fetch,
  client = defaultDeviceClient,
  now = () => new Date(),
}: {
  userId: string;
  deviceId: string;
  headers?: HeadersInit;
  fetchImpl?: typeof fetch;
  client?: PrivateSyncDeviceVaultClient;
  now?: () => Date;
}): Promise<PrivateSyncDeviceRevokeResponse> {
  const prepared = await privateSyncDeviceHeaders({ userId, headers, client, now });
  return fetchJson<PrivateSyncDeviceRevokeResponse>(
    fetchImpl,
    `/api/privacy/e2ee/devices/${encodeURIComponent(deviceId)}/revoke`,
    {
      method: "POST",
      cache: "no-store",
      credentials: "include",
      headers: jsonHeaders(prepared.headers),
      body: JSON.stringify({}),
    },
  );
}

export async function putPrivateSyncKeyGrants({
  userId,
  grants,
  headers,
  fetchImpl = fetch,
  client = defaultDeviceClient,
  now = () => new Date(),
}: {
  userId: string;
  grants: PrivateSyncKeyGrantInput[];
  headers?: HeadersInit;
  fetchImpl?: typeof fetch;
  client?: PrivateSyncDeviceVaultClient;
  now?: () => Date;
}): Promise<PrivateSyncKeyGrantPutResponse> {
  const prepared = await privateSyncDeviceHeaders({ userId, headers, client, now });
  return fetchJson<PrivateSyncKeyGrantPutResponse>(fetchImpl, "/api/privacy/e2ee/key-grants", {
    method: "POST",
    cache: "no-store",
    credentials: "include",
    headers: jsonHeaders(prepared.headers),
    body: JSON.stringify({ grants }),
  });
}

export async function listPrivateSyncKeyGrants({
  userId,
  headers,
  fetchImpl = fetch,
  client = defaultDeviceClient,
  now = () => new Date(),
}: {
  userId: string;
  headers?: HeadersInit;
  fetchImpl?: typeof fetch;
  client?: PrivateSyncDeviceVaultClient;
  now?: () => Date;
}): Promise<PrivateSyncKeyGrantListResponse> {
  const prepared = await privateSyncDeviceHeaders({ userId, headers, client, now });
  return fetchJson<PrivateSyncKeyGrantListResponse>(fetchImpl, "/api/privacy/e2ee/key-grants", {
    method: "GET",
    cache: "no-store",
    credentials: "include",
    headers: jsonHeaders(prepared.headers),
  });
}
