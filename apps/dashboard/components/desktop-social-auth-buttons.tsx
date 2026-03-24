'use client';

import { useMemo, useState } from 'react';
import { useSignIn, useSignUp } from '@clerk/nextjs';

import { openInBrowser } from '@/lib/tauri-utils';
import { FROM_WELCOME_KEY } from '@/lib/onboarding-flow';

type DesktopSocialAuthButtonsProps = {
  mode: 'sign-in' | 'sign-up';
  className?: string;
};

type DesktopProvider = 'google' | 'apple';

function buildBridgeUrl(): string {
  return new URL('/auth/desktop-oauth-bridge', window.location.origin).toString();
}

function buildClerkCallbackUrl(): string {
  return new URL('/auth/callback', window.location.origin).toString();
}

function providerLabel(provider: DesktopProvider): string {
  return provider === 'google' ? 'Continue with Google' : 'Continue with Apple';
}

export function DesktopSocialAuthButtons({
  mode,
  className,
}: DesktopSocialAuthButtonsProps) {
  const { isLoaded: signInLoaded, signIn } = useSignIn();
  const { isLoaded: signUpLoaded, signUp } = useSignUp();
  const [pendingProvider, setPendingProvider] = useState<DesktopProvider | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const ready = useMemo(() => {
    return mode === 'sign-in' ? signInLoaded && Boolean(signIn) : signUpLoaded && Boolean(signUp);
  }, [mode, signIn, signInLoaded, signUp, signUpLoaded]);

  async function startDesktopOAuth(provider: DesktopProvider) {
    if (!ready) {
      return;
    }

    setPendingProvider(provider);
    setErrorMessage(null);

    try {
      const strategy = `oauth_${provider}` as const;
      const redirectUrl = buildClerkCallbackUrl();
      const redirectUrlComplete = buildBridgeUrl();

      if (mode === 'sign-up') {
        window.localStorage.setItem(FROM_WELCOME_KEY, 'true');
      } else {
        window.localStorage.removeItem(FROM_WELCOME_KEY);
      }

      if (mode === 'sign-in') {
        await signIn!.authenticateWithRedirect({
          strategy,
          redirectUrl,
          redirectUrlComplete,
        });
      } else {
        await signUp!.authenticateWithRedirect({
          strategy,
          redirectUrl,
          redirectUrlComplete,
        });
        return;
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Desktop social sign-in failed to start.',
      );
      setPendingProvider(null);
      return;
    }
  }

  return (
    <div className={className}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {(['apple', 'google'] as const).map((provider) => {
          const isPending = pendingProvider === provider;
          return (
            <button
              key={provider}
              type="button"
              disabled={!ready || pendingProvider !== null}
              onClick={() => {
                void startDesktopOAuth(provider);
              }}
              className="rounded-sm border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-900 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending ? `Opening ${provider === 'google' ? 'Google' : 'Apple'}…` : providerLabel(provider)}
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-xs leading-5 text-gray-500">
        Apple and Google sign-in open in your default browser and return to Ritual automatically.
      </p>
      {errorMessage ? (
        <p className="mt-3 rounded-sm border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
