import { getBackendBaseUrl } from './backend-url';

export async function serverBackendFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const base = getBackendBaseUrl();
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return fetch(`${base}${normalizedPath}`, {
    cache: 'no-store',
    ...init,
  });
}
