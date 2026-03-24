'use client'

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AuthenticateWithRedirectCallback } from '@clerk/nextjs';

import { BrailleSpinner } from '@/components/ui/braille-spinner';

type CallbackState =
  | { status: 'preparing'; message: string }
  | { status: 'ready' }
  | { status: 'error'; message: string };

function normalizeDeepLinkQuery(rawDeepLink: string | null): CallbackState {
  if (!rawDeepLink) {
    return { status: 'ready' };
  }

  try {
    const deepLinkUrl = new URL(decodeURIComponent(rawDeepLink));

    if (deepLinkUrl.protocol !== 'ritual:') {
      return {
        status: 'error',
        message: `Unexpected deep link protocol: ${deepLinkUrl.protocol}`,
      };
    }

    const normalizedQuery = deepLinkUrl.searchParams.toString();
    const normalizedUrl = normalizedQuery ? `/auth/callback?${normalizedQuery}` : '/auth/callback';
    window.history.replaceState({}, '', normalizedUrl);
    return { status: 'ready' };
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Invalid desktop auth callback payload.',
    };
  }
}

function AuthCallbackLoader({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="text-center">
        <BrailleSpinner className="mx-auto mb-4 h-12 w-12 text-4xl text-gray-900" />
        <p className="text-sm text-gray-600">{message}</p>
      </div>
    </div>
  );
}

function AuthCallbackError({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-6">
      <div className="w-full max-w-lg rounded-2xl border border-red-200 bg-red-50 p-8 text-[#1d1a16] shadow-sm">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-red-700">
          Ritual Desktop Auth
        </p>
        <h1 className="mt-4 text-2xl font-medium tracking-[-0.02em]">
          Ritual could not finish social sign-in.
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
            Retry callback
          </button>
          <Link
            href="/sign-in"
            className="rounded-sm border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900"
          >
            Back to sign-in
          </Link>
        </div>
      </div>
    </div>
  );
}

function AuthCallbackPageInner() {
  const searchParams = useSearchParams();
  const deepLink = useMemo(() => searchParams.get('deepLink'), [searchParams]);
  const [callbackState, setCallbackState] = useState<CallbackState>({
    status: 'preparing',
    message: 'Preparing desktop sign-in…',
  });

  useEffect(() => {
    setCallbackState(normalizeDeepLinkQuery(deepLink));
  }, [deepLink]);

  if (callbackState.status === 'error') {
    return <AuthCallbackError message={callbackState.message} />;
  }

  if (callbackState.status !== 'ready') {
    return <AuthCallbackLoader message={callbackState.message} />;
  }

  return (
    <>
      <AuthCallbackLoader message="Completing desktop sign-in…" />
      <AuthenticateWithRedirectCallback
        signInUrl="/sign-in"
        signUpUrl="/sign-up"
        firstFactorUrl="/sign-in"
        secondFactorUrl="/sign-in"
        resetPasswordUrl="/sign-in"
        continueSignUpUrl="/sign-up"
        verifyEmailAddressUrl="/sign-up"
        verifyPhoneNumberUrl="/sign-up"
      />
    </>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<AuthCallbackLoader message="Preparing desktop sign-in…" />}>
      <AuthCallbackPageInner />
    </Suspense>
  );
}
