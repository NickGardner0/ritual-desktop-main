"use client";

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { Spinner } from '@/components/ui/kibo-ui/spinner';

export default function Home() {
  const { user, signInWithGoogle, signInWithApple, signInWithX, loading } = useAuth();
  const [loginLoading, setLoginLoading] = useState(false);
  const [appleLoginLoading, setAppleLoginLoading] = useState(false);
  const [xLoginLoading, setXLoginLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debug AuthContext and environment
  console.log('🔍 AuthContext values:', { user, signInWithGoogle: typeof signInWithGoogle });
  console.log('🔍 Environment check:', {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ? 'present' : 'missing',
    supabaseKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? 'present' : 'missing'
  });
  
  // Note: Token clearing removed to preserve user authentication state

  // Redirect authenticated users based on onboarding status
  useEffect(() => {
    const checkOnboardingStatus = async () => {
      if (user && !loading) {
        try {
          console.log('🔍 Auth user ID:', user.id);
          console.log('🔍 Auth user email:', user.email);
          
          // Skip profile check and go directly to dashboard for faster redirect
          // The dashboard will handle onboarding checks if needed
          console.log('🔍 Fast redirect to dashboard');
          window.location.href = '/dashboard';
        } catch (error) {
          console.error('Error in fast redirect:', error);
          window.location.href = '/dashboard'; // Fallback
        }
      }
    };
    
    checkOnboardingStatus();
  }, [user, loading]);

  const handleGoogleLogin = async () => {
    console.log('🔥 handleGoogleLogin called!');
    console.log('🔥 signInWithGoogle function:', signInWithGoogle);
    console.log('🔥 typeof signInWithGoogle:', typeof signInWithGoogle);
    console.log('🔥 user state:', user);
    console.log('🔥 loading state:', loading);
    console.log('🔥 localStorage tokens:', {
      googleToken: localStorage.getItem('google_access_token') ? 'present' : 'missing',
      googleUserInfo: localStorage.getItem('google_user_info') ? 'present' : 'missing'
    });
    
    setLoginLoading(true);
    setError(null);
    try {
      console.log('🔥 About to call signInWithGoogle...');
      
      if (typeof signInWithGoogle !== 'function') {
        throw new Error('signInWithGoogle is not a function');
      }
      
      const result = await signInWithGoogle();
      console.log('🔥 signInWithGoogle returned:', result);
      
      if (result && result.error) {
        setError(result.error.message);
      }
    } catch (error) {
      console.error('🔥 Google login error:', error);
      setError('Failed to sign in with Google: ' + (error as Error).message);
    } finally {
      console.log('🔥 Setting loginLoading to false');
      setLoginLoading(false);
    }
  };

  const handleAppleLogin = async () => {
    console.log('🔥 handleAppleLogin called!');
    setAppleLoginLoading(true);
    setError(null);
    try {
      if (typeof signInWithApple !== 'function') {
        throw new Error('signInWithApple is not a function');
      }
      const result = await signInWithApple();
      if (result && result.error) {
        setError(result.error.message);
      }
    } catch (e) {
      console.error('🔥 Apple login error:', e);
      setError('Failed to sign in with Apple: ' + (e as Error).message);
    } finally {
      setAppleLoginLoading(false);
    }
  };

  const handleXLogin = async () => {
    console.log('🔥 handleXLogin called!');
    setXLoginLoading(true);
    setError(null);
    try {
      if (typeof signInWithX !== 'function') {
        throw new Error('signInWithX is not a function');
      }
      const result = await signInWithX();
      if (result && result.error) {
        setError(result.error.message);
      }
    } catch (e) {
      console.error('🔥 X login error:', e);
      setError('Failed to sign in with X: ' + (e as Error).message);
    } finally {
      setXLoginLoading(false);
    }
  };

  console.log('🔥 Rendering main content');

  // Don't wait for auth loading - show content immediately
  // Authentication will redirect to dashboard in the background if user is logged in

  return (
    <div className="min-h-screen bg-white relative">
      {/* Window Drag Region - Top area */}
      <div
        data-tauri-drag-region
        className="fixed top-0 left-0 w-full h-16 z-50"
      />

      {/* Header */}
      <header className="relative z-40 flex justify-end items-center p-6" data-tauri-drag-region>
        {/* Clean header with no sign in button since we have Google button below */}
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
          
          <h1 className="text-3xl font-medium text-gray-900 mb-6 leading-tight" style={{ fontFamily: 'PP Neue Montreal, -apple-system, BlinkMacSystemFont, sans-serif' }}>
            Welcome to Ritual
          </h1>
          
          <p className="text-base text-gray-500 mb-12 leading-relaxed font-normal">
            Ritual is the best way to track and quantify your behavior.
          </p>
          
          <div className="flex flex-col gap-3 justify-center w-[280px] mx-auto">
            <button
              onMouseDown={() => console.log('🔥 Button mouse down')}
              onMouseUp={() => console.log('🔥 Button mouse up')}
              onClick={(e) => {
                console.log('🔥 BUTTON CLICKED - EVENT FIRED!');
                e.preventDefault();
                e.stopPropagation();
                console.log('🔥 Continue with Google button clicked!');
                console.log('🔥 Event target:', e.target);
                console.log('🔥 Event currentTarget:', e.currentTarget);
                console.log('🔥 Button disabled:', loginLoading);
                console.log('🔥 Window.__TAURI__:', typeof window !== 'undefined' && '__TAURI__' in window);
                console.log('🔥 Current user state:', user);
                console.log('🔥 Current loading state:', loading);
                
                // Check localStorage state before proceeding
                const existingTokens = localStorage.getItem('google_access_token');
                console.log('🔥 Existing tokens check:', existingTokens ? 'found' : 'none');
                
                handleGoogleLogin();
              }}
              disabled={loginLoading}
              className="w-full flex items-center justify-center gap-2 bg-white border border-gray-200 text-gray-700 hover:bg-gray-100 px-5 py-2 rounded-none font-medium transition-colors text-sm shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ 
                cursor: 'pointer',
                userSelect: 'none'
              }}
              data-tauri-drag-region={false}
            >
              {loginLoading ? (
                <Spinner className="w-5 h-5" />
              ) : (
                <>
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  Continue with Google
                </>
              )}
            </button>

            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('🔥 Continue with Apple button clicked!');
                handleAppleLogin();
              }}
              disabled={appleLoginLoading}
              className="w-full flex items-center justify-center gap-2 bg-white border border-gray-200 text-gray-700 hover:bg-gray-100 px-5 py-2 rounded-none font-medium transition-colors text-sm shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ cursor: 'pointer', userSelect: 'none' }}
              data-tauri-drag-region={false}
            >
              {appleLoginLoading ? (
                <Spinner className="w-5 h-5" />
              ) : (
                <>
                  {/* Apple logo */}
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"/>
                  </svg>
                  Continue with Apple
                </>
              )}
            </button>

            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('🔥 Continue with X button clicked!');
                handleXLogin();
              }}
              disabled={xLoginLoading}
              className="w-full flex items-center justify-center gap-2 bg-white border border-gray-200 text-gray-700 hover:bg-gray-100 px-5 py-2 rounded-none font-medium transition-colors text-sm shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ cursor: 'pointer', userSelect: 'none' }}
              data-tauri-drag-region={false}
            >
              {xLoginLoading ? (
                <Spinner className="w-5 h-5" />
              ) : (
                <>
                  {/* X (Twitter) logo */}
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M18.244 2.25h3.056l-6.676 7.63 7.839 11.87h-6.135l-4.804-6.27-5.5 6.27H2.018l7.15-8.15L1.61 2.25h6.3l4.33 5.74 5.998-5.74Zm-1.07 17.22h1.692L6.9 3.77H5.09l12.084 15.7Z"/>
                  </svg>
                  Continue with X
                </>
              )}
            </button>
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

      {/* Error display */}
      {error && (
        <div className="fixed bottom-4 right-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg shadow-lg z-50">
          {error}
        </div>
      )}
    </div>
  );
}
