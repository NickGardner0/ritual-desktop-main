'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@clerk/nextjs'
import { BrailleSpinner } from '@/components/ui/braille-spinner'
import { getPostOnboardingRoute } from '@/lib/onboarding-flow'

const devLog = (...args: unknown[]) => {
  if (process.env.NODE_ENV !== 'production') {
    console.log(...args);
  }
};

export default function AuthCallbackPage() {
  const [status, setStatus] = useState('Processing authentication...')
  const router = useRouter()
  const { user, isLoaded } = useUser()

  useEffect(() => {
    const handleCallback = async () => {
      // Clerk handles all OAuth callbacks now
      // Just redirect to dashboard when user is loaded
      if (isLoaded) {
        if (user) {
          devLog('✅ User authenticated via Clerk, redirecting to dashboard');
          setStatus('Authentication successful! Redirecting...')
          router.push(getPostOnboardingRoute('/dashboard'));
        } else {
          devLog('❌ No user found, redirecting to home');
          setStatus('Authentication failed. Redirecting...')
          setTimeout(() => {
            router.push('/');
          }, 2000);
        }
      }
    };

    handleCallback();
  }, [isLoaded, user, router]);

  return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      {/* Window Drag Region - Top Bar */}
      <div 
        className="tauri-drag-region"
        data-tauri-drag-region
      />
      
      <div className="max-w-md w-full text-center px-6">
        {/* Logo */}
        <div className="mb-8">
          <div className="w-16 h-16 mx-auto mb-6 flex items-center justify-center">
            <img 
              src="/images/ritual.svg" 
              alt="Ritual Logo" 
              className="w-full h-full rotate-180"
            />
          </div>
          
          {/* Status */}
          <div className="mb-6">
            <h1 className="text-2xl font-semibold text-gray-900 mb-3">
              OAuth Complete! ✨
            </h1>
            <p className="text-base text-gray-500 leading-relaxed">
              You can close this window.
            </p>
          </div>
          
          {/* Elegant Loading Spinner */}
          <div className="mb-6">
            <div className="w-8 h-8 mx-auto">
              <BrailleSpinner className="h-8 w-8 text-2xl text-gray-900" />
            </div>
          </div>
          
          {/* Subtle status text */}
          {status !== 'Processing authentication...' && (
            <div className="text-sm text-gray-400 mb-4 max-w-sm mx-auto">
              {status}
            </div>
          )}
        </div>
        
        {/* Footer text */}
        <div className="text-xs text-gray-400 mt-8">
          If Ritual does not open in a few seconds, <button onClick={() => {
            if (typeof window !== 'undefined') {
              window.location.href = getPostOnboardingRoute('/dashboard')
            }
          }} className="underline hover:text-gray-600 transition-colors">click here</button>.
        </div>
        
        <div className="text-xs text-gray-300 mt-4">
          You may close this browser tab when done
        </div>
      </div>
    </div>
  )
} 
