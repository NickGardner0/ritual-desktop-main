export const DESKTOP_RUNTIME_BRIDGE_POLL_MS = 10_000;
export const DESKTOP_RUNTIME_BRIDGE_OVERVIEW_POLL_MS = 60_000;
export const DESKTOP_AUTH_TOKEN_REFRESH_MS = 45_000;
export const COMPUTER_HISTORY_BACKFILL_DAYS = 3650;
export const COMPUTER_HISTORY_BACKFILL_DELAY_MS = 20_000;
export const COMPUTER_HISTORY_BACKFILL_THROTTLE_MS = 12 * 60 * 60 * 1000;
export const COMPUTER_HISTORY_BACKFILL_LAST_KEY = 'ritual:computer-history-backfill:last:v1';
const HOSTED_DESKTOP_BACKEND_BASE = 'https://backend-api-production-a37e.up.railway.app';

export interface RuntimeBridgeSignalsResponse {
  token_refresh_request?: number;
  dashboard_refresh_trigger?: number;
}

export type DesktopBridgeMode = 'probing' | 'native' | 'legacy';

export function resolveDesktopBackendBase(): string {
  const configured = (
    process.env.NEXT_PUBLIC_RITUAL_BACKEND_BASE_URL
    || process.env.VITE_PYTHON_API_URL
    || process.env.NEXT_PUBLIC_PYTHON_API_URL
  )?.trim();
  if (configured) {
    return configured.replace(/\/$/, '');
  }
  return HOSTED_DESKTOP_BACKEND_BASE;
}
