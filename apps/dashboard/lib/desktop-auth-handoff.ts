import type { DesktopRuntimeInfo } from '@/lib/native-gateway';

const DESKTOP_AUTH_HANDOFF_STORAGE_KEY = 'ritual:desktop-auth-handoff:v2';

export type PendingDesktopAuthAcknowledgement = {
  handoffId: string;
};

export function storePendingDesktopAuthAcknowledgement(handoffId: string): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(
    DESKTOP_AUTH_HANDOFF_STORAGE_KEY,
    JSON.stringify({ handoffId } satisfies PendingDesktopAuthAcknowledgement),
  );
}

export function readPendingDesktopAuthAcknowledgement(): PendingDesktopAuthAcknowledgement | null {
  if (typeof window === 'undefined') return null;
  const raw = window.sessionStorage.getItem(DESKTOP_AUTH_HANDOFF_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PendingDesktopAuthAcknowledgement;
    return typeof parsed.handoffId === 'string' && parsed.handoffId
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function clearPendingDesktopAuthAcknowledgement(): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(DESKTOP_AUTH_HANDOFF_STORAGE_KEY);
}

function nativeMetadata(runtimeInfo: DesktopRuntimeInfo) {
  return {
    appVersion: runtimeInfo.version,
    buildSha: runtimeInfo.buildSha,
    bundleId: runtimeInfo.bundleId,
    target: runtimeInfo.target ?? null,
  };
}

export async function consumeDesktopAuthHandoff(input: {
  handoffId: string;
  nonce: string;
  channel: DesktopRuntimeInfo['channel'];
  protocol: '2';
  runtimeInfo: DesktopRuntimeInfo;
}): Promise<string> {
  const response = await fetch('/api/auth/desktop-sign-in-token', {
    method: 'PATCH',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      handoffId: input.handoffId,
      nonce: input.nonce,
      channel: input.channel,
      protocol: input.protocol,
      nativeMetadata: nativeMetadata(input.runtimeInfo),
    }),
  });
  const payload = await response.json().catch(() => ({})) as {
    ticket?: string;
    detail?: string;
    error?: string;
  };
  if (!response.ok || !payload.ticket) {
    throw new Error(payload.detail || payload.error || 'Desktop authentication handoff was rejected.');
  }
  return payload.ticket;
}

export async function acknowledgeDesktopAuthHandoff(
  runtimeInfo: DesktopRuntimeInfo,
  outcome: 'acknowledged' | 'failed' = 'acknowledged',
  failureCode?: string,
): Promise<boolean> {
  const pending = readPendingDesktopAuthAcknowledgement();
  if (!pending) return false;
  const response = await fetch('/api/auth/desktop-sign-in-token', {
    method: 'PUT',
    credentials: 'include',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      handoffId: pending.handoffId,
      outcome,
      failureCode: failureCode ?? null,
      nativeMetadata: nativeMetadata(runtimeInfo),
    }),
  });
  if (!response.ok) return false;
  clearPendingDesktopAuthAcknowledgement();
  return true;
}
