"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useAuth, useUser } from "@clerk/nextjs"
import {
  Activity,
  ArrowRight,
  Bell,
  Check,
  Circle,
  Dumbbell,
  Focus,
  HeartPulse,
  Mic,
  Monitor,
  Moon,
  Shield,
  SkipForward,
  Smile,
  Sparkles,
  Watch,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { BrailleSpinner } from "@/components/ui/braille-spinner"
import { isTauri, setOnboardingWindowSize } from "@/lib/tauri-utils"
import { readOnboardingStep } from "@/lib/activation-flow.mjs"

type TemplateKey = "sleep" | "exercise" | "focus" | "mood" | "custom"
type OnboardingStep = "profile" | "first-behavior" | "connect"
type ChecklistKey =
  | "mac_activity"
  | "apple_health"
  | "oura"
  | "whoop"
  | "garmin"
  | "ai_voice"
  | "reminders"
type ChecklistStatus = "not_started" | "seen" | "skipped" | "completed" | "needs_attention"

type ChecklistItem = {
  key: ChecklistKey
  status: ChecklistStatus
  metadata?: Record<string, unknown> | null
}

type BootstrapResponse = {
  nextRoute: string
  permissionsSeen?: boolean
  activation?: {
    checklist?: ChecklistItem[]
  }
  user?: {
    fullName?: string | null
    timezone?: string | null
  }
}

const starterTemplates: Array<{
  key: TemplateKey
  title: string
  description: string
  unitLabel: string
  defaultValue: string
  Icon: typeof Moon
}> = [
  {
    key: "sleep",
    title: "Sleep",
    description: "Log hours slept.",
    unitLabel: "Hours",
    defaultValue: "7.5",
    Icon: Moon,
  },
  {
    key: "exercise",
    title: "Exercise",
    description: "Log minutes moved.",
    unitLabel: "Minutes",
    defaultValue: "30",
    Icon: Dumbbell,
  },
  {
    key: "focus",
    title: "Focus",
    description: "Log focused work.",
    unitLabel: "Hours",
    defaultValue: "1",
    Icon: Focus,
  },
  {
    key: "mood",
    title: "Mood",
    description: "Log a 1-10 score.",
    unitLabel: "Score",
    defaultValue: "7",
    Icon: Smile,
  },
  {
    key: "custom",
    title: "Custom",
    description: "Track anything manually.",
    unitLabel: "Value",
    defaultValue: "1",
    Icon: Circle,
  },
]

const setupItems: Array<{
  key: ChecklistKey
  title: string
  description: string
  action: string
  Icon: typeof Monitor
}> = [
  {
    key: "mac_activity",
    title: "Enable Mac activity",
    description: "Use accessibility access to capture app and focus context.",
    action: "Enable",
    Icon: Monitor,
  },
  {
    key: "apple_health",
    title: "Connect Apple Health",
    description: "Bring in sleep, steps, and health signals from iPhone.",
    action: "Connect",
    Icon: HeartPulse,
  },
  {
    key: "oura",
    title: "Connect Oura",
    description: "Sync sleep and recovery trends.",
    action: "Connect",
    Icon: Watch,
  },
  {
    key: "whoop",
    title: "Connect Whoop",
    description: "Sync strain, recovery, and sleep.",
    action: "Connect",
    Icon: Activity,
  },
  {
    key: "garmin",
    title: "Connect Garmin",
    description: "Sync workouts and daily body metrics.",
    action: "Connect",
    Icon: Watch,
  },
  {
    key: "ai_voice",
    title: "Try voice logging",
    description: "Allow microphone and speech recognition for spoken logs.",
    action: "Enable",
    Icon: Mic,
  },
  {
    key: "reminders",
    title: "Set reminders",
    description: "Allow prompts that make logging easier to remember.",
    action: "Enable",
    Icon: Bell,
  },
]

function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York"
  } catch {
    return "America/New_York"
  }
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10)
}

function stepIndex(step: OnboardingStep): number {
  if (step === "first-behavior") return 2
  if (step === "connect") return 3
  return 1
}

function stepRoute(step: OnboardingStep): string {
  return `/onboarding?s=${step}`
}

function statusLabel(status: ChecklistStatus): string {
  switch (status) {
    case "completed":
      return "Connected"
    case "skipped":
      return "Skipped"
    case "needs_attention":
      return "Needs attention"
    case "seen":
      return "Ready later"
    default:
      return "Optional"
  }
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

export default function OnboardingPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { isLoaded, user } = useUser()
  const { getToken } = useAuth()
  const requestedStep = readOnboardingStep(searchParams.get("s")) as OnboardingStep

  const [checking, setChecking] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [busyKey, setBusyKey] = useState<ChecklistKey | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null)
  const [name, setName] = useState("")
  const [timezone, setTimezone] = useState(getBrowserTimezone)
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateKey>("sleep")
  const [customName, setCustomName] = useState("")
  const [logValue, setLogValue] = useState("7.5")
  const [logDate, setLogDate] = useState(todayIsoDate)

  const selected = useMemo(
    () => starterTemplates.find((template) => template.key === selectedTemplate) ?? starterTemplates[0],
    [selectedTemplate],
  )

  const checklistByKey = useMemo(() => {
    const rows = bootstrap?.activation?.checklist ?? []
    return new Map(rows.map((item) => [item.key, item.status]))
  }, [bootstrap])

  const progress = `${(stepIndex(requestedStep) / 3) * 100}%`

  const fetchBootstrap = useCallback(async (): Promise<BootstrapResponse> => {
    const token = await getToken({ skipCache: true })
    if (!token) {
      throw new Error("Authentication required")
    }

    const response = await fetch("/api/user/bootstrap", {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Ritual-Force-Fresh": "1",
      },
    })
    if (!response.ok) {
      throw new Error(`Bootstrap failed (${response.status})`)
    }
    return response.json()
  }, [getToken])

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const token = await getToken({ skipCache: true })
    return {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
    }
  }, [getToken])

  useEffect(() => {
    setOnboardingWindowSize()
  }, [])

  useEffect(() => {
    if (!isLoaded) return
    if (!user) {
      router.replace("/sign-in")
      return
    }

    const load = async () => {
      try {
        setChecking(true)
        const nextBootstrap = await fetchBootstrap()
        setBootstrap(nextBootstrap)
        if (nextBootstrap.nextRoute === "/dashboard") {
          router.replace("/dashboard")
          return
        }
        if (nextBootstrap.nextRoute !== stepRoute(requestedStep)) {
          router.replace(nextBootstrap.nextRoute || "/onboarding?s=profile")
          return
        }
        setName(nextBootstrap.user?.fullName || user.fullName || user.firstName || "")
        setTimezone(nextBootstrap.user?.timezone || getBrowserTimezone())
      } catch (loadError) {
        console.error("Failed loading onboarding state:", loadError)
        setError("Unable to load setup. Please try signing in again.")
      } finally {
        setChecking(false)
      }
    }

    void load()
  }, [fetchBootstrap, isLoaded, requestedStep, router, user])

  useEffect(() => {
    const nextDefault = starterTemplates.find((template) => template.key === selectedTemplate)?.defaultValue ?? "1"
    setLogValue(nextDefault)
  }, [selectedTemplate])

  async function updateChecklist(key: ChecklistKey, status: Exclude<ChecklistStatus, "not_started">, metadata?: Record<string, unknown>) {
    const headers = await authHeaders()
    const response = await fetch("/api/user/activation/checklist", {
      method: "PATCH",
      headers,
      body: JSON.stringify({ key, status, metadata: metadata ?? null }),
    })
    if (!response.ok) {
      throw new Error("Failed to update setup item")
    }
    setBootstrap(await response.json())
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

  async function configureReminders(): Promise<{ completed: boolean; metadata: Record<string, unknown> }> {
    if (typeof window === "undefined" || !("Notification" in window)) {
      return { completed: false, metadata: { notification: "unsupported" } }
    }

    const permission = Notification.permission === "default"
      ? await Notification.requestPermission()
      : Notification.permission
    return {
      completed: permission === "granted",
      metadata: { notification: permission },
    }
  }

  async function submitProfile() {
    if (submitting) return
    const cleanName = name.trim()
    const cleanTimezone = timezone.trim()
    if (cleanName.length < 2) {
      setError("Enter your name.")
      return
    }
    if (!cleanTimezone) {
      setError("Enter your timezone.")
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const headers = await authHeaders()
      const response = await fetch("/api/user/bootstrap/profile", {
        method: "PATCH",
        headers,
        body: JSON.stringify({ fullName: cleanName, timezone: cleanTimezone }),
      })
      if (!response.ok) {
        throw new Error("Failed to save profile")
      }
      const nextBootstrap = await response.json() as BootstrapResponse
      router.replace(nextBootstrap.nextRoute || "/onboarding?s=first-behavior")
    } catch (submitError) {
      console.error("Failed saving onboarding profile:", submitError)
      setError("Unable to save profile. Please try again.")
      setSubmitting(false)
    }
  }

  async function submitFirstBehavior() {
    if (submitting) return
    const amount = Number(logValue)
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter a positive value.")
      return
    }
    if (selectedTemplate === "custom" && customName.trim().length < 2) {
      setError("Name your custom behavior.")
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const response = await fetch("/api/user/activation/first-behavior", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          templateKey: selectedTemplate,
          customName: selectedTemplate === "custom" ? customName.trim() : undefined,
          date: logDate,
          completedAt: new Date().toISOString(),
          amount,
          duration: null,
          notes: null,
          clientEventId: crypto.randomUUID(),
        }),
      })
      if (!response.ok) {
        throw new Error("Failed to log first behavior")
      }
      const payload = await response.json()
      router.replace(payload?.bootstrap?.nextRoute || "/onboarding?s=connect")
    } catch (submitError) {
      console.error("Failed logging first behavior:", submitError)
      setError("Unable to log your first behavior. Please try again.")
      setSubmitting(false)
    }
  }

  async function connectItem(key: ChecklistKey) {
    setBusyKey(key)
    setError(null)
    try {
      if (key === "mac_activity") {
        const result = await bootstrapMacActivityWatcher()
        await updateChecklist(key, result.completed ? "completed" : "seen", result.metadata)
        return
      }

      if (key === "ai_voice") {
        const invoke = await getInvoke()
        if (!invoke) {
          await updateChecklist(key, "seen", { surface: "web" })
          return
        }
        const microphone = await invoke<boolean>("show_native_microphone_permission_dialog").catch(() => false)
        const speech = await invoke<boolean>("show_native_speech_recognition_permission_dialog").catch(() => false)
        await updateChecklist(key, microphone && speech ? "completed" : "needs_attention", {
          microphone,
          speech,
        })
        return
      }

      if (key === "reminders") {
        const result = await configureReminders()
        await updateChecklist(key, result.completed ? "completed" : "seen", result.metadata)
        return
      }

      await updateChecklist(key, "seen", { destination: "/integrations" })
      await markSetupSeen()
      router.replace("/integrations?tab=available")
    } catch (connectError) {
      console.error("Failed updating setup item:", connectError)
      setError("That setup item could not be completed. You can skip it and continue.")
    } finally {
      setBusyKey(null)
    }
  }

  async function skipItem(key: ChecklistKey) {
    setBusyKey(key)
    setError(null)
    try {
      await updateChecklist(key, "skipped")
    } catch (skipError) {
      console.error("Failed skipping setup item:", skipError)
      setError("Unable to update that setup item. Please try again.")
    } finally {
      setBusyKey(null)
    }
  }

  async function markSetupSeen() {
    const response = await fetch("/api/user/activation/permissions-seen", {
      method: "PATCH",
      headers: await authHeaders(),
    })
    if (!response.ok) {
      throw new Error("Failed to finish setup")
    }
    setBootstrap(await response.json())
  }

  async function finishSetup(destination = "/dashboard") {
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await markSetupSeen()
      router.replace(destination)
    } catch (finishError) {
      console.error("Failed finishing setup:", finishError)
      setError("Unable to finish setup. Please try again.")
      setSubmitting(false)
    }
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <BrailleSpinner className="text-2xl text-gray-900" />
      </div>
    )
  }

  return (
    <div className="min-h-screen overflow-hidden bg-white text-gray-950">
      <div data-tauri-drag-region className="fixed left-0 right-0 top-0 z-50 h-12" />

      <div className="fixed left-8 right-8 top-8 z-40 h-2 overflow-hidden rounded-full bg-gray-200 shadow-inner">
        <div
          className="h-full rounded-full bg-[linear-gradient(90deg,#2f6fa3_0%,#2f6fa3_18%,#fff1a6_44%,#ff7a1a_57%,#ff1ea8_72%,#f2f2f2_100%)] transition-[width] duration-500"
          style={{ width: progress }}
        />
      </div>

      <main className="grid min-h-screen grid-cols-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(420px,0.9fr)]">
        <section className="flex min-h-screen items-center px-8 py-24 sm:px-14 lg:px-16">
          <div className="w-full max-w-[680px]">
            {requestedStep === "profile" ? (
              <>
                <h1 className="text-[44px] font-normal leading-[1.1] tracking-normal text-gray-950 sm:text-[56px]">
                  Welcome to Ritual
                </h1>
                <p className="mt-7 max-w-2xl text-[24px] leading-[1.38] text-gray-500">
                  Start with the basics Ritual needs to put your logs on the right day.
                </p>

                <div className="mt-12 space-y-6">
                  <label className="block text-[17px] font-medium text-gray-700">
                    Name
                    <Input
                      className="mt-3 h-16 rounded-[18px] border-0 bg-gray-100 px-6 text-[22px] text-gray-950 shadow-none placeholder:text-gray-400 focus-visible:ring-2 focus-visible:ring-gray-300"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      autoFocus
                    />
                  </label>
                  <label className="block text-[17px] font-medium text-gray-700">
                    Timezone
                    <Input
                      className="mt-3 h-16 rounded-[18px] border-0 bg-gray-100 px-6 text-[22px] text-gray-950 shadow-none placeholder:text-gray-400 focus-visible:ring-2 focus-visible:ring-gray-300"
                      value={timezone}
                      onChange={(event) => setTimezone(event.target.value)}
                    />
                  </label>
                </div>

                <div className="mt-20 flex justify-end">
                  <Button
                    className="h-16 rounded-[16px] bg-gray-950 px-8 text-[20px] font-semibold text-white hover:bg-gray-800"
                    onClick={() => void submitProfile()}
                    disabled={submitting}
                  >
                    Continue
                    <ArrowRight className="ml-3 h-5 w-5" />
                  </Button>
                </div>
              </>
            ) : null}

            {requestedStep === "first-behavior" ? (
              <>
                <h1 className="text-[44px] font-normal leading-[1.1] tracking-normal text-gray-950 sm:text-[56px]">
                  Log one thing first
                </h1>
                <p className="mt-7 max-w-2xl text-[24px] leading-[1.38] text-gray-500">
                  Pick a starter behavior and add today&apos;s first data point.
                </p>

                <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {starterTemplates.map(({ key, title, Icon }) => {
                    const active = selectedTemplate === key
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setSelectedTemplate(key)}
                        className={`flex h-[116px] items-center justify-between rounded-[22px] px-7 text-left transition ${
                          active ? "bg-gray-200 text-gray-950" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                        }`}
                      >
                        <span className="flex items-center gap-5">
                          <Icon className="h-9 w-9" />
                          <span className="text-[24px] font-semibold">{title}</span>
                        </span>
                        <span className={`h-9 w-9 rounded-full border-[3px] ${active ? "border-black ring-[7px] ring-inset ring-gray-200 bg-black" : "border-gray-300"}`} />
                      </button>
                    )
                  })}
                </div>

                <div className="mt-8 rounded-[24px] bg-gray-100 p-7">
                  <p className="text-[24px] font-semibold text-gray-950">{selected.title}</p>
                  <p className="mt-2 text-[18px] leading-7 text-gray-500">{selected.description}</p>
                  <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {selectedTemplate === "custom" ? (
                      <label className="block text-[16px] font-medium text-gray-700 sm:col-span-2">
                        Behavior name
                        <Input
                          className="mt-2 h-14 rounded-[16px] border-0 bg-white px-5 text-[20px] shadow-none focus-visible:ring-2 focus-visible:ring-gray-300"
                          value={customName}
                          onChange={(event) => setCustomName(event.target.value)}
                          placeholder="Reading"
                        />
                      </label>
                    ) : null}
                    <label className="block text-[16px] font-medium text-gray-700">
                      {selected.unitLabel}
                      <Input
                        className="mt-2 h-14 rounded-[16px] border-0 bg-white px-5 text-[20px] shadow-none focus-visible:ring-2 focus-visible:ring-gray-300"
                        inputMode="decimal"
                        value={logValue}
                        onChange={(event) => setLogValue(event.target.value)}
                      />
                    </label>
                    <label className="block text-[16px] font-medium text-gray-700">
                      Date
                      <Input
                        className="mt-2 h-14 rounded-[16px] border-0 bg-white px-5 text-[20px] shadow-none focus-visible:ring-2 focus-visible:ring-gray-300"
                        type="date"
                        value={logDate}
                        onChange={(event) => setLogDate(event.target.value)}
                      />
                    </label>
                  </div>
                </div>

                <div className="mt-14 flex justify-end">
                  <Button
                    className="h-16 rounded-[16px] bg-gray-950 px-8 text-[20px] font-semibold text-white hover:bg-gray-800"
                    onClick={() => void submitFirstBehavior()}
                    disabled={submitting}
                  >
                    Log first behavior
                    <ArrowRight className="ml-3 h-5 w-5" />
                  </Button>
                </div>
              </>
            ) : null}

            {requestedStep === "connect" ? (
              <>
                <h1 className="text-[44px] font-normal leading-[1.1] tracking-normal text-gray-950 sm:text-[56px]">
                  Connect Ritual to your day
                </h1>
                <p className="mt-7 max-w-2xl text-[24px] leading-[1.38] text-gray-500">
                  Choose what Ritual can use now. Everything here is optional and can be changed later.
                </p>

                <div className="mt-10 grid max-h-[52vh] grid-cols-1 gap-3 overflow-auto pr-2">
                  {setupItems.map(({ key, title, description, action, Icon }) => {
                    const status = checklistByKey.get(key) ?? "not_started"
                    const done = status === "completed" || status === "skipped"
                    return (
                      <div
                        key={key}
                        className={`flex items-center gap-5 rounded-[22px] p-5 transition ${
                          done ? "bg-gray-50 text-gray-400" : "bg-gray-100 text-gray-950"
                        }`}
                      >
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[18px] bg-white">
                          <Icon className="h-7 w-7" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <p className="text-[20px] font-semibold">{title}</p>
                            <p className="text-[15px] font-medium text-gray-400">{statusLabel(status)}</p>
                          </div>
                          <p className="mt-1 text-[17px] leading-6 text-gray-500">{description}</p>
                        </div>
                        <div className="flex shrink-0 gap-2">
                          {done ? (
                            <span className="flex h-11 items-center gap-2 rounded-[14px] bg-black px-4 text-[16px] font-semibold text-white">
                              {status === "completed" ? <Check className="h-4 w-4" /> : <SkipForward className="h-4 w-4" />}
                              {statusLabel(status)}
                            </span>
                          ) : (
                            <>
                              <Button
                                className="h-11 rounded-[14px] bg-gray-950 px-4 text-[16px] font-semibold text-white hover:bg-gray-800"
                                onClick={() => void connectItem(key)}
                                disabled={busyKey === key}
                              >
                                {action}
                              </Button>
                              <Button
                                variant="ghost"
                                className="h-11 rounded-[14px] px-3 text-[16px] font-semibold text-gray-600 hover:bg-white"
                                onClick={() => void skipItem(key)}
                                disabled={busyKey === key}
                              >
                                <SkipForward className="h-5 w-5" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div className="mt-10 flex items-center justify-between gap-4">
                  <Button
                    variant="ghost"
                    className="h-14 rounded-[16px] bg-gray-100 px-7 text-[20px] font-semibold text-gray-600 hover:bg-gray-200"
                    onClick={() => void finishSetup()}
                    disabled={submitting}
                  >
                    Skip for now
                  </Button>
                  <Button
                    className="h-16 rounded-[16px] bg-gray-950 px-8 text-[20px] font-semibold text-white hover:bg-gray-800"
                    onClick={() => void finishSetup()}
                    disabled={submitting}
                  >
                    Enter Ritual
                    <ArrowRight className="ml-3 h-5 w-5" />
                  </Button>
                </div>
              </>
            ) : null}

            {error ? (
              <p className="mt-6 rounded-[16px] bg-red-50 px-5 py-4 text-[16px] text-red-700">{error}</p>
            ) : null}
          </div>
        </section>

        <aside className="relative hidden min-h-screen overflow-hidden bg-[#f3f6fb] lg:block">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_85%,rgba(255,223,105,0.52),transparent_30%),radial-gradient(circle_at_78%_12%,rgba(222,231,245,0.9),transparent_34%)]" />
          <div className="absolute inset-x-0 top-24 mx-auto h-[660px] w-[660px] rounded-[140px] border border-white/80" />
          <div className="absolute left-1/2 top-1/2 flex h-64 w-64 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[56px] bg-white shadow-[0_30px_90px_rgba(15,23,42,0.12)]">
            <div className="flex h-32 w-32 items-center justify-center rounded-[36px] bg-[linear-gradient(180deg,#3c7dea_0%,#ffe979_58%,#ff5d55_100%)] shadow-inner">
              <Sparkles className="h-14 w-14 text-white" />
            </div>
          </div>
          <div className="absolute left-[16%] top-[27%] flex h-20 w-20 items-center justify-center rounded-full bg-white shadow-lg">
            <Shield className="h-9 w-9 text-gray-500" />
          </div>
          <div className="absolute bottom-[22%] left-[18%] flex h-24 w-24 items-center justify-center rounded-full bg-white shadow-lg">
            <Monitor className="h-10 w-10 text-gray-500" />
          </div>
          <div className="absolute right-[16%] top-[46%] flex h-20 w-20 items-center justify-center rounded-full bg-white shadow-lg">
            <Watch className="h-9 w-9 text-gray-500" />
          </div>
          <div className="absolute bottom-[16%] right-[26%] flex h-24 w-24 items-center justify-center rounded-full bg-white shadow-lg">
            <Mic className="h-10 w-10 text-gray-500" />
          </div>
        </aside>
      </main>
    </div>
  )
}
