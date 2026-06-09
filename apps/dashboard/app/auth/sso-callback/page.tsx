'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth, useUser } from '@clerk/nextjs'

import { BrailleSpinner } from '@/components/ui/braille-spinner'
import {
  clearFromWelcomeFlow,
  clearSignUpIntent,
  markDeviceAuthenticated,
} from '@/lib/onboarding-flow'
import { resolveSsoRedirectRoute } from '@/lib/activation-flow.mjs'

const DASHBOARD_RETURN_URL_KEY = 'ritual:dashboard-return-url:v1'
const ONBOARDING_V3_STEP_KEY = 'ritual:onboarding-v3-step'
const BOOTSTRAP_TIMEOUT_MS = 10_000

type BootstrapResponse = {
  nextRoute?: string
}

function readDashboardReturnUrl(): string | null {
  if (typeof window === 'undefined') return null

  const value = window.sessionStorage.getItem(DASHBOARD_RETURN_URL_KEY)
  window.sessionStorage.removeItem(DASHBOARD_RETURN_URL_KEY)

  if (!value?.startsWith('/dashboard')) {
    return null
  }

  return value
}

function readOnboardingV3ReturnUrl(): string | null {
  if (typeof window === 'undefined') return null

  const value = window.localStorage.getItem(ONBOARDING_V3_STEP_KEY)
  return value ? '/onboarding?s=meet' : null
}

export default function SSOCallback() {
  const router = useRouter()
  const { user, isLoaded } = useUser()
  const { getToken } = useAuth()
  const [status, setStatus] = useState('Completing sign-in...')

  useEffect(() => {
    if (!isLoaded) {
      return
    }

    if (!user) {
      router.replace('/sign-in')
      return
    }

    const bootstrapAndRedirect = async () => {
      try {
        markDeviceAuthenticated()
        clearFromWelcomeFlow()
        clearSignUpIntent()

        setStatus('Setting up your account...')
        const token = await getToken({ skipCache: true })
        if (!token) {
          router.replace('/sign-in')
          return
        }

        const controller = new AbortController()
        const timeoutId = window.setTimeout(() => controller.abort(), BOOTSTRAP_TIMEOUT_MS)
        let response: Response
        try {
          response = await fetch('/api/user/bootstrap', {
            cache: 'no-store',
            signal: controller.signal,
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          })
        } finally {
          window.clearTimeout(timeoutId)
        }

        if (response.status === 401 || response.status === 403) {
          router.replace('/sign-in')
          return
        }

        if (!response.ok) {
          throw new Error(`Bootstrap failed (${response.status})`)
        }

        const bootstrap = await response.json() as BootstrapResponse
        setStatus('Taking you to Ritual...')
        router.replace(readOnboardingV3ReturnUrl() ?? resolveSsoRedirectRoute(bootstrap.nextRoute, readDashboardReturnUrl()))
      } catch (error) {
        console.error('Error completing sign-in:', error)
        setStatus('Taking you to Ritual...')
        router.replace(readOnboardingV3ReturnUrl() ?? readDashboardReturnUrl() ?? '/dashboard')
      }
    }

    void bootstrapAndRedirect()
  }, [getToken, isLoaded, router, user])

  return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="text-center">
        <BrailleSpinner className="mx-auto mb-4 h-12 w-12 text-4xl text-gray-900" />
        <p className="text-sm text-gray-600">{status}</p>
      </div>
    </div>
  )
}
