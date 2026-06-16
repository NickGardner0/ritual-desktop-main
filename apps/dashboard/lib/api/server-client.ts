import { getBackendBaseUrl } from './backend-url';

export function getServerBackendBaseUrl(): string {
  return getBackendBaseUrl();
}

export async function serverBackendFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const base = getServerBackendBaseUrl();
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return fetch(`${base}${normalizedPath}`, {
    cache: 'no-store',
    ...init,
  });
}
