"use client"

import { Clock3, RefreshCw } from "lucide-react"

import {
  OnboardingFooter,
  OnboardingNavButton,
  OnboardingStepHeader,
  OnboardingStepper,
  SETUP_STEPPER_COUNT,
} from "@/components/onboarding/perplexity-onboarding-shell"

const SCHEDULED_TASKS = [
  { title: "Daily Inbox Sweep", cadence: "7am every day" },
  { title: "Competitor Watch", cadence: "8am on Mon" },
  { title: "Weekly KPI Digest", cadence: "9am on Fri" },
  { title: "Meeting Prep Pack", cadence: "6:30am weekdays" },
  { title: "Customer Pulse Check", cadence: "10am on Wed" },
]

export function ScheduleStep({
  onBack,
  onNext,
}: {
  onBack: () => void
  onNext: () => void
}) {
  return (
    <div className="px-onboarding-step-enter flex h-full flex-col">
      <OnboardingStepHeader
        title="Schedule your tasks to run while you sleep"
        subtitle="Schedule recurring tasks on any cadence. Computer runs in the background and produces finished deliverables."
      />

      <div className="flex min-h-0 flex-1 items-center px-8 pb-2 pt-6">
        <div className="relative h-full max-h-[444px] w-full overflow-hidden rounded-[16px] border border-[var(--px-onboarding-border)] bg-[linear-gradient(145deg,#f4f2ee_0%,#edf3f1_100%)] px-12 py-5">
          <div
            className="pointer-events-none absolute inset-x-0 top-0 z-10 h-10"
            style={{
              background:
                "linear-gradient(to bottom, var(--px-onboarding-recessed) 0%, rgba(242,241,235,0) 100%)",
            }}
          />
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-10"
            style={{
              background:
                "linear-gradient(to top, var(--px-onboarding-recessed) 0%, rgba(242,241,235,0) 100%)",
            }}
          />
          <div className="flex h-full flex-col justify-center gap-2">
            {SCHEDULED_TASKS.map((task, index) => {
              const faded = index === 0 || index === SCHEDULED_TASKS.length - 1
              return (
                <div
                  key={task.title}
                  className="flex min-h-[64px] items-center gap-3 rounded-[12px] border border-[var(--px-onboarding-border)] bg-[var(--px-onboarding-cream)] px-3.5 py-2.5 shadow-[0_8px_20px_rgba(0,0,0,0.045)]"
                  style={{ opacity: faded ? 0.4 : 1 }}
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-[#f1efeb] text-[var(--px-onboarding-muted)]">
                    <Clock3 className="h-[18px] w-[18px]" strokeWidth={1.7} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-normal text-[var(--px-onboarding-ink)]">
                      {task.title}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5 text-[13px] text-[var(--px-onboarding-muted)]">
                    <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.7} />
                    <span>{task.cadence}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <OnboardingFooter
        left={<OnboardingNavButton variant="secondary" onClick={onBack}>Back</OnboardingNavButton>}
        center={<OnboardingStepper total={SETUP_STEPPER_COUNT} activeIndex={4} />}
        right={<OnboardingNavButton onClick={onNext}>Next</OnboardingNavButton>}
      />
    </div>
  )
}
