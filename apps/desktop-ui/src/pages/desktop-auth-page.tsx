import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Button } from '@ritual/ui/button';
import { AuthFlowIntent } from '@/components/auth-flow-intent';
import { ClerkOAuthHandler } from '@/components/clerk-oauth-handler';
import { hasDeviceAuthenticated } from '@/lib/onboarding-flow';
import {
  getDesktopHostedOrigin,
  buildDesktopOAuthStartUrl,
  type DesktopOAuthMode,
  type DesktopOAuthStrategy,
} from '@/lib/desktop-auth-origin';
import {
  desktopBeginAuthHandoff,
  openInBrowserFromDesktopAuth,
  recordDesktopShellEvent,
} from '@/lib/native-gateway';

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
}

export function DesktopAuthPage({ mode }: { mode: DesktopOAuthMode }) {
  const [oauthMode, setOauthMode] = useState<DesktopOAuthMode>(mode);
  const [step, setStep] = useState<'welcome' | 'providers'>('welcome');
  const [busyStrategy, setBusyStrategy] = useState<DesktopOAuthStrategy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLogoSpinning, setIsLogoSpinning] = useState(false);
  const [isReturningUser] = useState(() => hasDeviceAuthenticated());
  const logoRef = useRef<HTMLImageElement>(null);
  const hostedOrigin = getDesktopHostedOrigin();
  const showGetStarted = mode === 'sign_up' || !isReturningUser;

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

  const openProviders = (nextMode: DesktopOAuthMode) => {
    setError(null);
    setOauthMode(nextMode);
    setStep('providers');
  };

  const launch = async (strategy: DesktopOAuthStrategy) => {
    setError(null);
    setBusyStrategy(strategy);
    try {
      await startDesktopOAuth(oauthMode, strategy);
    } catch (launchError) {
      const message = launchError instanceof Error ? launchError.message : String(launchError);
      void recordDesktopShellEvent('desktop.auth_oauth.launch_failed', 'error', {
        mode: oauthMode,
        strategy,
        error: message,
      });
      setError(message);
    } finally {
      setBusyStrategy(null);
    }
  };

  return (
    <div
      className="welcome-page relative flex min-h-screen flex-col bg-white glass-opaque-screen"
      style={{ fontFamily: 'var(--ritual-selected-font-family)' }}
    >
      <div data-tauri-drag-region className="fixed top-0 left-0 z-50 h-16 w-full" />
      <AuthFlowIntent mode={oauthMode} />
      <ClerkOAuthHandler mode={oauthMode} desktopMode={step === 'providers'} />
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
        <h1
          className={`text-gray-900 ${step === 'welcome' ? 'mb-8' : 'mb-3'}`}
          style={welcomeHeadingStyle}
        >
          Welcome to Ritual
        </h1>
        {step === 'welcome' ? (
          <button
            type="button"
            onClick={() => openProviders(showGetStarted ? 'sign_up' : 'sign_in')}
            className="inline-flex items-center justify-center bg-black text-white px-10 py-2 rounded-sm shadow transition-colors duration-200 text-sm font-medium hover:bg-[#27251E]"
            style={{ fontWeight: 500 }}
          >
            {showGetStarted ? 'Get Started' : 'Sign In'}
          </button>
        ) : (
          <>
            <p className="mb-8 max-w-sm text-center text-sm leading-6 text-[#737373]">
              Continue in your browser. Google and Apple never run inside this window.
            </p>
            <div className="flex w-full max-w-xs flex-col gap-2">
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
          </>
        )}
        {error ? (
          <p className="mt-4 max-w-sm text-center text-sm text-[#8b2e2e]" role="alert">
            {error}
          </p>
        ) : null}
      </main>
      <footer className="py-8 text-center">
        <p className="text-sm text-[#737373]" style={{ fontWeight: 400 }}>
          By signing in you agree to our{' '}
          <a
            href={`${hostedOrigin}/terms`}
            className="underline text-[#737373] hover:text-[#525252] transition-colors duration-200"
          >
            Terms of service
          </a>
          {' '}&{' '}
          <a
            href={`${hostedOrigin}/privacy`}
            className="underline text-[#737373] hover:text-[#525252] transition-colors duration-200"
          >
            Privacy policy
          </a>
        </p>
      </footer>
    </div>
  );
}
