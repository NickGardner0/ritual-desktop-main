"use client";

import { useUser, useAuth, SignIn, SignUp } from '@clerk/nextjs';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useRef, type CSSProperties } from 'react';
import Link from 'next/link';
import { setStandardWindowSize, setOnboardingWindowSize } from '@/lib/tauri-utils';
import { isTauri } from '@/lib/tauri-utils';
import { ArrowRight } from 'lucide-react';
import { ClerkOAuthHandler } from '@/components/clerk-oauth-handler';
import { BrailleSpinner } from '@/components/ui/braille-spinner';
import {
  FROM_WELCOME_KEY,
  ONBOARDING_BACKEND_COMPLETED_KEY,
  ONBOARDING_COMPLETED_KEY,
  getPostOnboardingRoute,
  markPermissionsOnboardingRequired,
} from '@/lib/onboarding-flow';

const PYTHON_API_BASE = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';
const TOTAL_PAGES = 4;

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
  const { isSignedIn, isLoaded, user } = useUser();
  const { getToken } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const hasChecked = useRef(false);
  const [isChecking, setIsChecking] = useState(false);
  const [isLogoSpinning, setIsLogoSpinning] = useState(false);
  const logoRef = useRef<HTMLImageElement>(null);
  
  // Welcome flow state
  const pageParam = searchParams.get('page');
  const authMode = searchParams.get('mode');
  const [currentPage, setCurrentPage] = useState(pageParam ? parseInt(pageParam) : 1);
  const [showSignUp, setShowSignUp] = useState(authMode === 'signup');
  const [isNewUser, setIsNewUser] = useState<boolean | null>(null);
  const [showStartupDiagnostics, setShowStartupDiagnostics] = useState(false);
  const desktopApp = typeof window !== 'undefined' && isTauri();

  // Update showSignUp when URL changes
  useEffect(() => {
    setShowSignUp(authMode === 'signup');
  }, [authMode]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!isTauri()) return;
    if (isLoaded && !isChecking) {
      setShowStartupDiagnostics(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setShowStartupDiagnostics(true);
    }, 8000);

    return () => window.clearTimeout(timer);
  }, [isLoaded, isChecking]);

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

  // Set window size based on current state
  useEffect(() => {
    if (isNewUser) {
      setOnboardingWindowSize();
    } else {
      setStandardWindowSize();
    }
  }, [isNewUser]);

  // Determine if new user or returning user
  useEffect(() => {
    if (!isLoaded) return;

    const hasSeenWelcome = localStorage.getItem(ONBOARDING_COMPLETED_KEY);
    
    // Not signed in
    if (!isSignedIn) {
      // New user - show welcome flow
      if (!hasSeenWelcome) {
        setIsNewUser(true);
        return;
      }
      // Returning user - show simple home page
      setIsNewUser(false);
      return;
    }

    // User is signed in - check if they need onboarding
    if (!user || hasChecked.current) {
      return;
    }

    hasChecked.current = true;
    setIsChecking(true);

    const checkAndRedirect = async () => {
      try {
        await new Promise(resolve => setTimeout(resolve, 100));

        const token = await getToken({ skipCache: false }).catch((err) => {
          console.error('Token fetch error:', err);
          return null;
        });

        if (!token) {
          router.replace('/onboarding');
          return;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(`${PYTHON_API_BASE}/api/user/profile`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          signal: controller.signal
        }).catch((err) => {
          console.error('Profile fetch error:', err);
          return null;
        }).finally(() => clearTimeout(timeoutId));

        if (response && response.ok) {
          const profile = await response.json();
          const localOnboardingCompleted = localStorage.getItem(ONBOARDING_BACKEND_COMPLETED_KEY) === 'true';

          if (profile.onboarding_completed || localOnboardingCompleted) {
            router.replace(getPostOnboardingRoute('/dashboard'));
          } else {
            try {
              const habitsResponse = await fetch(`${PYTHON_API_BASE}/api/habits`, {
                headers: { 'Authorization': `Bearer ${token}` }
              });
              if (habitsResponse.ok) {
                const habits = await habitsResponse.json();
                if (habits && habits.length > 0) {
                  router.replace(getPostOnboardingRoute('/dashboard'));
                  return;
                }
              }
            } catch (e) {
              console.log('Could not check habits, proceeding with onboarding check');
            }
            router.replace('/onboarding');
          }
        } else {
          router.replace(getPostOnboardingRoute('/dashboard'));
        }
      } catch (error) {
        console.error('Error checking profile:', error);
        router.replace(getPostOnboardingRoute('/dashboard'));
      }
    };

    checkAndRedirect();
  }, [isSignedIn, isLoaded, user, getToken, router]);

  // Handle signed in users during welcome flow
  useEffect(() => {
    if (isLoaded && isSignedIn && isNewUser) {
      const hasCompletedWelcomeFlow = localStorage.getItem(ONBOARDING_COMPLETED_KEY);
      const hasCompletedBackendOnboarding = localStorage.getItem(ONBOARDING_BACKEND_COMPLETED_KEY);

      // If returning from backend onboarding, continue to page 4
      if (hasCompletedBackendOnboarding === 'true' && pageParam === '4') {
        return;
      }

      // If fully completed, go to dashboard
      if (hasCompletedWelcomeFlow === 'true') {
        router.replace(getPostOnboardingRoute('/dashboard'));
      }
    }
  }, [isSignedIn, isLoaded, isNewUser, router, pageParam]);

  // Set flag when user reaches page 3 (auth page)
  useEffect(() => {
    if (currentPage === 3) {
      localStorage.setItem(FROM_WELCOME_KEY, 'true');
    }
  }, [currentPage]);

  const handleNext = () => {
    if (currentPage === TOTAL_PAGES) {
      localStorage.setItem(ONBOARDING_COMPLETED_KEY, 'true');
      localStorage.removeItem(FROM_WELCOME_KEY);
      localStorage.removeItem(ONBOARDING_BACKEND_COMPLETED_KEY);
      markPermissionsOnboardingRequired();
      router.push(getPostOnboardingRoute('/dashboard'));
      return;
    }
    setCurrentPage(prev => Math.min(prev + 1, TOTAL_PAGES));
  };

  const handleDotClick = (page: number) => {
    setCurrentPage(page);
  };

  // Show loading while checking auth state for signed-in users
  if (isSignedIn && isChecking) {
    if (showStartupDiagnostics) {
      return (
        <div className="min-h-screen bg-white flex items-center justify-center px-6">
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
                <dd className="break-all">{PYTHON_API_BASE}</dd>
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
      <div className="min-h-screen bg-white flex items-center justify-center">
        <BrailleSpinner className="text-2xl text-gray-900" />
      </div>
    );
  }

  // Still determining user type
  if (isNewUser === null) {
    if (showStartupDiagnostics) {
      return (
        <div className="min-h-screen bg-white flex items-center justify-center px-6">
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
                <dd>{String(typeof window !== 'undefined' ? isTauri() : false)}</dd>
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
      <div className="min-h-screen bg-white flex items-center justify-center">
        <BrailleSpinner className="text-2xl text-gray-900" />
      </div>
    );
  }

  // NEW USER: Show 4-page welcome flow
  if (isNewUser) {
    return (
      <div className="min-h-screen bg-white flex flex-col relative welcome-page" style={{ fontFamily: "'FK Grotesk Neue', sans-serif" }}>
        <ClerkOAuthHandler />
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
          <div className={`w-full text-center ${currentPage === 2 ? 'max-w-none px-0' : currentPage === 3 ? 'max-w-none px-0' : 'max-w-2xl px-8'}`}>
            
            {/* Page 1: Welcome */}
            {currentPage === 1 && (
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
            )}

            {/* Page 2: Why Ritual */}
            {currentPage === 2 && (
              <div className="animate-in fade-in duration-500">
                <div className="max-w-lg mx-auto text-left text-gray-900 px-8">
                  <p className="text-xl leading-relaxed">
                    Ritual is a collection of self-tracking tools and integrations used to measure and quantify your behavior.
                  </p>
                  <p className="text-xl leading-relaxed mt-6">
                    As you connect your wearable devices and create logs in the app, the system quietly generates metadata. Over time, your scattered behavior and patterns become structured data that start to form a model of your life.
                  </p>
                  <div className="mt-10 flex flex-col items-center gap-4">
                    <button
                      onClick={handleNext}
                      className="px-4 py-2 bg-black text-white rounded-sm transition-colors flex items-center gap-2 text-sm font-medium"
                    >
                      Next
                      <ArrowRight className="w-4 h-4" />
                    </button>
                    <div className="flex items-center gap-2">
                      {Array.from({ length: TOTAL_PAGES }).map((_, index) => (
                        <button
                          key={index}
                          onClick={() => handleDotClick(index + 1)}
                          className={`w-[7px] h-[7px] rounded-full transition-all ${currentPage === index + 1
                              ? 'bg-gray-900'
                              : 'bg-gray-300 hover:bg-gray-400'
                            }`}
                          aria-label={`Go to page ${index + 1}`}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Page 3: Clerk Auth Components */}
            {currentPage === 3 && (
              <div className="animate-in fade-in duration-500 flex justify-center">
                {showSignUp ? (
                  <SignUp
                    routing="virtual"
                    signInUrl="/?page=3&mode=signin"
                    forceRedirectUrl="/auth/sso-callback"
                    fallbackRedirectUrl="/auth/sso-callback"
                    appearance={{
                      elements: {
                        socialButtonsBlockButton: {
                          '&:hover': {
                            cursor: 'pointer'
                          }
                        },
                        dividerRow: '',
                      }
                    }}
                  />
                ) : (
                  <SignIn
                    routing="virtual"
                    signUpUrl="/?page=3&mode=signup"
                    forceRedirectUrl="/auth/sso-callback"
                    fallbackRedirectUrl="/auth/sso-callback"
                    appearance={{
                      elements: {
                        socialButtonsBlockButton: {
                          '&:hover': {
                            cursor: 'pointer'
                          }
                        },
                        dividerRow: '',
                      }
                    }}
                  />
                )}
              </div>
            )}

            {/* Page 4: You're all set */}
            {currentPage === 4 && (
              <div className="animate-in fade-in duration-500">
                <div className="flex justify-center mb-8">
                  <img
                    src="/images/eclipse.svg"
                    alt="Ritual Logo"
                    width={50}
                    height={50}
                  />
                </div>
                <h1 className="text-4xl font-medium text-gray-900 mb-4">
                  You&apos;re all set!
                </h1>
                <p className="text-lg text-gray-600 max-w-md mx-auto">
                  Let&apos;s start building your first ritual.
                </p>
              </div>
            )}

            {/* Navigation Buttons - Pages 1 and 4 */}
            {(currentPage === 1 || currentPage === 4) && (
              <div className="flex items-center justify-center">
                <button
                  onClick={handleNext}
                  className="px-12 py-2.5 bg-black text-white rounded-sm shadow transition-colors duration-200 flex items-center justify-center text-sm font-medium"
                  style={{ fontWeight: 500 }}
                >
                  {currentPage === 1 && 'Get Started'}
                  {currentPage === TOTAL_PAGES && 'Go to Dashboard'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Terms of Service - Page 1 only */}
        {currentPage === 1 && (
          <footer className="py-8 text-center">
            <p className="text-sm text-gray-400" style={{ fontWeight: 400 }}>
              By signing in you agree to our{' '}
              <a href="/terms" className="underline text-gray-400 hover:text-gray-600 transition-colors duration-200">
                Terms of service
              </a>
              {' '}&{' '}
              <a href="/privacy" className="underline text-gray-400 hover:text-gray-600 transition-colors duration-200">
                Privacy policy
              </a>
            </p>
          </footer>
        )}
      </div>
    );
  }

  // RETURNING USER: Show simple home page with Sign In
  return (
    <div className="min-h-screen bg-white relative flex flex-col" style={{ fontFamily: "'FK Grotesk Neue', sans-serif" }}>
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
        <p className="text-sm text-gray-400" style={{ fontWeight: 400 }}>
          By signing in you agree to our{' '}
          <a
            href="/terms"
            className="underline text-gray-400 hover:text-gray-600 transition-colors duration-200"
          >
            Terms of service
          </a>
          {' '}&{' '}
          <a
            href="/privacy"
            className="underline text-gray-400 hover:text-gray-600 transition-colors duration-200"
          >
            Privacy policy
          </a>
        </p>
      </footer>
    </div>
  );
}
