"use client"

import { useState } from "react"
import {
  Building2,
  Check,
  ChevronDown,
  Hash,
  Inbox,
  Signal,
  X,
} from "lucide-react"
import { MenuSurface } from "@ritual/ui/menu"

import {
  OnboardingFooter,
  OnboardingNavButton,
  OnboardingStepHeader,
  OnboardingStepper,
  SETUP_STEPPER_COUNT,
} from "@/components/onboarding/perplexity-onboarding-shell"
import { cn } from "@/lib/utils"

type DemoTask = {
  id: string
  title: string
  completed: boolean
}

const INITIAL_TASKS: DemoTask[] = [
  { id: "doctor", title: "Schedule doctors appointment", completed: false },
  { id: "read", title: "Read 20 pages", completed: false },
  { id: "gym", title: "Go to the gym", completed: true },
  { id: "feature", title: "Work on new product feature", completed: false },
  { id: "water", title: "Drink 1/2 gallon of water", completed: false },
]

export function ScheduleStep({
  onBack,
  onNext,
}: {
  onBack: () => void
  onNext: () => void
}) {
  const [tasks, setTasks] = useState(INITIAL_TASKS)
  const [draft, setDraft] = useState("")

  function toggleTask(id: string) {
    setTasks((current) =>
      current.map((task) =>
        task.id === id ? { ...task, completed: !task.completed } : task,
      ),
    )
  }

  function captureDraft() {
    const title = draft.trim()
    if (!title) return
    setTasks((current) => [
      { id: `draft-${Date.now()}`, title, completed: false },
      ...current,
    ])
    setDraft("")
  }

  return (
    <div className="px-onboarding-step-enter flex h-full flex-col">
      <OnboardingStepHeader
        title="Tasks"
        subtitle="Capture, prioritize, and complete work alongside the context that shapes your day."
      />

      <div className="flex min-h-0 flex-1 items-center justify-center px-8 pb-2 pt-5">
        <MenuSurface className="flex min-h-[420px] w-full max-w-[380px] flex-col">
          <div className="flex items-center gap-3 px-3.5 pb-2.5 pt-3">
            <button
              type="button"
              className="inline-flex min-w-0 items-center gap-1.5 rounded-[6px] px-1 py-1 text-[12.5px] text-[var(--text-muted)] transition-colors duration-100 hover:bg-[var(--row-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ritual-focus-ring)] focus-visible:ring-offset-1"
              aria-label="Personal project"
            >
              <Building2 className="h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
              <span className="truncate font-normal">Personal</span>
              <ChevronDown className="h-3 w-3 shrink-0 opacity-70" strokeWidth={1.8} />
            </button>
            <button
              type="button"
              className="inline-flex min-w-0 items-center gap-1.5 rounded-[6px] px-1 py-1 text-[12.5px] text-[var(--text-muted)] transition-colors duration-100 hover:bg-[var(--row-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ritual-focus-ring)] focus-visible:ring-offset-1"
              aria-label="Inbox"
            >
              <Inbox className="h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
              <span className="truncate font-normal">Inbox</span>
              <ChevronDown className="h-3 w-3 shrink-0 opacity-70" strokeWidth={1.8} />
            </button>
            <button
              type="button"
              className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-[var(--text-muted)] transition-colors duration-100 hover:bg-[var(--row-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ritual-focus-ring)] focus-visible:ring-offset-1"
              aria-label="Close"
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.8} />
            </button>
          </div>

          <div className="px-3.5">
            <label className="flex min-h-[44px] items-center gap-2 rounded-[10px] border border-[var(--border-subtle,rgba(15,23,42,0.08))] bg-[var(--surface-panel,#f4f4f3)] px-3">
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault()
                    captureDraft()
                  }
                }}
                placeholder="Quick Capture"
                aria-label="Quick Capture"
                className="min-w-0 flex-1 bg-transparent py-2.5 text-[14px] font-normal text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
              />
              <span className="flex shrink-0 items-center gap-2 text-[var(--text-muted)]" aria-hidden="true">
                <Signal className="h-3.5 w-3.5" strokeWidth={1.7} />
                <Hash className="h-3.5 w-3.5" strokeWidth={1.7} />
              </span>
            </label>
          </div>

          <div className="mt-3 flex min-h-0 flex-1 flex-col gap-0.5 px-2 py-1">
            {tasks.map((task) => (
              <div
                key={task.id}
                className="grid min-h-[42px] grid-cols-[18px_minmax(0,1fr)] items-center gap-3 rounded-[8px] px-2.5 transition-colors duration-100 hover:bg-[var(--row-hover)]"
              >
                <button
                  type="button"
                  onClick={() => toggleTask(task.id)}
                  className={cn(
                    "flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[4px] border transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ritual-focus-ring)] focus-visible:ring-offset-1",
                    task.completed
                      ? "border-[var(--text-primary)] bg-[var(--text-primary)] text-white"
                      : "border-[rgba(39,37,30,0.28)] bg-white text-transparent hover:border-[var(--text-primary)]",
                  )}
                  aria-label={`${task.completed ? "Reopen" : "Complete"} ${task.title}`}
                  aria-pressed={task.completed}
                >
                  <Check className="h-2.5 w-2.5" strokeWidth={2.6} />
                </button>
                <span
                  className={cn(
                    "truncate text-[14px] font-normal leading-[1.35] text-[var(--text-primary)]",
                    task.completed && "text-[var(--text-muted)] line-through",
                  )}
                >
                  {task.title}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-auto flex items-center justify-between gap-3 border-t border-[var(--divider-subtle)] px-3.5 py-3">
            <p className="truncate text-[12px] text-[var(--text-muted)]">
              Thursday, May 21 12:41
            </p>
            <button
              type="button"
              onClick={captureDraft}
              className="inline-flex h-8 shrink-0 items-center gap-2 rounded-[8px] border border-[var(--border-default,#dad9d7)] bg-white px-2.5 text-[12.5px] font-medium text-[var(--text-primary)] shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors duration-100 hover:bg-[var(--surface-panel,#f4f4f3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ritual-focus-ring)] focus-visible:ring-offset-1"
            >
              Capture
              <span className="text-[11px] font-normal text-[var(--text-muted)]">⌘ Enter</span>
            </button>
          </div>
        </MenuSurface>
      </div>

      <OnboardingFooter
        left={<OnboardingNavButton variant="secondary" onClick={onBack}>Back</OnboardingNavButton>}
        center={<OnboardingStepper total={SETUP_STEPPER_COUNT} activeIndex={4} />}
        right={<OnboardingNavButton onClick={onNext}>Next</OnboardingNavButton>}
      />
    </div>
  )
}
