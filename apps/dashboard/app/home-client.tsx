"use client";

import { useUser, useAuth } from '@clerk/nextjs';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useRef, type CSSProperties } from 'react';
import Link from 'next/link';
import {
  ONBOARDING_HOME_WINDOW_HEIGHT,
  ONBOARDING_HOME_WINDOW_WIDTH,
  restoreDashboardWindowSize,
  setOnboardingWindowSize,
} from '@/lib/tauri-utils';
import { useDesktopCapabilities } from '@/lib/desktop-capabilities';
import { BrailleSpinner } from '@/components/ui/braille-spinner';
import {
  hasDeviceAuthenticated,
  hasPendingSignUpIntent,
  markDeviceAuthenticated,
} from '@/lib/onboarding-flow';
import { resolveSsoRedirectRoute } from '@/lib/activation-flow.mjs';

const BFF_API_BASE = 'BFF /api';
const ONBOARDING_V3_STEP_KEY = 'ritual:onboarding-v3-step';

/** Shared “Welcome to Ritual” hero on Get Started + Sign In home */
const HOME_WELCOME_LOGO_PX = 36;
const homeWelcomeHeadingStyle: CSSProperties = {
  fontSize: '28px',
  lineHeight: '1.2',
  WebkitFontSmoothing: 'antialiased',
  letterSpacing: '-0.01em',
  fontWeight: 500,
};

export function HomeClient() {
  const { isDesktop } = useDesktopCapabilities();
  const { isSignedIn, isLoaded, user } = useUser();
  const { getToken } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const lastCheckedUserIdRef = useRef<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isLogoSpinning, setIsLogoSpinning] = useState(false);
  const logoRef = useRef<HTMLImageElement>(null);
  
  // Welcome flow state
  const pageParam = searchParams.get('page');
  const authMode = searchParams.get('mode');
  const [isNewUser, setIsNewUser] = useState<boolean | null>(() => (hasDeviceAuthenticated() ? null : true));
  const [showStartupDiagnostics, setShowStartupDiagnostics] = useState(false);
  const [desktopLaunchGraceExpired, setDesktopLaunchGraceExpired] = useState(false);
  const desktopApp = typeof window !== 'undefined' && isDesktop;
  const isDesktopLaunch = desktopApp && Boolean(searchParams.get('ritual_desktop_env'));

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!isDesktop) return;
    if (isLoaded && !isChecking) {
      queueMicrotask(() => setShowStartupDiagnostics(false));
      return;
    }

    const timer = window.setTimeout(() => {
      setShowStartupDiagnostics(true);
    }, 8000);

    return () => window.clearTimeout(timer);
  }, [isDesktop, isLoaded, isChecking]);

  useEffect(() => {
    const hasExplicitWelcomeIntent = Boolean(pageParam) || authMode === 'signup' || hasPendingSignUpIntent();
    const shouldHoldReturningDesktopHome = (
      isDesktopLaunch
      && isLoaded
      && !isSignedIn
      && !hasExplicitWelcomeIntent
      && hasDeviceAuthenticated()
    );

    if (!shouldHoldReturningDesktopHome) {
      queueMicrotask(() => setDesktopLaunchGraceExpired(false));
      return;
    }

    const timer = window.setTimeout(() => {
      setDesktopLaunchGraceExpired(true);
    }, 3500);

    return () => window.clearTimeout(timer);
  }, [authMode, isDesktopLaunch, isLoaded, isSignedIn, pageParam]);

  // Attach click handler directly to logo via DOM
  useEffect(() => {
    const logo = logoRef.current;
    if (!logo) return;

    const handleLogoClick = (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      setIsLogoSpinning(prev => !prev);
    };

    logo.addEventListener('click', handleLogoClick, true);
    return () => logo.removeEventListener('click', handleLogoClick, true);
  }, []);

  // Only the guided onboarding flow owns window sizing. Returning users keep
  // whatever dashboard size they chose.
  useEffect(() => {
    if (isNewUser) {
      void setOnboardingWindowSize(ONBOARDING_HOME_WINDOW_HEIGHT, ONBOARDING_HOME_WINDOW_WIDTH);
    }
  }, [isNewUser]);

  // Determine if new user or returning user
  useEffect(() => {
    if (!isLoaded) return;

    const hadDeviceAuthenticated = hasDeviceAuthenticated();

    if (isSignedIn && user?.id) {
      markDeviceAuthenticated();
    }

    if (!isSignedIn || !user?.id) {
      lastCheckedUserIdRef.current = null;
    }

    const hasSeenWelcome = hadDeviceAuthenticated;
    const hasExplicitWelcomeIntent = Boolean(pageParam) || authMode === 'signup' || hasPendingSignUpIntent();
    
    // Not signed in
    if (!isSignedIn) {
      // New user - show welcome flow
      if (!hasSeenWelcome || hasExplicitWelcomeIntent) {
        queueMicrotask(() => setIsNewUser(true));
        return;
      }
      // Returning user - show simple home page
      queueMicrotask(() => setIsNewUser(false));
      return;
    }

    // User is signed in - check if they need onboarding
    if (!user) {
      return;
    }

    if (lastCheckedUserIdRef.current === user.id) {
      return;
    }

    lastCheckedUserIdRef.current = user.id;
    queueMicrotask(() => setIsChecking(true));

    const restoreDashboardOnRedirect = hasPendingSignUpIntent();

    const checkAndRedirect = async () => {
      try {
        await new Promise(resolve => setTimeout(resolve, 100));

        const token = await getToken().catch((err) => {
          console.error('Token fetch error:', err);
          return null;
        });

        if (!token) {
          router.replace('/sign-in');
          return;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch('/api/user/bootstrap', {
          cache: 'no-store',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'X-Ritual-Force-Fresh': '1',
          },
          signal: controller.signal
        }).catch((err) => {
          console.error('Bootstrap fetch error:', err);
          return null;
        }).finally(() => clearTimeout(timeoutId));

        if (response && response.ok) {
          const bootstrap = await response.json();
          const redirectRoute = resolveSsoRedirectRoute(bootstrap?.nextRoute, undefined);
          if (restoreDashboardOnRedirect && redirectRoute.startsWith('/dashboard')) {
            await restoreDashboardWindowSize();
          }
          router.replace(redirectRoute);
        } else {
          router.replace('/sign-in');
        }
      } catch (error) {
        console.error('Error checking bootstrap:', error);
        router.replace('/sign-in');
      }
    };

    checkAndRedirect();
  }, [authMode, getToken, isLoaded, isNewUser, isSignedIn, pageParam, router, user]);

  const startSignup = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(ONBOARDING_V3_STEP_KEY, 'signup');
    }
    router.push('/onboarding?s=signup');
  };

  // Show loading while checking auth state for signed-in users
  if (isSignedIn && isChecking) {
    if (showStartupDiagnostics) {
      return (
        <div className="min-h-screen bg-white glass-opaque-screen flex items-center justify-center px-6">
          <div className="w-full max-w-xl rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
            <h1 className="text-xl font-medium text-gray-900">Desktop startup is still waiting.</h1>
            <p className="mt-3 text-sm leading-6 text-gray-600">
              Ritual reached the hosted app, but the signed-in startup check did not finish.
            </p>
            <dl className="mt-6 space-y-2 text-sm text-gray-700">
              <div className="flex gap-2">
                <dt className="min-w-[150px] font-medium text-gray-500">Clerk loaded</dt>
                <dd>{String(isLoaded)}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="min-w-[150px] font-medium text-gray-500">Signed in</dt>
                <dd>{String(isSignedIn)}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="min-w-[150px] font-medium text-gray-500">Checking profile</dt>
                <dd>{String(isChecking)}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="min-w-[150px] font-medium text-gray-500">Backend API</dt>
                <dd className="break-all">{BFF_API_BASE}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="min-w-[150px] font-medium text-gray-500">Current URL</dt>
                <dd className="break-all">{typeof window !== 'undefined' ? window.location.href : ''}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="min-w-[150px] font-medium text-gray-500">User agent</dt>
                <dd className="break-all">{typeof window !== 'undefined' ? window.navigator.userAgent : ''}</dd>
              </div>
            </dl>
            <div className="mt-6 flex gap-3">
              <button
                onClick={() => window.location.reload()}
                className="rounded-sm bg-black px-4 py-2 text-sm font-medium text-white"
              >
                Reload
              </button>
              <Link
                href="/sign-in"
                className="rounded-sm border border-gray-300 px-4 py-2 text-sm font-medium text-gray-900"
              >
                Open sign-in
              </Link>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-white glass-opaque-screen flex items-center justify-center">
        <BrailleSpinner className="text-2xl text-gray-900" />
      </div>
    );
  }

  // Still determining user type
  if (isNewUser === null) {
    if (showStartupDiagnostics) {
      return (
        <div className="min-h-screen bg-white glass-opaque-screen flex items-center justify-center px-6">
          <div className="w-full max-w-xl rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
            <h1 className="text-xl font-medium text-gray-900">Desktop auth did not finish loading.</h1>
            <p className="mt-3 text-sm leading-6 text-gray-600">
              Ritual is still waiting for the initial Clerk session state inside the desktop webview.
            </p>
            <dl className="mt-6 space-y-2 text-sm text-gray-700">
              <div className="flex gap-2">
                <dt className="min-w-[150px] font-medium text-gray-500">Clerk loaded</dt>
                <dd>{String(isLoaded)}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="min-w-[150px] font-medium text-gray-500">Signed in</dt>
                <dd>{String(isSignedIn)}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="min-w-[150px] font-medium text-gray-500">Tauri detected</dt>
                <dd>{String(typeof window !== 'undefined' ? isDesktop : false)}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="min-w-[150px] font-medium text-gray-500">Current URL</dt>
                <dd className="break-all">{typeof window !== 'undefined' ? window.location.href : ''}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="min-w-[150px] font-medium text-gray-500">User agent</dt>
                <dd className="break-all">{typeof window !== 'undefined' ? window.navigator.userAgent : ''}</dd>
              </div>
            </dl>
            <div className="mt-6 flex gap-3">
              <button
                onClick={() => window.location.reload()}
                className="rounded-sm bg-black px-4 py-2 text-sm font-medium text-white"
              >
                Reload
              </button>
              <Link
                href="/sign-in"
                className="rounded-sm border border-gray-300 px-4 py-2 text-sm font-medium text-gray-900"
              >
                Open sign-in
              </Link>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-white glass-opaque-screen flex items-center justify-center">
        <BrailleSpinner className="text-2xl text-gray-900" />
      </div>
    );
  }

  // NEW USER: Show the first welcome screen, then continue into the v3 onboarding signup/card sequence.
  if (isNewUser) {
    return (
      <div className="min-h-screen bg-white glass-opaque-screen flex flex-col relative welcome-page" style={{ fontFamily: "var(--ritual-selected-font-family)" }}>
        <style jsx global>{`
          .welcome-page [class*="user"], 
          .welcome-page [class*="profile"],
          .welcome-page [class*="avatar"] {
            display: none !important;
          }
        `}</style>

        {/* Window Drag Region */}
        <div
          data-tauri-drag-region
          className="fixed top-0 left-0 w-full h-12 z-50"
        />

        {/* Main Content */}
        <div className="flex-1 flex items-center justify-center">
          <div className="w-full max-w-2xl px-8 text-center">
            <div className="animate-in fade-in duration-500 flex flex-col items-center">
              <div className="mb-5">
                <img
                  ref={logoRef}
                  src="/images/eclipse.svg"
                  alt="Ritual Logo"
                  width={HOME_WELCOME_LOGO_PX}
                  height={HOME_WELCOME_LOGO_PX}
                  className="cursor-pointer"
                  style={{
                    transform: isLogoSpinning ? 'rotate(360deg)' : 'rotate(0deg)',
                    transition: 'transform 500ms ease-in-out'
                  }}
                />
              </div>
              <h1 className="text-gray-900 mb-8" style={homeWelcomeHeadingStyle}>
                Welcome to Ritual
              </h1>
            </div>

            <div className="flex items-center justify-center">
              <button
                onClick={startSignup}
                className="inline-flex items-center justify-center bg-black text-white px-10 py-2 rounded-sm shadow transition-colors duration-200 text-sm font-medium hover:bg-[#27251E]"
                style={{ fontWeight: 500 }}
              >
                Get Started
              </button>
            </div>
          </div>
        </div>

        <footer className="py-8 text-center">
          <p className="text-sm text-[#737373]" style={{ fontWeight: 400 }}>
            By signing in you agree to our{' '}
            <a href="/terms" className="underline text-[#737373] hover:text-[#525252] transition-colors duration-200">
              Terms of service
            </a>
            {' '}&{' '}
            <a href="/privacy" className="underline text-[#737373] hover:text-[#525252] transition-colors duration-200">
              Privacy policy
            </a>
          </p>
        </footer>
      </div>
    );
  }

  if (
    isNewUser === false
    && isDesktopLaunch
    && !desktopLaunchGraceExpired
    && !isSignedIn
  ) {
    return (
      <div className="min-h-screen bg-white glass-opaque-screen flex items-center justify-center">
        <BrailleSpinner className="text-2xl text-gray-900" />
      </div>
    );
  }

  // RETURNING USER: Show simple home page with Sign In
  return (
    <div className="min-h-screen bg-white glass-opaque-screen relative flex flex-col" style={{ fontFamily: "var(--ritual-selected-font-family)" }}>
      {/* Window Drag Region */}
      <div
        data-tauri-drag-region
        className="fixed top-0 left-0 w-full h-16 z-50"
      />

      {/* Main Content - True center */}
      <main className="flex-1 flex flex-col items-center justify-center px-6">
        <div className="flex flex-col items-center">
          <div className="mb-5">
            <img
              ref={logoRef}
              src="/images/eclipse.svg"
              alt="Ritual Logo"
              width={HOME_WELCOME_LOGO_PX}
              height={HOME_WELCOME_LOGO_PX}
              className="cursor-pointer"
              style={{
                transform: isLogoSpinning ? 'rotate(360deg)' : 'rotate(0deg)',
                transition: 'transform 500ms ease-in-out'
              }}
            />
          </div>

          <h1 className="text-gray-900 mb-8" style={homeWelcomeHeadingStyle}>
            Welcome to Ritual
          </h1>

          <Link
            href="/sign-in"
            prefetch={false}
            className="inline-flex items-center justify-center bg-black text-white px-10 py-2 rounded-sm font-medium text-sm shadow transition-colors duration-200 hover:bg-[#27251E]"
            style={{
              userSelect: 'none',
              fontWeight: 500
            }}
          >
            Sign In
          </Link>
        </div>
      </main>

      {/* Terms of Service - Fixed at bottom */}
      <footer className="py-8 text-center">
        <p className="text-sm text-[#737373]" style={{ fontWeight: 400 }}>
          By signing in you agree to our{' '}
          <a
            href="/terms"
            className="underline text-[#737373] hover:text-[#525252] transition-colors duration-200"
          >
            Terms of service
          </a>
          {' '}&{' '}
          <a
            href="/privacy"
            className="underline text-[#737373] hover:text-[#525252] transition-colors duration-200"
          >
            Privacy policy
          </a>
        </p>
      </footer>
    </div>
  );
}
