"use client"

import { useCallback, useEffect, useState } from "react"
import type { LucideIcon } from "lucide-react"
import { Check, FolderOpen, HardDrive, MapPin, Mic, Monitor, ScreenShare, ShieldCheck } from "lucide-react"

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
        "h-8 min-w-[78px] shrink-0 rounded-md border px-3 text-[12px] font-medium shadow-none transition-colors duration-100",
        granted
          ? "border-[#dededb] bg-[#f6f6f3] text-[#5f5f58] hover:bg-[#f6f6f3]"
          : "border-[#d9d9d6] bg-white text-[#1f1f1d] hover:bg-[#f7f7f4]",
      )}
    >
      {loading ? <BrailleSpinner className="text-sm" intervalMs={45} /> : granted ? "Granted" : "Grant"}
    </Button>
  )
}

function PermissionListRow({
  row,
  granted,
  loading,
  disabled,
  onGrant,
}: {
  row: PermissionRow
  granted: boolean
  loading: boolean
  disabled?: boolean
  onGrant: () => void
}) {
  const Icon = row.icon

  return (
    <div className="grid min-h-[58px] grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 border-b border-[#ececea] px-3.5 last:border-b-0">
      <span
        className={cn(
          "grid h-7 w-7 place-items-center rounded-md border",
          granted
            ? "border-[#d9e1d7] bg-[#f1f7f0] text-[#446a40]"
            : "border-[#e2e2df] bg-[#f8f8f6] text-[#686863]",
        )}
        aria-hidden="true"
      >
        {granted ? <Check className="h-3.5 w-3.5" strokeWidth={2.6} /> : <Icon className="h-3.5 w-3.5" strokeWidth={2.1} />}
      </span>
      <div className="min-w-0">
        <p className="truncate text-[13px] font-semibold leading-tight text-[#191917]">{row.label}</p>
        <p className="mt-0.5 truncate text-[11.5px] leading-tight text-[#74746e]">{row.description}</p>
      </div>
      <GrantButton
        granted={granted}
        loading={loading}
        disabled={disabled}
        onClick={onGrant}
      />
    </div>
  )
}

function SetupPreview() {
  return (
    <div className="relative h-full min-h-[322px] overflow-hidden rounded-lg border border-[#e5e3df] bg-[#f8f7f3]">
      <div className="absolute inset-x-0 top-0 flex h-8 items-center gap-1.5 border-b border-[#e5e3df] bg-white/70 px-3">
        <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#ffbd2e]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
      </div>
      <div className="absolute inset-x-8 top-[66px] rounded-lg border border-[#e7e4de] bg-white p-4 shadow-[0_18px_42px_rgba(24,24,27,0.08)]">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-md bg-[#18181b] text-white">
            <ShieldCheck className="h-4 w-4" strokeWidth={2.2} />
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold leading-none text-[#18181b]">Private desktop memory</p>
            <p className="mt-1 text-[11.5px] leading-none text-[#76766f]">Encrypted on this Mac</p>
          </div>
        </div>
        <div className="mt-5 space-y-2.5">
          {[
            ["Context", "Active window"],
            ["Voice", "Ready to log"],
            ["Vault", "Local folder"],
          ].map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-3">
              <span className="text-[12px] text-[#62625c]">{label}</span>
              <span className="rounded bg-[#f3f2ee] px-2 py-1 text-[11px] font-medium text-[#44443f]">{value}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="absolute bottom-7 left-8 right-8 grid grid-cols-3 gap-2">
        {PRIVACY_BADGES.map((badge) => (
          <div
            key={badge}
            className="flex min-h-16 flex-col justify-between rounded-md border border-[#e7e4de] bg-white/72 p-3 shadow-[0_10px_26px_rgba(24,24,27,0.045)]"
          >
            <Check className="h-3.5 w-3.5 text-[#373733]" strokeWidth={2.4} />
            <span className="text-[11px] font-semibold leading-tight text-[#50504a]">{badge}</span>
          </div>
        ))}
      </div>
    </div>
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
      className="flex h-[612px] w-full max-w-[800px] flex-col bg-[#fcfcfa] text-[#18181b]"
      style={{ fontFamily: "var(--ritual-font-fk)" }}
    >
      <div data-tauri-drag-region className="h-8 shrink-0" />
      <div className="flex flex-1 flex-col px-7 pb-7 pt-1">
        <div className="mx-auto flex w-full max-w-[724px] flex-1 flex-col">
          <header className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-2.5">
              <img
                src="/images/eclipse.svg"
                alt=""
                width={32}
                height={32}
                className="h-8 w-8 shrink-0"
              />
              <div className="min-w-0">
                <h1 className="text-[17px] font-semibold leading-tight text-[#18181b]">
                  Set up Ritual
                </h1>
                <p className="mt-0.5 text-[12px] leading-snug text-[#71717a]">
                  Connect the local permissions that power desktop memory.
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onFinish}
              className="h-8 shrink-0 rounded-md border-[#d9d9d6] bg-[#18181b] px-3.5 text-[12px] font-semibold text-white shadow-none transition-colors duration-100 hover:bg-[#27272a]"
            >
              {busy ? "Finishing" : "Continue"}
            </Button>
          </header>

          <main className="mt-5 grid flex-1 grid-cols-[300px_minmax(0,1fr)] gap-5">
            <SetupPreview />

            <div className="flex min-h-0 flex-col rounded-lg border border-[#e5e3df] bg-white shadow-[0_18px_48px_rgba(24,24,27,0.06)]">
              <section className="border-b border-[#ececea] px-4 py-3.5">
                <h2 className="text-[13px] font-semibold text-[#18181b]">macOS access</h2>
                <p className="mt-1 text-[12px] leading-snug text-[#71717a]">
                  Grant what you want now. You can change each setting later.
                </p>
              </section>

              <div className="min-h-0 flex-1 overflow-hidden">
                {PERMISSION_ROWS.map((row) => (
                  <PermissionListRow
                    key={row.key}
                    row={row}
                    granted={permissions[row.key]}
                    loading={workingKey === row.key}
                    disabled={busy}
                    onGrant={() => void handleGrant(row.key)}
                  />
                ))}
              </div>

              <section className="border-t border-[#ececea] px-4 py-3.5">
                <div className="flex min-h-9 items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-[#18181b]">Ritual Vault folder</p>
                    <p className="mt-0.5 truncate text-[11.5px] text-[#71717a]">
                      {vaultFolderPath || "No folder selected"}
                    </p>
                    {vaultFolderMessage ? (
                      <p className="mt-0.5 truncate text-[11.5px] text-[#71717a]">{vaultFolderMessage}</p>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy || vaultFolderWorking}
                    onClick={() => void handleChooseVaultFolder()}
                    className="h-8 shrink-0 rounded-md border-[#d9d9d6] bg-white px-3 text-[12px] font-medium text-[#18181b] shadow-none transition-colors duration-100 hover:bg-[#f7f7f4]"
                  >
                    {vaultFolderWorking ? <BrailleSpinner className="text-sm" intervalMs={45} /> : <FolderOpen className="h-3.5 w-3.5" />}
                    <span className="ml-1.5">Choose</span>
                  </Button>
                </div>
              </section>
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}
