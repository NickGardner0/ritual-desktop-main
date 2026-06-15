"use client"

import { useCallback, useEffect, useMemo, useState, type ButtonHTMLAttributes } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { ClerkLoaded, ClerkLoading, SignUp, useAuth, useUser } from "@clerk/nextjs"
import { Check, ChevronLeft } from "lucide-react"

import { AuthFlowIntent } from "@/components/auth-flow-intent"
import { ClerkOAuthHandler } from "@/components/clerk-oauth-handler"
import { DashboardPreviewWindow, LandingHeroPreviewWindow } from "@/components/onboarding/dashboard-preview-window"
import LegacyActivationOnboarding from "@/components/onboarding/legacy-activation-onboarding"
import { OnboardingWindow } from "@/components/onboarding/onboarding-window"
import { PermissionsPanel, VaultPanel } from "@/components/onboarding/onboarding-preview-panels"
import { BrailleSpinner } from "@/components/ui/braille-spinner"
import { Button } from "@/components/ui/button"
import { openLocationServicesSettings, submitCurrentLocationPing } from "@/lib/location-ping"
import {
  isTauri,
  ONBOARDING_CARD_WINDOW_HEIGHT,
  ONBOARDING_CARD_WINDOW_WIDTH,
  ONBOARDING_SIGNUP_WINDOW_HEIGHT,
  ONBOARDING_WELCOME_WINDOW_HEIGHT,
  ONBOARDING_WINDOW_HEIGHT,
  ONBOARDING_WINDOW_WIDTH,
  setOnboardingWindowSize,
} from "@/lib/tauri-utils"
import { cn } from "@/lib/utils"

type LegacyStep = "profile" | "first-behavior" | "connect"
type V3Step = "welcome" | "signup" | "meet" | "permissions" | "privacy"

type BootstrapResponse = {
  nextRoute?: string
  firstBehaviorLogged?: boolean
  permissionsSeen?: boolean
}

type ChecklistStatus = "seen" | "skipped" | "completed" | "needs_attention"

const V3_STEPS: V3Step[] = ["welcome", "signup", "meet", "permissions", "privacy"]
const LEGACY_STEPS = new Set(["profile", "first-behavior", "connect"])
const ONBOARDING_V3_STEP_KEY = "ritual:onboarding-v3-step"

function readV3Step(value: string | null): V3Step | null {
  return V3_STEPS.includes(value as V3Step) ? (value as V3Step) : null
}

function isLegacyStep(value: string | null): value is LegacyStep {
  return LEGACY_STEPS.has(value ?? "")
}

function nextStep(step: V3Step): V3Step {
  const index = V3_STEPS.indexOf(step)
  return V3_STEPS[Math.min(index + 1, V3_STEPS.length - 1)]
}

function previousStep(step: V3Step): V3Step {
  const index = V3_STEPS.indexOf(step)
  return V3_STEPS[Math.max(index - 1, 0)]
}

function previousVisibleStep(step: V3Step): V3Step {
  if (step === "permissions") return "meet"
  if (step === "meet") return "welcome"
  return previousStep(step)
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
  if (!isTauri()) return null
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
        "inline-flex rounded-sm py-2 text-sm font-medium focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2",
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

function BackButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <OnboardingButton variant="secondary" onClick={onClick} disabled={disabled} aria-label="Back">
      <ChevronLeft className="mr-[2px] h-[14px] w-[14px] text-[#111827]" strokeWidth={2.4} />
      Back
    </OnboardingButton>
  )
}

function Footer({
  onBack,
  onContinue,
  onSkip,
  continueLabel = "Continue",
  busy = false,
}: {
  onBack?: () => void
  onContinue: () => void
  onSkip?: () => void
  continueLabel?: string
  busy?: boolean
}) {
  return (
    <div className="flex items-center justify-between">
      <div>{onBack ? <BackButton onClick={onBack} disabled={busy} /> : null}</div>
      <div className="flex items-center gap-2">
        {onSkip ? (
          <OnboardingButton variant="secondary" onClick={onSkip} disabled={busy}>
            Skip
          </OnboardingButton>
        ) : null}
        <OnboardingButton onClick={onContinue} disabled={busy}>
          {busy ? "Working..." : continueLabel}
        </OnboardingButton>
      </div>
    </div>
  )
}

function TrustRow() {
  const items = ["Local-first storage", "End-to-end encrypted", "Delete anytime"]

  return (
    <div className="mt-[25px] flex flex-wrap items-center gap-x-[28px] gap-y-3">
      {items.map((item) => (
        <div key={item} className="flex items-center gap-[9px] text-[15px] font-medium text-[#3f4654]">
          <span className="flex h-[22px] w-[22px] items-center justify-center rounded-[7px] bg-[#f0f0f2]">
            <Check className="h-[14px] w-[14px] text-[#52525b]" strokeWidth={2.3} />
          </span>
          {item}
        </div>
      ))}
    </div>
  )
}

function SignUpStep({ desktopMode }: { desktopMode: boolean }) {
  return (
    <div className="flex h-screen items-center justify-center overflow-hidden bg-white px-4 py-8">
      <div className="ritual-signup-stage mx-auto max-h-full w-full max-w-md overflow-y-auto overscroll-contain px-1 py-3">
        <AuthFlowIntent mode="sign_up" />
        {desktopMode ? <ClerkOAuthHandler mode="sign_up" desktopMode /> : null}
        <div className="flex justify-center">
          <ClerkLoading>
            <div className="flex h-[560px] w-full items-center justify-center rounded-sm bg-white">
              <BrailleSpinner className="text-2xl text-gray-900" />
            </div>
          </ClerkLoading>
          <ClerkLoaded>
            <SignUp
              appearance={{
                variables: {
                  borderRadius: "0.125rem",
                },
                elements: {
                  rootBox: "mx-auto",
                  card: "shadow-sm rounded-sm",
                  formButtonPrimary: "rounded-sm",
                  socialButtonsBlockButton: "rounded-sm",
                  dividerRow: "",
                  formFieldInput: "rounded-sm",
                  footerActionText: "text-gray-600",
                  footerActionLink: "text-blue-600 hover:text-blue-500",
                },
              }}
              signInUrl="/sign-in"
              forceRedirectUrl="/auth/sso-callback"
              fallbackRedirectUrl="/auth/sso-callback"
              oauthFlow={desktopMode ? "redirect" : "auto"}
              oidcPrompt={desktopMode ? "select_account" : undefined}
            />
          </ClerkLoaded>
        </div>
      </div>
      <style jsx global>{`
        .ritual-signup-stage {
          scrollbar-width: thin;
          scrollbar-color: rgba(20, 23, 29, 0.24) transparent;
        }

        .ritual-signup-stage .cl-rootBox,
        .ritual-signup-stage .cl-cardBox,
        .ritual-signup-stage .cl-card {
          width: 100%;
          max-width: 448px;
        }

        .ritual-signup-stage .cl-card {
          border-radius: 2px;
          border: 1px solid #dedede;
          box-shadow: 0 24px 54px rgba(18, 20, 28, 0.16);
          overflow: hidden;
        }

        .ritual-signup-stage .cl-main {
          padding: 28px 38px 26px;
        }

        .ritual-signup-stage .cl-header {
          margin-bottom: 22px;
        }

        .ritual-signup-stage .cl-headerTitle {
          font-size: 28px;
          line-height: 1.14;
          letter-spacing: 0;
          font-weight: 700;
          color: #14171d;
        }

        .ritual-signup-stage .cl-headerSubtitle {
          margin-top: 8px;
          font-size: 17px;
          line-height: 1.35;
          color: #737373;
        }

        .ritual-signup-stage .cl-socialButtonsBlockButton {
          min-height: 44px;
          border-color: #dedede;
          box-shadow: 0 1px 2px rgba(18, 20, 28, 0.08);
          font-size: 15px;
          font-weight: 500;
        }

        .ritual-signup-stage .cl-dividerRow {
          margin: 22px 0;
        }

        .ritual-signup-stage .cl-form {
          gap: 16px;
        }

        .ritual-signup-stage .cl-formField {
          gap: 7px;
        }

        .ritual-signup-stage .cl-formFieldLabel {
          font-size: 14px;
          line-height: 1.3;
          font-weight: 600;
          color: #23252b;
        }

        .ritual-signup-stage .cl-formFieldInput {
          min-height: 44px;
          border-color: #dedede;
          padding: 10px 14px;
          font-size: 15px;
          line-height: 1.35;
          color: #23252b;
          box-shadow: none;
        }

        .ritual-signup-stage .cl-formFieldInput::placeholder {
          color: #737373;
        }

        .ritual-signup-stage .cl-phoneInputBox .cl-formFieldInput {
          padding-left: 8px;
        }

        .ritual-signup-stage .cl-formButtonPrimary {
          min-height: 46px;
          margin-top: 4px;
          border: 0;
          background: #000;
          box-shadow: 0 2px 5px rgba(18, 20, 28, 0.18);
          font-size: 15px;
          font-weight: 500;
        }

        .ritual-signup-stage .cl-formButtonPrimary:hover {
          background: #27251e;
        }

        .ritual-signup-stage .cl-footer {
          background: #f7f7f7;
          border-top: 1px solid #e7e7e7;
        }

        .ritual-signup-stage .cl-footerAction,
        .ritual-signup-stage .cl-footerPages {
          padding: 18px 24px;
        }

        .ritual-signup-stage .cl-footerActionText,
        .ritual-signup-stage .cl-footerActionLink {
          font-size: 15px;
          line-height: 1.35;
        }

        .ritual-signup-stage .cl-footerActionLink {
          color: #14171d;
          font-weight: 600;
        }

        .ritual-signup-stage .cl-footerActionLink:hover {
          color: #27251e;
        }
      `}</style>
    </div>
  )
}

export default function OnboardingPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { isLoaded, user } = useUser()
  const { getToken } = useAuth()
  const rawStep = searchParams.get("s")
  const queryStep = readV3Step(rawStep)
  const initialStep = useMemo(() => queryStep ?? (typeof window === "undefined" ? "welcome" : readPersistedStep() ?? "welcome"), [queryStep])

  const [step, setStep] = useState<V3Step>(initialStep)
  const [desktopMode, setDesktopMode] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const token = await getToken({ skipCache: true })
    return {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
    }
  }, [getToken])

  const goToStep = useCallback((target: V3Step) => {
    persistReachedStep(target)
    setStep(target)
    router.replace(`/onboarding?s=${target}`, { scroll: false })
  }, [router])

  useEffect(() => {
    if (isLegacyStep(rawStep)) return
    const target = queryStep ?? readPersistedStep() ?? "welcome"
    setStep(target)
    persistReachedStep(target)
    if (!queryStep) {
      router.replace(`/onboarding?s=${target}`, { scroll: false })
    }
  }, [queryStep, rawStep, router])

  useEffect(() => {
    if (isLegacyStep(rawStep)) return
    const nextDesktopMode = isTauri()
    setDesktopMode(nextDesktopMode)
    const nextHeight = step === "welcome"
      ? ONBOARDING_WELCOME_WINDOW_HEIGHT
      : step === "signup"
        ? ONBOARDING_SIGNUP_WINDOW_HEIGHT
        : ONBOARDING_CARD_WINDOW_HEIGHT
    const nextWidth = step === "welcome" || step === "signup" ? ONBOARDING_WINDOW_WIDTH : ONBOARDING_CARD_WINDOW_WIDTH
    void setOnboardingWindowSize(nextHeight, nextWidth)
  }, [rawStep, step])

  useEffect(() => {
    if (isLegacyStep(rawStep) || !isLoaded) return

    if (!user && (step === "permissions" || step === "privacy")) {
      goToStep("signup")
      return
    }

    if (user && step === "signup") {
      goToStep("meet")
    }
  }, [goToStep, isLoaded, rawStep, step, user])

  async function updateChecklist(key: "mac_activity" | "ai_voice" | "place_tagging", status: ChecklistStatus, metadata?: Record<string, unknown>) {
    const response = await fetch("/api/user/activation/checklist", {
      method: "PATCH",
      headers: await authHeaders(),
      body: JSON.stringify({ key, status, metadata: metadata ?? null }),
    })

    if (!response.ok) {
      throw new Error("Failed to update setup item")
    }
  }

  async function ensureWatcherDevice(): Promise<string> {
    const headers = await authHeaders()
    const devicesResponse = await fetch("/api/watcher/devices", { headers })
    if (devicesResponse.ok) {
      const payload = await devicesResponse.json()
      const existing = Array.isArray(payload.devices)
        ? payload.devices.find((device: any) => device.platform === "macos") ?? payload.devices[0]
        : null
      const existingId = existing?.device_id ?? existing?.id
      if (existingId) return existingId
    }

    const deviceResponse = await fetch("/api/watcher/devices", {
      method: "POST",
      headers,
      body: JSON.stringify({ device_name: "My Mac", platform: "macos" }),
    })
    if (!deviceResponse.ok) {
      throw new Error("Failed to register watcher device")
    }
    const device = await deviceResponse.json()
    return device.device_id
  }

  async function ensureComputerTimeHabit() {
    await fetch("/api/habits", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({
        name: "Computer Time",
        category: "Productivity",
        is_custom: false,
        sensor_type: "Manual",
        icon: "lucide:monitor",
        unit_type: "Hours",
        integration_source: null,
        metric_type: null,
      }),
    }).catch(() => undefined)
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
    await fetch(`/api/watcher/devices/${deviceId}/start`, {
      method: "POST",
      headers: await authHeaders(),
    }).catch(() => undefined)
    return { completed: true, metadata: { permission: "accessibility", granted: true, deviceId } }
  }

  async function markSetupSeen(): Promise<BootstrapResponse | null> {
    if (!user) return null
    const response = await fetch("/api/user/activation/permissions-seen", {
      method: "PATCH",
      headers: await authHeaders(),
    })
    if (!response.ok) {
      throw new Error("Failed to finish setup")
    }
    return response.json()
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

    await openPrivacyPane(invoke, "open_screen_recording_settings")
    await openPrivacyPane(invoke, "open_input_monitoring_settings")
    await openPrivacyPane(invoke, "open_full_disk_access_settings")
  }

  async function finishV3Flow() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await markSetupSeen()
      clearPersistedStep()
      router.replace("/dashboard")
    } catch (finishError) {
      console.error("Failed finishing onboarding:", finishError)
      setError("Unable to finish setup. Please try again.")
      setBusy(false)
    }
  }

  async function allowAndContinue() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await requestDesktopPermissions()
      goToStep("privacy")
    } catch (permissionError) {
      console.error("Failed requesting desktop permissions:", permissionError)
      setError("Some permissions could not be requested. You can continue and adjust them later in Settings.")
    } finally {
      setBusy(false)
    }
  }

  if (isLegacyStep(rawStep)) {
    return <LegacyActivationOnboarding />
  }

  if (!isLoaded && step !== "welcome") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <BrailleSpinner className="text-2xl text-gray-900" />
      </div>
    )
  }

  if (step === "signup") {
    return <SignUpStep desktopMode={desktopMode} />
  }

  const windowClassName = step === "welcome" ? "h-[612px] max-w-[800px]" : "h-[500px] max-w-[720px]"
  const pageClassName = desktopMode
    ? "min-h-screen bg-white"
    : "min-h-screen bg-[#e9e9e7]"

  return (
    <div className={cn("flex items-center justify-center overflow-hidden", pageClassName)}>
      <div data-tauri-drag-region className="fixed left-0 right-0 top-0 z-50 h-8" />
      {step === "welcome" ? (
        <OnboardingWindow
          className={windowClassName}
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
            <Footer
              onContinue={() => goToStep(user ? "meet" : "signup")}
              continueLabel="Get Started"
            />
          }
        />
      ) : null}

      {step === "meet" ? (
        <OnboardingWindow
          className={windowClassName}
          title="Your way to track anything"
          banner={<LandingHeroPreviewWindow />}
          body="Ritual is a collection of self-tracking and observability tools used to measure and quantify your behavior. It connects the data from your wearables, your computer, and your phone, quietly logging in the background while you live your life."
          footer={<Footer onBack={() => goToStep(previousVisibleStep(step))} onContinue={() => goToStep(user ? "permissions" : "signup")} />}
        />
      ) : null}

      {step === "permissions" ? (
        <OnboardingWindow
          className={windowClassName}
          title="Grant permissions"
          banner={<PermissionsPanel />}
          body="Allow Ritual to read local activity, files, microphone, screen context, and place context so it can track your day in the background. You can change these permissions anytime in macOS Settings."
          footer={
            <Footer
              onBack={() => goToStep(previousVisibleStep(step))}
              onSkip={() => goToStep(nextStep(step))}
              onContinue={() => void allowAndContinue()}
              continueLabel="Allow & Continue"
              busy={busy}
            />
          }
        />
      ) : null}

      {step === "privacy" ? (
        <OnboardingWindow
          className={windowClassName}
          title="Your data stays yours"
          banner={<VaultPanel />}
          body="Everything Ritual remembers lives on your Mac, encrypted with a key only you hold. No cloud sync, and your data is never used to train anyone's models."
          afterBody={<TrustRow />}
          footer={<Footer onBack={() => goToStep(previousVisibleStep(step))} onContinue={() => void finishV3Flow()} busy={busy} />}
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
