"use client"

import { useCallback, useEffect, useState } from "react"
import type { LucideIcon } from "lucide-react"
import { Check, FolderOpen, HardDrive, MapPin, Mic, Monitor, ScreenShare } from "lucide-react"
import { Button } from "@ritual/ui/button"

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
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={disabled || loading}
      onClick={onClick}
      className={cn(
        "h-8 min-w-[80px] shrink-0 rounded-md px-3 text-[13px] font-medium shadow-none transition-colors duration-100",
        granted
          ? "border-[hsl(var(--border))] bg-[var(--px-onboarding-recessed)] text-[var(--text-secondary)] hover:bg-[var(--px-onboarding-recessed)]"
          : "border-[var(--px-onboarding-border)] bg-white text-[var(--px-onboarding-ink)] hover:bg-[var(--surface-panel)]",
      )}
    >
      {loading ? <BrailleSpinner className="text-sm" intervalMs={45} /> : granted ? "Granted" : "Grant"}
    </Button>
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
        subtitle="Choose which local capabilities Ritual can use. You can update these anytime in Settings."
        className="pt-10"
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-8 pt-5">
        <div className="overflow-hidden rounded-lg border border-[var(--px-onboarding-border)] bg-white">
          {PERMISSION_ROWS.map((row) => {
            const Icon = row.icon
            const granted = permissions[row.key]
            return (
              <div
                key={row.key}
                className="grid min-h-[60px] grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-2.5 last:border-b-0"
              >
                <span
                  className={cn(
                    "grid h-8 w-8 place-items-center rounded-md border",
                    granted
                      ? "border-[#d9e1d7] bg-[#f1f7f0] text-[#167046]"
                      : "border-[hsl(var(--border))] bg-[var(--px-onboarding-recessed)] text-[var(--icon-muted)]",
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
                  <p className="text-[14px] font-medium leading-[1.3] text-[var(--px-onboarding-ink)]">
                    {row.label}
                  </p>
                  <p className="mt-0.5 text-[12px] font-normal leading-[1.35] text-[var(--px-onboarding-muted)]">
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
        </div>

        <div className="mt-3 flex min-h-[72px] items-center gap-3 rounded-lg border border-[var(--px-onboarding-border)] bg-[var(--px-onboarding-recessed)] px-4 py-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-[hsl(var(--border))] bg-white text-[var(--icon-default)]" aria-hidden="true">
            <FolderOpen className="h-4 w-4" strokeWidth={1.8} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-medium leading-[1.3] text-[var(--px-onboarding-ink)]">
              Ritual Vault folder
            </p>
            <p className="mt-0.5 truncate text-[12px] leading-[1.35] text-[var(--px-onboarding-muted)]">
              {vaultFolderPath || "Choose where Ritual stores your private local files."}
            </p>
            {vaultFolderMessage ? (
              <p className="mt-0.5 truncate text-[12px] leading-[1.35] text-[var(--px-onboarding-muted)]">
                {vaultFolderMessage}
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || vaultFolderWorking}
            onClick={() => void handleChooseVaultFolder()}
            className="h-8 shrink-0 rounded-md border-[var(--px-onboarding-border)] bg-white px-3 text-[13px] font-medium text-[var(--px-onboarding-ink)] shadow-none hover:bg-[var(--surface-panel)]"
          >
            {vaultFolderWorking ? (
              <BrailleSpinner className="text-sm" intervalMs={45} />
            ) : (
              <FolderOpen className="h-4 w-4" />
            )}
            <span>Choose</span>
          </Button>
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
