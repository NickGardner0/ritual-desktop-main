"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useAuth, useUser } from "@clerk/nextjs"
import { Dumbbell, Focus, Moon, Smile, Circle, ArrowRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { BrailleSpinner } from "@/components/ui/braille-spinner"
import { setOnboardingWindowSize } from "@/lib/tauri-utils"
import { readOnboardingStep } from "@/lib/activation-flow.mjs"

type TemplateKey = "sleep" | "exercise" | "focus" | "mood" | "custom"
type OnboardingStep = "profile" | "first-behavior"

type BootstrapResponse = {
  nextRoute: string
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

export default function OnboardingPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { isLoaded, user } = useUser()
  const { getToken } = useAuth()
  const requestedStep = readOnboardingStep(searchParams.get("s"))

  const [checking, setChecking] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
        const bootstrap = await fetchBootstrap()
        if (bootstrap.nextRoute === "/dashboard") {
          router.replace("/dashboard")
          return
        }
        if (bootstrap.nextRoute === "/onboarding?s=profile" && requestedStep !== "profile") {
          router.replace("/onboarding?s=profile")
          return
        }
        if (bootstrap.nextRoute === "/onboarding?s=first-behavior" && requestedStep !== "first-behavior") {
          router.replace("/onboarding?s=first-behavior")
          return
        }
        setName(bootstrap.user?.fullName || user.fullName || user.firstName || "")
        setTimezone(bootstrap.user?.timezone || getBrowserTimezone())
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
      const token = await getToken({ skipCache: true })
      if (!token) throw new Error("Authentication required")
      const response = await fetch("/api/user/bootstrap/profile", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ fullName: cleanName, timezone: cleanTimezone }),
      })
      if (!response.ok) {
        throw new Error("Failed to save profile")
      }
      const bootstrap = await response.json() as BootstrapResponse
      router.replace(bootstrap.nextRoute || "/onboarding?s=first-behavior")
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
      const token = await getToken({ skipCache: true })
      if (!token) throw new Error("Authentication required")
      const response = await fetch("/api/user/activation/first-behavior", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
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
      router.replace("/dashboard")
    } catch (submitError) {
      console.error("Failed logging first behavior:", submitError)
      setError("Unable to log your first behavior. Please try again.")
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
    <div className="flex min-h-screen items-center justify-center bg-white p-6">
      <div data-tauri-drag-region className="fixed left-0 right-0 top-0 z-50 h-12" />

      <div className="flex w-full max-w-[520px] flex-col">
        <div className="mb-7">
          <p className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-gray-500">
            {requestedStep === "profile" ? "Account setup" : "First behavior"}
          </p>
          <h1 className="text-2xl font-medium text-gray-950">
            {requestedStep === "profile" ? "Welcome to Ritual" : "Log one thing first"}
          </h1>
          <p className="mt-2 text-sm leading-6 text-gray-600">
            {requestedStep === "profile"
              ? "Add the basics Ritual needs to place your logs on the right day."
              : "Pick a starter behavior and add today’s first data point."}
          </p>
        </div>

        {requestedStep === "profile" ? (
          <div className="space-y-4">
            <label className="block text-sm font-medium text-gray-900">
              Name
              <Input
                className="mt-2 rounded-sm"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoFocus
              />
            </label>
            <label className="block text-sm font-medium text-gray-900">
              Timezone
              <Input
                className="mt-2 rounded-sm"
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
              />
            </label>
            <Button className="w-full rounded-sm" onClick={() => void submitProfile()} disabled={submitting}>
              Continue
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
              {starterTemplates.map(({ key, title, Icon }) => {
                const active = selectedTemplate === key
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelectedTemplate(key)}
                    className={`flex h-20 flex-col items-center justify-center gap-2 rounded-sm border text-sm transition ${
                      active ? "border-gray-950 bg-gray-950 text-white" : "border-gray-200 bg-white text-gray-700 hover:border-gray-400"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{title}</span>
                  </button>
                )
              })}
            </div>

            <div className="rounded-sm border border-gray-200 p-4">
              <p className="text-sm font-medium text-gray-950">{selected.title}</p>
              <p className="mt-1 text-sm text-gray-500">{selected.description}</p>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {selectedTemplate === "custom" ? (
                  <label className="block text-sm font-medium text-gray-900 sm:col-span-2">
                    Behavior name
                    <Input
                      className="mt-2 rounded-sm"
                      value={customName}
                      onChange={(event) => setCustomName(event.target.value)}
                      placeholder="Reading"
                    />
                  </label>
                ) : null}
                <label className="block text-sm font-medium text-gray-900">
                  {selected.unitLabel}
                  <Input
                    className="mt-2 rounded-sm"
                    inputMode="decimal"
                    value={logValue}
                    onChange={(event) => setLogValue(event.target.value)}
                  />
                </label>
                <label className="block text-sm font-medium text-gray-900">
                  Date
                  <Input
                    className="mt-2 rounded-sm"
                    type="date"
                    value={logDate}
                    onChange={(event) => setLogDate(event.target.value)}
                  />
                </label>
              </div>
            </div>

            <Button className="w-full rounded-sm" onClick={() => void submitFirstBehavior()} disabled={submitting}>
              Log first behavior
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        )}

        {error ? (
          <p className="mt-4 text-sm text-red-600">{error}</p>
        ) : null}
      </div>
    </div>
  )
}
