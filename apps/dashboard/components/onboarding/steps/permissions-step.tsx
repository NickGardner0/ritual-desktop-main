"use client"

import { useCallback, useEffect, useState } from "react"
import type { LucideIcon } from "lucide-react"
import { Check, FolderOpen, HardDrive, MapPin, Mic, Monitor, ScreenShare } from "lucide-react"

import {
  OnboardingFooter,
  OnboardingNavButton,
  OnboardingStepHeader,
  OnboardingStepper,
  SETUP_STEPPER_COUNT,
} from "@/components/onboarding/perplexity-onboarding-shell"
import { BrailleSpinner } from "@/components/ui/braille-spinner"
import { getDesktopCapabilities } from "@/lib/desktop-capabilities"
import { getLocationPermissionState, openLocationServicesSettings, submitCurrentLocationPing } from "@/lib/location-ping"
import {
  chooseRitualVaultFolder,
  readRitualVaultFolderSettings,
  writeRitualVaultFolderSettings,
} from "@/lib/privacy/ritual-vault-folder-settings"
import { writeRitualVaultFolderMirror } from "@/lib/privacy/ritual-vault-export"
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
  description: string
  icon: LucideIcon
}

const PERMISSION_ROWS: PermissionRow[] = [
  {
    key: "accessibility",
    label: "Accessibility",
    description: "Active app and window context for desktop tracking.",
    icon: Monitor,
  },
  {
    key: "microphone",
    label: "Microphone",
    description: "Voice logging and dictation when you ask Ritual to listen.",
    icon: Mic,
  },
  {
    key: "screen_recording",
    label: "Screen Recording",
    description: "Optional visual context for richer desktop memory.",
    icon: ScreenShare,
  },
  {
    key: "full_disk_access",
    label: "Full Disk Access",
    description: "Local file access for your private Ritual Vault.",
    icon: HardDrive,
  },
  {
    key: "location_services",
    label: "Location Services",
    description: "Place context for logs when location is available.",
    icon: MapPin,
  },
]

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

function GrantButton({
  granted,
  loading,
  onClick,
  disabled,
}: {
  granted: boolean
  loading?: boolean
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 min-w-[78px] shrink-0 items-center justify-center rounded-[8px] border px-3 text-[12px] font-medium transition-colors duration-100 disabled:opacity-50",
        granted
          ? "border-[#dededb] bg-[#f6f6f3] text-[#5f5f58]"
          : "border-[var(--px-onboarding-border)] bg-white text-[var(--px-onboarding-ink)] hover:bg-[#f4f3ee]",
      )}
    >
      {loading ? <BrailleSpinner className="text-sm" intervalMs={45} /> : granted ? "Granted" : "Grant"}
    </button>
  )
}

export function PermissionsStep({
  busy,
  userId,
  onBack,
  onFinish,
}: {
  busy?: boolean
  userId?: string | null
  onBack: () => void
  onFinish: () => void
}) {
  const [permissions, setPermissions] = useState<PermissionState>(DEFAULT_PERMISSION_STATE)
  const [workingKey, setWorkingKey] = useState<PermissionKey | null>(null)
  const [vaultFolderPath, setVaultFolderPath] = useState<string | null>(null)
  const [vaultFolderMessage, setVaultFolderMessage] = useState("")
  const [vaultFolderWorking, setVaultFolderWorking] = useState(false)

  const refreshPermissions = useCallback(async () => {
    const invoke = await getInvoke()
    if (!invoke) return

    const [accessibility, microphone, speech, locationState] = await Promise.all([
      invoke<boolean>("check_accessibility_permission").catch(() => false),
      invoke<boolean>("check_native_microphone_permission").catch(() => false),
      invoke<boolean>("check_native_speech_recognition_permission").catch(() => false),
      getLocationPermissionState().catch(() => "unknown"),
    ])

    setPermissions({
      full_disk_access: false,
      accessibility,
      microphone: microphone && speech,
      screen_recording: false,
      location_services: locationState === "granted",
    })
  }, [])

  useEffect(() => {
    void refreshPermissions()
    setVaultFolderPath(readRitualVaultFolderSettings().folderPath)
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

  const schedulePermissionRefresh = useCallback(() => {
    void refreshPermissions()
    window.setTimeout(() => void refreshPermissions(), 1200)
    window.setTimeout(() => void refreshPermissions(), 3000)
  }, [refreshPermissions])

  async function handleGrant(key: PermissionKey) {
    if (workingKey) return
    setWorkingKey(key)
    try {
      const invoke = await getInvoke()

      if (key === "full_disk_access") {
        await openSettings("open_full_disk_access_settings")
      }

      if (key === "accessibility" && invoke) {
        const granted = await invoke<boolean>("request_accessibility_permission").catch(() => false)
        if (!granted) {
          await openSettings("open_accessibility_settings")
        }
      }

      if (key === "microphone" && invoke) {
        const microphone = await invoke<boolean>("show_native_microphone_permission_dialog").catch(() => false)
        const speech = await invoke<boolean>("show_native_speech_recognition_permission_dialog").catch(() => false)
        if (!microphone) {
          await openSettings("open_microphone_settings")
        }
        if (!speech) {
          await openSettings("open_speech_recognition_settings")
        }
      }

      if (key === "screen_recording") {
        await openSettings("open_screen_recording_settings")
      }

      if (key === "location_services") {
        const result = await submitCurrentLocationPing({
          reason: "onboarding_setup_grant",
          maxRecentAgeMs: 0,
          timeoutMs: 8000,
        }).catch(() => ({ status: "failed" as const }))
        if (result.status !== "submitted") {
          await openLocationServicesSettings()
        }
      }

      schedulePermissionRefresh()
    } finally {
      setWorkingKey(null)
    }
  }

  async function handleChooseVaultFolder() {
    if (vaultFolderWorking) return
    if (!getDesktopCapabilities().isDesktop) {
      setVaultFolderMessage("Folder selection is available in Ritual Desktop.")
      return
    }
    setVaultFolderWorking(true)
    try {
      setVaultFolderMessage("Choosing folder...")
      const selected = await chooseRitualVaultFolder()
      if (!selected?.folderPath) {
        setVaultFolderMessage("Folder selection cancelled.")
        return
      }
      setVaultFolderPath(selected.folderPath)
      if (!userId) {
        setVaultFolderMessage("Folder selected.")
        return
      }
      const mirrored = await writeRitualVaultFolderMirror({
        userId,
        folderPath: selected.folderPath,
      })
      writeRitualVaultFolderSettings({
        folderPath: mirrored.folderPath,
        lastMirroredAt: mirrored.mirroredAt,
        lastRecordCount: mirrored.recordCount,
      })
      setVaultFolderMessage(`Folder ready with ${mirrored.recordCount} records.`)
    } catch {
      setVaultFolderMessage("Folder selected; mirror will run from Settings.")
    } finally {
      setVaultFolderWorking(false)
    }
  }

  return (
    <div className="px-onboarding-step-enter flex h-full flex-col">
      <OnboardingStepHeader
        title="Connect local access"
        subtitle="Grant what you want now. You can change each setting later."
        className="pt-8"
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-4">
        <div className="overflow-hidden rounded-[14px] border border-[var(--px-onboarding-border)] bg-white">
          {PERMISSION_ROWS.map((row) => {
            const Icon = row.icon
            const granted = permissions[row.key]
            return (
              <div
                key={row.key}
                className="grid min-h-[56px] grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 border-b border-[#ececea] px-3.5 last:border-b-0"
              >
                <span
                  className={cn(
                    "grid h-7 w-7 place-items-center rounded-[7px] border",
                    granted
                      ? "border-[#d9e1d7] bg-[#f1f7f0] text-[#446a40]"
                      : "border-[#e2e2df] bg-[#f8f8f6] text-[#686863]",
                  )}
                  aria-hidden="true"
                >
                  {granted ? (
                    <Check className="h-3.5 w-3.5" strokeWidth={2.6} />
                  ) : (
                    <Icon className="h-3.5 w-3.5" strokeWidth={2.1} />
                  )}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold leading-tight text-[var(--px-onboarding-ink)]">
                    {row.label}
                  </p>
                  <p className="mt-0.5 truncate text-[11.5px] leading-tight text-[var(--px-onboarding-muted)]">
                    {row.description}
                  </p>
                </div>
                <GrantButton
                  granted={granted}
                  loading={workingKey === row.key}
                  disabled={busy}
                  onClick={() => void handleGrant(row.key)}
                />
              </div>
            )
          })}

          <div className="flex min-h-14 items-center justify-between gap-3 border-t border-[#ececea] px-3.5 py-3">
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-[var(--px-onboarding-ink)]">
                Ritual Vault folder
              </p>
              <p className="mt-0.5 truncate text-[11.5px] text-[var(--px-onboarding-muted)]">
                {vaultFolderPath || "No folder selected"}
              </p>
              {vaultFolderMessage ? (
                <p className="mt-0.5 truncate text-[11.5px] text-[var(--px-onboarding-muted)]">
                  {vaultFolderMessage}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              disabled={busy || vaultFolderWorking}
              onClick={() => void handleChooseVaultFolder()}
              className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-[8px] border border-[var(--px-onboarding-border)] bg-white px-3 text-[12px] font-medium text-[var(--px-onboarding-ink)] transition-colors duration-100 hover:bg-[#f4f3ee] disabled:opacity-50"
            >
              {vaultFolderWorking ? (
                <BrailleSpinner className="text-sm" intervalMs={45} />
              ) : (
                <FolderOpen className="h-3.5 w-3.5" />
              )}
              <span>Choose</span>
            </button>
          </div>
        </div>
      </div>

      <OnboardingFooter
        left={<OnboardingNavButton variant="secondary" onClick={onBack}>Back</OnboardingNavButton>}
        center={<OnboardingStepper total={SETUP_STEPPER_COUNT} activeIndex={SETUP_STEPPER_COUNT - 1} />}
        right={
          <OnboardingNavButton disabled={busy} onClick={onFinish}>
            {busy ? "Finishing" : "Continue"}
          </OnboardingNavButton>
        }
      />
    </div>
  )
}
