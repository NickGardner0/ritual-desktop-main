'use client';

import { useState } from 'react';
import { useSignIn, useSignUp } from '@clerk/nextjs';

type AuthMode = 'sign-in' | 'sign-up';
type SocialProvider = 'google' | 'apple';

const AUTH_CALLBACK_PATH = '/auth/callback';
const AUTH_COMPLETE_PATH = '/auth/sso-callback';

function GoogleMark() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24">
      <path
        d="M21.6 12.23c0-.68-.06-1.34-.18-1.98H12v3.74h5.39a4.62 4.62 0 0 1-2 3.03v2.52h3.23c1.9-1.75 2.98-4.33 2.98-7.31Z"
        fill="#4285F4"
      />
      <path
        d="M12 22c2.7 0 4.97-.9 6.63-2.45l-3.23-2.52c-.9.6-2.05.95-3.4.95-2.61 0-4.83-1.76-5.62-4.13H3.04v2.6A10 10 0 0 0 12 22Z"
        fill="#34A853"
      />
      <path
        d="M6.38 13.85A5.98 5.98 0 0 1 6.07 12c0-.64.11-1.26.31-1.85v-2.6H3.04A10 10 0 0 0 2 12c0 1.61.39 3.13 1.04 4.45l3.34-2.6Z"
        fill="#FBBC04"
      />
      <path
        d="M12 6.02c1.47 0 2.8.5 3.84 1.48l2.88-2.88C16.97 2.98 14.7 2 12 2a10 10 0 0 0-8.96 5.55l3.34 2.6C7.17 7.78 9.39 6.02 12 6.02Z"
        fill="#EA4335"
      />
    </svg>
  );
}

function AppleMark() {
  return (
    <svg aria-hidden="true" className="h-4 w-4 fill-current" viewBox="0 0 24 24">
      <path d="M16.7 12.72c.02 2.14 1.88 2.85 1.9 2.86-.02.05-.3 1.03-.98 2.03-.59.86-1.2 1.72-2.16 1.74-.94.02-1.25-.56-2.33-.56-1.08 0-1.43.54-2.31.58-.92.03-1.61-.92-2.21-1.78-1.22-1.76-2.15-4.97-.9-7.14.62-1.08 1.73-1.77 2.94-1.79.9-.02 1.75.61 2.33.61.57 0 1.64-.75 2.76-.64.47.02 1.8.19 2.65 1.43-.07.04-1.58.92-1.57 2.66Zm-1.92-5.76c.49-.6.82-1.42.73-2.24-.71.03-1.58.47-2.09 1.07-.45.52-.85 1.36-.74 2.16.79.06 1.61-.4 2.1-.99Z" />
    </svg>
  );
}

export function DesktopSocialAuthButtons({ mode }: { mode: AuthMode }) {
  const { isLoaded: isSignInLoaded, signIn } = useSignIn();
  const { isLoaded: isSignUpLoaded, signUp } = useSignUp();
  const [pendingProvider, setPendingProvider] = useState<SocialProvider | null>(null);

  const isLoaded = mode === 'sign-in' ? isSignInLoaded : isSignUpLoaded;

  const startOAuth = async (provider: SocialProvider) => {
    if (!isLoaded) {
      return;
    }

    setPendingProvider(provider);

    try {
      const params = {
        strategy: provider === 'google' ? 'oauth_google' : 'oauth_apple',
        redirectUrl: AUTH_CALLBACK_PATH,
        redirectUrlComplete: AUTH_COMPLETE_PATH,
        ...(provider === 'google' ? { oidcPrompt: 'select_account' } : {}),
      } as const;

      if (mode === 'sign-in') {
        await signIn?.authenticateWithRedirect({
          ...params,
          continueSignIn: true,
        });
        return;
      }

      await signUp?.authenticateWithRedirect({
        ...params,
        continueSignUp: true,
      });
    } catch (error) {
      console.error(`Failed to start ${provider} OAuth`, error);
      setPendingProvider(null);
    }
  };

  const disabled = !isLoaded || pendingProvider !== null;

  return (
    <div className="mb-6 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => startOAuth('apple')}
          disabled={disabled}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-sm border border-gray-300 bg-white px-4 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <AppleMark />
          <span>{pendingProvider === 'apple' ? 'Opening...' : 'Apple'}</span>
        </button>
        <button
          type="button"
          onClick={() => startOAuth('google')}
          disabled={disabled}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-sm border border-gray-300 bg-white px-4 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <GoogleMark />
          <span>{pendingProvider === 'google' ? 'Opening...' : 'Google'}</span>
        </button>
      </div>
      <p className="text-center text-xs text-gray-500">
        Google sign-in will always ask which account to use.
      </p>
    </div>
  );
}
