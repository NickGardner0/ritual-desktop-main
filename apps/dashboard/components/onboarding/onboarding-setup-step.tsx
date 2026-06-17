"use client"

import { useCallback, useEffect, useState } from "react"
import Image from "next/image"
import { Check } from "lucide-react"

import { Button } from "@/components/ui/button"
import { getDesktopCapabilities } from "@/lib/desktop-capabilities"
import { cn } from "@/lib/utils"

type PermissionKey =
  | "full_disk_access"
  | "accessibility"
  | "microphone"
  | "screen_recording"
  | "location_services"

type PermissionRow = {
  key: PermissionKey
  label: string
  control: "grant" | "toggle"
}

const PERMISSION_ROWS: PermissionRow[] = [
  { key: "full_disk_access", label: "Full Disk Access", control: "grant" },
  { key: "accessibility", label: "Accessibility", control: "toggle" },
  { key: "microphone", label: "Microphone", control: "toggle" },
  { key: "screen_recording", label: "Screen Recording", control: "grant" },
  { key: "location_services", label: "Location Services", control: "toggle" },
]

const PRIVACY_BADGES = ["Local-first", "Encrypted", "No training"] as const

type PermissionState = Record<PermissionKey, boolean>

const DEFAULT_PERMISSION_STATE: PermissionState = {
  full_disk_access: false,
  accessibility: false,
  microphone: false,
  screen_recording: false,
  location_services: false,
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

function Toggle({
  enabled,
  onToggle,
  disabled,
}: {
  enabled: boolean
  onToggle: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "relative h-5 w-8 shrink-0 rounded-full transition-colors duration-200",
        enabled ? "bg-[#333333]" : "bg-[#e4e4e7]",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform duration-200",
          enabled ? "translate-x-[14px]" : "translate-x-0.5",
        )}
      />
    </button>
  )
}

function GrantButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <Button
      type="button"
      variant="outline"
      disabled={disabled}
      onClick={onClick}
      className="h-7 shrink-0 rounded-md border-[#e4e4e7] bg-white px-2.5 text-xs font-medium text-[#18181b] shadow-none hover:bg-[#fafafa]"
    >
      Grant
    </Button>
  )
}

export function OnboardingSetupStep({
  busy,
  onFinish,
}: {
  busy?: boolean
  onFinish: () => void
}) {
  const [permissions, setPermissions] = useState<PermissionState>(DEFAULT_PERMISSION_STATE)
  const [workingKey, setWorkingKey] = useState<PermissionKey | null>(null)

  const refreshPermissions = useCallback(async () => {
    const invoke = await getInvoke()
    if (!invoke) return

    const [accessibility, microphone, speech, locationPing] = await Promise.all([
      invoke<boolean>("check_accessibility_permission").catch(() => false),
      invoke<boolean>("check_native_microphone_permission").catch(() => false),
      invoke<boolean>("check_native_speech_recognition_permission").catch(() => false),
      import("@/lib/location-ping").then(({ submitCurrentLocationPing }) =>
        submitCurrentLocationPing({
          reason: "onboarding_setup_refresh",
          maxRecentAgeMs: 60_000,
          timeoutMs: 4000,
        }).then((result) => result.status === "submitted"),
      ).catch(() => false),
    ])

    setPermissions({
      full_disk_access: false,
      accessibility,
      microphone: microphone && speech,
      screen_recording: false,
      location_services: locationPing,
    })
  }, [])

  useEffect(() => {
    void refreshPermissions()
    const interval = window.setInterval(() => {
      void refreshPermissions()
    }, 2500)
    return () => window.clearInterval(interval)
  }, [refreshPermissions])

  async function openSettings(command: string) {
    const invoke = await getInvoke()
    if (!invoke) return
    await invoke(command).catch(() => undefined)
  }

  async function handleGrant(key: PermissionKey) {
    if (workingKey) return
    setWorkingKey(key)
    try {
      if (key === "full_disk_access") {
        await openSettings("open_full_disk_access_settings")
      } else if (key === "screen_recording") {
        await openSettings("open_screen_recording_settings")
      }
      await refreshPermissions()
    } finally {
      setWorkingKey(null)
    }
  }

  async function handleToggle(key: PermissionKey) {
    if (workingKey) return
    setWorkingKey(key)
    try {
      const invoke = await getInvoke()
      if (!invoke) return

      if (key === "accessibility") {
        let granted = await invoke<boolean>("check_accessibility_permission").catch(() => false)
        if (!granted) {
          granted = await invoke<boolean>("request_accessibility_permission").catch(() => false)
        }
        if (!granted) {
          await openSettings("open_accessibility_settings")
        }
      }

      if (key === "microphone") {
        const microphone = await invoke<boolean>("show_native_microphone_permission_dialog").catch(() => false)
        const speech = await invoke<boolean>("show_native_speech_recognition_permission_dialog").catch(() => false)
        if (!microphone) {
          await openSettings("open_microphone_settings")
        }
        if (!speech) {
          await openSettings("open_speech_recognition_settings")
        }
      }

      if (key === "location_services") {
        const { submitCurrentLocationPing, openLocationServicesSettings } = await import("@/lib/location-ping")
        const result = await submitCurrentLocationPing({
          reason: "onboarding_setup_toggle",
          maxRecentAgeMs: 0,
          timeoutMs: 8000,
        }).catch(() => ({ status: "failed" as const }))
        if (result.status !== "submitted") {
          await openLocationServicesSettings()
        }
      }

      await refreshPermissions()
    } finally {
      setWorkingKey(null)
    }
  }

  return (
    <div className="flex h-[612px] w-full max-w-[800px] flex-col bg-white text-[#18181b]" style={{ fontFamily: "var(--ritual-selected-font-family)" }}>
      <div className="flex flex-1 flex-col justify-center px-7 pb-8 pt-2">
        <div className="mx-auto flex w-full max-w-[720px] flex-col gap-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#14171d]">
                <Image src="/images/eclipse.svg" alt="" width={14} height={14} className="invert" />
              </div>
              <div className="min-w-0">
                <h1 className="text-[15px] font-semibold leading-tight tracking-[-0.02em] text-[#18181b]">
                  Set up Ritual
                </h1>
                <p className="text-[11px] leading-snug text-[#71717a] italic">
                  Tools to measure and quantify your behavior
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onFinish}
              className="h-8 shrink-0 rounded-md border-[#e4e4e7] bg-white px-2.5 text-xs font-medium text-[#18181b] shadow-none hover:bg-[#fafafa]"
            >
              Finish Setup
              <span className="ml-1.5 rounded border border-[#e4e4e7] bg-[#f4f4f5] px-1 text-[10px] text-[#a1a1aa]">
                ↵
              </span>
            </Button>
          </div>

          <div className="h-px bg-[#e4e4e7]" />

          <section className="space-y-1">
            <h2 className="text-[13px] font-medium text-[#18181b]">Permissions</h2>
            <p className="text-[12px] leading-snug text-[#71717a]">
              Allow Ritual to track in the background. Change anytime in Settings.
            </p>
          </section>

          <div className="space-y-1.5">
            {PERMISSION_ROWS.map((row) => (
              <div key={row.key} className="flex min-h-7 items-center justify-between gap-4">
                <span className="truncate text-[13px] font-medium text-[#18181b]">{row.label}</span>
                {row.control === "grant" ? (
                  <GrantButton
                    disabled={busy || workingKey === row.key}
                    onClick={() => void handleGrant(row.key)}
                  />
                ) : (
                  <Toggle
                    enabled={permissions[row.key]}
                    disabled={busy || workingKey === row.key}
                    onToggle={() => void handleToggle(row.key)}
                  />
                )}
              </div>
            ))}
          </div>

          <div className="h-px bg-[#e4e4e7]" />

          <section className="space-y-1">
            <h2 className="text-[13px] font-medium text-[#18181b]">Privacy &amp; Storage</h2>
            <p className="text-[12px] leading-snug text-[#71717a]">
              Everything stays on your Mac — encrypted, never used for training.
            </p>
          </section>

          <div className="flex flex-wrap gap-1.5">
            {PRIVACY_BADGES.map((badge) => (
              <div
                key={badge}
                className="inline-flex items-center gap-1 rounded border border-[#e4e4e7] bg-[#fafafa] px-2 py-1 text-[11px] font-medium text-[#52525b]"
              >
                <Check className="h-3 w-3 text-[#333333]" strokeWidth={2.5} />
                {badge}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
