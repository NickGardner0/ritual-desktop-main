"use client"

import {
  OnboardingFooter,
  OnboardingNavButton,
  OnboardingStepper,
  SETUP_STEPPER_COUNT,
} from "@/components/onboarding/perplexity-onboarding-shell"
import { RitualLiquidMetalLogo } from "@/components/onboarding/ritual-liquid-metal-logo"

export function IntroStep({
  onSkip,
  onContinue,
}: {
  onSkip: () => void
  onContinue: () => void
}) {
  return (
    <div className="px-onboarding-step-enter flex h-full flex-col">
      <div
        className="relative h-[52.35%] min-h-[260px] max-h-[356px] shrink-0 overflow-hidden"
        style={{
          background:
            "radial-gradient(circle farthest-corner at 50% 44%, rgba(255,255,255,0.98) 0%, rgba(244,245,249,0.32) 36%, rgba(251,250,248,0) 72%)",
        }}
      >
        <RitualLiquidMetalLogo className="absolute left-1/2 top-[27%] -translate-x-1/2" />
      </div>

      <div className="flex flex-1 flex-col px-8 pt-2 text-center">
        <h1 className="px-onboarding-title text-[24px] leading-[1.2]">
          Welcome to Ritual
        </h1>
        <p className="mx-auto mt-3 max-w-[390px] text-[14px] font-normal leading-[1.45] text-[var(--px-onboarding-muted)]">
          Your private intelligence layer for remembering what matters and
          helping you move through every day.
        </p>
      </div>

      <OnboardingFooter
        left={
          <OnboardingNavButton variant="secondary" onClick={onSkip}>
            Skip intro
          </OnboardingNavButton>
        }
        center={
          <OnboardingStepper total={SETUP_STEPPER_COUNT} activeIndex={0} />
        }
        right={
          <OnboardingNavButton onClick={onContinue}>
            Get started
          </OnboardingNavButton>
        }
      />
    </div>
  )
}
