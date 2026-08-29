import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

import { getBackendBaseUrl } from '@/lib/api/backend-url';
import { desktopWebviewCorsHeaders } from '@/lib/server/desktop-webview-cors';
import { buildBackendAuthHeaders } from '@/lib/server/backend-auth';
import {
  mintDesktopClerkSession,
  refreshDesktopClerkSession,
} from '@/lib/server/desktop-clerk-session';

type DesktopChannel = 'production' | 'qa' | 'development';

type HandoffCreateBody = {
  handoffId: string;
  nonceChallenge: string;
  channel: DesktopChannel;
  protocol: '2';
  expiresAtMs: number;
  appVersion?: string;
  buildSha?: string;
  bundleId?: string;
  callbackScheme?: string;
  target?: string | null;
};

const CHANNEL_IDENTITIES: Record<DesktopChannel, { bundleId: string; callbackScheme: string }> = {
  production: { bundleId: 'com.ritual.desktop', callbackScheme: 'com.ritual.desktop' },
  qa: { bundleId: 'com.ritual.desktop.qa', callbackScheme: 'com.ritual.desktop.qa' },
  development: { bundleId: 'com.ritual.desktop.dev', callbackScheme: 'com.ritual.desktop.dev' },
};

type HandoffActionBody = {
  handoffId?: string;
  nonce?: string;
  channel?: DesktopChannel;
  protocol?: '2';
  sessionId?: string;
  action?: 'refresh';
  outcome?: 'acknowledged' | 'failed';
  failureCode?: string | null;
  nativeMetadata?: Record<string, string | null | undefined>;
};

function isDesktopSessionRefreshBody(body: unknown): body is { sessionId: string } {
  if (!body || typeof body !== 'object') return false;
  const candidate = body as HandoffActionBody;
  const sessionId = typeof candidate.sessionId === 'string' ? candidate.sessionId.trim() : '';
  const handoffId = typeof candidate.handoffId === 'string' ? candidate.handoffId.trim() : '';
  return Boolean(sessionId) && !handoffId;
}

async function desktopSessionRefreshResponse(sessionId: string, request?: NextRequest) {
  try {
    return noStoreJson(await refreshDesktopClerkSession(sessionId), 200, request);
  } catch (error) {
    console.error('Desktop session JWT refresh failed:', error);
    return noStoreJson({ error: 'Desktop session refresh failed' }, 401, request);
  }
}

function noStoreJson(payload: unknown, status = 200, request?: NextRequest) {
  const response = NextResponse.json(payload, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
  const cors = desktopWebviewCorsHeaders(request?.headers.get('origin'));
  if (cors) {
    for (const [key, value] of Object.entries(cors)) {
      response.headers.set(key, value);
    }
  }
  return response;
}

export async function OPTIONS(request: NextRequest) {
  const cors = desktopWebviewCorsHeaders(request.headers.get('origin')) ?? {};
  return new NextResponse(null, { status: 204, headers: cors });
}

async function backendJson(
  path: string,
  init: RequestInit,
): Promise<{ ok: boolean; status: number; payload: Record<string, unknown> }> {
  const response = await fetch(`${getBackendBaseUrl()}${path}`, {
    ...init,
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  return { ok: response.ok, status: response.status, payload };
}

function nativeMetadata(body: HandoffCreateBody | HandoffActionBody) {
  const source = 'nativeMetadata' in body && body.nativeMetadata
    ? body.nativeMetadata
    : (() => {
        const createBody = body as HandoffCreateBody;
        return {
          appVersion: createBody.appVersion,
          buildSha: createBody.buildSha,
          bundleId: createBody.bundleId,
          target: createBody.target,
        };
      })();
  return {
    app_version: source?.appVersion ?? null,
    build_sha: source?.buildSha ?? null,
    bundle_id: source?.bundleId ?? null,
    target: source?.target ?? null,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as HandoffCreateBody & HandoffActionBody;
    if (isDesktopSessionRefreshBody(body)) {
      return desktopSessionRefreshResponse(body.sessionId, request);
    }

    const { userId, getToken } = await auth();
    if (!userId) return noStoreJson({ error: 'Unauthorized' }, 401);

    const expectedIdentity = CHANNEL_IDENTITIES[body.channel];
    const remainingSeconds = Math.ceil((Number(body.expiresAtMs) - Date.now()) / 1000);
    if (
      !expectedIdentity
      || body.protocol !== '2'
      || !/^dah_[A-Za-z0-9_-]{22}$/.test(body.handoffId || '')
      || !/^[0-9a-f]{64}$/.test(body.nonceChallenge || '')
      || body.bundleId !== expectedIdentity.bundleId
      || body.callbackScheme !== expectedIdentity.callbackScheme
      || !body.appVersion?.trim()
      || !body.buildSha?.trim()
      || remainingSeconds < 30
    ) {
      return noStoreJson({ error: 'Desktop handoff identity is invalid or expired' }, 400);
    }
    const token = await getToken();
    const created = await backendJson('/api/desktop-auth/handoffs', {
      method: 'POST',
      headers: buildBackendAuthHeaders({ userId, token }),
      body: JSON.stringify({
        id: body.handoffId,
        nonce_challenge: body.nonceChallenge,
        channel: body.channel,
        protocol: body.protocol,
        expires_in_seconds: Math.min(300, remainingSeconds),
        native_metadata: nativeMetadata(body),
      }),
    });
    if (!created.ok) return noStoreJson(created.payload, created.status);
    return noStoreJson({ handoff: created.payload });
  } catch (error) {
    console.error('Failed to create desktop sign-in handoff:', error);
    return noStoreJson({ error: 'Failed to create desktop sign-in handoff' }, 500);
  }
}

export async function GET(request: NextRequest) {
  const { userId, getToken } = await auth();
  if (!userId) return noStoreJson({ error: 'Unauthorized' }, 401);
  const handoffId = request.nextUrl.searchParams.get('handoff_id')?.trim();
  if (!handoffId) return noStoreJson({ error: 'handoff_id is required' }, 400);
  const token = await getToken();
  const result = await backendJson(`/api/desktop-auth/handoffs/${encodeURIComponent(handoffId)}`, {
    method: 'GET',
    headers: buildBackendAuthHeaders({ userId, token, contentType: '' }),
  });
  return noStoreJson(result.payload, result.status);
}

export async function PATCH(request: NextRequest) {
  const json = (payload: unknown, status = 200) => noStoreJson(payload, status, request);
  const body = await request.json() as HandoffActionBody;
  if (isDesktopSessionRefreshBody(body)) {
    return desktopSessionRefreshResponse(body.sessionId, request);
  }
  if (!body.handoffId || !body.nonce || !body.channel || body.protocol !== '2') {
    return json({ error: 'Complete v2 handoff identity is required' }, 400);
  }
  const result = await backendJson(
    `/api/desktop-auth/handoffs/${encodeURIComponent(body.handoffId)}/consume`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nonce: body.nonce,
        channel: body.channel,
        protocol: body.protocol,
        native_metadata: nativeMetadata(body),
      }),
    },
  );
  if (!result.ok) return json(result.payload, result.status);
  const subject = typeof result.payload.user_id === 'string' ? result.payload.user_id : '';
  if (!subject) return json({ error: 'Desktop handoff subject is unavailable' }, 502);
  try {
    const minted = await mintDesktopClerkSession(subject);
    const handoff = { ...result.payload };
    delete handoff.user_id;
    return json({ ...minted, handoff });
  } catch (error) {
    await backendJson(
      `/api/desktop-auth/handoffs/${encodeURIComponent(body.handoffId)}/claim-failed`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nonce: body.nonce,
          channel: body.channel,
          protocol: body.protocol,
          failure_code: 'clerk_session_creation_failed',
          native_metadata: nativeMetadata(body),
        }),
      },
    ).catch(() => null);
    console.error('Desktop handoff was claimed but session JWT creation failed:', error);
    return json({ error: 'Desktop sign-in session creation failed' }, 502);
  }
}

export async function PUT(request: NextRequest) {
  const json = (payload: unknown, status = 200) => noStoreJson(payload, status, request);
  const { userId, getToken } = await auth();
  if (!userId) return json({ error: 'Unauthorized' }, 401);
  const body = await request.json() as HandoffActionBody;
  if (!body.handoffId || !body.outcome) {
    return json({ error: 'handoffId and outcome are required' }, 400);
  }
  const token = await getToken();
  const result = await backendJson(
    `/api/desktop-auth/handoffs/${encodeURIComponent(body.handoffId)}/acknowledge`,
    {
      method: 'POST',
      headers: buildBackendAuthHeaders({ userId, token }),
      body: JSON.stringify({
        outcome: body.outcome,
        failure_code: body.failureCode ?? null,
        native_metadata: nativeMetadata(body),
      }),
    },
  );
  return json(result.payload, result.status);
}
