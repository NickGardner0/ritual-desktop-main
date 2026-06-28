"use client"

import Image from "next/image"
import {
  Bell,
  Bluetooth,
  Calendar,
  Camera,
  Check,
  ChevronRight,
  CircleUserRound,
  Eye,
  Folder,
  ImageIcon,
  Lock,
  MapPin,
  Mic,
  Monitor,
  Moon,
  Palette,
  Search,
  ShieldCheck,
  Sparkles,
  Sun,
  UserRound,
  Wifi,
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
    { label: "Location Services", meta: "5", icon: MapPin, color: "bg-[#0a84ff]", iconClassName: "text-white" },
    { label: "Calendars", meta: "3 full access", icon: Calendar, color: "bg-white", iconClassName: "text-[#ff3b30]" },
    { label: "Contacts", meta: "None", icon: UserRound, color: "bg-[#b79b52]", iconClassName: "text-white" },
    { label: "Files & Folders", meta: "7 apps", icon: Folder, color: "bg-[#22c8e5]", iconClassName: "text-white" },
    { label: "Full Disk Access", meta: "2 full access", icon: Lock, color: "bg-[#8e8e93]", iconClassName: "text-white" },
    { label: "Microphone", meta: "1", icon: Mic, color: "bg-[#8e8e93]", iconClassName: "text-white" },
    { label: "Screen Recording", meta: "1", icon: Monitor, color: "bg-[#ff453a]", iconClassName: "text-white" },
  ]
  const sidebarRows = [
    { label: "Wi-Fi", icon: Wifi, color: "bg-[#0a84ff]", iconClassName: "text-white" },
    { label: "Bluetooth", icon: Bluetooth, color: "bg-[#0a84ff]", iconClassName: "text-white" },
    { label: "Privacy & Security", icon: Lock, color: "bg-[#0a84ff]", iconClassName: "text-white" },
    { label: "Desktop & Dock", icon: Monitor, color: "bg-[#2b2b2d]", iconClassName: "text-white" },
    { label: "Displays", icon: Sun, color: "bg-[#3aa6ff]", iconClassName: "text-white" },
    { label: "Appearance", icon: Palette, color: "bg-[#1d1d1f]", iconClassName: "text-white" },
  ]

  return (
    <div className="absolute left-1/2 top-[10px] flex h-[260px] w-[620px] -translate-x-1/2 overflow-hidden rounded-[20px] border border-[#d8d6d2] bg-[#f7f6f4] text-[#1d1d1f] shadow-[0_22px_50px_rgba(20,24,40,0.16)]">
      <div className="w-[188px] shrink-0 border-r border-[#d8d6d2] bg-[linear-gradient(145deg,rgba(246,225,232,0.78),rgba(232,236,240,0.78))] px-3.5 py-4 backdrop-blur-xl">
        <div className="mb-4 flex items-center gap-[7px]">
          {["#ff5f57", "#ffbd2e", "#28c840"].map((color) => (
            <span
              key={color}
              className="h-[10px] w-[10px] rounded-full border border-black/10 shadow-[inset_0_0_0_0.5px_rgba(255,255,255,0.3)]"
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
        <div className="flex h-[29px] items-center gap-2 rounded-[8px] bg-white/48 px-2.5 text-[11.5px] text-[#8d8a88] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)]">
          <Search className="h-[14px] w-[14px] text-[#5f6268]" strokeWidth={2.2} />
          <span>Search</span>
        </div>
        <div className="mt-3 flex items-center gap-2 px-1.5">
          <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-[#9ca3af]">
            <CircleUserRound className="h-[22px] w-[22px] text-white" strokeWidth={1.8} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[11.5px] font-semibold leading-[1.05] text-[#26272b]">Nick Gardner</p>
            <p className="mt-0.5 truncate text-[10.5px] leading-none text-[#7d7f86]">Apple Account</p>
          </div>
        </div>
        <div className="mt-4 space-y-[4px]">
          {sidebarRows.map((row) => {
            const selected = row.label === "Privacy & Security"
            const Icon = row.icon
            return (
              <div
                key={row.label}
                className={cn(
                  "flex h-[28px] items-center gap-2 rounded-[7px] px-2 text-[11px] font-medium",
                  selected ? "bg-[#0a84ff] text-white shadow-[inset_0_0_0_0.5px_rgba(255,255,255,0.16)]" : "text-[#333438]",
                )}
              >
                <span
                  className={cn(
                    "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)]",
                    selected ? "bg-white/20" : row.color,
                  )}
                >
                  <Icon className={cn("h-[12px] w-[12px]", selected ? "text-white" : row.iconClassName)} strokeWidth={2.1} />
                </span>
                <span className="truncate">{row.label}</span>
              </div>
            )
          })}
        </div>
      </div>
      <div className="min-w-0 flex-1 bg-[#f7f6f4] px-6 py-4">
        <h3 className="text-[15px] font-semibold leading-none text-[#424245]">Privacy & Security</h3>
        <div className="mt-5 flex items-center gap-3 rounded-[13px] bg-white/42 px-3.5 py-3 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.025)]">
          <span className="flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-[8px] bg-[#0a84ff] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.22)]">
            <ShieldCheck className="h-[17px] w-[17px] text-white" strokeWidth={2.1} />
          </span>
          <div className="min-w-0">
            <p className="text-[13.5px] font-medium leading-none text-[#202124]">Privacy</p>
            <p className="mt-1 max-w-[310px] text-[11.5px] leading-[1.25] text-[#7b7b80]">
              Control which apps can access your data, location, camera, and microphone.
            </p>
          </div>
        </div>
        <div className="mt-3 overflow-hidden rounded-[13px] bg-white/42 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.025)]">
          {privacyRows.map((row) => {
            const Icon = row.icon
            return (
              <div key={row.label} className="flex h-[34px] items-center gap-3 border-b border-[#e3e1df] px-3 last:border-b-0">
                <span
                  className={cn(
                    "flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[6px] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)]",
                    row.color,
                  )}
                >
                  <Icon className={cn("h-[14px] w-[14px]", row.iconClassName)} strokeWidth={2.1} />
                </span>
                <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-[#242528]">{row.label}</p>
                <span className="text-[12px] leading-none text-[#8a8a8e]">{row.meta}</span>
                <ChevronRight className="h-[14px] w-[14px] text-[#b0aeab]" strokeWidth={2.4} />
              </div>
            )
          })}
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-[13px] bg-white/42 px-3.5 py-2.5 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.025)]">
          <span className="flex h-[24px] w-[24px] items-center justify-center rounded-[7px] bg-[#8e8e93]">
            <Sparkles className="h-[14px] w-[14px] text-white" strokeWidth={2.1} />
          </span>
          <p className="text-[12.5px] font-medium text-[#25262a]">Apple Intelligence & Siri</p>
          <ChevronRight className="ml-auto h-[14px] w-[14px] text-[#b0aeab]" strokeWidth={2.4} />
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
