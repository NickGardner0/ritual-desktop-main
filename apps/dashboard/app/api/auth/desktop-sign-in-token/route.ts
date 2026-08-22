import { NextRequest, NextResponse } from 'next/server';
import { auth, clerkClient } from '@clerk/nextjs/server';

import { getBackendBaseUrl } from '@/lib/api/backend-url';
import { buildBackendAuthHeaders } from '@/lib/server/backend-auth';

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
  handoffId: string;
  nonce?: string;
  channel?: DesktopChannel;
  protocol?: '2';
  outcome?: 'acknowledged' | 'failed';
  failureCode?: string | null;
  nativeMetadata?: Record<string, string | null | undefined>;
};

function noStoreJson(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
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
    const { userId, getToken } = await auth();
    if (!userId) return noStoreJson({ error: 'Unauthorized' }, 401);

    const body = await request.json() as HandoffCreateBody;
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
  const body = await request.json() as HandoffActionBody;
  if (!body.handoffId || !body.nonce || !body.channel || body.protocol !== '2') {
    return noStoreJson({ error: 'Complete v2 handoff identity is required' }, 400);
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
  if (!result.ok) return noStoreJson(result.payload, result.status);
  const subject = typeof result.payload.user_id === 'string' ? result.payload.user_id : '';
  if (!subject) return noStoreJson({ error: 'Desktop handoff subject is unavailable' }, 502);
  try {
    const client = await clerkClient();
    const signInToken = await client.signInTokens.createSignInToken({
      userId: subject,
      expiresInSeconds: 5 * 60,
    });
    const handoff = { ...result.payload };
    delete handoff.user_id;
    return noStoreJson({ ticket: signInToken.token, handoff });
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
          failure_code: 'clerk_ticket_creation_failed',
          native_metadata: nativeMetadata(body),
        }),
      },
    ).catch(() => null);
    console.error('Desktop handoff was claimed but ticket creation failed:', error);
    return noStoreJson({ error: 'Desktop sign-in ticket creation failed' }, 502);
  }
}

export async function PUT(request: NextRequest) {
  const { userId, getToken } = await auth();
  if (!userId) return noStoreJson({ error: 'Unauthorized' }, 401);
  const body = await request.json() as HandoffActionBody;
  if (!body.handoffId || !body.outcome) {
    return noStoreJson({ error: 'handoffId and outcome are required' }, 400);
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
  return noStoreJson(result.payload, result.status);
}
