import { useState } from 'react';
import { ClerkLoaded, ClerkLoading, SignIn, SignUp } from '@clerk/clerk-react';
import { Button } from '@ritual/ui/button';
import { AuthFlowIntent } from '@/components/auth-flow-intent';
import { ClerkOAuthHandler } from '@/components/clerk-oauth-handler';
import {
  buildDesktopOAuthStartUrl,
  type DesktopOAuthMode,
  type DesktopOAuthStrategy,
} from '@/lib/desktop-auth-origin';
import {
  desktopBeginAuthHandoff,
  openInBrowserFromDesktopAuth,
  recordDesktopShellEvent,
} from '@/lib/native-gateway';

const clerkAppearance = {
  variables: {
    borderRadius: '0.125rem',
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
    fontFamilyButtons: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  },
  elements: {
    rootBox: 'mx-auto',
    card: 'shadow-sm rounded-sm',
    formButtonPrimary: 'rounded-sm',
    socialButtonsBlockButton: 'rounded-sm',
    formFieldInput: 'rounded-sm',
  },
} as const;

async function startDesktopOAuth(mode: DesktopOAuthMode, strategy: DesktopOAuthStrategy) {
  const handoff = await desktopBeginAuthHandoff();
  if (!handoff) {
    throw new Error('The installed Ritual app does not support secure browser handoff.');
  }
  const oauthStartUrl = buildDesktopOAuthStartUrl(mode, strategy, handoff);
  void recordDesktopShellEvent('desktop.auth_oauth.launch_requested', 'info', {
    mode,
    strategy,
    channel: handoff.channel,
    protocol: handoff.protocol,
  });
  await openInBrowserFromDesktopAuth(oauthStartUrl);
}

export function DesktopAuthPage({ mode }: { mode: DesktopOAuthMode }) {
  const [busyStrategy, setBusyStrategy] = useState<DesktopOAuthStrategy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isSignIn = mode === 'sign_in';

  const launch = async (strategy: DesktopOAuthStrategy) => {
    setError(null);
    setBusyStrategy(strategy);
    try {
      await startDesktopOAuth(mode, strategy);
    } catch (launchError) {
      const message = launchError instanceof Error ? launchError.message : String(launchError);
      void recordDesktopShellEvent('desktop.auth_oauth.launch_failed', 'error', {
        mode,
        strategy,
        error: message,
      });
      setError(message);
    } finally {
      setBusyStrategy(null);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#fcfcfa] px-4 py-12">
      <div className="w-full max-w-md">
        <AuthFlowIntent mode={mode} />
        <ClerkOAuthHandler mode={mode} desktopMode />
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#7a7a7a]">
          Ritual
        </p>
        <h1 className="mt-3 text-[22px] font-medium tracking-[-0.02em] text-[#111111]">
          {isSignIn ? 'Sign in to Ritual' : 'Create your Ritual account'}
        </h1>
        <p className="mt-2 text-sm leading-6 text-[#666666]">
          Continue in your browser. This window stays local; Google and Apple never run inside the desktop webview.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <Button
            type="button"
            variant="default"
            className="w-full rounded-sm"
            disabled={busyStrategy !== null}
            onClick={() => void launch('oauth_google')}
          >
            {busyStrategy === 'oauth_google' ? 'Opening Google…' : 'Continue with Google'}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full rounded-sm"
            disabled={busyStrategy !== null}
            onClick={() => void launch('oauth_apple')}
          >
            {busyStrategy === 'oauth_apple' ? 'Opening Apple…' : 'Continue with Apple'}
          </Button>
        </div>
        {error ? (
          <p className="mt-4 text-sm text-[#8b2e2e]" role="alert">
            {error}
          </p>
        ) : null}
        <div className="mt-8 flex justify-center">
          <ClerkLoading>
            <p className="text-sm text-[#7a7a7a]">Loading email sign-in…</p>
          </ClerkLoading>
          <ClerkLoaded>
            {isSignIn ? (
              <SignIn
                appearance={clerkAppearance}
                routing="path"
                path="/sign-in"
                signUpUrl="/sign-up"
                forceRedirectUrl="/auth/sso-callback"
                fallbackRedirectUrl="/auth/sso-callback"
              />
            ) : (
              <SignUp
                appearance={clerkAppearance}
                routing="path"
                path="/sign-up"
                signInUrl="/sign-in"
                forceRedirectUrl="/auth/sso-callback"
                fallbackRedirectUrl="/auth/sso-callback"
              />
            )}
          </ClerkLoaded>
        </div>
      </div>
    </main>
  );
}
