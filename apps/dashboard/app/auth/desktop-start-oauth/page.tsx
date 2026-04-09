'use client'

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useSignIn, useSignUp, useUser } from '@clerk/nextjs';

import { BrailleSpinner } from '@/components/ui/braille-spinner';

type DesktopOAuthMode = 'sign_in' | 'sign_up';
type DesktopOAuthStrategy = 'oauth_google' | 'oauth_apple';

function isValidMode(value: string | null): value is DesktopOAuthMode {
  return value === 'sign_in' || value === 'sign_up';
}

function isValidStrategy(value: string | null): value is DesktopOAuthStrategy {
  return value === 'oauth_google' || value === 'oauth_apple';
}

function buildDesktopOAuthBridgeUrl(): string {
  return new URL('/auth/desktop-oauth-bridge', window.location.origin).toString();
}

function DesktopStartOAuthInner() {
  const searchParams = useSearchParams();
  const { isLoaded: signInLoaded, signIn } = useSignIn();
  const { isLoaded: signUpLoaded, signUp } = useSignUp();
  const { isLoaded: userLoaded, user } = useUser();
  const startedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const mode = searchParams.get('mode');
  const strategy = searchParams.get('strategy');

  const parsed = useMemo(() => {
    if (!isValidMode(mode)) {
      return { error: 'Missing or invalid desktop OAuth mode.' };
    }

    if (!isValidStrategy(strategy)) {
      return { error: 'Missing or invalid desktop OAuth provider.' };
    }

    return {
      mode,
      strategy,
      providerLabel: strategy === 'oauth_google' ? 'Google' : 'Apple',
    };
  }, [mode, strategy]);

  useEffect(() => {
    if ('error' in parsed || startedRef.current) {
      return;
    }

    const redirectParams = {
      strategy: parsed.strategy,
      redirectUrl: '/auth/desktop-oauth-bridge',
      redirectUrlComplete: '/auth/desktop-oauth-bridge',
      oidcPrompt: parsed.strategy === 'oauth_google' ? 'select_account' : undefined,
    } as const;

    const run = async () => {
      try {
        startedRef.current = true;

        if (!userLoaded) {
          startedRef.current = false;
          return;
        }

        if (user) {
          window.location.replace(buildDesktopOAuthBridgeUrl());
          return;
        }

        if (parsed.mode === 'sign_in') {
          if (!signInLoaded || !signIn) {
            startedRef.current = false;
            return;
          }
          await signIn.authenticateWithRedirect(redirectParams);
          return;
        }

        if (!signUpLoaded || !signUp) {
          startedRef.current = false;
          return;
        }

        await signUp.authenticateWithRedirect(redirectParams);
      } catch (oauthError) {
        startedRef.current = false;
        setError(oauthError instanceof Error ? oauthError.message : 'Failed to start desktop OAuth.');
      }
    };

    void run();
  }, [parsed, signInLoaded, signIn, signUpLoaded, signUp, userLoaded, user]);

  if ('error' in parsed || error) {
    const message = error ?? parsed.error;
    return (
      <main className="flex min-h-screen items-center justify-center bg-white px-6">
        <div className="w-full max-w-lg rounded-2xl border border-red-200 bg-red-50 p-8 text-[#1d1a16] shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-red-700">
            Ritual Desktop Auth
          </p>
          <h1 className="mt-4 text-2xl font-medium tracking-[-0.02em]">
            Ritual could not start social sign-in.
          </h1>
          <p className="mt-4 text-sm leading-6 text-red-900">
            {message}
          </p>
          <div className="mt-6 flex gap-3">
            <button
              type="button"
              className="rounded-sm bg-black px-4 py-2 text-sm font-medium text-white"
              onClick={() => window.location.reload()}
            >
              Retry
            </button>
            <Link
              href="/desktop-only"
              className="rounded-sm border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900"
            >
              Need help?
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-6">
      <div className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <BrailleSpinner className="mx-auto text-2xl text-gray-900" />
        <h1 className="mt-6 text-2xl font-medium text-gray-900">
          Opening {parsed.providerLabel} sign-in…
        </h1>
        <p className="mt-3 text-sm leading-6 text-gray-600">
          Your default browser is preparing the secure {parsed.providerLabel} sign-in flow for Ritual.
        </p>
      </div>
    </main>
  );
}

export default function DesktopStartOAuthPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-white px-6">
          <div className="text-center text-gray-900">
            <BrailleSpinner className="mx-auto text-2xl text-gray-900" />
            <p className="mt-4 text-sm text-gray-600">Preparing desktop sign-in…</p>
          </div>
        </main>
      }
    >
      <DesktopStartOAuthInner />
    </Suspense>
  );
}
