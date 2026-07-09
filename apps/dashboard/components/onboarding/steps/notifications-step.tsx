"use client"

import { Monitor } from "lucide-react"

import {
  OnboardingFooter,
  OnboardingNavButton,
  OnboardingStepHeader,
} from "@/components/onboarding/perplexity-onboarding-shell"

export function NotificationsStep({
  onBack,
  onSkip,
  onEnable,
}: {
  onBack: () => void
  onSkip: () => void
  onEnable: () => void
}) {
  return (
    <div className="px-onboarding-step-enter flex h-full flex-col">
      <OnboardingStepHeader
        title="Know the moment it gets done"
        subtitle="Get notified when Computer finishes a task or needs your input."
      />

      <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-4">
        <div className="relative flex h-[280px] w-full items-center justify-center rounded-[18px] bg-gradient-to-b from-[#f4f3ee] to-[#ebeae4]">
          <div className="relative w-[280px]">
            <div className="absolute left-2 top-3 h-[88px] w-full rounded-[14px] border border-[var(--px-onboarding-border)] bg-white/70 shadow-[0_10px_24px_rgba(0,0,0,0.05)]" />
            <div className="absolute left-1 top-1.5 h-[88px] w-full rounded-[14px] border border-[var(--px-onboarding-border)] bg-white/85 shadow-[0_10px_24px_rgba(0,0,0,0.06)]" />
            <div className="relative rounded-[14px] border border-[var(--px-onboarding-border)] bg-white px-3.5 py-3 shadow-[0_16px_36px_rgba(0,0,0,0.08)]">
              <div className="flex items-center gap-2.5">
                <span className="grid h-7 w-7 place-items-center rounded-[7px] border border-[var(--px-onboarding-border)] bg-[#fafaf8]">
                  <Monitor className="h-3.5 w-3.5 text-[var(--px-onboarding-ink)]" strokeWidth={1.8} />
                </span>
                <p className="text-[13px] font-semibold text-[var(--px-onboarding-ink)]">Computer</p>
                <span className="ml-auto text-[11px] text-[var(--px-onboarding-muted)]">just now</span>
              </div>
              <div className="mt-3 space-y-2">
                <div className="h-2 w-[88%] rounded-full bg-[#ecece8]" />
                <div className="h-2 w-[72%] rounded-full bg-[#ecece8]" />
                <div className="h-2 w-[54%] rounded-full bg-[#ecece8]" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <OnboardingFooter
        left={<OnboardingNavButton variant="secondary" onClick={onBack}>Back</OnboardingNavButton>}
        right={
          <>
            <OnboardingNavButton variant="secondary" onClick={onSkip}>
              Not now
            </OnboardingNavButton>
            <OnboardingNavButton onClick={onEnable}>Enable</OnboardingNavButton>
          </>
        }
      />
    </div>
  )
}
