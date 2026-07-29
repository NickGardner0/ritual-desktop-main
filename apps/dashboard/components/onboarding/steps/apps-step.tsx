"use client"

import type { LucideIcon } from "lucide-react"
import { Check, Clock3, Focus, Moon, Repeat2, Sunrise } from "lucide-react"

import {
  OnboardingFooter,
  OnboardingNavButton,
  OnboardingStepHeader,
  OnboardingStepper,
  SETUP_STEPPER_COUNT,
} from "@/components/onboarding/perplexity-onboarding-shell"

const ROUTINES: {
  title: string
  schedule: string
  detail: string
  progress: number
  icon: LucideIcon
}[] = [
  {
    title: "Morning reset",
    schedule: "7:00 AM",
    detail: "3 of 4 steps",
    progress: 75,
    icon: Sunrise,
  },
  {
    title: "Deep work block",
    schedule: "Weekdays",
    detail: "90 minutes",
    progress: 48,
    icon: Focus,
  },
  {
    title: "Evening review",
    schedule: "9:30 PM",
    detail: "3 steps",
    progress: 100,
    icon: Moon,
  },
]

export function AppsStep({
  onBack,
  onNext,
}: {
  onBack: () => void
  onNext: () => void
}) {
  return (
    <div className="px-onboarding-step-enter flex h-full flex-col">
      <OnboardingStepHeader
        title="Routines"
        subtitle="Build repeatable schedules, track completion, and see which routines actually work."
      />

      <div className="flex min-h-0 flex-1 items-center px-8 pb-2 pt-5">
        <div className="w-full rounded-[16px] border border-[var(--px-onboarding-border)] bg-[var(--px-onboarding-recessed)] p-4">
          <div className="mb-3 flex items-center gap-2">
            <Repeat2 className="h-4 w-4" strokeWidth={1.7} />
            <p className="text-[13px] font-medium text-[var(--px-onboarding-ink)]">
              Your routines
            </p>
            <span className="ml-auto text-[11px] text-[var(--px-onboarding-muted)]">
              Today
            </span>
          </div>

          <div className="space-y-2.5">
            {ROUTINES.map((routine) => {
              const Icon = routine.icon
              return (
                <div
                  key={routine.title}
                  className="rounded-[10px] border border-[var(--px-onboarding-border)] bg-[var(--px-onboarding-chip)] px-3 py-3"
                >
                  <div className="flex items-center gap-3">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] border border-[var(--px-onboarding-border)] bg-[var(--px-onboarding-recessed)]">
                      <Icon className="h-4 w-4" strokeWidth={1.65} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] text-[var(--px-onboarding-ink)]">
                        {routine.title}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1 text-[11px] text-[var(--px-onboarding-muted)]">
                        <Clock3 className="h-3 w-3" strokeWidth={1.6} />
                        {routine.schedule}
                        <span aria-hidden="true">·</span>
                        {routine.detail}
                      </span>
                    </span>
                    {routine.progress === 100 ? (
                      <span className="grid h-6 w-6 place-items-center rounded-full bg-[var(--px-onboarding-ink)] text-white">
                        <Check className="h-3.5 w-3.5" strokeWidth={2} />
                      </span>
                    ) : (
                      <span className="text-[12px] text-[var(--px-onboarding-muted)]">
                        {routine.progress}%
                      </span>
                    )}
                  </div>
                  <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-[var(--px-onboarding-border)]">
                    <div
                      className="h-full rounded-full bg-[var(--px-onboarding-ink)]"
                      style={{ width: `${routine.progress}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <OnboardingFooter
        left={<OnboardingNavButton variant="secondary" onClick={onBack}>Back</OnboardingNavButton>}
        center={<OnboardingStepper total={SETUP_STEPPER_COUNT} activeIndex={5} />}
        right={<OnboardingNavButton onClick={onNext}>Next</OnboardingNavButton>}
      />
    </div>
  )
}
