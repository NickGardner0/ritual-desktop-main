"use client"

import { useMemo, useState } from "react"
import { Check, ChevronsUpDown, Flag, Plus } from "lucide-react"
import { MenuSurface } from "@ritual/ui/menu"

import {
  OnboardingFooter,
  OnboardingNavButton,
  OnboardingStepHeader,
  OnboardingStepper,
  SETUP_STEPPER_COUNT,
} from "@/components/onboarding/perplexity-onboarding-shell"
import { cn } from "@/lib/utils"

const CATEGORIES = ["All", "Finance", "Health", "Personal", "Work"] as const

type DemoTask = {
  id: string
  title: string
  meta?: string
  overdue?: boolean
  completed: boolean
  priority: boolean
  category: (typeof CATEGORIES)[number]
  showBars?: boolean
}

const INITIAL_TASKS: DemoTask[] = [
  {
    id: "goals",
    title: "Review weekly goals",
    meta: "Today",
    completed: true,
    priority: false,
    category: "Work",
  },
  {
    id: "brief",
    title: "Finish product brief",
    meta: "Today",
    completed: false,
    priority: true,
    category: "Work",
    showBars: true,
  },
  {
    id: "plan",
    title: "Plan tomorrow",
    meta: "5:00 PM",
    completed: false,
    priority: false,
    category: "Personal",
  },
  {
    id: "training",
    title: "Book training session",
    meta: "Friday",
    completed: false,
    priority: false,
    category: "Health",
  },
  {
    id: "cpa",
    title: "Confirm CPA appointment",
    meta: "3 days ago",
    overdue: true,
    completed: false,
    priority: true,
    category: "Finance",
  },
]

function PriorityBars() {
  return (
    <span className="flex h-3.5 w-[14px] items-end gap-[1.5px]" aria-hidden="true">
      <span className="h-[5px] w-[2.5px] rounded-full bg-[#ef6c2f]" />
      <span className="h-[8px] w-[2.5px] rounded-full bg-[#ef6c2f]" />
      <span className="h-[11px] w-[2.5px] rounded-full bg-[#ef6c2f]" />
    </span>
  )
}

export function ScheduleStep({
  onBack,
  onNext,
}: {
  onBack: () => void
  onNext: () => void
}) {
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("All")
  const [tasks, setTasks] = useState(INITIAL_TASKS)

  const visibleTasks = useMemo(() => {
    if (category === "All") return tasks
    return tasks.filter((task) => task.category === category)
  }, [category, tasks])

  function toggleTask(id: string) {
    setTasks((current) =>
      current.map((task) =>
        task.id === id ? { ...task, completed: !task.completed } : task,
      ),
    )
  }

  return (
    <div className="px-onboarding-step-enter flex h-full flex-col">
      <OnboardingStepHeader
        title="Tasks"
        subtitle="Capture, prioritize, and complete work alongside the context that shapes your day."
      />

      <div className="flex min-h-0 flex-1 items-center justify-center px-8 pb-2 pt-5">
        <MenuSurface className="w-full max-w-[360px]">
          <div className="flex items-center justify-between gap-3 px-3 pb-1 pt-3">
            <h2 className="text-[17px] font-medium leading-none tracking-[-0.02em] text-[var(--text-primary)]">
              Today
            </h2>
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                className="inline-flex h-7 items-center gap-1 rounded-[6px] px-2 text-[12px] font-normal text-[var(--text-muted)] transition-colors duration-100 hover:bg-[var(--row-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ritual-focus-ring)] focus-visible:ring-offset-1"
                aria-label="View by List"
              >
                View by List
                <ChevronsUpDown className="h-3 w-3 opacity-70" strokeWidth={1.8} />
              </button>
              <button
                type="button"
                className="inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-[var(--text-muted)] transition-colors duration-100 hover:bg-[var(--row-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ritual-focus-ring)] focus-visible:ring-offset-1"
                aria-label="Add task"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-0.5 px-2 pb-2 pt-1">
            {CATEGORIES.map((option) => {
              const active = category === option
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => setCategory(option)}
                  className={cn(
                    "h-7 rounded-[6px] px-2.5 text-[12.5px] transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ritual-focus-ring)] focus-visible:ring-offset-1",
                    active
                      ? "bg-[var(--surface-panel,#f4f4f3)] font-medium text-[var(--text-primary)]"
                      : "font-normal text-[var(--text-muted)] hover:bg-[var(--row-hover)] hover:text-[var(--text-primary)]",
                  )}
                >
                  {option}
                </button>
              )
            })}
          </div>

          <div className="h-px bg-[var(--divider-subtle)]" />

          <div className="px-1 py-1">
            {visibleTasks.length ? (
              visibleTasks.map((task) => (
                <div
                  key={task.id}
                  className="grid min-h-[36px] grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-[8px] px-2 transition-colors duration-100 hover:bg-[var(--row-hover)]"
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

                  <div className="flex min-w-0 items-center gap-2">
                    {task.showBars ? <PriorityBars /> : null}
                    <span
                      className={cn(
                        "truncate text-[13px] font-normal leading-none text-[var(--text-primary)]",
                        task.completed && "text-[var(--text-muted)] line-through",
                      )}
                    >
                      {task.title}
                    </span>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    {task.priority && task.overdue ? (
                      <Flag className="h-3 w-3 text-[#c44d3a]" strokeWidth={1.8} />
                    ) : null}
                    {task.meta ? (
                      <span
                        className={cn(
                          "text-[11.5px] leading-none",
                          task.overdue
                            ? "text-[#c44d3a]"
                            : "text-[var(--text-muted)]",
                        )}
                      >
                        {task.meta}
                      </span>
                    ) : null}
                  </div>
                </div>
              ))
            ) : (
              <p className="px-2 py-5 text-center text-[13px] text-[var(--text-muted)]">
                No tasks in {category}
              </p>
            )}
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
