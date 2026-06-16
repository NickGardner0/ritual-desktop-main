'use client';

import { getReadConsistencyHeaders } from '@/lib/read-consistency';

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function normalizeApiPath(path: string): string {
  if (path.startsWith('/api/')) return path;
  const trimmed = path.replace(/^\/+/, '');
  return `/api/${trimmed}`;
}

export type ApiFetchOptions = RequestInit & {
  userId?: string | null;
};

export async function apiFetch(path: string, options: ApiFetchOptions = {}): Promise<Response> {
  const { userId, headers, ...rest } = options;
  return fetch(normalizeApiPath(path), {
    cache: 'no-store',
    credentials: 'include',
    ...rest,
    headers: {
      ...getReadConsistencyHeaders(userId),
      ...(headers ?? {}),
    },
  });
}

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

export async function apiJson<T>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const response = await apiFetch(path, options);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new ApiError(response.status, text || `Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function apiJsonWithAuth<T>(
  path: string,
  getToken: (opts?: { skipCache?: boolean }) => Promise<string | null>,
  options: ApiFetchOptions = {},
): Promise<T> {
  const response = await apiFetchWithAuth(path, getToken, options);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new ApiError(response.status, text || `Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}
