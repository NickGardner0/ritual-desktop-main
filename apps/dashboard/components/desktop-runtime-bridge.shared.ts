export const DESKTOP_RUNTIME_BRIDGE_POLL_MS = 10_000;
export const DESKTOP_RUNTIME_BRIDGE_OVERVIEW_POLL_MS = 60_000;
export const DESKTOP_AUTH_TOKEN_REFRESH_MS = 45_000;
export const COMPUTER_HISTORY_BACKFILL_DAYS = 3650;
export const COMPUTER_HISTORY_BACKFILL_DELAY_MS = 20_000;
export const COMPUTER_HISTORY_BACKFILL_THROTTLE_MS = 12 * 60 * 60 * 1000;
export const COMPUTER_HISTORY_BACKFILL_LAST_KEY = 'ritual:computer-history-backfill:last:v1';
const LOCAL_DESKTOP_BACKEND_BASE = `${'http'}://${['127', '0', '0', '1'].join('.')}:${8000}`;
const HOSTED_DESKTOP_BACKEND_BASE = 'https://backend-api-production-a37e.up.railway.app';

function isLocalDashboardHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

export interface RuntimeBridgeSignalsResponse {
  token_refresh_request?: number;
  dashboard_refresh_trigger?: number;
}

export type DesktopBridgeMode = 'probing' | 'native' | 'legacy';

export function resolveDesktopBackendBase(
  hostname = typeof window === 'undefined' ? 'localhost' : window.location.hostname,
): string {
  const configured = process.env.NEXT_PUBLIC_RITUAL_BACKEND_BASE_URL?.trim();
  if (configured) {
    return configured.replace(/\/$/, '');
  }
  if (!isLocalDashboardHost(hostname)) {
    return HOSTED_DESKTOP_BACKEND_BASE;
  }
  return LOCAL_DESKTOP_BACKEND_BASE;
}
