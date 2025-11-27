'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useUser, useAuth } from '@clerk/nextjs'

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

        if (isFromWelcome === 'true') {
          // New user from welcome flow - go to onboarding
          localStorage.removeItem('ritual-from-welcome') // Clean up flag
          setStatus('Setting up your profile...')
          router.replace('/onboarding')
          return
        }

        // Existing user - check backend profile
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

        // Check onboarding status from backend with timeout
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
            setStatus('Welcome back! Taking you to your dashboard...')
            console.log('[SSO Callback] Redirecting to dashboard')
            router.replace('/dashboard')
          } else {
            setStatus('Setting up your profile...')
            console.log('[SSO Callback] Redirecting to onboarding - onboarding_completed is:', profile.onboarding_completed)
            router.replace('/onboarding')
          }
        } else {
          // Profile doesn't exist yet or error, go to dashboard
          console.log('[SSO Callback] Profile fetch failed, status:', response?.status)
          setStatus('Taking you to your dashboard...')
          router.replace('/dashboard')
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
        <div className="animate-spin rounded-full h-12 w-12 border-2 border-gray-200 mx-auto mb-4">
          <div className="rounded-full h-12 w-12 border-2 border-transparent border-t-gray-900"></div>
        </div>
        <p className="text-sm text-gray-600">{status}</p>
      </div>
    </div>
  )
}

