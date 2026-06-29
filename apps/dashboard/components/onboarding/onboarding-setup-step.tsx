"use client"

import { useCallback, useEffect, useState } from "react"
import { Check, FolderOpen } from "lucide-react"

import { Button } from "@/components/ui/button"
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
}

const PERMISSION_ROWS: PermissionRow[] = [
  { key: "full_disk_access", label: "Full Disk Access" },
  { key: "accessibility", label: "Accessibility" },
  { key: "microphone", label: "Microphone" },
  { key: "screen_recording", label: "Screen Recording" },
  { key: "location_services", label: "Location Services" },
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
      disabled={disabled || loading}
      onClick={onClick}
      className={cn(
        "h-8 min-w-[74px] shrink-0 rounded-sm border px-3 text-[13px] font-medium shadow-none transition-colors duration-75",
        granted
          ? "border-[#e4e4e7] bg-[#f4f4f5] text-[#52525b] hover:bg-[#f4f4f5]"
          : "border-[#dfe1e5] bg-white text-[#18181b] hover:bg-[#f5f5f5]",
      )}
    >
      {loading ? <BrailleSpinner className="text-sm" intervalMs={45} /> : granted ? "Granted" : "Grant"}
    </Button>
  )
}

export function OnboardingSetupStep({
  busy,
  onFinish,
  userId,
}: {
  busy?: boolean
  onFinish: () => void
  userId?: string | null
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
    <div
      className="flex h-[612px] w-full max-w-[800px] flex-col bg-white text-[#18181b]"
      style={{ fontFamily: "var(--ritual-font-fk), 'FK Grotesk Neue', -apple-system, BlinkMacSystemFont, sans-serif" }}
    >
      <div className="flex flex-1 flex-col justify-center px-7 pb-8 pt-2">
        <div className="mx-auto flex w-full max-w-[720px] flex-col gap-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-2.5">
              <img
                src="/images/eclipse.svg"
                alt=""
                width={32}
                height={32}
                className="h-8 w-8 shrink-0"
              />
              <div className="min-w-0">
                <h1 className="text-[16px] font-semibold leading-tight text-[#18181b]">
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
              className="h-8 shrink-0 rounded-sm border-[#dfe1e5] bg-white px-3 text-[13px] font-medium text-[#18181b] shadow-none transition-colors duration-75 hover:bg-[#f5f5f5]"
            >
              {busy ? "Finishing" : "Finish Setup"}
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
                <GrantButton
                  granted={permissions[row.key]}
                  loading={workingKey === row.key}
                  disabled={busy}
                  onClick={() => void handleGrant(row.key)}
                />
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

          <div className="flex min-h-8 items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-[#18181b]">Ritual Vault folder</p>
              <p className="truncate text-[11px] text-[#71717a]">
                {vaultFolderPath || "No folder selected"}
              </p>
              {vaultFolderMessage ? (
                <p className="truncate text-[11px] text-[#71717a]">{vaultFolderMessage}</p>
              ) : null}
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={busy || vaultFolderWorking}
              onClick={() => void handleChooseVaultFolder()}
              className="h-8 shrink-0 rounded-sm border-[#dfe1e5] bg-white px-3 text-[13px] font-medium text-[#18181b] shadow-none transition-colors duration-75 hover:bg-[#f5f5f5]"
            >
              {vaultFolderWorking ? <BrailleSpinner className="text-sm" intervalMs={45} /> : <FolderOpen className="h-3.5 w-3.5" />}
              <span className="ml-1.5">Choose</span>
            </Button>
          </div>

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
