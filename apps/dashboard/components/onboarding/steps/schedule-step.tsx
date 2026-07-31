"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Check, ChevronsUpDown, Plus } from "lucide-react"
import { MenuSurface } from "@ritual/ui/menu"

import { ShimmeringText } from "@/components/ui/shimmering-text"
import {
  OnboardingFooter,
  OnboardingNavButton,
  OnboardingStepHeader,
  OnboardingStepper,
  SETUP_STEPPER_COUNT,
} from "@/components/onboarding/perplexity-onboarding-shell"
import { cn } from "@/lib/utils"

const CATEGORIES = ["All", "Health", "Productivity", "Learning", "Finances"] as const

type DemoTask = {
  id: string
  title: string
  category: Exclude<(typeof CATEGORIES)[number], "All">
}

/** Keep this list short enough that every row fits inside the card without clipping. */
const INITIAL_TASKS: DemoTask[] = [
  {
    id: "demo",
    title: "Record demo video walkthrough",
    category: "Productivity",
  },
  {
    id: "hn",
    title: "Draft Hacker News launch post",
    category: "Productivity",
  },
  {
    id: "badge",
    title: "Fix Today badge / view sync bug",
    category: "Productivity",
  },
  {
    id: "cpa",
    title: "Confirm CPA appointment",
    category: "Finances",
  },
  {
    id: "run",
    title: "Easy 5k recovery run",
    category: "Health",
  },
  {
    id: "meditate",
    title: "10 minute morning meditation",
    category: "Health",
  },
  {
    id: "sleep",
    title: "In bed by 10:30 PM",
    category: "Health",
  },
  {
    id: "water",
    title: "Drink 1/2 gallon of water",
    category: "Health",
  },
  {
    id: "stretch",
    title: "15 minute mobility stretch",
    category: "Health",
  },
  {
    id: "vitamins",
    title: "Take vitamins and supplements",
    category: "Health",
  },
]

const DEMO_COMPLETE_SEQUENCE = [
  { id: "meditate", delay: 900 },
  { id: "run", delay: 2400 },
  { id: "water", delay: 3900 },
  { id: "stretch", delay: 5400 },
  { id: "vitamins", delay: 6900 },
] as const

const SHIMMER_DURATION_S = 1.5
const SHIMMER_MS = Math.round(SHIMMER_DURATION_S * 1000) + 250

export function ScheduleStep({
  onBack,
  onNext,
}: {
  onBack: () => void
  onNext: () => void
}) {
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("All")
  const [tasks, setTasks] = useState(INITIAL_TASKS)
  const [completingIds, setCompletingIds] = useState<Set<string>>(new Set())
  const completingRef = useRef(new Set<string>())
  const dismissTimers = useRef<number[]>([])

  const visibleTasks = useMemo(() => {
    if (category === "All") return tasks
    return tasks.filter((task) => task.category === category)
  }, [category, tasks])

  const completeTask = useCallback((id: string) => {
    if (completingRef.current.has(id)) return

    completingRef.current.add(id)
    setCompletingIds(new Set(completingRef.current))

    const timer = window.setTimeout(() => {
      setTasks((current) => current.filter((task) => task.id !== id))
      completingRef.current.delete(id)
      setCompletingIds(new Set(completingRef.current))
    }, SHIMMER_MS)
    dismissTimers.current.push(timer)
  }, [])

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (reducedMotion) return

    const timers = DEMO_COMPLETE_SEQUENCE.map(({ id, delay }) =>
      window.setTimeout(() => {
        completeTask(id)
      }, delay),
    )

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer))
      dismissTimers.current.forEach((timer) => window.clearTimeout(timer))
      dismissTimers.current = []
    }
  }, [completeTask])

  return (
    <div className="px-onboarding-step-enter flex h-full flex-col">
      <OnboardingStepHeader
        title="Tasks"
        subtitle="Extremely fast, unified interface for all your tasks"
      />

      <div className="flex min-h-0 flex-1 items-center justify-center px-8 pb-2 pt-5">
        <MenuSurface className="flex h-[420px] w-full max-w-[380px] flex-col overflow-hidden">
          <div className="flex shrink-0 items-center justify-between gap-3 px-3.5 pb-3 pt-3">
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

          <div className="flex shrink-0 flex-nowrap items-center gap-0.5 overflow-hidden px-2.5 pb-2">
            {CATEGORIES.map((option) => {
              const active = category === option
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => setCategory(option)}
                  className={cn(
                    "h-6 shrink-0 rounded-full px-2.5 text-[12px] transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ritual-focus-ring)] focus-visible:ring-offset-1",
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

          <div className="flex min-h-0 flex-1 flex-col justify-start overflow-hidden px-1.5 pb-3 pt-0.5">
            {visibleTasks.length ? (
              <AnimatePresence initial={false}>
                {visibleTasks.map((task) => {
                  const completing = completingIds.has(task.id)
                  return (
                    <motion.div
                      key={task.id}
                      layout
                      initial={{ opacity: 1, height: 30 }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.18, ease: "easeOut" }}
                      className="grid h-[30px] shrink-0 grid-cols-[16px_minmax(0,1fr)] items-center gap-2.5 px-2 transition-colors duration-100 hover:bg-[var(--row-hover)]"
                    >
                      <button
                        type="button"
                        onClick={() => completeTask(task.id)}
                        disabled={completing}
                        className={cn(
                          "flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full border transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ritual-focus-ring)] focus-visible:ring-offset-1 disabled:opacity-100",
                          completing
                            ? "border-[var(--text-primary)] bg-[var(--text-primary)] text-white"
                            : "border-[rgba(39,37,30,0.28)] bg-white text-transparent hover:border-[var(--text-primary)]",
                        )}
                        aria-label={`Complete ${task.title}`}
                        aria-pressed={completing}
                      >
                        <Check className="h-2 w-2" strokeWidth={2.8} />
                      </button>

                      {completing ? (
                        <ShimmeringText
                          text={task.title}
                          duration={SHIMMER_DURATION_S}
                          delay={0}
                          repeat
                          repeatDelay={0.2}
                          startOnView={false}
                          once={false}
                          spread={2.4}
                          color="#8a8a8f"
                          shimmerColor="#111111"
                          className="text-[13px] font-normal leading-none"
                        />
                      ) : (
                        <span className="truncate text-[13px] font-normal leading-none text-[var(--text-primary)]">
                          {task.title}
                        </span>
                      )}
                    </motion.div>
                  )
                })}
              </AnimatePresence>
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
