'use client';

import { getReadConsistencyHeaders } from '@/lib/read-consistency';
import { privacySettingsHeaders } from '@/lib/privacy/privacy-settings';
import {
  BackendClientError,
  createBackendClient,
  type BackendOperationId,
  type BackendOperationRequest,
  type BackendOperationResponse,
} from '@/lib/api/generated/backend-client';

function normalizeApiPath(path: string): string {
  if (path.startsWith('/api/')) return path;
  const trimmed = path.replace(/^\/+/, '');
  return `/api/${trimmed}`;
}

export type ApiFetchOptions = RequestInit & {
  userId?: string | null;
};

export async function apiFetchWithAuth(
  path: string,
  getToken: (opts?: { skipCache?: boolean }) => Promise<string | null>,
  options: ApiFetchOptions = {},
): Promise<Response> {
  const url = normalizeApiPath(path);
  const token = await getToken();
  if (!token) throw new Error('No auth token available');

  const buildInit = (authToken: string): RequestInit => ({
    ...options,
    headers: {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
      ...getReadConsistencyHeaders(options.userId),
      ...privacySettingsHeaders(),
      ...(options.headers ?? {}),
    },
  });

  let response = await fetch(url, buildInit(token));

  if ((response.status === 401 || response.status === 403) && url.includes('/api/')) {
    const freshToken = await getToken({ skipCache: true });
    if (freshToken) {
      response = await fetch(url, buildInit(freshToken));
    }
  }

  return response;
}

function dashboardBaseUrl(): string {
  if (typeof window !== 'undefined') return window.location.origin;
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost';
}

/**
 * Typed operation-ID boundary for generated FastAPI contracts.
 *
 * Authentication remains compatible with the existing dashboard helper:
 * one cached token is attempted, then a single fresh-token retry is allowed
 * for 401/403 responses.
 */
export async function apiOperationWithAuth<TOperation extends BackendOperationId>(
  operationId: TOperation,
  getToken: (opts?: { skipCache?: boolean }) => Promise<string | null>,
  request: BackendOperationRequest<TOperation> = {},
  userId?: string | null,
): Promise<BackendOperationResponse<TOperation>> {
  const execute = async (skipCache: boolean) => {
    const token = await getToken(skipCache ? { skipCache: true } : undefined);
    if (!token) throw new Error('No auth token available');
    const client = createBackendClient({
      baseUrl: dashboardBaseUrl(),
      getAuthHeaders: () => ({
        Authorization: `Bearer ${token}`,
        ...getReadConsistencyHeaders(userId),
        ...privacySettingsHeaders(),
      }),
    });
    return client.requestOperation(operationId, request);
  };

  try {
    return await execute(false);
  } catch (error) {
    if (error instanceof BackendClientError && (error.status === 401 || error.status === 403)) {
      return execute(true);
    }
    throw error;
  }
}

export async function apiOperation<TOperation extends BackendOperationId>(
  operationId: TOperation,
  request: BackendOperationRequest<TOperation> = {},
  options: {
    getToken?: (opts?: { skipCache?: boolean }) => Promise<string | null>;
    userId?: string | null;
  } = {},
): Promise<BackendOperationResponse<TOperation>> {
  if (options.getToken) {
    return apiOperationWithAuth(operationId, options.getToken, request, options.userId);
  }
  const client = createBackendClient({
    baseUrl: dashboardBaseUrl(),
    getAuthHeaders: () => ({
      ...getReadConsistencyHeaders(options.userId),
      ...privacySettingsHeaders(),
    }),
  });
  return client.requestOperation(operationId, request);
}
