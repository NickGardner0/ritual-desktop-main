"use client"

import {
  OnboardingFooter,
  OnboardingNavButton,
  OnboardingStepper,
  SETUP_STEPPER_COUNT,
} from "@/components/onboarding/perplexity-onboarding-shell"
import { RitualGlassMark } from "@/components/onboarding/ritual-glass-mark"

export function IntroStep({
  onSkip,
  onContinue,
}: {
  onSkip: () => void
  onContinue: () => void
}) {
  return (
    <div className="px-onboarding-step-enter flex h-full flex-col">
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-8 pb-4 pt-12 text-center">
        <RitualGlassMark className="mb-8" />
        <h1 className="px-onboarding-title text-[24px] leading-[1.2]">Welcome to Ritual</h1>
        <p className="mx-auto mt-3 max-w-[390px] text-[14px] font-normal leading-[1.45] text-[var(--px-onboarding-muted)]">
          Your private intelligence layer for remembering what matters and helping you move through every day.
        </p>
      </div>

      <OnboardingFooter
        left={<OnboardingNavButton variant="secondary" onClick={onSkip}>Skip intro</OnboardingNavButton>}
        center={<OnboardingStepper total={SETUP_STEPPER_COUNT} activeIndex={0} />}
        right={<OnboardingNavButton onClick={onContinue}>Get started</OnboardingNavButton>}
      />
    </div>
  )
}
