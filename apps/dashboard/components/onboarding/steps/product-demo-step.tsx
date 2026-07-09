"use client"

import { ArrowUp, Monitor, Search, Sparkles } from "lucide-react"

import {
  OnboardingFooter,
  OnboardingNavButton,
  OnboardingStepHeader,
  OnboardingStepper,
  SETUP_STEPPER_COUNT,
} from "@/components/onboarding/perplexity-onboarding-shell"

export function ProductDemoStep({
  onBack,
  onNext,
}: {
  onBack: () => void
  onNext: () => void
}) {
  return (
    <div className="px-onboarding-step-enter flex h-full flex-col">
      <OnboardingStepHeader
        title="Computer can tackle any project"
        subtitle="Computer orchestrates AI agents that research, build and ship finished projects end to end."
      />

      <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-4">
        <div className="relative flex h-full max-h-[340px] w-full flex-col items-center justify-center rounded-[18px] bg-[var(--px-onboarding-recessed)] px-5 pb-10 pt-8">
          <div className="w-full max-w-[340px] rounded-[16px] border border-[var(--px-onboarding-border)] bg-white p-4 shadow-[0_16px_40px_rgba(0,0,0,0.08)]">
            <p className="text-[14px] text-[#b0b0ab]">What can I take off your plate?</p>
            <div className="mt-4 flex items-center gap-2 rounded-full border border-[var(--px-onboarding-border)] bg-[#fafaf8] px-2.5 py-1.5">
              <Search className="h-3.5 w-3.5 shrink-0 text-[#9a9a95]" strokeWidth={1.8} />
              <span className="inline-flex items-center gap-1 rounded-full border border-[var(--px-onboarding-border)] bg-white px-2 py-0.5 text-[11px] font-medium text-[var(--px-onboarding-ink)]">
                <Monitor className="h-3 w-3" strokeWidth={1.8} />
                Computer
              </span>
              <span className="ml-auto grid h-7 w-7 place-items-center rounded-full bg-[#005F5F] text-white">
                <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.2} />
              </span>
            </div>
          </div>
          <p className="mt-5 flex items-center justify-center gap-1.5 text-[13px] font-medium text-[#005F5F]">
            <Sparkles className="h-3.5 w-3.5" strokeWidth={1.8} />
            Draft replies to my support emails daily.
          </p>
        </div>
      </div>

      <OnboardingFooter
        left={<OnboardingNavButton variant="secondary" onClick={onBack}>Back</OnboardingNavButton>}
        center={<OnboardingStepper total={SETUP_STEPPER_COUNT} activeIndex={2} />}
        right={<OnboardingNavButton onClick={onNext}>Next</OnboardingNavButton>}
      />
    </div>
  )
}
