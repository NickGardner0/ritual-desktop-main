"use client"

import Image from "next/image"
import { Calendar, Check, Eye, Folder, Lock, Mic, Moon } from "lucide-react"

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
  return (
    <FrostedPreviewPanel>
      <div className="flex items-center gap-[12px]">
        <Lock className="h-[17px] w-[17px] text-[#6b7280]" strokeWidth={2} />
        <p className="text-[13px] font-semibold leading-none text-[#14171d]">Privacy & Security</p>
      </div>
      <div className="mt-[27px] flex flex-col gap-[20px]">
        <div className="flex items-center gap-[14px]">
          <span className={tileClass}>
            <Folder className="h-[16px] w-[16px] text-[#52525b]" strokeWidth={2} />
          </span>
          <p className="flex-1 text-[13px] leading-none text-[#3f4654]">Full Disk Access</p>
          <span className="inline-flex items-center gap-[4px] text-[12px] font-semibold text-[#14171d]">
            <Check className="h-[13px] w-[13px]" strokeWidth={2.3} />
            On
          </span>
        </div>
        <div className="flex items-center gap-[14px]">
          <span className={tileClass}>
            <Eye className="h-[16px] w-[16px] text-[#52525b]" strokeWidth={2} />
          </span>
          <p className="flex-1 text-[13px] leading-none text-[#3f4654]">Accessibility · Ritual Watcher</p>
          <TogglePreview checked />
        </div>
        <div className="flex items-center gap-[14px]">
          <span className={tileClass}>
            <Mic className="h-[16px] w-[16px] text-[#52525b]" strokeWidth={2} />
          </span>
          <p className="flex-1 text-[13px] leading-none text-[#3f4654]">Microphone & Voice</p>
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
