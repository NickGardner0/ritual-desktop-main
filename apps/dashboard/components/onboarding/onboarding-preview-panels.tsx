"use client"

import Image from "next/image"
import { Calendar, Check, ChevronRight, Eye, Folder, Keyboard, Lock, Mic, Monitor, Moon, Search, Settings } from "lucide-react"

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
  const permissionRows = [
    { label: "Full Disk Access", icon: Folder, count: "1", color: "bg-[#8e8e93]" },
    { label: "Accessibility", icon: Settings, count: "1", color: "bg-[#007aff]" },
    { label: "Microphone", icon: Mic, count: "1", color: "bg-[#8e8e93]" },
    { label: "Screen & System Audio Recording", icon: Monitor, count: "1", color: "bg-[#ff453a]" },
    { label: "Input Monitoring", icon: Keyboard, count: "0", color: "bg-[#8e8e93]" },
  ]

  return (
    <div className="absolute left-1/2 top-4 flex h-[160px] w-[460px] -translate-x-1/2 overflow-hidden rounded-[12px] border border-[#e6e6e4] bg-[#f6f6f5] text-[#1d1d1f] shadow-[0_14px_36px_rgba(20,24,40,0.10)]">
      <div className="w-[136px] shrink-0 border-r border-[#e5e5e3] bg-[#f2f2f1] px-3 py-3">
        <div className="flex h-7 items-center gap-2 rounded-[7px] bg-[#dededc] px-2 text-[11px] text-[#3f3f42]">
          <Search className="h-3.5 w-3.5 text-[#767676]" strokeWidth={2} />
          privacy
        </div>
        <div className="mt-3 flex h-8 items-center gap-2 rounded-[7px] bg-[#0a84ff] px-2 text-[11px] font-medium text-white">
          <span className="flex h-5 w-5 items-center justify-center rounded-[5px] bg-white/20">
            <Lock className="h-3.5 w-3.5" strokeWidth={2.2} />
          </span>
          Privacy & Security
        </div>
        <div className="mt-3 space-y-1.5 pl-9 text-[9.5px] leading-[1.12] text-[#8a8a8d]">
          <p>Allow applications to access your microphone</p>
          <p>Allow applications to record your screen</p>
        </div>
      </div>
      <div className="min-w-0 flex-1 bg-[#fbfbfa] px-3 py-3">
        <div className="mb-2 flex items-center gap-2 px-1">
          <Lock className="h-3.5 w-3.5 text-[#767676]" strokeWidth={2} />
          <p className="text-[12px] font-semibold leading-none">Privacy & Security</p>
        </div>
        <div className="overflow-hidden rounded-[10px] bg-white">
          {permissionRows.map((row) => {
            const Icon = row.icon
            return (
              <div key={row.label} className="flex h-[25px] items-center gap-2 border-b border-[#eeeeec] px-2 last:border-b-0">
                <span className={cn("flex h-5 w-5 items-center justify-center rounded-[5px] text-white", row.color)}>
                  <Icon className="h-3.5 w-3.5" strokeWidth={2} />
                </span>
                <p className="min-w-0 flex-1 truncate text-[11px] text-[#252527]">{row.label}</p>
                <span className="text-[10px] text-[#7d7d80]">{row.count}</span>
                <ChevronRight className="h-3.5 w-3.5 text-[#b4b4b6]" strokeWidth={2.4} />
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
