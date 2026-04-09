'use client'

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AuthenticateWithRedirectCallback, useUser, useSignIn } from '@clerk/nextjs';

import { BrailleSpinner } from '@/components/ui/braille-spinner';

type CallbackState =
  | { status: 'preparing'; message: string }
  | { status: 'redirect'; normalizedUrl: string }
  | { status: 'ticket'; normalizedUrl: string; ticket: string }
  | { status: 'error'; message: string };

function parseCallbackState(searchParams: URLSearchParams, rawDeepLink: string | null): CallbackState {
  try {
    const normalizedParams = new URLSearchParams();

    if (rawDeepLink) {
      const deepLinkUrl = new URL(decodeURIComponent(rawDeepLink));

      if (deepLinkUrl.protocol !== 'ritual:' && deepLinkUrl.protocol !== 'com.ritual.desktop:') {
        return {
          status: 'error',
          message: `Unexpected deep link protocol: ${deepLinkUrl.protocol}`,
        };
      }

      deepLinkUrl.searchParams.forEach((value, key) => {
        normalizedParams.append(key, value);
      });
    } else {
      searchParams.forEach((value, key) => {
        if (key !== 'deepLink') {
          normalizedParams.append(key, value);
        }
      });
    }

    const normalizedQuery = normalizedParams.toString();
    const normalizedUrl = normalizedQuery ? `/auth/callback?${normalizedQuery}` : '/auth/callback';
    const ticket = normalizedParams.get('ticket');

    if (ticket) {
      return { status: 'ticket', normalizedUrl, ticket };
    }

    return { status: 'redirect', normalizedUrl };
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

function extractClerkErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'object' && error !== null) {
    const maybeError = error as {
      errors?: Array<{ longMessage?: string; message?: string }>;
      message?: string;
    };

    const firstClerkError = maybeError.errors?.[0];
    if (firstClerkError?.longMessage) {
      return firstClerkError.longMessage;
    }

    if (firstClerkError?.message) {
      return firstClerkError.message;
    }

    if (typeof maybeError.message === 'string' && maybeError.message) {
      return maybeError.message;
    }
  }

  return 'Failed to activate desktop session.';
}

function isAlreadySignedInError(error: unknown): boolean {
  const message = extractClerkErrorMessage(error).toLowerCase();
  return message.includes('already signed in');
}

function TicketCallback({ ticket }: { ticket: string }) {
  const { isLoaded, signIn, setActive } = useSignIn();
  const { isLoaded: userLoaded, isSignedIn } = useUser();
  const startedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoaded || !userLoaded || startedRef.current) {
      return;
    }

    if (isSignedIn) {
      startedRef.current = true;
      window.location.replace('/auth/sso-callback');
      return;
    }

    startedRef.current = true;

    const run = async () => {
      try {
        const attempt = await signIn.create({
          strategy: 'ticket',
          ticket,
        });

        if (!attempt.createdSessionId) {
          throw new Error('Desktop sign-in completed without creating a Clerk session.');
        }

        await setActive({
          session: attempt.createdSessionId,
        });

        window.location.replace('/auth/sso-callback');
      } catch (ticketError) {
        if (isAlreadySignedInError(ticketError)) {
          window.location.replace('/auth/sso-callback');
          return;
        }

        startedRef.current = false;
        setError(extractClerkErrorMessage(ticketError));
      }
    };

    void run();
  }, [isLoaded, isSignedIn, setActive, signIn, ticket, userLoaded]);

  if (error) {
    return <AuthCallbackError message={error} />;
  }

  return <AuthCallbackLoader message="Completing desktop sign-in…" />;
}

function AuthCallbackPageInner() {
  const searchParams = useSearchParams();
  const deepLink = useMemo(() => searchParams.get('deepLink'), [searchParams]);
  const [callbackState, setCallbackState] = useState<CallbackState>({
    status: 'preparing',
    message: 'Preparing desktop sign-in…',
  });

  useEffect(() => {
    setCallbackState(parseCallbackState(new URLSearchParams(searchParams.toString()), deepLink));
  }, [deepLink, searchParams]);

  useEffect(() => {
    if (callbackState.status === 'redirect' || callbackState.status === 'ticket') {
      if (window.location.pathname + window.location.search !== callbackState.normalizedUrl) {
        window.history.replaceState({}, '', callbackState.normalizedUrl);
      }
    }
  }, [callbackState]);

  if (callbackState.status === 'error') {
    return <AuthCallbackError message={callbackState.message} />;
  }

  if (callbackState.status === 'preparing') {
    return <AuthCallbackLoader message={callbackState.message} />;
  }

  if (callbackState.status === 'ticket') {
    return <TicketCallback ticket={callbackState.ticket} />;
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
