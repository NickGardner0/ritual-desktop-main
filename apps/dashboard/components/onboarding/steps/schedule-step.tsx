"use client"

import { useMemo, useState } from "react"
import { AlertCircle, Check, ChevronsUpDown, Flag, Plus } from "lucide-react"
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
  completed: boolean
  category: (typeof CATEGORIES)[number]
  showBars?: boolean
  alert?: boolean
  overdue?: boolean
  meta?: string
}

const INITIAL_TASKS: DemoTask[] = [
  {
    id: "demo",
    title: "Record demo video walkthrough",
    completed: false,
    category: "Work",
    showBars: true,
  },
  {
    id: "hn",
    title: "Draft Hacker News launch post",
    completed: false,
    category: "Work",
    showBars: true,
  },
  {
    id: "badge",
    title: "Fix Today badge / view sync bug",
    completed: false,
    category: "Work",
  },
  {
    id: "cpa",
    title: "Confirm CPA appointment",
    completed: false,
    category: "Finance",
    alert: true,
    overdue: true,
    meta: "3 days ago",
  },
  {
    id: "run",
    title: "Easy 5k recovery run",
    completed: false,
    category: "Health",
  },
  {
    id: "read",
    title: "Read 30 pages of current book",
    completed: false,
    category: "Personal",
  },
  {
    id: "deep-work",
    title: "Deep work: launch checklist review",
    completed: false,
    category: "Work",
    showBars: true,
  },
  {
    id: "weekly",
    title: "Weekly planning review",
    completed: false,
    category: "Work",
    showBars: true,
  },
  {
    id: "hero",
    title: "Design landing page hero",
    completed: false,
    category: "Work",
  },
  {
    id: "groceries",
    title: "buy groceries",
    completed: false,
    category: "Personal",
  },
]

function PriorityBars() {
  return (
    <span className="flex h-3 w-[12px] items-end gap-[1.5px]" aria-hidden="true">
      <span className="h-[4px] w-[2px] rounded-full bg-[#ef6c2f]" />
      <span className="h-[7px] w-[2px] rounded-full bg-[#ef6c2f]" />
      <span className="h-[10px] w-[2px] rounded-full bg-[#ef6c2f]" />
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
        <MenuSurface className="flex h-[440px] w-full max-w-[380px] flex-col">
          <div className="flex items-center justify-between gap-3 px-3.5 pb-1.5 pt-3">
            <h2 className="text-[18px] font-medium leading-none tracking-[-0.02em] text-[var(--text-primary)]">
              Today
            </h2>
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                className="inline-flex h-6 items-center gap-1 rounded-[5px] px-1.5 text-[11.5px] font-normal text-[var(--text-muted)] transition-colors duration-100 hover:bg-[var(--row-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ritual-focus-ring)] focus-visible:ring-offset-1"
                aria-label="View by List"
              >
                View by List
                <ChevronsUpDown className="h-3 w-3 opacity-70" strokeWidth={1.8} />
              </button>
              <button
                type="button"
                className="inline-flex h-6 w-6 items-center justify-center rounded-[5px] text-[var(--text-muted)] transition-colors duration-100 hover:bg-[var(--row-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ritual-focus-ring)] focus-visible:ring-offset-1"
                aria-label="Add task"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-0.5 px-2.5 pb-2">
            {CATEGORIES.map((option) => {
              const active = category === option
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => setCategory(option)}
                  className={cn(
                    "h-6 rounded-[5px] px-2 text-[12px] transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ritual-focus-ring)] focus-visible:ring-offset-1",
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

          <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
            {visibleTasks.length ? (
              visibleTasks.map((task) => (
                <div
                  key={task.id}
                  className="grid min-h-[28px] grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2 rounded-[6px] px-2 transition-colors duration-100 hover:bg-[var(--row-hover)]"
                >
                  <button
                    type="button"
                    onClick={() => toggleTask(task.id)}
                    className={cn(
                      "flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-[3px] border transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ritual-focus-ring)] focus-visible:ring-offset-1",
                      task.completed
                        ? "border-[var(--text-primary)] bg-[var(--text-primary)] text-white"
                        : "border-[rgba(39,37,30,0.28)] bg-white text-transparent hover:border-[var(--text-primary)]",
                    )}
                    aria-label={`${task.completed ? "Reopen" : "Complete"} ${task.title}`}
                    aria-pressed={task.completed}
                  >
                    <Check className="h-2 w-2" strokeWidth={2.8} />
                  </button>

                  <div className="flex min-w-0 items-center gap-1.5">
                    {task.showBars ? <PriorityBars /> : null}
                    {task.alert ? (
                      <AlertCircle className="h-3 w-3 shrink-0 text-[#c44d3a]" strokeWidth={1.9} />
                    ) : null}
                    <span
                      className={cn(
                        "truncate text-[13px] font-normal leading-none text-[var(--text-primary)]",
                        task.completed && "text-[var(--text-muted)] line-through",
                      )}
                    >
                      {task.title}
                    </span>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    {task.overdue ? (
                      <Flag className="h-3 w-3 text-[#c44d3a]" strokeWidth={1.8} />
                    ) : null}
                    {task.meta ? (
                      <span
                        className={cn(
                          "text-[11px] leading-none",
                          task.overdue ? "text-[#c44d3a]" : "text-[var(--text-muted)]",
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
