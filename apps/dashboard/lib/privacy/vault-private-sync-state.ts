import type {
  DesktopVaultPutInput,
  DesktopVaultRecord,
  DesktopVaultRecordMetadata,
} from "./vault-client";

const STATE_RECORD_ID = "state-v2";
const LEGACY_STATE_RECORD_ID = "state-v1";
const STATE_COLLECTION = "private_sync_state";

type PushedRecord = {
  revision: number;
  plaintextSha256: string;
  ciphertextSha256: string;
  pushedAt: string;
};

export type PrivateSyncStatePayload = {
  lastPulledServerRevision: number;
  pushed: Record<string, PushedRecord>;
};

type StateClient = {
  getRecord<T>(userId: string, collection: string, recordId: string): Promise<DesktopVaultRecord<T> | null>;
  putRecord<T>(input: DesktopVaultPutInput<T>): Promise<DesktopVaultRecordMetadata | null>;
  compareAndSwapRecord?<T>(
    input: DesktopVaultPutInput<T>,
    expectedUpdatedAt: string | null,
  ): Promise<{
    applied: boolean;
    record?: DesktopVaultRecordMetadata | null;
    current?: DesktopVaultRecord<T> | null;
  } | null>;
};

function normalizeState(value: PrivateSyncStatePayload | null | undefined): PrivateSyncStatePayload {
  return {
    lastPulledServerRevision:
      typeof value?.lastPulledServerRevision === "number" && value.lastPulledServerRevision >= 0
        ? value.lastPulledServerRevision
        : 0,
    pushed: value?.pushed && typeof value.pushed === "object" ? value.pushed : {},
  };
}

export async function readPrivateSyncState(userId: string, client: StateClient) {
  const record = await client.getRecord<PrivateSyncStatePayload>(userId, STATE_COLLECTION, STATE_RECORD_ID);
  if (record) return { state: normalizeState(record.payload), updatedAt: record.updatedAt };
  const legacy = await client.getRecord<PrivateSyncStatePayload>(
    userId,
    STATE_COLLECTION,
    LEGACY_STATE_RECORD_ID,
  );
  return { state: normalizeState(legacy?.payload), updatedAt: null };
}

export async function writePrivateSyncState(
  userId: string,
  client: StateClient,
  state: PrivateSyncStatePayload,
  now: Date,
  expectedUpdatedAt: string | null,
) {
  let desired = normalizeState(state);
  let expected = expectedUpdatedAt;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const input: DesktopVaultPutInput<PrivateSyncStatePayload> = {
      userId,
      collection: STATE_COLLECTION,
      recordId: STATE_RECORD_ID,
      recordType: "private_sync_state",
      payload: desired,
      updatedAt: new Date(now.getTime() + attempt).toISOString(),
    };
    if (!client.compareAndSwapRecord) {
      await client.putRecord(input);
      return;
    }
    const result = await client.compareAndSwapRecord(input, expected);
    if (result?.applied) return;
    const current = result?.current;
    if (!current) throw new Error("Private Sync state changed and could not be reloaded.");
    const currentState = normalizeState(current.payload);
    desired = {
      lastPulledServerRevision: Math.max(
        currentState.lastPulledServerRevision,
        desired.lastPulledServerRevision,
      ),
      pushed: { ...currentState.pushed, ...desired.pushed },
    };
    expected = current.updatedAt;
  }
  throw new Error("Private Sync state remained busy after repeated compare-and-swap attempts.");
}
