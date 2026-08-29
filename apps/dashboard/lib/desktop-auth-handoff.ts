import { getDesktopAuthHandoffApiUrl } from '@/lib/desktop-auth-origin';
import { invokeDesktopCommand } from '@/lib/desktop-bridge/commands';
import { isDesktopTauriRuntime } from '@/lib/desktop-bridge/environment';
import { desktopSetAuthToken } from '@/lib/desktop-bridge/runtime';
import type { DesktopRuntimeInfo } from '@/lib/desktop-bridge/runtime';

const DESKTOP_AUTH_HANDOFF_STORAGE_KEY = 'ritual:desktop-auth-handoff:v2';

export type PendingDesktopAuthAcknowledgement = {
  handoffId: string;
};

export type DesktopAuthHandoffConsumeResult = {
  sessionId: string;
  userId: string;
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

function sessionFromPayload(payload: {
  accessToken?: string;
  sessionId?: string;
  userId?: string;
  profile?: unknown;
  ticket?: string;
}): DesktopAuthHandoffConsumeResult {
  if (payload.ticket && !payload.accessToken) {
    throw new Error('Desktop authentication handoff returned a ticket instead of a session JWT.');
  }
  if (!payload.accessToken || !payload.sessionId || !payload.userId) {
    throw new Error('Desktop authentication handoff did not return a session JWT.');
  }
  return { sessionId: payload.sessionId, userId: payload.userId };
}

async function consumeDesktopAuthHandoffViaHostedApi(input: {
  handoffId: string;
  nonce: string;
  channel: DesktopRuntimeInfo['channel'];
  protocol: '2';
  runtimeInfo: DesktopRuntimeInfo;
}): Promise<DesktopAuthHandoffConsumeResult> {
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
    accessToken?: string;
    sessionId?: string;
    userId?: string;
    profile?: unknown;
    ticket?: string;
    detail?: string;
    error?: string;
  };
  if (!response.ok) {
    throw new Error(payload.detail || payload.error || 'Desktop authentication handoff was rejected.');
  }
  const session = sessionFromPayload(payload);
  await desktopSetAuthToken({
    token: payload.accessToken!,
    userId: payload.userId,
    sessionId: payload.sessionId,
    profile: payload.profile ?? null,
  });
  return session;
}

export async function consumeDesktopAuthHandoff(input: {
  handoffId: string;
  nonce: string;
  channel: DesktopRuntimeInfo['channel'];
  protocol: '2';
  runtimeInfo: DesktopRuntimeInfo;
}): Promise<DesktopAuthHandoffConsumeResult> {
  if (isDesktopTauriRuntime()) {
    try {
      const result = await invokeDesktopCommand('desktop_consume_auth_handoff', {
        handoffId: input.handoffId,
        nonce: input.nonce,
        channel: input.channel,
        protocol: input.protocol,
        nativeMetadata: nativeMetadata(input.runtimeInfo),
      }) as { sessionId?: string; userId?: string; token?: string; ticket?: string };
      if (result && typeof result === 'object' && result.sessionId && result.userId) {
        return { sessionId: result.sessionId, userId: result.userId };
      }
      throw new Error('Desktop authentication handoff did not return a session JWT.');
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
