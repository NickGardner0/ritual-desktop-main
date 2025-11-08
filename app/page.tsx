"use client";

import { useUser, useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useState, useRef } from 'react';

const PYTHON_API_BASE = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';

export default function Home() {
  const { isSignedIn, isLoaded, user } = useUser();
  const { getToken } = useAuth();
  const router = useRouter();
  const hasChecked = useRef(false);
  const [isChecking, setIsChecking] = useState(false);

  // Check onboarding status and redirect appropriately
  useEffect(() => {
    if (!isLoaded || !isSignedIn || !user || hasChecked.current) {
      return;
    }

    hasChecked.current = true;
    setIsChecking(true);

    const checkAndRedirect = async () => {
      try {
        const token = await getToken();
        if (!token) {
          router.replace('/onboarding');
          return;
        }

        // Quick profile check
        const response = await fetch(`${PYTHON_API_BASE}/api/user/profile`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });

        if (response.ok) {
          const profile = await response.json();
          
          // Route directly to the correct destination
          if (profile.onboarding_completed) {
            router.replace('/dashboard');
          } else {
            router.replace('/onboarding');
          }
        } else {
          // If profile doesn't exist or error, go to onboarding to create it
          console.log('Profile fetch failed, redirecting to onboarding');
          router.replace('/onboarding');
        }
      } catch (error) {
        console.error('Error checking profile:', error);
        router.replace('/onboarding');
      }
    };

    checkAndRedirect();
  }, [isSignedIn, isLoaded, user, getToken, router]);


  // Show loading while checking auth state or redirecting
  if (!isLoaded || (isSignedIn && isChecking)) {
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
      <main className="relative z-30 flex flex-col items-center justify-center min-h-[calc(100vh-120px)] px-6 text-center" data-tauri-drag-region>
        <div className="max-w-2xl mx-auto">
          <div className="w-24 h-24 md:w-28 md:h-28 flex items-center justify-center mx-auto mb-8">
            <img 
              src="/images/ritual-logo1.svg" 
              alt="Ritual Logo" 
              className="w-full h-full"
            />
          </div>
          
          <h1 className="text-gray-900 mb-6" style={{ 
            fontFamily: 'inherit',
            fontSize: '33px',
            lineHeight: '1.2',
            WebkitFontSmoothing: 'antialiased',
            letterSpacing: '0.02em',
            fontWeight: 500,
            WebkitTextStroke: '0.3px currentColor'
          }}>
            Welcome to Ritual
          </h1>
          
          <p className="text-base text-gray-500 mb-12 leading-relaxed font-normal">
            Ritual is the best way to track and quantify your behavior.
          </p>
          
          <div className="flex justify-center">
            <Link
              href="/auth"
              className="inline-flex items-center justify-center gap-2 bg-gray-900 text-white px-6 py-2.5 rounded-none font-medium text-sm shadow-sm get-started-btn"
              style={{ 
                userSelect: 'none',
                transition: 'all 0.2s ease-out',
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
        <p className="text-sm text-gray-500">
          By signing in you agree to our{' '}
          <a 
            href="/terms" 
            className="underline text-gray-500 hover:text-gray-800 transition-colors duration-200"
          >
            Terms of service
          </a>
          {' '}&{' '}
          <a 
            href="/privacy" 
            className="underline text-gray-500 hover:text-gray-800 transition-colors duration-200"
          >
            Privacy policy
          </a>
        </p>
      </div>
    </div>
  );
}
