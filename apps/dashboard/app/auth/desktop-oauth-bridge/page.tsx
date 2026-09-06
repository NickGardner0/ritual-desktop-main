'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useUser } from '@clerk/nextjs';

import { Button } from '@ritual/ui/button';
import { BrailleSpinner } from '@/components/ui/braille-spinner';

const NO_APP_AFTER_MS = 8_000;
const POLL_INTERVAL_MS = 1_000;

type HandoffStatus =
  | 'preparing'
  | 'pending'
  | 'no_app'
  | 'consumed'
  | 'acknowledged'
  | 'expired'
  | 'failed';

type HandoffIdentity = {
  handoffId: string;
  nonceChallenge: string;
  channel: 'production' | 'qa' | 'development';
  protocol: '2';
  expiresAtMs: number;
  appVersion: string;
  buildSha: string;
  bundleId: string;
  callbackScheme: string;
  target: string | null;
};

const CHANNEL_IDENTITIES: Record<HandoffIdentity['channel'], { bundleId: string; callbackScheme: string }> = {
  production: { bundleId: 'com.ritual.desktop', callbackScheme: 'com.ritual.desktop' },
  qa: { bundleId: 'com.ritual.desktop.qa', callbackScheme: 'com.ritual.desktop.qa' },
  development: { bundleId: 'com.ritual.desktop.dev', callbackScheme: 'com.ritual.desktop.dev' },
};

type HandoffRead = {
  id: string;
  status: 'pending' | 'consumed' | 'acknowledged' | 'expired' | 'failed';
  failure_code?: string | null;
};

function parseHandoff(searchParams: URLSearchParams): HandoffIdentity | null {
  const channel = searchParams.get('channel');
  const protocol = searchParams.get('protocol');
  const handoffId = searchParams.get('handoff_id')?.trim() || '';
  const nonceChallenge = searchParams.get('nonce_challenge')?.trim() || '';
  const callbackScheme = searchParams.get('callback_scheme')?.trim() || '';
  const bundleId = searchParams.get('bundle_id')?.trim() || '';
  const expiresAtMs = Number(searchParams.get('expires_at_ms'));
  const expectedIdentity = ['production', 'qa', 'development'].includes(channel || '')
    ? CHANNEL_IDENTITIES[channel as HandoffIdentity['channel']]
    : null;
  if (
    !expectedIdentity
    || protocol !== '2'
    || !/^dah_[A-Za-z0-9_-]{22}$/.test(handoffId)
    || !/^[0-9a-f]{64}$/.test(nonceChallenge)
    || callbackScheme !== expectedIdentity.callbackScheme
    || bundleId !== expectedIdentity.bundleId
    || !Number.isFinite(expiresAtMs)
    || expiresAtMs <= Date.now()
  ) return null;
  return {
    handoffId,
    nonceChallenge,
    channel: channel as HandoffIdentity['channel'],
    protocol,
    expiresAtMs,
    appVersion: searchParams.get('app_version') || 'unknown',
    buildSha: searchParams.get('build_sha') || 'unknown',
    bundleId,
    callbackScheme,
    target: searchParams.get('target'),
  };
}

function buildDeepLink(identity: HandoffIdentity): string {
  const params = new URLSearchParams({
    handoff_id: identity.handoffId,
    channel: identity.channel,
    protocol: identity.protocol,
  });
  return `${identity.callbackScheme}://auth/callback?${params.toString()}`;
}

async function createDesktopSignInHandoff(identity: HandoffIdentity) {
  const response = await fetch('/api/auth/desktop-sign-in-token', {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(identity),
  });
  const payload = await response.json().catch(() => ({})) as {
    handoff?: HandoffRead;
    error?: string;
    detail?: string;
  };
  if (!response.ok || payload.handoff?.id !== identity.handoffId) {
    throw new Error(payload.error || payload.detail || 'Failed to create desktop sign-in handoff.');
  }
  return { handoff: payload.handoff };
}

async function readHandoffStatus(handoffId: string): Promise<HandoffRead> {
  const response = await fetch(
    `/api/auth/desktop-sign-in-token?handoff_id=${encodeURIComponent(handoffId)}`,
    { credentials: 'include', cache: 'no-store' },
  );
  const payload = await response.json().catch(() => ({})) as HandoffRead & { detail?: string };
  if (!response.ok) throw new Error(payload.detail || 'Failed to read desktop handoff status.');
  return payload;
}

function DesktopOAuthBridgePageInner() {
  const searchParams = useSearchParams();
  const { isLoaded, user } = useUser();
  const identity = useMemo(
    () => parseHandoff(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );
  const [error, setError] = useState<string | null>(null);
  const [deepLinkHref, setDeepLinkHref] = useState<string | null>(null);
  const [handoffId, setHandoffId] = useState<string | null>(null);
  const [handoffStatus, setHandoffStatus] = useState<HandoffStatus>('preparing');
  const startedRef = useRef(false);
  const providerError = searchParams.get('error_description') || searchParams.get('error');

  useEffect(() => {
    if (!handoffId || ['acknowledged', 'expired', 'failed'].includes(handoffStatus)) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const latest = await readHandoffStatus(handoffId);
        if (!cancelled) {
          setHandoffStatus((current) => (
            latest.status === 'pending' && current === 'no_app' ? current : latest.status
          ));
        }
      } catch (pollError) {
        if (!cancelled) setError(pollError instanceof Error ? pollError.message : 'Handoff status failed.');
      }
    };
    void poll();
    const interval = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [handoffId, handoffStatus]);

  useEffect(() => {
    if (handoffStatus !== 'pending') return;
    const timer = window.setTimeout(() => setHandoffStatus('no_app'), NO_APP_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [handoffStatus]);

  useEffect(() => {
    if (startedRef.current || !isLoaded) return;
    if (!identity) {
      queueMicrotask(() => setError('This sign-in request is missing its secure desktop identity. Start again from Ritual.'));
      return;
    }
    if (!user) {
      queueMicrotask(() => setError(providerError || 'Browser sign-in completed without an authenticated Ritual session.'));
      return;
    }
    startedRef.current = true;
    void createDesktopSignInHandoff(identity)
      .then(({ handoff }) => {
        const nextDeepLink = buildDeepLink(identity);
        setHandoffId(handoff.id);
        setDeepLinkHref(nextDeepLink);
        setHandoffStatus('pending');
        window.setTimeout(() => { window.location.href = nextDeepLink; }, 120);
      })
      .catch((handoffError) => {
        startedRef.current = false;
        setError(handoffError instanceof Error ? handoffError.message : 'Failed to return to Ritual.');
      });
  }, [identity, isLoaded, providerError, user]);

  const handleOpenRitual = useCallback(() => {
    setHandoffStatus('pending');
  }, []);

  if (error) {
    return (
      <main className="ritual-onboarding-font flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
        <div className="w-full max-w-lg rounded-2xl border border-destructive/30 bg-destructive/5 p-8 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-destructive">Ritual Desktop Auth</p>
          <h1 className="mt-4 text-2xl font-medium tracking-[-0.02em]">Ritual could not finish browser sign-in.</h1>
          <p className="mt-4 text-sm leading-6 text-destructive">{error}</p>
          <div className="mt-6 flex justify-center gap-3">
            <Button onClick={() => window.location.reload()}>Retry</Button>
            <Button asChild variant="outline"><Link href="/sign-in">Back to sign-in</Link></Button>
          </div>
        </div>
      </main>
    );
  }

  const terminal = handoffStatus === 'acknowledged';
  const title = terminal
    ? 'Ritual confirmed your sign-in'
    : handoffStatus === 'expired'
      ? 'This sign-in request expired'
      : handoffStatus === 'failed'
        ? 'Ritual could not complete sign-in'
        : handoffStatus === 'no_app'
          ? 'Ritual has not answered yet'
          : handoffStatus === 'consumed'
            ? 'Ritual is finishing sign-in…'
            : 'Returning to Ritual…';

  return (
    <main className="ritual-onboarding-font flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        {terminal ? null : <BrailleSpinner className="mx-auto text-2xl" />}
        <h1 className="mt-6 text-2xl font-medium">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {terminal
            ? 'The intended desktop app acknowledged the handoff. You can close this browser tab.'
            : handoffStatus === 'consumed'
              ? 'The correct Ritual channel consumed the one-time request. Waiting for its authenticated session acknowledgement.'
              : handoffStatus === 'expired'
                ? 'Return to the Ritual app and begin sign-in again.'
                : handoffStatus === 'failed'
                  ? 'The app rejected or could not complete this request. Return to Ritual and try again.'
                  : handoffStatus === 'no_app'
                    ? 'No compatible Ritual app has consumed this request. Open the intended app or try the button below.'
                    : 'Your browser finished sign-in. Waiting for the intended Ritual app to consume and acknowledge the request.'}
        </p>
        {deepLinkHref && ['pending', 'no_app'].includes(handoffStatus) ? (
          <div className="mt-6">
            <Button asChild><a href={deepLinkHref} onClick={handleOpenRitual}>Open Ritual</a></Button>
          </div>
        ) : null}
      </div>
    </main>
  );
}

export default function DesktopOAuthBridgePage() {
  return (
    <Suspense fallback={<main className="flex min-h-screen items-center justify-center bg-background"><BrailleSpinner /></main>}>
      <DesktopOAuthBridgePageInner />
    </Suspense>
  );
}
