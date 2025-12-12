'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useUser, useAuth } from '@clerk/nextjs'

import { Loader } from 'lucide-react'

const PYTHON_API_BASE = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';

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
        // Check if user came from welcome flow
        const isFromWelcome = localStorage.getItem('ritual-from-welcome')
        
        // Always clean up the welcome flag
        if (isFromWelcome === 'true') {
          localStorage.removeItem('ritual-from-welcome')
        }

        setStatus('Checking your profile...')

        // Add delay and error handling to prevent rapid token requests
        await new Promise(resolve => setTimeout(resolve, 100));

        const token = await getToken({ skipCache: false }).catch((err) => {
          console.error('Token fetch error in SSO callback:', err);
          return null;
        });

        if (!token) {
          console.log('No token in SSO callback, redirecting to dashboard');
          router.replace('/dashboard')
          return
        }

        // Always check onboarding status from backend (even for welcome flow users)
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
          console.log('[SSO Callback] Profile data:', profile)
          console.log('[SSO Callback] Onboarding completed:', profile.onboarding_completed)

          if (profile.onboarding_completed) {
            // User already completed onboarding - go to dashboard
            setStatus('Welcome back! Taking you to your dashboard...')
            console.log('[SSO Callback] Redirecting to dashboard - onboarding already completed')
            router.replace('/dashboard')
          } else if (isFromWelcome === 'true') {
            // New user from welcome flow who hasn't completed onboarding
            setStatus('Setting up your profile...')
            console.log('[SSO Callback] Redirecting to onboarding - new user from welcome flow')
            router.replace('/onboarding')
          } else {
            // Existing user who hasn't completed onboarding
            setStatus('Setting up your profile...')
            console.log('[SSO Callback] Redirecting to onboarding - onboarding_completed is:', profile.onboarding_completed)
            router.replace('/onboarding')
          }
        } else {
          // Profile doesn't exist yet
          if (isFromWelcome === 'true') {
            // New user from welcome flow - go to onboarding
            setStatus('Setting up your profile...')
            console.log('[SSO Callback] No profile yet, new user - redirecting to onboarding')
            router.replace('/onboarding')
          } else {
            // Returning user but profile fetch failed - go to dashboard
            console.log('[SSO Callback] Profile fetch failed, status:', response?.status)
            setStatus('Taking you to your dashboard...')
            router.replace('/dashboard')
          }
        }
      } catch (error) {
        console.error('Error checking onboarding:', error)
        // On error, go to dashboard and let it handle the flow
        router.replace('/dashboard')
      }
    }

    checkOnboardingAndRedirect()
  }, [isLoaded, user, getToken, router])

  return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="text-center">
        <Loader className="h-12 w-12 animate-spin text-gray-900 mx-auto mb-4" />
        <p className="text-sm text-gray-600">{status}</p>
      </div>
    </div>
  )
}

