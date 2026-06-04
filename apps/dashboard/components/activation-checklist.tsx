"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth, useUser } from "@clerk/nextjs"
import {
  Activity,
  Bell,
  Check,
  HeartPulse,
  Mic,
  Monitor,
  SkipForward,
  Watch,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { isTauri } from "@/lib/tauri-utils"

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
  firstBehaviorLogged?: boolean
  activation?: {
    checklist?: ChecklistItem[]
  }
}

const checklistConfig: Array<{
  key: ChecklistKey
  title: string
  description: string
  Icon: typeof Monitor
}> = [
  {
    key: "mac_activity",
    title: "Enable Mac Activity",
    description: "Capture app and focus context from this Mac.",
    Icon: Monitor,
  },
  {
    key: "apple_health",
    title: "Connect Apple Health",
    description: "Import sleep, activity, and health metrics.",
    Icon: HeartPulse,
  },
  {
    key: "oura",
    title: "Connect Oura",
    description: "Bring in recovery and sleep signals.",
    Icon: Watch,
  },
  {
    key: "whoop",
    title: "Connect Whoop",
    description: "Sync strain, recovery, and sleep data.",
    Icon: Activity,
  },
  {
    key: "garmin",
    title: "Connect Garmin",
    description: "Sync workouts and daily body metrics.",
    Icon: Watch,
  },
  {
    key: "ai_voice",
    title: "Try AI Voice Logging",
    description: "Log behaviors by speaking to Ritual.",
    Icon: Mic,
  },
  {
    key: "reminders",
    title: "Set Reminders",
    description: "Add prompts that help logging stick.",
    Icon: Bell,
  },
]

function statusLabel(status: ChecklistStatus): string {
  switch (status) {
    case "completed":
      return "Done"
    case "skipped":
      return "Skipped"
    case "needs_attention":
      return "Needs attention"
    case "seen":
      return "Started"
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

export function ActivationChecklist() {
  const router = useRouter()
  const { getToken } = useAuth()
  const { user } = useUser()
  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null)
  const [busyKey, setBusyKey] = useState<ChecklistKey | null>(null)

  const items = useMemo(() => {
    const rows = bootstrap?.activation?.checklist ?? []
    const byKey = new Map(rows.map((item) => [item.key, item.status]))
    return checklistConfig.map((config) => ({
      ...config,
      status: byKey.get(config.key) ?? "not_started",
    }))
  }, [bootstrap])

  const visibleItems = items.filter((item) => item.status !== "completed" && item.status !== "skipped")

  async function refreshBootstrap() {
    const token = await getToken()
    if (!token) return
    const response = await fetch("/api/user/bootstrap", {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    })
    if (response.ok) {
      setBootstrap(await response.json())
    }
  }

  async function updateChecklist(key: ChecklistKey, status: Exclude<ChecklistStatus, "not_started">, metadata?: Record<string, unknown>) {
    const token = await getToken()
    if (!token) return
    const response = await fetch("/api/user/activation/checklist", {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ key, status, metadata: metadata ?? null }),
    })
    if (response.ok) {
      setBootstrap(await response.json())
    }
  }

  async function authHeaders(): Promise<Record<string, string>> {
    const token = await getToken()
    return {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
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
      if (existingId) {
        return existingId
      }
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
    const headers = await authHeaders()
    await fetch("/api/habits", {
      method: "POST",
      headers,
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
      metadata: { notification: permission, destination: "/calendar" },
    }
  }

  useEffect(() => {
    void refreshBootstrap()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function connectItem(key: ChecklistKey) {
    setBusyKey(key)
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
        router.push("/calendar")
        return
      }

      await updateChecklist(key, "seen")
      router.push("/integrations")
    } finally {
      setBusyKey(null)
    }
  }

  async function skipItem(key: ChecklistKey) {
    setBusyKey(key)
    try {
      await updateChecklist(key, "skipped")
    } finally {
      setBusyKey(null)
    }
  }

  if (!bootstrap?.firstBehaviorLogged || visibleItems.length === 0) {
    return null
  }

  return (
    <section className="mb-6 border-b border-gray-200 pb-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium text-gray-950">Activate Ritual</h2>
          <p className="mt-1 text-sm text-gray-500">Optional setup you can finish whenever it is useful.</p>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {visibleItems.map(({ key, title, description, Icon, status }) => (
          <div key={key} className="rounded-sm border border-gray-200 bg-white p-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-sm border border-gray-200">
                  <Icon className="h-4 w-4 text-gray-700" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-950">{title}</p>
                  <p className="mt-1 text-xs text-gray-500">{statusLabel(status)}</p>
                </div>
              </div>
            </div>
            <p className="min-h-10 text-sm leading-5 text-gray-600">{description}</p>
            <div className="mt-4 flex gap-2">
              <Button
                size="sm"
                className="h-8 rounded-sm"
                onClick={() => void connectItem(key)}
                disabled={busyKey === key}
              >
                <Check className="mr-2 h-3.5 w-3.5" />
                Connect
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 rounded-sm"
                onClick={() => void skipItem(key)}
                disabled={busyKey === key}
              >
                <SkipForward className="mr-2 h-3.5 w-3.5" />
                Skip
              </Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
