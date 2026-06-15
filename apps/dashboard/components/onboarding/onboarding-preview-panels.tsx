"use client"

import Image from "next/image"
import {
  Bell,
  Bluetooth,
  Calendar,
  Camera,
  Check,
  ChevronRight,
  Eye,
  Folder,
  ImageIcon,
  Lock,
  MapPin,
  Mic,
  Monitor,
  Moon,
  Search,
  UserRound,
} from "lucide-react"

import { FrostedPreviewPanel } from "@/components/onboarding/onboarding-window"
import { cn } from "@/lib/utils"

const tileClass = "flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[8px] bg-[#f0f0f2]"

function TogglePreview({ checked }: { checked: boolean }) {
  return (
    <span
      className={cn(
        "relative inline-flex h-[18px] w-[36px] shrink-0 rounded-full transition-colors",
        checked ? "bg-[#14171d]" : "bg-[#e2e2e6]",
      )}
      aria-hidden="true"
    >
      <span
        className={cn(
          "absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-transform",
          checked ? "translate-x-[19px]" : "translate-x-[3px]",
        )}
      />
    </span>
  )
}

export function MorningBriefPanel() {
  return (
    <FrostedPreviewPanel>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-[12px]">
          <Image src="/images/eclipse.svg" alt="" width={24} height={24} className="h-6 w-6" />
          <p className="text-[13px] font-semibold leading-none text-[#14171d]">Morning Brief</p>
        </div>
        <p className="text-[12px] leading-none text-[#a0a4ad]">Today · 8:02 AM</p>
      </div>
      <div className="mt-[26px] flex flex-col gap-[20px]">
        <div className="flex items-center gap-[14px]">
          <span className={tileClass}>
            <Calendar className="h-[17px] w-[17px] text-[#52525b]" strokeWidth={2} />
          </span>
          <p className="text-[13px] leading-none text-[#3f4654]">3 meetings today — first at 9:30</p>
        </div>
        <div className="flex items-center gap-[14px]">
          <span className={tileClass}>
            <Moon className="h-[17px] w-[17px] text-[#52525b]" strokeWidth={2} />
          </span>
          <p className="text-[13px] leading-none text-[#3f4654]">Slept 7h 12m · recovery 82%</p>
        </div>
        <div className="flex items-center gap-[14px]">
          <span className={tileClass}>
            <Check className="h-[18px] w-[18px] text-[#52525b]" strokeWidth={2.2} />
          </span>
          <p className="text-[13px] leading-none text-[#3f4654]">2 follow-ups from yesterday</p>
        </div>
      </div>
    </FrostedPreviewPanel>
  )
}

export function PermissionsPanel() {
  const privacyRows = [
    { label: "Location Services", icon: MapPin, color: "bg-[#0a84ff]", iconClassName: "text-white" },
    { label: "Contacts", icon: UserRound, color: "bg-[#b79b52]", iconClassName: "text-white" },
    { label: "Calendars", icon: Calendar, color: "bg-white", iconClassName: "text-[#ff3b30]" },
    { label: "Reminders", icon: Bell, color: "bg-white", iconClassName: "text-[#ff9500]" },
    { label: "Photos", icon: ImageIcon, color: "bg-white", iconClassName: "text-[#34c759]" },
    { label: "Bluetooth", icon: Bluetooth, color: "bg-[#0a84ff]", iconClassName: "text-white" },
    { label: "Microphone", icon: Mic, color: "bg-[#9a9aa0]", iconClassName: "text-white" },
    { label: "Camera", icon: Camera, color: "bg-[#9a9aa0]", iconClassName: "text-white" },
    { label: "Screen Recording", icon: Monitor, color: "bg-[#ff453a]", iconClassName: "text-white" },
  ]
  const sidebarRows = ["Siri & Spotlight", "Privacy & Security", "Desktop & Dock", "Displays", "Wallpaper"]

  return (
    <div className="absolute left-1/2 top-[12px] flex h-[252px] w-[574px] -translate-x-1/2 overflow-hidden rounded-[15px] border border-[#d8d6d2] bg-[#f4f3f1] text-[#1d1d1f] shadow-[0_18px_42px_rgba(20,24,40,0.14)]">
      <div className="w-[174px] shrink-0 border-r border-[#d8d6d2] bg-[linear-gradient(145deg,rgba(246,225,232,0.74),rgba(226,231,235,0.72))] px-3 py-4 backdrop-blur-xl">
        <div className="mb-5 flex items-center gap-[7px]">
          {["#ff5f57", "#ffbd2e", "#28c840"].map((color) => (
            <span
              key={color}
              className="h-[9px] w-[9px] rounded-full border border-black/10"
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
        <div className="flex h-[27px] items-center gap-2 rounded-[7px] bg-white/48 px-2 text-[11px] text-[#8d8a88] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.05)]">
          <Search className="h-[13px] w-[13px] text-[#5f6268]" strokeWidth={2.2} />
          <span>Search</span>
        </div>
        <div className="mt-3 space-y-[3px]">
          {sidebarRows.map((label) => {
            const selected = label === "Privacy & Security"
            return (
              <div
                key={label}
                className={cn(
                  "flex h-[25px] items-center gap-2 rounded-[6px] px-2 text-[10.5px] font-medium",
                  selected ? "bg-[#0a84ff] text-white" : "text-[#333438]",
                )}
              >
                <span
                  className={cn(
                    "flex h-[15px] w-[15px] items-center justify-center rounded-[4px]",
                    selected ? "bg-white/20" : "bg-white/62",
                  )}
                >
                  {selected ? (
                    <Lock className="h-[11px] w-[11px]" strokeWidth={2.2} />
                  ) : (
                    <span className="h-[5px] w-[5px] rounded-full bg-[#8b8c90]" />
                  )}
                </span>
                <span className="truncate">{label}</span>
              </div>
            )
          })}
        </div>
      </div>
      <div className="min-w-0 flex-1 bg-[#f6f5f4] px-6 py-4">
        <h3 className="text-[14px] font-semibold leading-none">Privacy & Security</h3>
        <p className="mt-[22px] text-[12px] font-semibold leading-none">Privacy</p>
        <div className="mt-3 overflow-hidden rounded-[9px] border border-[#dedcd9] bg-[#ecebea]">
          {privacyRows.map((row) => {
            const Icon = row.icon
            return (
              <div key={row.label} className="flex h-[30px] items-center gap-2 border-b border-[#d8d6d3] px-2.5 last:border-b-0">
                <span
                  className={cn(
                    "flex h-[18px] w-[18px] items-center justify-center rounded-[5px] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.05)]",
                    row.color,
                  )}
                >
                  <Icon className={cn("h-[12px] w-[12px]", row.iconClassName)} strokeWidth={2.1} />
                </span>
                <p className="min-w-0 flex-1 truncate text-[11.5px] text-[#242528]">{row.label}</p>
                <ChevronRight className="h-[13px] w-[13px] text-[#a8a6a4]" strokeWidth={2.4} />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export function LegacyPermissionsPanel() {
  return (
    <FrostedPreviewPanel>
      <div className="flex items-center gap-[10px]">
        <Lock className="h-[15px] w-[15px] text-[#6b7280]" strokeWidth={2} />
        <p className="text-[12px] font-semibold leading-none text-[#14171d]">Privacy & Security</p>
      </div>
      <div className="mt-[18px] flex flex-col gap-[13px]">
        <div className="flex items-center gap-[10px]">
          <span className={tileClass}>
            <Folder className="h-[15px] w-[15px] text-[#52525b]" strokeWidth={2} />
          </span>
          <p className="flex-1 text-[12px] leading-none text-[#3f4654]">Full Disk Access</p>
          <span className="inline-flex items-center gap-[4px] text-[11px] font-semibold text-[#14171d]">
            <Check className="h-[12px] w-[12px]" strokeWidth={2.3} />
            On
          </span>
        </div>
        <div className="flex items-center gap-[10px]">
          <span className={tileClass}>
            <Eye className="h-[15px] w-[15px] text-[#52525b]" strokeWidth={2} />
          </span>
          <p className="flex-1 text-[12px] leading-none text-[#3f4654]">Accessibility · Ritual Watcher</p>
          <TogglePreview checked />
        </div>
        <div className="flex items-center gap-[10px]">
          <span className={tileClass}>
            <Mic className="h-[15px] w-[15px] text-[#52525b]" strokeWidth={2} />
          </span>
          <p className="flex-1 text-[12px] leading-none text-[#3f4654]">Microphone & Voice</p>
          <TogglePreview checked={false} />
        </div>
      </div>
    </FrostedPreviewPanel>
  )
}

export function VaultPanel() {
  const rows = ["Files & notes", "Activity timeline", "Memory & context"]

  return (
    <FrostedPreviewPanel>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-[12px]">
          <span className="flex h-[32px] w-[32px] items-center justify-center rounded-[9px] bg-[#14171d]">
            <Lock className="h-[17px] w-[17px] text-white" strokeWidth={2} />
          </span>
          <p className="text-[13px] font-semibold leading-none text-[#14171d]">Stored on this Mac</p>
        </div>
        <span className="inline-flex h-[22px] items-center gap-[5px] rounded-[8px] bg-[#f0f0f2] px-[9px] text-[12px] font-semibold text-[#14171d]">
          <Check className="h-[13px] w-[13px] text-[#52525b]" strokeWidth={2.3} />
          Encrypted
        </span>
      </div>
      <div className="mt-[29px] flex flex-col gap-[22px]">
        {rows.map((row) => (
          <div key={row} className="flex items-center justify-between">
            <p className="text-[13px] leading-none text-[#3f4654]">{row}</p>
            <p className="text-[15px] leading-none tracking-[0.18em] text-[#c2c6cd]" aria-label="masked value">
              ••••••
            </p>
          </div>
        ))}
      </div>
    </FrostedPreviewPanel>
  )
}
