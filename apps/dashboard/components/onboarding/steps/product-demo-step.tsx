"use client"

import type { LucideIcon } from "lucide-react"
import {
  Activity,
  Dumbbell,
  HeartPulse,
  LockKeyhole,
  Moon,
  Smartphone,
  Watch,
} from "lucide-react"

import {
  OnboardingFooter,
  OnboardingNavButton,
  OnboardingStepHeader,
  OnboardingStepper,
  SETUP_STEPPER_COUNT,
} from "@/components/onboarding/perplexity-onboarding-shell"

const DEVICE_SOURCES: {
  label: string
  detail: string
  icon: LucideIcon
}[] = [
  { label: "Apple Health", detail: "Health & activity", icon: HeartPulse },
  { label: "WHOOP", detail: "Recovery & strain", icon: Activity },
  { label: "Oura", detail: "Sleep & readiness", icon: Moon },
  { label: "Garmin", detail: "Workouts & activity", icon: Watch },
  { label: "Fitbit", detail: "Fitness & sleep", icon: Dumbbell },
  { label: "Screen Time", detail: "Digital behavior", icon: Smartphone },
]

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
        title="Connect your devices"
        subtitle="Bring health, activity, sleep, and screen-time data into one private timeline."
      />

      <div className="flex min-h-0 flex-1 items-center px-8 pb-2 pt-5">
        <div className="w-full rounded-[16px] border border-[var(--px-onboarding-border)] bg-[var(--px-onboarding-recessed)] p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[13px] font-medium text-[var(--px-onboarding-ink)]">
              Available sources
            </p>
            <span className="text-[12px] text-[var(--px-onboarding-muted)]">
              Connect anytime
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            {DEVICE_SOURCES.map((source) => {
              const Icon = source.icon
              return (
                <div
                  key={source.label}
                  className="flex min-h-[68px] items-center gap-3 rounded-[10px] border border-[var(--px-onboarding-border)] bg-[var(--px-onboarding-chip)] px-3"
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] border border-[var(--px-onboarding-border)] bg-[var(--px-onboarding-recessed)] text-[var(--px-onboarding-ink)]">
                    <Icon className="h-4 w-4" strokeWidth={1.7} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] text-[var(--px-onboarding-ink)]">
                      {source.label}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-[var(--px-onboarding-muted)]">
                      {source.detail}
                    </span>
                  </span>
                </div>
              )
            })}
          </div>

          <div className="mt-3 flex items-center justify-center gap-2 rounded-[10px] border border-[var(--px-onboarding-border)] bg-[var(--px-onboarding-chip)] px-3 py-2.5 text-[12px] text-[var(--px-onboarding-muted)]">
            <LockKeyhole className="h-3.5 w-3.5" strokeWidth={1.7} />
            Your connections and data stay private.
          </div>
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
