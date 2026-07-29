'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useUser } from '@clerk/nextjs';

import { BrailleSpinner } from '@/components/ui/braille-spinner';

const AUTH_DEEP_LINK_OPENED_EVENT = 'desktop://auth-deep-link-opened';
const HANDOFF_TIMEOUT_MS = 5_000;

type HandoffStatus = 'preparing' | 'opening' | 'opened' | 'manual';

function buildDeepLink(ticket: string): string {
  const params = new URLSearchParams();
  params.set('ticket', ticket);
  return `com.ritual.desktop://auth/callback?${params.toString()}`;
}

async function createDesktopSignInTicket(): Promise<string> {
  const response = await fetch('/api/auth/desktop-sign-in-token', {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
  });

  const payload = await response.json().catch(() => ({})) as { ticket?: string; error?: string };

  if (!response.ok || !payload.ticket) {
    throw new Error(payload.error || 'Failed to create desktop sign-in handoff.');
  }

  return payload.ticket;
}

function DesktopOAuthBridgePageInner() {
  const searchParams = useSearchParams();
  const { isLoaded, user } = useUser();
  const [error, setError] = useState<string | null>(null);
  const [deepLinkHref, setDeepLinkHref] = useState<string | null>(null);
  const [handoffStatus, setHandoffStatus] = useState<HandoffStatus>('preparing');
  const startedRef = useRef(false);
  const manualFallbackTimerRef = useRef<number | null>(null);
  const providerError = useMemo(
    () => searchParams.get('error_description') || searchParams.get('error'),
    [searchParams],
  );

  const scheduleManualFallback = useCallback(() => {
    if (manualFallbackTimerRef.current !== null) {
      window.clearTimeout(manualFallbackTimerRef.current);
    }

    manualFallbackTimerRef.current = window.setTimeout(() => {
      setHandoffStatus((current) => (current === 'opened' ? current : 'manual'));
    }, HANDOFF_TIMEOUT_MS);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    void import('@tauri-apps/api/event')
      .then(async ({ listen }) => {
        if (cancelled) {
          return;
        }

        unlisten = await listen(AUTH_DEEP_LINK_OPENED_EVENT, () => {
          setHandoffStatus('opened');
          if (manualFallbackTimerRef.current !== null) {
            window.clearTimeout(manualFallbackTimerRef.current);
            manualFallbackTimerRef.current = null;
          }
        });
      })
      .catch(() => {
        // External browsers cannot import Tauri APIs; they use the manual fallback.
      });

    return () => {
      cancelled = true;
      unlisten?.();
      if (manualFallbackTimerRef.current !== null) {
        window.clearTimeout(manualFallbackTimerRef.current);
        manualFallbackTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (startedRef.current || !isLoaded) {
      return;
    }

    if (!user) {
      if (providerError) {
        queueMicrotask(() => setError(providerError));
        return;
      }

      queueMicrotask(() => setError('Browser sign-in completed without an authenticated Ritual session.'));
      return;
    }

    startedRef.current = true;

    const run = async () => {
      try {
        const ticket = await createDesktopSignInTicket();
        const nextDeepLink = buildDeepLink(ticket);
        setDeepLinkHref(nextDeepLink);
        setHandoffStatus('opening');
        scheduleManualFallback();
        window.setTimeout(() => {
          window.location.href = nextDeepLink;
        }, 120);
      } catch (ticketError) {
        startedRef.current = false;
        setError(ticketError instanceof Error ? ticketError.message : 'Failed to return to Ritual.');
      }
    };

    void run();
  }, [isLoaded, providerError, scheduleManualFallback, user]);

  const handleOpenRitual = useCallback(() => {
    setHandoffStatus('opening');
    scheduleManualFallback();
  }, [scheduleManualFallback]);

  if (error) {
    return (
      <main className="ritual-onboarding-font flex min-h-screen items-center justify-center bg-[#fcfcfa] px-6">
        <div className="w-full max-w-lg rounded-2xl border border-red-200 bg-red-50 p-8 text-[#1d1a16] shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-red-700">
            Ritual Desktop Auth
          </p>
          <h1 className="mt-4 text-2xl font-medium tracking-[-0.02em]">
            Ritual could not finish browser sign-in.
          </h1>
          <p className="mt-4 text-sm leading-6 text-red-900">
            {error}
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <button
              type="button"
              className="rounded-sm bg-black px-4 py-2 text-sm font-medium text-white"
              onClick={() => window.location.reload()}
            >
              Retry
            </button>
            <Link
              href="/sign-in"
              className="rounded-sm border border-gray-300 px-4 py-2 text-sm font-medium text-gray-900"
            >
              Back to sign-in
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="ritual-onboarding-font flex min-h-screen items-center justify-center bg-[#fcfcfa] px-6">
      <div className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        {handoffStatus === 'opened' ? null : (
          <BrailleSpinner className="mx-auto text-2xl text-gray-900" />
        )}
        <h1 className="mt-6 text-2xl font-medium text-gray-900">
          {handoffStatus === 'opened'
            ? 'Ritual opened'
            : handoffStatus === 'manual'
              ? 'Still returning to Ritual?'
              : 'Returning to Ritual…'}
        </h1>
        <p className="mt-3 text-sm leading-6 text-gray-600">
          {handoffStatus === 'opened'
            ? 'The desktop app received the sign-in handoff. You can close this window once Ritual finishes loading your dashboard.'
            : handoffStatus === 'manual'
              ? 'Your browser finished Apple or Google sign-in, but Ritual did not clearly confirm the handoff. Click Open Ritual again, then return to the desktop app.'
              : 'Your browser finished Apple or Google sign-in. Ritual should reopen automatically to complete authentication.'}
        </p>
        {deepLinkHref ? (
          <div className="mt-6 space-y-3">
            <a
              href={deepLinkHref}
              onClick={handleOpenRitual}
              className="inline-flex rounded-sm bg-black px-4 py-2 text-sm font-medium text-white"
            >
              Open Ritual
            </a>
            <p className="text-xs leading-5 text-gray-500">
              {handoffStatus === 'opened'
                ? 'If the desktop app is already on your dashboard, this page is no longer needed.'
                : 'If Ritual did not reopen automatically, click Open Ritual. You can close this tab after the desktop app reaches your dashboard.'}
            </p>
          </div>
        ) : null}
      </div>
    </main>
  );
}

export default function DesktopOAuthBridgePage() {
  return (
    <Suspense
      fallback={
        <main className="ritual-onboarding-font flex min-h-screen items-center justify-center bg-[#fcfcfa] px-6">
          <div className="text-center text-gray-900">
            <BrailleSpinner className="mx-auto text-2xl text-gray-900" />
            <p className="mt-4 text-sm text-gray-600">Preparing Ritual sign-in…</p>
          </div>
        </main>
      }
    >
      <DesktopOAuthBridgePageInner />
    </Suspense>
  );
}
