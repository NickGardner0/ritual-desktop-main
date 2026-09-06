import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Button } from '@ritual/ui/button';
import { AuthFlowIntent } from '@/components/auth-flow-intent';
import { ClerkOAuthHandler } from '@/components/clerk-oauth-handler';
import {
  getDesktopHostedOrigin,
  buildDesktopOAuthStartUrl,
  type DesktopOAuthMode,
  type DesktopOAuthStrategy,
} from '@/lib/desktop-auth-origin';
import {
  desktopBeginAuthHandoff,
  desktopCompleteAuthHandoff,
  desktopGetAuthToken,
  desktopPollAuthHandoff,
  openInBrowserFromDesktopAuth,
  recordDesktopShellEvent,
} from '@/lib/native-gateway';
import { useAuth } from '@/lib/desktop-session';
import { useRouter } from '@/lib/app-navigation';
import { storePendingDesktopAuthAcknowledgement } from '@/lib/desktop-auth-handoff';
import {
  clearFromWelcomeFlow,
  clearSignUpIntent,
  markDeviceAuthenticated,
} from '@/lib/onboarding-flow';
import { initializeDesktopVault } from '@/lib/privacy/vault-client';

const DEVELOPMENT_HANDOFF_POLL_MS = 1_000;

const HOME_WELCOME_LOGO_PX = 36;
const welcomeHeadingStyle: CSSProperties = {
  fontSize: '28px',
  lineHeight: '1.2',
  WebkitFontSmoothing: 'antialiased',
  letterSpacing: '-0.01em',
  fontWeight: 500,
};

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
  return handoff;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function isPendingDevelopmentHandoff(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return message.includes('handoff not found')
    || message.includes('request failed')
    || message.includes('network')
    || message.includes('fetch');
}

async function consumeDevelopmentHandoff(
  handoff: Awaited<ReturnType<typeof startDesktopOAuth>>,
): Promise<void> {
  let lastError: unknown = null;
  while (Date.now() < handoff.expiresAtMs) {
    try {
      await desktopPollAuthHandoff();
      await desktopCompleteAuthHandoff(handoff.handoffId);
      storePendingDesktopAuthAcknowledgement(handoff.handoffId);
      return;
    } catch (error) {
      lastError = error;
      if (!isPendingDevelopmentHandoff(error)) throw error;
      await wait(DEVELOPMENT_HANDOFF_POLL_MS);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Ritual Dev sign-in expired. Please try again.');
}

export function DesktopAuthPage({ mode }: { mode: DesktopOAuthMode }) {
  const { getToken } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLogoSpinning, setIsLogoSpinning] = useState(false);
  const logoRef = useRef<HTMLImageElement>(null);
  const hostedOrigin = getDesktopHostedOrigin();

  useEffect(() => {
    const logo = logoRef.current;
    if (!logo) return;
    const handleLogoClick = (event: MouseEvent) => {
      event.stopPropagation();
      event.preventDefault();
      setIsLogoSpinning((current) => !current);
    };
    logo.addEventListener('click', handleLogoClick, true);
    return () => logo.removeEventListener('click', handleLogoClick, true);
  }, []);

  const launch = async (strategy: DesktopOAuthStrategy) => {
    setError(null);
    setBusy(true);
    try {
      const handoff = await startDesktopOAuth(mode, strategy);
      if (handoff.channel === 'development') {
        await consumeDevelopmentHandoff(handoff);
        await getToken();
        markDeviceAuthenticated();
        clearFromWelcomeFlow();
        clearSignUpIntent();
        const session = await desktopGetAuthToken({ refresh: false });
        if (session?.userId) {
          await initializeDesktopVault(session.userId);
        }
        void recordDesktopShellEvent('desktop.auth_handoff.development_poll_succeeded', 'info', {
          mode,
          protocol: handoff.protocol,
        });
        router.replace('/dashboard');
      }
    } catch (launchError) {
      const message = launchError instanceof Error ? launchError.message : String(launchError);
      void recordDesktopShellEvent('desktop.auth_oauth.launch_failed', 'error', {
        mode,
        strategy,
        error: message,
      });
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="welcome-page relative flex min-h-screen flex-col bg-[var(--surface-window)] glass-opaque-screen"
      style={{ fontFamily: 'var(--ritual-selected-font-family)' }}
    >
      <div data-tauri-drag-region className="fixed top-0 left-0 z-50 h-16 w-full" />
      <AuthFlowIntent mode={mode} />
      <ClerkOAuthHandler mode={mode} desktopMode />
      <main className="flex flex-1 flex-col items-center justify-center px-6">
        <img
          ref={logoRef}
          src="/images/eclipse.svg"
          alt="Ritual Logo"
          width={HOME_WELCOME_LOGO_PX}
          height={HOME_WELCOME_LOGO_PX}
          className="mb-5 cursor-pointer"
          style={{
            transform: isLogoSpinning ? 'rotate(360deg)' : 'rotate(0deg)',
            transition: 'transform 500ms ease-in-out',
          }}
        />
        <h1 className="mb-6 text-[var(--text-primary)]" style={welcomeHeadingStyle}>
          Welcome to Ritual
        </h1>
        <Button
          type="button"
          variant="brand"
          className="rounded-full px-10"
          disabled={busy}
          onClick={() => void launch('oauth_google')}
        >
          {busy ? 'Opening…' : 'Sign in'}
        </Button>
        {error ? (
          <p className="mt-4 max-w-sm text-center text-sm text-[var(--ritual-status-danger)]" role="alert">
            {error}
          </p>
        ) : null}
      </main>
      <footer className="py-8 text-center">
        <p className="text-sm text-[var(--text-muted)]" style={{ fontWeight: 400 }}>
          By signing in you agree to our{' '}
          <a
            href={`${hostedOrigin}/terms`}
            className="underline text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors duration-200"
          >
            Terms of service
          </a>
          {' '}&{' '}
          <a
            href={`${hostedOrigin}/privacy`}
            className="underline text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors duration-200"
          >
            Privacy policy
          </a>
        </p>
      </footer>
    </div>
  );
}
