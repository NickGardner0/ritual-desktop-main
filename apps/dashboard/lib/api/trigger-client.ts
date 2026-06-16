import { getBackendBaseUrl } from './backend-url';

export function getTriggerBackendBaseUrl(): string {
  return getBackendBaseUrl();
}

export async function triggerBackendFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const base = getTriggerBackendBaseUrl();
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return fetch(`${base}${normalizedPath}`, {
    cache: 'no-store',
    ...init,
  });
}
