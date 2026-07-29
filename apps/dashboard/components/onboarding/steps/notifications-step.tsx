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
        subtitle="Get notified when Ritual discovers a pattern, prepares a report, or needs your input."
      />

      <div className="flex min-h-0 flex-1 items-center justify-center px-8 pb-2 pt-6">
        <div className="relative flex h-full max-h-[464px] w-full items-center justify-center rounded-[16px] border border-[var(--px-onboarding-border)] bg-[linear-gradient(145deg,#f4f2ee_0%,#edf3f1_100%)]">
          <div className="relative w-[340px]">
            <div className="absolute left-5 top-8 h-[104px] w-[calc(100%_-_40px)] rounded-[14px] border border-[var(--px-onboarding-border)] bg-[var(--px-onboarding-cream)]/70 shadow-[0_10px_24px_rgba(0,0,0,0.05)]" />
            <div className="absolute left-2.5 top-4 h-[104px] w-[calc(100%_-_20px)] rounded-[14px] border border-[var(--px-onboarding-border)] bg-[var(--px-onboarding-cream)]/85 shadow-[0_10px_24px_rgba(0,0,0,0.06)]" />
            <div className="relative rounded-[14px] border border-[var(--px-onboarding-border)] bg-[var(--px-onboarding-cream)] px-4 py-4 shadow-[0_16px_36px_rgba(0,0,0,0.10)]">
              <div className="flex items-center gap-2.5">
                <span className="grid h-8 w-8 place-items-center rounded-[8px] border border-[var(--px-onboarding-border)] bg-[#f4f2ee]">
                  <Monitor className="h-4 w-4 text-[var(--px-onboarding-ink)]" strokeWidth={1.7} />
                </span>
                <p className="text-[15px] font-normal text-[var(--px-onboarding-ink)]">Ritual</p>
                <span className="ml-auto text-[13px] text-[var(--px-onboarding-muted)]">just now</span>
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
