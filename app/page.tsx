"use client";

import { useUser, useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useState, useRef } from 'react';
import { setStandardWindowSize } from '@/lib/tauri-utils';

const PYTHON_API_BASE = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';

export default function Home() {
  const { isSignedIn, isLoaded, user } = useUser();
  const { getToken } = useAuth();
  const router = useRouter();
  const hasChecked = useRef(false);
  const [isChecking, setIsChecking] = useState(false);
  const [isLogoSpinning, setIsLogoSpinning] = useState(false);
  const logoRef = useRef<HTMLImageElement>(null);

  // Attach click handler directly to logo via DOM
  useEffect(() => {
    const logo = logoRef.current;
    if (!logo) return;

    const handleLogoClick = (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      console.log('Logo clicked via DOM handler!');
      setIsLogoSpinning(prev => !prev);
    };

    logo.addEventListener('click', handleLogoClick, true);
    return () => logo.removeEventListener('click', handleLogoClick, true);
  }, []);

  // Set standard window size
  useEffect(() => {
    setStandardWindowSize();
  }, []);

  // Check if first-time visitor
  useEffect(() => {
    if (!isLoaded) return;

    // If not signed in, check if they've seen the welcome flow
    if (!isSignedIn) {
      const hasSeenWelcome = localStorage.getItem('ritual-onboarding-completed');
      if (!hasSeenWelcome) {
        router.replace('/welcome');
        return;
      }
      return;
    }

    // If signed in, check backend onboarding status
    if (!user || hasChecked.current) {
      return;
    }

    hasChecked.current = true;
    setIsChecking(true);

    const checkAndRedirect = async () => {
      try {
        // Add a small delay to prevent rapid token refresh requests
        await new Promise(resolve => setTimeout(resolve, 100));

        const token = await getToken({ skipCache: false }).catch((err) => {
          console.error('Token fetch error:', err);
          return null;
        });

        if (!token) {
          console.log('No token available, redirecting to onboarding');
          router.replace('/onboarding');
          return;
        }

        // Quick profile check with timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

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
          console.log('Profile data:', profile);
          console.log('Onboarding completed:', profile.onboarding_completed);

          // Check localStorage as a fallback (in case DB sync is slow)
          const localOnboardingCompleted = localStorage.getItem('ritual-onboarding-backend-completed') === 'true';

          // Route directly to the correct destination
          if (profile.onboarding_completed || localOnboardingCompleted) {
            console.log('Redirecting to dashboard - onboarding completed');
            router.replace('/dashboard');
          } else {
            // Check if user has habits - if so, they're an existing user, skip onboarding
            try {
              const habitsResponse = await fetch(`${PYTHON_API_BASE}/api/habits`, {
                headers: { 'Authorization': `Bearer ${token}` }
              });
              if (habitsResponse.ok) {
                const habits = await habitsResponse.json();
                if (habits && habits.length > 0) {
                  console.log('User has existing habits, skipping onboarding');
                  router.replace('/dashboard');
                  return;
                }
              }
            } catch (e) {
              console.log('Could not check habits, proceeding with onboarding check');
            }

            console.log('Redirecting to onboarding - not completed');
            router.replace('/onboarding');
          }
        } else {
          // If profile doesn't exist or error, go to dashboard (user exists but no profile yet)
          console.log('Profile fetch failed or no profile, redirecting to dashboard');
          console.log('Response status:', response?.status);
          router.replace('/dashboard');
        }
      } catch (error) {
        console.error('Error checking profile:', error);
        // On error, just go to dashboard and let it handle the flow
        router.replace('/dashboard');
      }
    };

    checkAndRedirect();
  }, [isSignedIn, isLoaded, user, getToken, router]);


  // Show loading only while checking auth state for signed-in users
  // For non-signed-in users, show the page immediately
  if (isSignedIn && isChecking) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-200">
          <div className="rounded-full h-8 w-8 border-2 border-transparent border-t-gray-900"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white relative">
      {/* Window Drag Region - Top area */}
      <div
        data-tauri-drag-region
        className="fixed top-0 left-0 w-full h-16 z-50"
      />

      {/* Header */}
      <header className="relative z-40 flex justify-end items-center p-6" data-tauri-drag-region>
        {/* Clean header */}
      </header>

      {/* Main Content */}
      <main className="relative z-30 flex flex-col items-center justify-center min-h-[calc(100vh-120px)] px-6 text-center" style={{ fontFamily: "'FK Grotesk Neue', sans-serif" }}>
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-center mx-auto mb-8">
            <img
              ref={logoRef}
              src="/images/logo_fix1.svg"
              alt="Ritual Logo"
              className="w-10 h-10 cursor-pointer"
              style={{
                transform: isLogoSpinning ? 'rotate(360deg)' : 'rotate(0deg)',
                transition: 'transform 500ms ease-in-out'
              }}
            />
          </div>

          <h1 className="text-gray-900 mb-6" style={{
            fontSize: '33px',
            lineHeight: '1.2',
            WebkitFontSmoothing: 'antialiased',
            letterSpacing: '0.02em',
            fontWeight: 500,
            WebkitTextStroke: '0.3px currentColor',
            fontFamily: "'FK Grotesk Neue', sans-serif"
          }}>
            Welcome to Ritual
          </h1>

          <div className="flex justify-center">
            <Link
              href="/sign-up"
              className="inline-flex items-center justify-center gap-2 bg-gray-900 text-white px-4 py-1.5 rounded-none font-medium text-sm shadow-sm get-started-btn"
              style={{
                userSelect: 'none',
                transition: 'all 0.2s ease-out',
                fontFamily: "'FK Grotesk Neue', sans-serif",
                fontWeight: 400
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#4b5563';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#111827';
              }}
              data-tauri-drag-region={false}
            >
              Get Started
            </Link>
          </div>
        </div>
      </main>

      {/* Terms of Service and Privacy Policy - Fixed at bottom */}
      <div className="fixed bottom-6 left-0 right-0 text-center z-10">
        <p className="text-sm text-gray-500" style={{ fontFamily: "'FK Grotesk Neue', sans-serif", fontWeight: 400 }}>
          By signing in you agree to our{' '}
          <a
            href="/terms"
            className="underline text-gray-500 hover:text-gray-800 transition-colors duration-200"
            style={{ fontFamily: "'FK Grotesk Neue', sans-serif", fontWeight: 400 }}
          >
            Terms of service
          </a>
          {' '}&{' '}
          <a
            href="/privacy"
            className="underline text-gray-500 hover:text-gray-800 transition-colors duration-200"
            style={{ fontFamily: "'FK Grotesk Neue', sans-serif", fontWeight: 400 }}
          >
            Privacy policy
          </a>
        </p>
      </div>
    </div>
  );
}
