"use client"

import {
  OnboardingFooter,
  OnboardingNavButton,
  OnboardingStepper,
  SETUP_STEPPER_COUNT,
} from "@/components/onboarding/perplexity-onboarding-shell"

export function IntroStep({
  onSkip,
  onContinue,
}: {
  onSkip: () => void
  onContinue: () => void
}) {
  return (
    <div className="px-onboarding-step-enter flex h-full flex-col">
      <div className="relative h-[72.35%] min-h-[300px] max-h-[492px] shrink-0 overflow-hidden">
        <img
          src="/onboarding/intro-hero.png"
          alt=""
          className="absolute inset-0 h-full w-full object-cover object-center"
        />
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-32"
          style={{
            background:
              "linear-gradient(to bottom, rgba(251,250,248,0) 0%, rgba(251,250,248,0.76) 55%, var(--px-onboarding-cream) 100%)",
          }}
        />
      </div>

      <div className="flex flex-1 flex-col px-8 pt-2 text-center">
        <h1 className="px-onboarding-title text-[24px] leading-[1.2]">Welcome to Perplexity Pro</h1>
        <p className="mx-auto mt-3 max-w-[390px] text-[14px] font-normal leading-[1.45] text-[var(--px-onboarding-muted)]">
          You&apos;ve unlocked access to Computer, your always-on teammate that works for you.
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
