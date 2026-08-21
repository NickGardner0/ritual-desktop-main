"use client";

import type {
  DesktopVaultDeletionReceipt,
  DesktopVaultStatus,
} from "./vault-sync";
import { vaultSync } from "./vault-sync";

export const SUPPORTED_EXTERNAL_ERASURE_TARGETS = [
  "private_sync_envelopes",
  "tinybird",
  "openpanel",
  "sentry",
  "external_providers",
] as const;

export type ExternalErasureTarget = typeof SUPPORTED_EXTERNAL_ERASURE_TARGETS[number];

export const EXTERNAL_ERASURE_TARGET_LABELS: Record<ExternalErasureTarget, string> = {
  private_sync_envelopes: "Private Sync",
  tinybird: "Tinybird",
  openpanel: "OpenPanel",
  sentry: "Sentry",
  external_providers: "Providers",
};

export type ExternalErasurePlanTarget = {
  target: ExternalErasureTarget;
  label: string;
  status: "supported_by_api" | "manual_required";
  execution?: string;
  datasources?: string[];
  collections?: string[];
  instructions?: string;
};

export type ExternalErasurePlan = {
  deletes_cloud_data: boolean;
  requires_local_receipt: boolean;
  targets: ExternalErasurePlanTarget[];
  supported_targets: ExternalErasureTarget[];
  planned_at: string;
  limitations?: string[];
};

export type ExternalErasureExecuteResponse = {
  erasure_id: string;
  local_receipt_id: string;
  deletes_cloud_data: boolean;
  requested_targets: ExternalErasureTarget[];
  targets: Array<{
    target: ExternalErasureTarget;
    status: string;
    deleted_count: number;
    [key: string]: unknown;
  }>;
  deleted_count: number;
  manual_required_count: number;
  completed_at: string;
  limitations?: string[];
};

export type ExternalErasureResult = {
  erasureId: string;
  targets: ExternalErasureTarget[];
  plan: ExternalErasurePlan;
  response: ExternalErasureExecuteResponse;
  receipt: DesktopVaultDeletionReceipt | null;
};

export type ExternalErasureClient = {
  initializeVault(userId: string): Promise<DesktopVaultStatus | null>;
  putDeletionReceipt(input: {
    userId: string;
    deletionId: string;
    categories: string[];
    status: "running" | "completed" | "failed";
    sourceHash: string;
    requestedRecordCount: number;
    deletedCount: number;
    backendReceipts: unknown;
    startedAt?: string;
    completedAt?: string | null;
    error?: string | null;
  }): Promise<DesktopVaultDeletionReceipt | null>;
};

const defaultExternalErasureClient: ExternalErasureClient = {
  async initializeVault(userId) {
    return vaultSync.initialize(userId);
  },
  async putDeletionReceipt(input) {
    return vaultSync.putDeletionReceipt(input);
  },
};

function selectedTargets(targets: ExternalErasureTarget[]): ExternalErasureTarget[] {
  return SUPPORTED_EXTERNAL_ERASURE_TARGETS.filter((target) => targets.includes(target));
}

async function fetchJson<T>(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetchImpl(url, init);
  if (!response.ok) {
    throw new Error(`External erasure request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function createExternalErasureId(now: Date): string {
  const randomPart = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
  return `external-erasure-${now.toISOString()}-${randomPart}`;
}

async function writeDeletionReceipt(
  client: ExternalErasureClient,
  input: Parameters<ExternalErasureClient["putDeletionReceipt"]>[0],
): Promise<DesktopVaultDeletionReceipt | null> {
  return client.putDeletionReceipt(input);
}

export async function planExternalErasure({
  targets,
  headers,
  fetchImpl = fetch,
}: {
  targets: ExternalErasureTarget[];
  headers?: HeadersInit;
  fetchImpl?: typeof fetch;
}): Promise<ExternalErasurePlan> {
  const selected = selectedTargets(targets);
  if (selected.length === 0) {
    throw new Error("Select at least one external erasure target.");
  }
  return fetchJson<ExternalErasurePlan>(fetchImpl, "/api/privacy/external-erasure-plan", {
    method: "POST",
    cache: "no-store",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(headers || {}),
    },
    body: JSON.stringify({ targets: selected }),
  });
}

export async function executeExternalErasure({
  userId,
  targets,
  headers,
  fetchImpl = fetch,
  client = defaultExternalErasureClient,
  now = () => new Date(),
}: {
  userId: string;
  targets: ExternalErasureTarget[];
  headers?: HeadersInit;
  fetchImpl?: typeof fetch;
  client?: ExternalErasureClient;
  now?: () => Date;
}): Promise<ExternalErasureResult> {
  const selected = selectedTargets(targets);
  if (selected.length === 0) {
    throw new Error("Select at least one external erasure target.");
  }

  const vaultStatus = await client.initializeVault(userId);
  if (!vaultStatus) {
    throw new Error("Ritual Desktop is required for external erasure receipts.");
  }

  const plan = await planExternalErasure({
    targets: selected,
    headers,
    fetchImpl,
  });
  if (!plan.deletes_cloud_data || !plan.requires_local_receipt) {
    throw new Error("External erasure plan did not include the required operation guards.");
  }

  const startedAt = now().toISOString();
  const erasureId = createExternalErasureId(new Date(startedAt));
  const runningReceipt = await writeDeletionReceipt(client, {
    userId,
    deletionId: erasureId,
    categories: selected,
    status: "running",
    sourceHash: erasureId,
    requestedRecordCount: selected.length,
    deletedCount: 0,
    backendReceipts: [],
    startedAt,
    completedAt: null,
    error: null,
  });
  if (!runningReceipt) {
    throw new Error("Local external erasure receipt could not be written.");
  }

  try {
    const response = await fetchJson<ExternalErasureExecuteResponse>(
      fetchImpl,
      "/api/privacy/external-erasure-execute",
      {
        method: "POST",
        cache: "no-store",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(headers || {}),
        },
        body: JSON.stringify({
          erasure_id: erasureId,
          local_receipt_id: erasureId,
          targets: selected,
          confirm_external_erasure: true,
        }),
      },
    );
    const completedReceipt = await writeDeletionReceipt(client, {
      userId,
      deletionId: erasureId,
      categories: selected,
      status: "completed",
      sourceHash: erasureId,
      requestedRecordCount: selected.length,
      deletedCount: response.deleted_count,
      backendReceipts: response.targets,
      startedAt,
      completedAt: response.completed_at,
      error: response.manual_required_count
        ? `${response.manual_required_count} targets require manual provider erasure.`
        : null,
    });
    return {
      erasureId,
      targets: selected,
      plan,
      response,
      receipt: completedReceipt,
    };
  } catch (error) {
    try {
      await writeDeletionReceipt(client, {
        userId,
        deletionId: erasureId,
        categories: selected,
        status: "failed",
        sourceHash: erasureId,
        requestedRecordCount: selected.length,
        deletedCount: 0,
        backendReceipts: [],
        startedAt,
        completedAt: now().toISOString(),
        error: error instanceof Error ? error.message : "External erasure failed.",
      });
    } catch {
      // Preserve the original erasure failure for the UI.
    }
    throw error;
  }
}
