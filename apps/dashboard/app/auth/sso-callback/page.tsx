'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth, useUser } from '@clerk/nextjs'
import { Button } from '@ritual/ui/button'

import { clearSetupSubstep } from '@/components/onboarding/setup-wizard'
import { BrailleSpinner } from '@/components/ui/braille-spinner'
import {
  clearFromWelcomeFlow,
  clearSignUpIntent,
  hasPendingSignUpIntent,
  markDeviceAuthenticated,
} from '@/lib/onboarding-flow'
import {
  onboardingRouteForStep,
  resolveOnboardingStep,
  resolveSsoRedirectRoute,
} from '@/lib/activation-flow.mjs'
import { restoreDashboardWindowSize } from '@/lib/tauri-utils'

const DASHBOARD_RETURN_URL_KEY = 'ritual:dashboard-return-url:v1'
const ONBOARDING_V3_STEP_KEY = 'ritual:onboarding-v3-step'
const BOOTSTRAP_TIMEOUT_MS = 8_000
const BOOTSTRAP_RETRY_DELAYS_MS = [0, 750, 1_500] as const

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

function readPersistedOnboardingStep(): string | null {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(ONBOARDING_V3_STEP_KEY)
}

function clearPersistedOnboardingStep(): void {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(ONBOARDING_V3_STEP_KEY)
}

function resolveBootstrapRedirect(nextRoute: unknown, dashboardReturnUrl: string | null): string {
  const redirectRoute = resolveSsoRedirectRoute(nextRoute, dashboardReturnUrl)
  if (redirectRoute === '/dashboard' || !redirectRoute.startsWith('/onboarding')) {
    return redirectRoute
  }

  const resolvedStep = resolveOnboardingStep(redirectRoute, readPersistedOnboardingStep())
  return onboardingRouteForStep(resolvedStep)
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, delayMs))
}

async function fetchBootstrapWithRetry({
  token,
  onAttempt,
}: {
  token: string
  onAttempt: (attempt: number) => void
}): Promise<Response> {
  let lastError: unknown = new Error('Bootstrap did not start')

  for (let index = 0; index < BOOTSTRAP_RETRY_DELAYS_MS.length; index += 1) {
    const delayMs = BOOTSTRAP_RETRY_DELAYS_MS[index]
    if (delayMs > 0) {
      await wait(delayMs)
    }

    onAttempt(index + 1)
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), BOOTSTRAP_TIMEOUT_MS)

    try {
      const response = await fetch('/api/user/bootstrap', {
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      })

      if (response.ok || response.status === 401 || response.status === 403) {
        return response
      }

      lastError = new Error(`Bootstrap failed (${response.status})`)
      if (response.status < 500 && response.status !== 408 && response.status !== 429) {
        throw lastError
      }
    } catch (error) {
      lastError = error
      if (index === BOOTSTRAP_RETRY_DELAYS_MS.length - 1) {
        throw error
      }
    } finally {
      window.clearTimeout(timeoutId)
    }
  }

  throw lastError
}

async function prepareDashboardRedirect(
  target: string,
  shouldRestoreWindowSize: boolean,
): Promise<void> {
  if (target.startsWith('/dashboard')) {
    clearPersistedOnboardingStep()
    clearSetupSubstep()
    if (shouldRestoreWindowSize) {
      await restoreDashboardWindowSize()
    }
  }
}

export default function SSOCallback() {
  const router = useRouter()
  const { user, isLoaded } = useUser()
  const { getToken } = useAuth()
  const [status, setStatus] = useState('Completing sign-in...')
  const [failed, setFailed] = useState(false)
  const [retryNonce, setRetryNonce] = useState(0)

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
        setFailed(false)
        const shouldRestoreDashboardWindowSize = hasPendingSignUpIntent()
        markDeviceAuthenticated()
        clearFromWelcomeFlow()
        clearSignUpIntent()

        setStatus('Setting up your account...')
        const token = await getToken({ skipCache: true })
        if (!token) {
          router.replace('/sign-in')
          return
        }

        const response = await fetchBootstrapWithRetry({
          token,
          onAttempt: (attempt) => {
            setStatus(attempt === 1 ? 'Setting up your account...' : 'Still setting up your account...')
          },
        })

        if (response.status === 401 || response.status === 403) {
          router.replace('/sign-in')
          return
        }

        if (!response.ok) {
          throw new Error(`Bootstrap failed (${response.status})`)
        }

        const bootstrap = await response.json() as BootstrapResponse
        setStatus('Taking you to Ritual...')
        const redirectTarget = resolveBootstrapRedirect(bootstrap.nextRoute, readDashboardReturnUrl())
        await prepareDashboardRedirect(redirectTarget, shouldRestoreDashboardWindowSize)
        router.replace(redirectTarget)
      } catch (error) {
        console.error('Error completing sign-in:', error)
        setFailed(true)
        setStatus("We couldn't finish setting up your account.")
      }
    }

    void bootstrapAndRedirect()
  }, [getToken, isLoaded, retryNonce, router, user])

  return (
    <div className="min-h-screen bg-white glass-opaque-screen flex items-center justify-center">
      <div className="text-center">
        {!failed ? (
          <BrailleSpinner className="mx-auto mb-4 h-12 w-12 text-4xl text-gray-900" intervalMs={45} />
        ) : null}
        <p className="text-sm text-gray-600">{status}</p>
        {failed ? (
          <Button
            variant="outline"
            className="mt-4 shadow-none hover:bg-[var(--surface-panel)]"
            onClick={() => setRetryNonce((current) => current + 1)}
          >
            Try again
          </Button>
        ) : null}
      </div>
    </div>
  )
}
