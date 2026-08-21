"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { ClerkLoaded, ClerkLoading, SignUp, useAuth, useUser } from "@clerk/nextjs"
import { ChevronLeft } from "lucide-react"

import { AuthFlowIntent } from "@/components/auth-flow-intent"
import { ClerkOAuthHandler } from "@/components/clerk-oauth-handler"
import { DashboardPreviewWindow } from "@/components/onboarding/dashboard-preview-window"
import { clearSetupSubstep, SetupWizard } from "@/components/onboarding/setup-wizard"
import {
  normalizeOnboardingStep,
  onboardingRouteForStep,
  parseOnboardingStepFromRoute,
  resolveOnboardingStep,
  resolveSsoRedirectRoute,
} from "@/lib/activation-flow.mjs"
import { consumeBootstrapHandoff } from "@/lib/bootstrap-handoff"
import { apiOperationWithAuth } from "@/lib/api/client"
import { OnboardingWindow } from "@/components/onboarding/onboarding-window"
import { BrailleSpinner } from "@/components/ui/braille-spinner"
import { Button } from "@/components/ui/button"
import { openLocationServicesSettings, submitCurrentLocationPing } from "@/lib/location-ping"
import { getDesktopCapabilities, useDesktopCapabilities } from '@/lib/desktop-capabilities'
import { initializeDesktopVault } from '@/lib/privacy/vault-client'
import {
  ONBOARDING_SETUP_WINDOW_WIDTH,
  ONBOARDING_SETUP_WINDOW_HEIGHT,
  ONBOARDING_SIGNUP_WINDOW_WIDTH,
  ONBOARDING_SIGNUP_WINDOW_HEIGHT,
  ONBOARDING_WELCOME_WINDOW_WIDTH,
  ONBOARDING_WELCOME_WINDOW_HEIGHT,
  restoreDashboardWindowSize,
  setOnboardingWindowSize,
} from "@/lib/native-gateway"
import { cn } from "@/lib/utils"

type V3Step = "welcome" | "signup" | "setup"

type BootstrapResponse = {
  nextRoute?: string
  firstBehaviorLogged?: boolean
  permissionsSeen?: boolean
}

type ChecklistStatus = "seen" | "skipped" | "completed" | "needs_attention"

const V3_STEPS: V3Step[] = ["welcome", "signup", "setup"]
const ONBOARDING_V3_STEP_KEY = "ritual:onboarding-v3-step"

function readV3Step(value: string | null): V3Step | null {
  return normalizeOnboardingStep(value)
}

function readPersistedStep(): V3Step | null {
  if (typeof window === "undefined") return null
  return readV3Step(window.localStorage.getItem(ONBOARDING_V3_STEP_KEY))
}

function persistReachedStep(step: V3Step) {
  if (typeof window === "undefined") return

  const current = readPersistedStep()
  if (!current || V3_STEPS.indexOf(step) > V3_STEPS.indexOf(current)) {
    window.localStorage.setItem(ONBOARDING_V3_STEP_KEY, step)
  }
}

function clearPersistedStep() {
  if (typeof window === "undefined") return
  window.localStorage.removeItem(ONBOARDING_V3_STEP_KEY)
}

async function getInvoke() {
  if (!getDesktopCapabilities().isDesktop) return null
  try {
    const mod = await import("@tauri-apps/api/core")
    return mod.invoke
  } catch {
    return null
  }
}

function OnboardingButton({
  children,
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" }) {
  return (
    <Button
      {...props}
      className={cn(
        "inline-flex rounded-md py-2 text-sm font-medium focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2",
        variant === "primary"
          ? "bg-black px-10 text-white shadow transition-colors duration-200 hover:bg-[#27251E]"
          : "border border-gray-300 bg-white px-4 text-gray-900 shadow-none transition-colors duration-200 hover:bg-[#F3F3F3]",
        className,
      )}
    >
      {children}
    </Button>
  )
}

function SignUpStep({ desktopMode, oauthFlowMode }: { desktopMode: boolean; oauthFlowMode: 'redirect' | 'auto' }) {
  return (
    <div className="ritual-onboarding-font flex h-screen items-center justify-center overflow-hidden bg-[#fcfcfa] px-4 py-5">
      <div className="w-full max-w-[420px]">
        <AuthFlowIntent mode="sign_up" />
        {desktopMode ? <ClerkOAuthHandler mode="sign_up" desktopMode /> : null}
        <div className="flex justify-center">
          <ClerkLoading>
            <div className="flex h-[420px] w-full items-center justify-center bg-[#fcfcfa]">
              <BrailleSpinner className="text-2xl text-gray-900" />
            </div>
          </ClerkLoading>
          <ClerkLoaded>
            <SignUp
              routing="hash"
              signInUrl="/sign-in"
              forceRedirectUrl="/auth/sso-callback"
              fallbackRedirectUrl="/auth/sso-callback"
              oauthFlow={oauthFlowMode}
              oidcPrompt={desktopMode ? "select_account" : undefined}
              appearance={{
                variables: {
                  fontFamily: "'FK Grotesk Neue', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                  fontFamilyButtons: "'FK Grotesk Neue', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                },
              }}
            />
          </ClerkLoaded>
        </div>
      </div>
    </div>
  )
}

export default function OnboardingPage() {
  const { isDesktop, oauthFlow } = useDesktopCapabilities()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { isLoaded, user } = useUser()
  const { getToken } = useAuth()
  const rawStep = searchParams.get("s")
  const queryStep = readV3Step(rawStep)
  const initialStep = useMemo(() => queryStep ?? (typeof window === "undefined" ? "welcome" : readPersistedStep() ?? "welcome"), [queryStep])

  const [step, setStep] = useState<V3Step>(initialStep)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bootstrapSyncUserRef = useRef<string | null>(null)

  const getOnboardingToken = useCallback(
    async (opts?: { skipCache?: boolean }) => getToken({ skipCache: opts?.skipCache ?? true }),
    [getToken],
  )

  const goToStep = useCallback((target: V3Step) => {
    persistReachedStep(target)
    setStep(target)
    router.replace(onboardingRouteForStep(target), { scroll: false })
  }, [router])

  useEffect(() => {
    const target = queryStep ?? readPersistedStep() ?? "welcome"
    queueMicrotask(() => setStep(target))
    persistReachedStep(target)
    if (!queryStep) {
      router.replace(onboardingRouteForStep(target), { scroll: false })
    }
  }, [queryStep, router])

  useEffect(() => {
    const nextSize = step === "welcome"
      ? { height: ONBOARDING_WELCOME_WINDOW_HEIGHT, width: ONBOARDING_WELCOME_WINDOW_WIDTH }
      : step === "signup"
        ? { height: ONBOARDING_SIGNUP_WINDOW_HEIGHT, width: ONBOARDING_SIGNUP_WINDOW_WIDTH }
        : { height: ONBOARDING_SETUP_WINDOW_HEIGHT, width: ONBOARDING_SETUP_WINDOW_WIDTH }
    void setOnboardingWindowSize(nextSize.height, nextSize.width)
  }, [step])

  useEffect(() => {
    if (!isLoaded) return

    if (!user && step === "setup") {
      queueMicrotask(() => goToStep("signup"))
      return
    }

    if (user && step === "signup") {
      queueMicrotask(() => goToStep("setup"))
    }
  }, [goToStep, isLoaded, step, user])

  useEffect(() => {
    if (!isLoaded || !user) return
    if (bootstrapSyncUserRef.current === user.id) return
    bootstrapSyncUserRef.current = user.id

    let cancelled = false

    const applyBootstrapRoute = async (bootstrap: BootstrapResponse) => {
      if (cancelled) return

      const redirectRoute = resolveSsoRedirectRoute(bootstrap.nextRoute, undefined)

      if (redirectRoute === "/dashboard") {
        clearPersistedStep()
        clearSetupSubstep()
        await restoreDashboardWindowSize()
        router.replace("/dashboard")
        return
      }

      const backendStep = parseOnboardingStepFromRoute(redirectRoute)
      if (!backendStep) {
        return
      }

      const resolvedStep = resolveOnboardingStep(redirectRoute, readPersistedStep() ?? queryStep)
      if (resolvedStep !== step) {
        goToStep(resolvedStep)
      }
    }

    const syncBootstrapRoute = async () => {
      try {
        const handoff = consumeBootstrapHandoff()
        if (handoff) {
          await applyBootstrapRoute(handoff)
          return
        }

        const bootstrap = await apiOperationWithAuth(
          "get_user_bootstrap_api_user_bootstrap_get",
          getOnboardingToken,
          {},
          user?.id,
        )
        if (cancelled) return
        await applyBootstrapRoute(bootstrap)
      } catch (bootstrapError) {
        console.warn("Unable to sync onboarding bootstrap route:", bootstrapError)
      }
    }

    void syncBootstrapRoute()

    return () => {
      cancelled = true
    }
  }, [getOnboardingToken, goToStep, isLoaded, queryStep, router, step, user])

  async function updateChecklist(key: "mac_activity" | "ai_voice" | "place_tagging", status: ChecklistStatus, metadata?: Record<string, unknown>) {
    await apiOperationWithAuth(
      "update_activation_checklist_api_user_activation_checklist_patch",
      getOnboardingToken,
      { body: { key, status, metadata: metadata ?? null } },
      user?.id,
    )
  }

  async function ensureWatcherDevice(): Promise<string> {
    try {
      const payload = await apiOperationWithAuth(
        "list_devices_api_watcher_devices_get",
        getOnboardingToken,
        {},
        user?.id,
      ) as { devices?: Array<{ platform?: string; device_id?: string; id?: string }> }
      const existing = Array.isArray(payload.devices)
        ? payload.devices.find((device) => device.platform === "macos") ?? payload.devices[0]
        : null
      const existingId = existing?.device_id ?? existing?.id
      if (existingId) return existingId
    } catch {
      // Register a new device when the list is unavailable.
    }

    const device = await apiOperationWithAuth(
      "register_device_api_watcher_devices_post",
      getOnboardingToken,
      { body: { device_name: "My Mac", platform: "macos" } },
      user?.id,
    )
    return device.device_id
  }

  async function ensureComputerTimeHabit() {
    await apiOperationWithAuth(
      "create_habit_api_habits_post",
      getOnboardingToken,
      {
        body: {
          name: "Computer Time",
          category: "Productivity",
          is_custom: false,
          sensor_type: "Manual",
          icon: "lucide:monitor",
          unit_type: "Hours",
          integration_source: null,
          metric_type: null,
        },
      },
      user?.id,
    ).catch(() => undefined)
  }

  async function bootstrapMacActivityWatcher(): Promise<{ completed: boolean; metadata: Record<string, unknown> }> {
    const invoke = await getInvoke()
    if (!invoke || !user?.id) {
      return { completed: false, metadata: { surface: "web" } }
    }

    let granted = await invoke<boolean>("check_accessibility_permission").catch(() => false)
    if (!granted) {
      granted = await invoke<boolean>("request_accessibility_permission").catch(() => false)
    }
    if (!granted) {
      await invoke("open_accessibility_settings").catch(() => undefined)
      return { completed: false, metadata: { permission: "accessibility", granted: false } }
    }

    const deviceId = await ensureWatcherDevice()
    const config = {
      device_id: deviceId,
      user_id: user.id,
      poll_interval_ms: 2000,
      title_mode: "off",
      truncate_length: 80,
      excluded_bundle_ids: [],
      afk_timeout_seconds: 900,
      url_mode: "domain",
      track_incognito: false,
      browser_heartbeat_port: 8766,
    }
    await invoke("start_watcher", { config })
    await invoke("save_watcher_config_cmd", { config })
    await ensureComputerTimeHabit()
    await apiOperationWithAuth(
      "start_watcher_api_watcher_devices__device_id__start_post",
      getOnboardingToken,
      { pathParams: { device_id: deviceId } },
      user?.id,
    ).catch(() => undefined)
    return { completed: true, metadata: { permission: "accessibility", granted: true, deviceId } }
  }

  async function markSetupSeen(): Promise<BootstrapResponse | null> {
    if (!user) return null
    return await apiOperationWithAuth(
      "mark_activation_permissions_seen_api_user_activation_permissions_seen_patch",
      getOnboardingToken,
      {},
      user?.id,
    )
  }

  async function ensureLocalAccountVault(): Promise<void> {
    if (!isDesktop || !user?.id) return
    const status = await initializeDesktopVault(user.id)
    if (!status?.initialized) {
      throw new Error("Local account vault was not initialized")
    }
  }

  async function persistProfileTimezone(): Promise<void> {
    if (!user) return

    const fullName = user.fullName?.trim()
      || [user.firstName, user.lastName].filter(Boolean).join(" ").trim()
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone?.trim()
    if (!fullName || fullName.length < 2 || !timezone) return

    await apiOperationWithAuth(
      "update_user_bootstrap_profile_api_user_bootstrap_profile_patch",
      getOnboardingToken,
      { body: { fullName, timezone } },
      user?.id,
    )
  }

  async function openPrivacyPane(invoke: NonNullable<Awaited<ReturnType<typeof getInvoke>>>, command: string) {
    await invoke(command).catch((settingsError) => {
      console.warn(`Unable to open ${command}:`, settingsError)
    })
  }

  async function requestPlaceTaggingPermission(): Promise<{ completed: boolean; metadata: Record<string, unknown> }> {
    const token = await getToken({ skipCache: true })
    const result = await submitCurrentLocationPing({
      authToken: token,
      reason: "onboarding_place_tagging",
      maxRecentAgeMs: 0,
      timeoutMs: 8000,
    })

    if (result.status === "submitted") {
      return {
        completed: true,
        metadata: {
          permission: "location",
          granted: true,
          source: result.source,
          accuracyM: result.accuracyM,
        },
      }
    }

    return {
      completed: false,
      metadata: {
        permission: "location",
        granted: false,
        status: result.status,
        reason: result.reason,
      },
    }
  }

  async function requestDesktopPermissions() {
    const invoke = await getInvoke()
    if (!invoke || !user?.id) {
      return
    }

    const macActivity = await bootstrapMacActivityWatcher().catch(async (watcherError) => {
      console.warn("Unable to fully bootstrap macOS activity watcher:", watcherError)
      await openPrivacyPane(invoke, "open_accessibility_settings")
      return { completed: false, metadata: { permission: "accessibility", granted: false, error: String(watcherError) } }
    })
    await updateChecklist("mac_activity", macActivity.completed ? "completed" : "seen", macActivity.metadata).catch(() => undefined)

    const microphone = await invoke<boolean>("show_native_microphone_permission_dialog").catch(() => false)
    const speech = await invoke<boolean>("show_native_speech_recognition_permission_dialog").catch(() => false)
    if (!microphone) {
      await openPrivacyPane(invoke, "open_microphone_settings")
    }
    if (!speech) {
      await openPrivacyPane(invoke, "open_speech_recognition_settings")
    }
    await updateChecklist("ai_voice", microphone && speech ? "completed" : "needs_attention", {
      microphone,
      speech,
    }).catch(() => undefined)

    const placeTagging = await requestPlaceTaggingPermission().catch(async (locationError) => {
      console.warn("Unable to request place tagging permission:", locationError)
      await openLocationServicesSettings()
      return {
        completed: false,
        metadata: { permission: "location", granted: false, error: String(locationError) },
      }
    })
    if (!placeTagging.completed) {
      await openLocationServicesSettings()
    }
    await updateChecklist(
      "place_tagging",
      placeTagging.completed ? "completed" : "needs_attention",
      placeTagging.metadata,
    ).catch(() => undefined)
  }

  const finishSetupFlow = useCallback(async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await persistProfileTimezone().catch((profileError) => {
        console.warn("Unable to persist onboarding profile details:", profileError)
      })
      await ensureLocalAccountVault()
      const bootstrap = await markSetupSeen()
      if (bootstrap?.nextRoute !== "/dashboard") {
        throw new Error("Setup completion did not return the dashboard route")
      }
      const redirectRoute = resolveSsoRedirectRoute(bootstrap?.nextRoute, undefined)
      if (redirectRoute !== "/dashboard") {
        throw new Error("Setup completion did not resolve to the dashboard")
      }
      clearPersistedStep()
      clearSetupSubstep()
      await restoreDashboardWindowSize()
      router.replace(redirectRoute)
      void requestDesktopPermissions().catch((permissionError) => {
        console.warn("Setup permissions finished with partial errors:", permissionError)
      })
    } catch (finishError) {
      console.error("Failed finishing onboarding:", finishError)
      setError("Unable to finish setup. Please try again.")
      setBusy(false)
    }
  }, [busy, requestDesktopPermissions, markSetupSeen, persistProfileTimezone, router])

  if (!isLoaded && step !== "welcome") {
    return (
      <div className="ritual-onboarding-font flex min-h-screen items-center justify-center bg-[#fcfcfa]">
        <BrailleSpinner className="text-2xl text-gray-900" />
      </div>
    )
  }

  if (step === "signup") {
    return <SignUpStep desktopMode={isDesktop} oauthFlowMode={oauthFlow} />
  }

  if (step === "setup") {
    return (
      <div className="ritual-onboarding-font h-screen w-screen">
        <SetupWizard
          busy={busy}
          userId={user?.id}
          onFinish={() => void finishSetupFlow()}
        />
        {error ? (
          <p className="fixed bottom-4 left-1/2 z-[60] max-w-[680px] -translate-x-1/2 rounded-sm border border-red-200 bg-white px-4 py-3 text-[13px] text-red-700 shadow-sm">
            {error}
          </p>
        ) : null}
      </div>
    )
  }

  const pageClassName = isDesktop
    ? "min-h-screen bg-[#fcfcfa]"
    : "min-h-screen bg-[#e9e9e7]"

  return (
    <div className={cn("ritual-onboarding-font flex items-center justify-center overflow-hidden", pageClassName)}>
      <div data-tauri-drag-region className="fixed left-0 right-0 top-0 z-50 h-8" />
      {step === "welcome" ? (
        <OnboardingWindow
          className="h-[612px] max-w-[800px]"
          bannerSize="welcome"
          title="Welcome to Ritual"
          banner={
            <div className="absolute left-1/2 top-[30px] w-[450px] -translate-x-1/2">
              <DashboardPreviewWindow />
            </div>
          }
          body={
            <>
              Ritual quietly builds a private memory of your work and life — from your apps, files, and wearables — so
              the tools you already use finally understand you.
            </>
          }
          afterBody={
            <p className="mt-[17px] text-[14px] leading-[1.45] text-[#737373]">
              By signing in you agree to our{" "}
              <Link className="underline underline-offset-2" href="/terms">
                Terms of service
              </Link>{" "}
              &{" "}
              <Link className="underline underline-offset-2" href="/privacy">
                Privacy policy
              </Link>
              .
            </p>
          }
          footer={
            <div className="flex justify-center">
              <OnboardingButton onClick={() => goToStep(user ? "setup" : "signup")}>
                Get Started
              </OnboardingButton>
            </div>
          }
        />
      ) : null}

      {error ? (
        <p className="fixed bottom-4 left-1/2 max-w-[680px] -translate-x-1/2 rounded-sm border border-red-200 bg-white px-4 py-3 text-[13px] text-red-700 shadow-sm">
          {error}
        </p>
      ) : null}
    </div>
  )
}
