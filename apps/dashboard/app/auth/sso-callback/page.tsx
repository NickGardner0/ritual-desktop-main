'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth, useClerk, useUser } from '@clerk/nextjs'
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
import { storeBootstrapHandoff } from '@/lib/bootstrap-handoff'
import { restoreDashboardWindowSize } from '@/lib/tauri-utils'

const DASHBOARD_RETURN_URL_KEY = 'ritual:dashboard-return-url:v1'
const ONBOARDING_V3_STEP_KEY = 'ritual:onboarding-v3-step'
const BOOTSTRAP_TIMEOUT_MS = 30_000

type BootstrapResponse = {
  nextRoute?: string
}

type BootstrapFailure = {
  code: string
  message: string
}

class BootstrapError extends Error {
  code: string

  constructor(failure: BootstrapFailure) {
    super(failure.message)
    this.name = 'BootstrapError'
    this.code = failure.code
  }
}

async function readBootstrapFailure(response: Response): Promise<BootstrapFailure> {
  const fallback = {
    code: 'account_setup_failed',
    message: 'Ritual could not finish creating your account. Please try again.',
  }

  try {
    const payload = await response.json() as {
      detail?: unknown
      error?: unknown
    }
    let detail = payload.detail
    if (!detail && typeof payload.error === 'string') {
      try {
        detail = (JSON.parse(payload.error) as { detail?: unknown }).detail
      } catch {
        detail = null
      }
    }
    if (detail && typeof detail === 'object') {
      const candidate = detail as { code?: unknown; message?: unknown }
      return {
        code: typeof candidate.code === 'string' ? candidate.code : fallback.code,
        message: typeof candidate.message === 'string' ? candidate.message : fallback.message,
      }
    }
  } catch {
    // Keep the safe user-facing fallback.
  }

  return fallback
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

async function fetchBootstrap(token: string): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), BOOTSTRAP_TIMEOUT_MS)

  try {
    return await fetch('/api/user/bootstrap', {
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
  const { signOut } = useClerk()
  const [status, setStatus] = useState('Completing sign-in...')
  const [failure, setFailure] = useState<BootstrapFailure | null>(null)
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
        setFailure(null)
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

        const bootstrapStartedAt = window.performance.now()
        const response = await fetchBootstrap(token)
        const bootstrapDurationMs = window.performance.now() - bootstrapStartedAt
        console.info('[Ritual][account-bootstrap] completed', {
          duration_ms: Math.round(bootstrapDurationMs),
          backend_duration_ms: response.headers.get('x-ritual-bootstrap-duration-ms'),
          mode: response.headers.get('x-ritual-bootstrap-mode'),
          server_timing: response.headers.get('server-timing'),
          status: response.status,
        })

        if (response.status === 401 || response.status === 403) {
          router.replace('/sign-in')
          return
        }

        if (!response.ok) {
          throw new BootstrapError(await readBootstrapFailure(response))
        }

        const bootstrap = await response.json() as BootstrapResponse
        setStatus('Taking you to Ritual...')
        const redirectTarget = resolveBootstrapRedirect(bootstrap.nextRoute, readDashboardReturnUrl())
        if (redirectTarget.startsWith('/onboarding')) {
          storeBootstrapHandoff(bootstrap)
        }
        await prepareDashboardRedirect(redirectTarget, shouldRestoreDashboardWindowSize)
        router.replace(redirectTarget)
      } catch (error) {
        console.error('Error completing sign-in:', error)
        setStatus("We couldn't finish setting up your account.")
        setFailure({
          code: error instanceof BootstrapError ? error.code : 'account_setup_failed',
          message: error instanceof Error
            ? error.message
            : 'Ritual could not finish creating your account. Please try again.',
        })
      }
    }

    void bootstrapAndRedirect()
  }, [getToken, isLoaded, retryNonce, router, user])

  return (
    <div className="min-h-screen bg-white glass-opaque-screen flex items-center justify-center">
      <div className="text-center">
        {!failure ? (
          <BrailleSpinner className="mx-auto mb-4 h-12 w-12 text-4xl text-gray-900" intervalMs={45} />
        ) : null}
        <p className="text-sm text-gray-600">{status}</p>
        {failure ? (
          <>
            <p role="alert" className="mt-3 max-w-md text-sm leading-6 text-[var(--ritual-text-secondary)]">
              {failure.message}
            </p>
            {failure.code === 'account_identity_conflict' ? (
              <p className="mt-2 max-w-md text-sm leading-6 text-[var(--ritual-text-muted)]">
                If you just deleted this account, cleanup may still be processing. Retrying is safe.
              </p>
            ) : null}
            <div className="mt-4 flex justify-center gap-3">
              <Button
                variant="outline"
                className="shadow-none hover:bg-[var(--surface-panel)]"
                onClick={() => setRetryNonce((current) => current + 1)}
              >
                Try again
              </Button>
              <Button
                variant="outline"
                className="shadow-none hover:bg-[var(--surface-panel)]"
                onClick={() => void signOut({ redirectUrl: '/sign-in' })}
              >
                Sign out
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
