"use client"

import { useCallback, useEffect, useState } from "react"
import { FolderOpen } from "lucide-react"
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
}

const PERMISSION_ROWS: PermissionRow[] = [
  {
    key: "accessibility",
    label: "Accessibility",
    description: "Active app and window context for desktop tracking.",
  },
  {
    key: "microphone",
    label: "Microphone",
    description: "Voice logging and dictation when you ask Ritual to listen.",
  },
  {
    key: "screen_recording",
    label: "Screen Recording",
    description: "Optional visual context for richer desktop memory.",
  },
  {
    key: "full_disk_access",
    label: "Full Disk Access",
    description: "Local file access for your private Ritual Vault.",
  },
  {
    key: "location_services",
    label: "Location Services",
    description: "Place context for logs when location is available.",
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

function PermissionToggle({
  checked,
  label,
  loading,
  disabled,
  onChange,
}: {
  checked: boolean
  label: string
  loading?: boolean
  disabled?: boolean
  onChange: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-busy={loading || undefined}
      aria-label={`${checked ? "Manage" : "Enable"} ${label}`}
      disabled={disabled || loading}
      onClick={(event) => {
        event.stopPropagation()
        onChange()
      }}
      className={cn(
        "relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ritual-focus-ring)] focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60",
      )}
      style={{
        backgroundColor: checked
          ? "var(--ritual-status-success, #34785c)"
          : "#d4d4d8",
      }}
    >
      <span
        className={cn(
          "pointer-events-none inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform duration-150",
          checked ? "translate-x-4" : "translate-x-0.5",
        )}
      />
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

  async function openPermissionSettings(key: PermissionKey) {
    if (key === "full_disk_access") {
      await openSettings("open_full_disk_access_settings")
      return
    }
    if (key === "accessibility") {
      await openSettings("open_accessibility_settings")
      return
    }
    if (key === "microphone") {
      await openSettings("open_microphone_settings")
      return
    }
    if (key === "screen_recording") {
      await openSettings("open_screen_recording_settings")
      return
    }
    if (key === "location_services") {
      await openLocationServicesSettings()
    }
  }

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

  async function handleToggle(key: PermissionKey) {
    if (workingKey || busy) return
    if (permissions[key]) {
      setWorkingKey(key)
      try {
        await openPermissionSettings(key)
        schedulePermissionRefresh()
      } finally {
        setWorkingKey(null)
      }
      return
    }
    await handleGrant(key)
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
        <div className="mx-auto w-full max-w-[520px]">
          <div className="overflow-hidden rounded-xl bg-[var(--px-onboarding-recessed)]">
            {PERMISSION_ROWS.map((row, index) => {
              const granted = permissions[row.key]
              const loading = workingKey === row.key
              return (
                <div key={row.key} className="px-4">
                  {index > 0 ? (
                    <div className="h-px bg-[var(--border-subtle)]" aria-hidden="true" />
                  ) : null}
                  <div className="flex min-h-[64px] items-center justify-between gap-4 py-3.5">
                    <div className="min-w-0">
                      <p className="text-[14px] font-medium leading-[1.3] text-[var(--px-onboarding-ink)]">
                        {row.label}
                      </p>
                      <p className="mt-0.5 text-[12px] font-normal leading-[1.35] text-[var(--px-onboarding-muted)]">
                        {row.description}
                      </p>
                    </div>
                    <PermissionToggle
                      checked={granted}
                      label={row.label}
                      loading={loading}
                      disabled={busy}
                      onChange={() => void handleToggle(row.key)}
                    />
                  </div>
                </div>
              )
            })}
          </div>

          <div className="mt-3 overflow-hidden rounded-xl bg-[var(--px-onboarding-recessed)] px-4">
            <div className="flex min-h-[64px] items-center gap-4 py-3.5">
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
