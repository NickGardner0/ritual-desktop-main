'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useUser, useAuth } from '@clerk/nextjs'

import { BrailleSpinner } from '@/components/ui/braille-spinner'
import {
  cameFromWelcomeFlow,
  clearFromWelcomeFlow,
  clearSignUpIntent,
  getPostOnboardingRoute,
  hasCompletedOnboarding,
  hasPendingSignUpIntent,
  markDeviceAuthenticated,
  markOnboardingCompleted,
} from '@/lib/onboarding-flow'

const PYTHON_API_BASE = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';
const DASHBOARD_RETURN_URL_KEY = 'ritual:dashboard-return-url:v1';
const devLog = (...args: unknown[]) => {
  if (process.env.NODE_ENV !== 'production') {
    console.log(...args);
  }
};

function readDashboardReturnUrl(): string | null {
  if (typeof window === 'undefined') return null;

  const value = window.sessionStorage.getItem(DASHBOARD_RETURN_URL_KEY);
  window.sessionStorage.removeItem(DASHBOARD_RETURN_URL_KEY);

  if (!value?.startsWith('/dashboard')) {
    return null;
  }

  return value;
}

function resolvePostSignInRoute(userId?: string | null): string {
  return getPostOnboardingRoute(readDashboardReturnUrl() ?? '/dashboard', userId);
}

export default function SSOCallback() {
  const router = useRouter()
  const { user, isLoaded } = useUser()
  const { getToken } = useAuth()
  const [status, setStatus] = useState('Completing sign-in...')

  useEffect(() => {
    if (!isLoaded || !user) {
      return
    }

    const checkOnboardingAndRedirect = async () => {
      try {
        markDeviceAuthenticated()

        // Check if user came from welcome flow (new user signup)
        const isFromWelcome = cameFromWelcomeFlow()
        const hasSignUpIntent = hasPendingSignUpIntent()
        const isRecentlyCreatedUser = user.createdAt
          ? (Date.now() - user.createdAt.getTime()) < 10 * 60 * 1000
          : false
        // Check if user has previously completed onboarding (client-side flag)
        const hasCompletedOnboardingLocally = hasCompletedOnboarding(user.id)
        
        // Always clean up the welcome flag
        if (isFromWelcome) {
          clearFromWelcomeFlow()
        }
        if (hasSignUpIntent) {
          clearSignUpIntent()
        }

        // FAST PATH: If user has completed onboarding locally, go straight to dashboard
        // This handles returning users who sign in again
        if (hasCompletedOnboardingLocally) {
          devLog('[SSO Callback] User has local onboarding flag, going to dashboard')
          setStatus('Welcome back! Taking you to your dashboard...')
          router.replace(resolvePostSignInRoute(user.id))
          return
        }

        setStatus('Checking your profile...')

        // Add delay and error handling to prevent rapid token requests
        await new Promise(resolve => setTimeout(resolve, 100));

        const token = await getToken({ skipCache: true }).catch((err) => {
          console.error('Token fetch error in SSO callback:', err);
          return null;
        });

        if (!token) {
          devLog('No token in SSO callback, redirecting to dashboard');
          router.replace(resolvePostSignInRoute(user.id))
          return
        }

        // Check onboarding status from backend
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(`${PYTHON_API_BASE}/api/user/profile`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          signal: controller.signal
        }).catch((err) => {
          console.error('Profile fetch error in SSO callback:', err);
          return null;
        }).finally(() => clearTimeout(timeoutId));

        if (response && response.ok) {
          const profile = await response.json()
          devLog('[SSO Callback] Profile data:', profile)
          devLog('[SSO Callback] Onboarding completed:', profile.onboarding_completed)

          if (profile.onboarding_completed) {
            // User already completed onboarding - set local flag and go to dashboard
            markOnboardingCompleted(user.id)
            setStatus('Welcome back! Taking you to your dashboard...')
            devLog('[SSO Callback] Redirecting to dashboard - onboarding already completed')
            router.replace(resolvePostSignInRoute(user.id))
          } else {
            // Backend says not completed - check if user has habits (existing user)
            try {
              const habitsResponse = await fetch(`${PYTHON_API_BASE}/api/habits`, {
                headers: { 'Authorization': `Bearer ${token}` }
              });
              if (habitsResponse.ok) {
                const habits = await habitsResponse.json();
                if (habits && habits.length > 0) {
                  devLog('[SSO Callback] User has existing habits, skipping onboarding');
                  // User is clearly an existing user, set local flag and mark in backend
                  markOnboardingCompleted(user.id)
                  setStatus('Welcome back! Taking you to your dashboard...')
                  router.replace(resolvePostSignInRoute(user.id));
                  return;
                }
              }
            } catch (e) {
              devLog('[SSO Callback] Could not check habits, proceeding with onboarding check');
            }
            
            // Only redirect to onboarding if:
            // 1. User came from welcome flow (new signup), OR
            // 2. User has never completed onboarding locally
            if (isFromWelcome || hasSignUpIntent || isRecentlyCreatedUser) {
              setStatus('Setting up your profile...')
              devLog('[SSO Callback] Redirecting to onboarding - detected new sign-up flow')
              router.replace('/onboarding')
            } else {
              // Returning user but backend shows incomplete - could be DB issue
              // Default to dashboard since they're trying to sign in (not sign up)
              devLog('[SSO Callback] Backend shows incomplete but user is signing in - going to dashboard')
              setStatus('Taking you to your dashboard...')
              router.replace(resolvePostSignInRoute(user.id))
            }
          }
        } else {
          // Profile doesn't exist or fetch failed
          if (isFromWelcome || hasSignUpIntent || isRecentlyCreatedUser) {
            // New user from welcome flow - go to onboarding
            setStatus('Setting up your profile...')
            devLog('[SSO Callback] No profile yet, new user - redirecting to onboarding')
            router.replace('/onboarding')
          } else {
            // Returning user but profile fetch failed - go to dashboard
            devLog('[SSO Callback] Profile fetch failed, status:', response?.status)
            setStatus('Taking you to your dashboard...')
            router.replace(resolvePostSignInRoute(user.id))
          }
        }
      } catch (error) {
        console.error('Error checking onboarding:', error)
        // On error, go to dashboard and let it handle the flow
        router.replace(resolvePostSignInRoute(user.id))
      }
    }

    checkOnboardingAndRedirect()
  }, [isLoaded, user, getToken, router])

  return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="text-center">
        <BrailleSpinner className="mx-auto mb-4 h-12 w-12 text-4xl text-gray-900" />
        <p className="text-sm text-gray-600">{status}</p>
      </div>
    </div>
  )
}
