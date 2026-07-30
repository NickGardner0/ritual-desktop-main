"use client"

import { useMemo, useState } from "react"
import { Check, ChevronsUpDown, Plus } from "lucide-react"
import { MenuSurface } from "@ritual/ui/menu"

import {
  OnboardingFooter,
  OnboardingNavButton,
  OnboardingStepHeader,
  OnboardingStepper,
  SETUP_STEPPER_COUNT,
} from "@/components/onboarding/perplexity-onboarding-shell"
import { cn } from "@/lib/utils"

const CATEGORIES = ["All", "Health", "Productivity", "Learning", "Finances", "Work"] as const

type DemoTask = {
  id: string
  title: string
  completed: boolean
  category: Exclude<(typeof CATEGORIES)[number], "All">
}

const INITIAL_TASKS: DemoTask[] = [
  {
    id: "demo",
    title: "Record demo video walkthrough",
    completed: false,
    category: "Work",
  },
  {
    id: "hn",
    title: "Draft Hacker News launch post",
    completed: false,
    category: "Work",
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
    category: "Finances",
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
    category: "Learning",
  },
  {
    id: "deep-work",
    title: "Deep work: launch checklist review",
    completed: false,
    category: "Productivity",
  },
  {
    id: "weekly",
    title: "Weekly planning review",
    completed: false,
    category: "Productivity",
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
    category: "Productivity",
  },
]

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
        subtitle="Extremely fast, unified interface for all your tasks"
      />

      <div className="flex min-h-0 flex-1 items-center justify-center px-8 pb-2 pt-5">
        <MenuSurface className="flex h-[440px] w-full max-w-[380px] flex-col">
          <div className="flex items-center justify-between gap-3 px-3.5 pb-4 pt-3">
            <h2 className="text-[18px] font-medium leading-none tracking-[-0.02em] text-[var(--text-primary)]">
              Today
            </h2>
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                className="inline-flex h-6 items-center gap-1 rounded-full px-1.5 text-[11.5px] font-normal text-[var(--text-muted)] transition-colors duration-100 hover:bg-[var(--row-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ritual-focus-ring)] focus-visible:ring-offset-1"
                aria-label="View by List"
              >
                View by List
                <ChevronsUpDown className="h-3 w-3 opacity-70" strokeWidth={1.8} />
              </button>
              <button
                type="button"
                className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[var(--text-muted)] transition-colors duration-100 hover:bg-[var(--row-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ritual-focus-ring)] focus-visible:ring-offset-1"
                aria-label="Add task"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-0.5 px-2.5 pb-2.5">
            {CATEGORIES.map((option) => {
              const active = category === option
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => setCategory(option)}
                  className={cn(
                    "h-6 rounded-full px-2.5 text-[12px] transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ritual-focus-ring)] focus-visible:ring-offset-1",
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
                  className="grid min-h-[28px] grid-cols-[16px_minmax(0,1fr)] items-center gap-2.5 rounded-[6px] px-2 transition-colors duration-100 hover:bg-[var(--row-hover)]"
                >
                  <button
                    type="button"
                    onClick={() => toggleTask(task.id)}
                    className={cn(
                      "flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full border transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ritual-focus-ring)] focus-visible:ring-offset-1",
                      task.completed
                        ? "border-[var(--text-primary)] bg-[var(--text-primary)] text-white"
                        : "border-[rgba(39,37,30,0.28)] bg-white text-transparent hover:border-[var(--text-primary)]",
                    )}
                    aria-label={`${task.completed ? "Reopen" : "Complete"} ${task.title}`}
                    aria-pressed={task.completed}
                  >
                    <Check className="h-2 w-2" strokeWidth={2.8} />
                  </button>

                  <span
                    className={cn(
                      "truncate text-[13px] font-normal leading-none text-[var(--text-primary)]",
                      task.completed && "text-[var(--text-muted)] line-through",
                    )}
                  >
                    {task.title}
                  </span>
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
