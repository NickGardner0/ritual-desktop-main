import { getDesktopAuthHandoffApiUrl } from '@/lib/desktop-auth-origin';
import { invokeDesktopCommand } from '@/lib/desktop-bridge/commands';
import { isDesktopTauriRuntime } from '@/lib/desktop-bridge/environment';
import type { DesktopRuntimeInfo } from '@/lib/desktop-bridge/runtime';

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

function isMissingNativeConsumeCommand(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return message.includes('not allowed')
    || message.includes('unknown command')
    || message.includes('command not found')
    || message.includes('does not exist');
}

async function consumeDesktopAuthHandoffViaHostedApi(input: {
  handoffId: string;
  nonce: string;
  channel: DesktopRuntimeInfo['channel'];
  protocol: '2';
  runtimeInfo: DesktopRuntimeInfo;
}): Promise<string> {
  const response = await fetch(getDesktopAuthHandoffApiUrl(), {
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

export async function consumeDesktopAuthHandoff(input: {
  handoffId: string;
  nonce: string;
  channel: DesktopRuntimeInfo['channel'];
  protocol: '2';
  runtimeInfo: DesktopRuntimeInfo;
}): Promise<string> {
  if (isDesktopTauriRuntime()) {
    try {
      const ticket = await invokeDesktopCommand('desktop_consume_auth_handoff', {
        handoffId: input.handoffId,
        nonce: input.nonce,
        channel: input.channel,
        protocol: input.protocol,
        nativeMetadata: nativeMetadata(input.runtimeInfo),
      });
      if (typeof ticket === 'string' && ticket.trim()) {
        return ticket;
      }
      throw new Error('Desktop authentication handoff did not return a ticket.');
    } catch (error) {
      if (!isMissingNativeConsumeCommand(error)) {
        throw error;
      }
    }
  }
  return consumeDesktopAuthHandoffViaHostedApi(input);
}

export async function acknowledgeDesktopAuthHandoff(
  runtimeInfo: DesktopRuntimeInfo,
  outcome: 'acknowledged' | 'failed' = 'acknowledged',
  failureCode?: string,
): Promise<boolean> {
  const pending = readPendingDesktopAuthAcknowledgement();
  if (!pending) return false;
  const response = await fetch(getDesktopAuthHandoffApiUrl(), {
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
