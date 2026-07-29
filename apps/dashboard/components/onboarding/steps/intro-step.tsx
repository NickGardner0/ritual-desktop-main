"use client"

import Image from "next/image"

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
      <div className="flex flex-1 items-center justify-center px-8 text-center">
        <div className="translate-y-6">
          <Image
            src="/images/eclipse.svg"
            alt="Ritual"
            width={40}
            height={40}
            priority
            className="mx-auto h-10 w-10"
          />
          <h1 className="px-onboarding-title mt-8 text-[24px] leading-[1.2]">
            Welcome to Ritual
          </h1>
          <p className="mx-auto mt-3 max-w-[390px] text-[14px] font-normal leading-[1.45] text-[var(--px-onboarding-muted)]">
            The unified system for tracking, observing, and analyzing all of
            your online and offline behavior
          </p>
        </div>
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
