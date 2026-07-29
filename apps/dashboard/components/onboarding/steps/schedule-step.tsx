"use client"

import { CalendarDays, Check, Circle, Flag, ListTodo, Plus } from "lucide-react"

import {
  OnboardingFooter,
  OnboardingNavButton,
  OnboardingStepHeader,
  OnboardingStepper,
  SETUP_STEPPER_COUNT,
} from "@/components/onboarding/perplexity-onboarding-shell"

const TASKS = [
  { title: "Review weekly goals", meta: "Today", completed: true, priority: false },
  { title: "Finish product brief", meta: "Today", completed: false, priority: true },
  { title: "Plan tomorrow", meta: "5:00 PM", completed: false, priority: false },
  { title: "Book training session", meta: "Friday", completed: false, priority: false },
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
        title="Tasks"
        subtitle="Capture, prioritize, and complete work alongside the context that shapes your day."
      />

      <div className="flex min-h-0 flex-1 items-center px-8 pb-2 pt-5">
        <div className="w-full rounded-[16px] border border-[var(--px-onboarding-border)] bg-[var(--px-onboarding-recessed)] p-4">
          <div className="flex items-center">
            <span className="grid h-8 w-8 place-items-center rounded-[8px] border border-[var(--px-onboarding-border)] bg-[var(--px-onboarding-chip)]">
              <ListTodo className="h-4 w-4" strokeWidth={1.7} />
            </span>
            <div className="ml-2.5">
              <p className="text-[14px] text-[var(--px-onboarding-ink)]">Today</p>
              <p className="text-[11px] text-[var(--px-onboarding-muted)]">3 remaining</p>
            </div>
            <span className="ml-auto grid h-7 w-7 place-items-center rounded-full border border-[var(--px-onboarding-border)] bg-[var(--px-onboarding-chip)]">
              <Plus className="h-3.5 w-3.5" strokeWidth={1.7} />
            </span>
          </div>

          <div className="mt-3 space-y-2">
            {TASKS.map((task) => (
              <div
                key={task.title}
                className="flex min-h-[52px] items-center gap-3 rounded-[10px] border border-[var(--px-onboarding-border)] bg-[var(--px-onboarding-chip)] px-3"
              >
                <span
                  className={
                    task.completed
                      ? "grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[var(--px-onboarding-ink)] text-white"
                      : "grid h-5 w-5 shrink-0 place-items-center text-[var(--px-onboarding-muted)]"
                  }
                >
                  {task.completed ? (
                    <Check className="h-3 w-3" strokeWidth={2} />
                  ) : (
                    <Circle className="h-5 w-5" strokeWidth={1.5} />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={
                      task.completed
                        ? "block truncate text-[14px] text-[var(--px-onboarding-muted)] line-through"
                        : "block truncate text-[14px] text-[var(--px-onboarding-ink)]"
                    }
                  >
                    {task.title}
                  </span>
                </span>
                {task.priority ? (
                  <Flag className="h-3.5 w-3.5 shrink-0 text-[var(--px-onboarding-ink)]" strokeWidth={1.7} />
                ) : null}
                <span className="flex shrink-0 items-center gap-1 text-[11px] text-[var(--px-onboarding-muted)]">
                  <CalendarDays className="h-3 w-3" strokeWidth={1.6} />
                  {task.meta}
                </span>
              </div>
            ))}
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
