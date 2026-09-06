"use client";

import {
  BackendClientError,
  createBackendClient,
  type BackendOperationId,
  type BackendOperationRequest,
  type BackendOperationResponse,
} from "@/lib/api/generated/backend-client";

function dashboardOrigin(): string {
  if (typeof window !== "undefined") return window.location.origin;
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost";
}

function headersRecord(headers?: HeadersInit): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  const record: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value == null) continue;
    record[key] = String(value);
  }
  return record;
}

export async function privacyBackendOperation<TOperation extends BackendOperationId>(
  fetchImpl: typeof fetch,
  fallbackUrl: string,
  fallbackInit: RequestInit,
  operationId: TOperation,
  request: BackendOperationRequest<TOperation>,
  failMessage: string,
): Promise<BackendOperationResponse<TOperation>> {
  if (fetchImpl !== fetch) {
    const response = await fetchImpl(fallbackUrl, fallbackInit);
    if (!response.ok) {
      throw new Error(`${failMessage}: ${response.status}`);
    }
    return response.json() as Promise<BackendOperationResponse<TOperation>>;
  }

  try {
    const client = createBackendClient({
      baseUrl: dashboardOrigin(),
      getAuthHeaders: () => headersRecord(fallbackInit.headers),
    });
    return await client.requestOperation(operationId, request);
  } catch (error) {
    if (error instanceof BackendClientError) {
      throw new Error(`${failMessage}: ${error.status}`);
    }
    throw error;
  }
}
