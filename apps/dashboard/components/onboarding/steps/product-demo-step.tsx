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

      <div className="flex min-h-0 flex-1 items-center justify-center px-8 pb-2 pt-6">
        <div className="relative flex h-full max-h-[444px] w-full flex-col items-center justify-center rounded-[16px] border border-[var(--px-onboarding-border)] bg-[linear-gradient(145deg,#eef4f2_0%,#f4f2ee_62%,#f3f1ed_100%)] px-5 pb-10 pt-8">
          <div className="w-full max-w-[320px] rounded-[16px] border border-[var(--px-onboarding-border)] bg-[var(--px-onboarding-cream)] p-4 shadow-[0_16px_34px_rgba(0,0,0,0.10)]">
            <p className="text-[15px] text-[#99968f]">What can I take off your plate?</p>
            <div className="mt-4 flex items-center gap-2 rounded-full border border-[var(--px-onboarding-border)] bg-[#f7f5f2] px-2.5 py-1.5">
              <Search className="h-4 w-4 shrink-0 text-[#87857f]" strokeWidth={1.7} />
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--px-onboarding-border)] bg-[var(--px-onboarding-cream)] px-2.5 py-1 text-[13px] font-normal text-[var(--px-onboarding-ink)]">
                <Monitor className="h-3 w-3" strokeWidth={1.8} />
                Computer
              </span>
              <span className="ml-auto grid h-8 w-8 place-items-center rounded-full bg-[#087d82] text-white">
                <ArrowUp className="h-4 w-4" strokeWidth={2} />
              </span>
            </div>
          </div>
          <p className="mt-5 flex items-center justify-center gap-2 text-[15px] font-normal text-[#168895]">
            <Sparkles className="h-4 w-4" strokeWidth={1.7} />
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
