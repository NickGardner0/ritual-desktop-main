"use client"

import { useEffect, useState, type ReactNode } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import {
  ChevronDown,
  ChevronsRight,
  Ellipsis,
  Plus,
  Repeat2,
} from "lucide-react"
import { MenuSurface } from "@ritual/ui/menu"

import {
  OnboardingFooter,
  OnboardingNavButton,
  OnboardingStepHeader,
  OnboardingStepper,
  SETUP_STEPPER_COUNT,
} from "@/components/onboarding/perplexity-onboarding-shell"

type DemoPhase =
  | "list"
  | "selected"
  | "daily"
  | "weekly-menu"
  | "weekly"
  | "weekly-expanded"
  | "monthly-menu"
  | "monthly"
  | "monthly-refined"
  | "yearly-menu"
  | "yearly"
  | "yearly-refined"
  | "completion-menu"
  | "completion"
  | "completion-refined"

type TriggerType =
  | "Daily"
  | "Weekly"
  | "Monthly"
  | "Yearly"
  | "On completion"

const ROUTINES = [
  { title: "Grocery shopping", schedule: "Every Wed and Sun" },
  { title: "Daily morning exercise", schedule: "Every day" },
  { title: "Weekly grocery shopping", schedule: "Every Sunday" },
  { title: "Monthly budget review", schedule: "Every month on the 1st" },
  { title: "Weekday work planning", schedule: "Every weekday" },
  { title: "Oil change maintenance", schedule: "3 months after completion" },
] as const

const DEMO_SEQUENCE: Array<{ phase: DemoPhase; delay: number }> = [
  { phase: "selected", delay: 1400 },
  { phase: "daily", delay: 2600 },
  { phase: "weekly-menu", delay: 4700 },
  { phase: "weekly", delay: 5600 },
  { phase: "weekly-expanded", delay: 7600 },
  { phase: "monthly-menu", delay: 9200 },
  { phase: "monthly", delay: 10200 },
  { phase: "monthly-refined", delay: 13300 },
  { phase: "yearly-menu", delay: 15100 },
  { phase: "yearly", delay: 16200 },
  { phase: "yearly-refined", delay: 19500 },
  { phase: "completion-menu", delay: 22200 },
  { phase: "completion", delay: 23400 },
  { phase: "completion-refined", delay: 26000 },
  { phase: "list", delay: 28700 },
]

const DEMO_LOOP_DURATION = 30500

const TRIGGER_OPTIONS = [
  "Daily",
  "Weekly",
  "Monthly",
  "Yearly",
  "On completion",
] as const

const PANEL_TRANSITION = {
  duration: 0.24,
  ease: [0.2, 0, 0, 1] as const,
}

function RoutineList({
  detailVisible,
  selected,
}: {
  detailVisible: boolean
  selected: boolean
}) {
  return (
    <motion.div
      className="relative z-10 h-full shrink-0 overflow-hidden bg-[var(--ritual-surface-raised,#fff)]"
      animate={{ width: detailVisible ? "32.5%" : "100%" }}
      transition={PANEL_TRANSITION}
    >
      <div className="flex h-12 items-center px-4">
        <p className="text-[17.5px] font-medium tracking-[-0.02em] text-[var(--ritual-text-primary,#111)]">
          Routines
        </p>
        <button
          type="button"
          aria-label="Add routine"
          className="ml-auto grid h-6 w-6 place-items-center rounded-md text-[var(--ritual-text-muted,#7a7a7a)]"
        >
          <Plus className="h-4 w-4" strokeWidth={1.7} />
        </button>
      </div>

      <div className="space-y-0.5 px-2.5">
        {ROUTINES.map((routine, index) => {
          const active = selected && index === 1
          return (
            <motion.div
              key={routine.title}
              className="relative flex h-[34px] items-center overflow-hidden rounded-[8px] px-2"
              animate={{
                backgroundColor: active
                  ? "var(--ritual-surface-panel, #f4f4f3)"
                  : "rgba(255,255,255,0)",
              }}
              transition={{ duration: 0.16 }}
            >
              <Repeat2
                className={
                  active
                    ? "h-3.5 w-3.5 shrink-0 text-[var(--ritual-text-primary,#111)]"
                    : "h-3.5 w-3.5 shrink-0 text-[var(--ritual-text-muted,#7a7a7a)]"
                }
                strokeWidth={1.55}
              />
              <span
                className={
                  active
                    ? "ml-2 min-w-0 truncate text-[10.5px] font-medium text-[var(--ritual-text-primary,#111)]"
                    : "ml-2 min-w-0 truncate text-[10.5px] font-normal text-[var(--ritual-text-primary,#111)]"
                }
              >
                {routine.title}
              </span>
              {!detailVisible ? (
                <span className="ml-auto block min-w-0 overflow-hidden whitespace-nowrap pl-3 text-[8.5px] text-[var(--ritual-text-muted,#7a7a7a)]">
                  {routine.schedule}
                </span>
              ) : null}
            </motion.div>
          )
        })}
      </div>
    </motion.div>
  )
}

function Toggle() {
  return (
    <span className="relative h-[18px] w-8 rounded-full bg-[var(--ritual-border-default,#dad9d7)]">
      <span className="absolute left-0.5 top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow-sm" />
    </span>
  )
}

function TriggerMenu({
  target,
}: {
  target: Exclude<TriggerType, "Daily">
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -4, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -3, scale: 0.98 }}
      transition={{ duration: 0.16, ease: [0.2, 0, 0, 1] }}
      className="absolute right-0 top-7 z-50 w-[108px]"
    >
      <MenuSurface className="overflow-hidden p-1">
        {TRIGGER_OPTIONS.map((option) => (
          <div
            key={option}
            className={
              option === target
                ? "flex h-6 items-center rounded-[8px] bg-[var(--row-hover)] px-2 text-[9px] font-medium text-[var(--ritual-text-primary,#111)]"
                : "flex h-6 items-center rounded-[8px] px-2 text-[9px] text-[var(--ritual-text-secondary,#666)]"
            }
          >
            {option}
          </div>
        ))}
      </MenuSurface>
    </motion.div>
  )
}

function ScheduleFields({
  phase,
  trigger,
}: {
  phase: DemoPhase
  trigger: TriggerType
}) {
  const weeklyExpanded = phase === "weekly-expanded"
  const monthlyRefined = phase === "monthly-refined"
  const yearlyRefined = phase === "yearly-refined"
  const completionRefined = phase === "completion-refined"

  return (
    <AnimatePresence initial={false} mode="wait">
      <motion.div
        key={`${trigger}-${phase}`}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -5 }}
        transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
      >
        {trigger === "Daily" ? (
          <>
            <FieldRow
              label="Every"
              value={
                <span className="flex items-center gap-1.5">
                  <ValueChip>1</ValueChip>
                  day
                </span>
              }
            />
            <FieldRow label="First run" value="Select date" />
            <FieldRow label="Ends" value="Select date" last />
          </>
        ) : trigger === "Weekly" ? (
          <>
            <FieldRow
              label="Every"
              value={
                <span className="flex items-center gap-1.5">
                  <ValueChip>1</ValueChip>
                  week
                </span>
              }
            />
            <FieldRow
              label="On"
              value={
                <span className="flex items-center gap-1.5">
                  <ValueChip>Tuesday</ValueChip>
                  <span className="text-[11px]">+</span>
                </span>
              }
            />
            {weeklyExpanded ? (
              <FieldRow
                label="And on"
                value={
                  <span className="flex items-center gap-1.5">
                    <ValueChip>Monday</ValueChip>
                    <span className="text-[11px]">−</span>
                  </span>
                }
              />
            ) : null}
            <FieldRow label="First run" value="Select date" />
            <FieldRow label="Ends" value="Select date" last />
          </>
        ) : trigger === "Monthly" ? (
          <>
            <FieldRow
              label="Every"
              value={
                <span className="flex items-center gap-1.5">
                  <ValueChip>1</ValueChip>
                  month
                </span>
              }
            />
            <FieldRow
              label="On the"
              value={
                <span className="flex items-center gap-1.5">
                  {monthlyRefined ? (
                    <>
                      <ValueChip>First</ValueChip>
                      <ValueChip>Sunday</ValueChip>
                    </>
                  ) : (
                    <>
                      <ValueChip>26th</ValueChip>
                      day
                    </>
                  )}
                </span>
              }
            />
            <FieldRow label="First run" value="Select date" />
            <FieldRow label="Ends" value="Select date" last />
          </>
        ) : trigger === "Yearly" ? (
          <>
            <FieldRow
              label="Every"
              value={
                <span className="flex items-center gap-1.5">
                  <ValueChip>{yearlyRefined ? "2" : "1"}</ValueChip>
                  {yearlyRefined ? "years" : "year"}
                </span>
              }
            />
            <FieldRow
              label="On the"
              value={
                <span className="flex items-center gap-1.5">
                  {yearlyRefined ? (
                    <>
                      <ValueChip>5th</ValueChip>
                      <ValueChip>Monday</ValueChip>
                      in
                      <ValueChip>March</ValueChip>
                    </>
                  ) : (
                    <>
                      <ValueChip>26th</ValueChip>
                      day in
                      <ValueChip>May</ValueChip>
                    </>
                  )}
                </span>
              }
            />
            <FieldRow label="First run" value="Select date" />
            <FieldRow label="Ends" value="Select date" last />
          </>
        ) : (
          <>
            <FieldRow
              label="Repeat"
              value={
                <span className="flex items-center gap-1.5">
                  <ValueChip>{completionRefined ? "2" : "1"}</ValueChip>
                  {completionRefined ? "days" : "week"}
                  <span>after completion</span>
                </span>
              }
              last
            />
          </>
        )}
      </motion.div>
    </AnimatePresence>
  )
}

function ValueChip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-[6px] bg-[var(--ritual-surface-raised,#fff)] px-1.5 py-0.5 text-[9px] text-[var(--ritual-text-primary,#111)] shadow-[inset_0_0_0_1px_var(--ritual-border-subtle,rgba(15,23,42,.052))]">
      {children}
    </span>
  )
}

function FieldRow({
  label,
  value,
  last = false,
}: {
  label: string
  value: ReactNode
  last?: boolean
}) {
  return (
    <div
      className={
        last
          ? "flex min-h-6 items-center justify-between"
          : "flex min-h-6 items-center justify-between border-b border-[var(--ritual-border-subtle,rgba(15,23,42,.052))]"
      }
    >
      <span className="text-[9.5px] text-[var(--ritual-text-secondary,#666)]">
        {label}
      </span>
      <span className="text-[9px] text-[var(--ritual-text-muted,#7a7a7a)]">
        {value}
      </span>
    </div>
  )
}

function RoutineDetail({
  phase,
  trigger,
}: {
  phase: DemoPhase
  trigger: TriggerType
}) {
  const showMenu =
    phase === "weekly-menu" ||
    phase === "monthly-menu" ||
    phase === "yearly-menu" ||
    phase === "completion-menu"
  const menuTarget: Exclude<TriggerType, "Daily"> =
    phase === "weekly-menu"
      ? "Weekly"
      : phase === "monthly-menu"
        ? "Monthly"
        : phase === "yearly-menu"
          ? "Yearly"
          : "On completion"

  return (
    <motion.div
      initial={{ x: 72 }}
      animate={{ x: 0 }}
      exit={{ x: 72 }}
      transition={PANEL_TRANSITION}
      className="absolute inset-y-0 right-0 z-20 w-[67.5%] border-l border-[var(--ritual-border-default,#dad9d7)] bg-[var(--ritual-surface-canvas,#fefefe)]"
    >
      <div className="relative flex h-8 items-center justify-center border-b border-[var(--ritual-border-subtle,rgba(15,23,42,.052))] px-3">
        <ChevronsRight
          className="absolute left-2.5 h-3.5 w-3.5 text-[var(--ritual-text-muted,#7a7a7a)]"
          strokeWidth={1.7}
        />
        <span className="text-[8px] text-[var(--ritual-text-muted,#7a7a7a)]">
          Routine
        </span>
        <Ellipsis
          className="absolute right-2.5 h-3.5 w-3.5 text-[var(--ritual-text-muted,#7a7a7a)]"
          strokeWidth={1.7}
        />
      </div>

      <div className="px-3.5 pb-2.5 pt-2.5">
        <h3 className="flex h-6 items-center truncate text-[16px] font-medium tracking-[-0.02em] text-[var(--ritual-text-primary,#111)]">
          <span className="truncate">Daily morning exercise</span>
          {phase === "daily" ? (
            <motion.span
              aria-hidden="true"
              className="ml-px h-[17px] w-px shrink-0 bg-[var(--ritual-text-primary,#111)]"
              animate={{ opacity: [1, 1, 0, 0] }}
              transition={{ duration: 0.9, repeat: Infinity }}
            />
          ) : null}
        </h3>

        <div className="mt-2 rounded-[8px] bg-[var(--ritual-surface-panel,#f4f4f3)] px-2.5">
          <div className="flex h-7 items-center justify-between border-b border-[var(--ritual-border-subtle,rgba(15,23,42,.052))]">
            <span className="text-[9.5px] text-[var(--ritual-text-secondary,#666)]">
              Trigger
            </span>
            <span className="relative">
              <span className="flex items-center gap-1 rounded-[8px] bg-[var(--ritual-surface-raised,#fff)] px-2 py-1 text-[9px] font-medium text-[var(--ritual-text-primary,#111)] shadow-[inset_0_0_0_1px_var(--ritual-border-subtle,rgba(15,23,42,.052))]">
                {trigger}
                <ChevronDown
                  className="h-2.5 w-2.5 text-[var(--ritual-text-muted,#7a7a7a)]"
                  strokeWidth={1.7}
                />
              </span>
              <AnimatePresence>
                {showMenu ? <TriggerMenu target={menuTarget} /> : null}
              </AnimatePresence>
            </span>
          </div>
          <div className="flex h-7 items-center justify-between">
            <span className="text-[9.5px] text-[var(--ritual-text-secondary,#666)]">
              Paused
            </span>
            <Toggle />
          </div>
        </div>

        <div className="mt-2 rounded-[8px] bg-[var(--ritual-surface-panel,#f4f4f3)] px-2.5">
          <ScheduleFields phase={phase} trigger={trigger} />
        </div>

        <div className="mt-2 px-1 text-[8.5px] leading-[1.35] text-[var(--ritual-text-muted,#7a7a7a)]">
          <p>Last: Jul 29</p>
          <p className="truncate">
            {trigger === "On completion"
              ? "If completed today → next Aug 13"
              : trigger === "Yearly"
                ? "Next: Mar 20, 2028 · Mar 18, 2030…"
                : trigger === "Monthly"
                  ? "Next: Aug 2, Sep 6, Oct 4…"
                  : trigger === "Weekly"
                    ? "Next: Aug 4, Aug 11, Aug 18…"
                    : "Next: Jul 30, Jul 31, Aug 1…"}
          </p>
        </div>

        <div className="mt-2 flex h-7 items-center justify-between rounded-[8px] bg-[var(--ritual-surface-panel,#f4f4f3)] px-2.5">
          <span className="text-[9.5px] text-[var(--ritual-text-secondary,#666)]">
            Priority
          </span>
          <span className="flex items-end gap-0.5 text-[8.5px] font-medium text-[var(--ritual-text-primary,#111)]">
            <span className="h-1.5 w-0.5 rounded-full bg-[var(--ritual-text-muted,#7a7a7a)]" />
            <span className="h-2.5 w-0.5 rounded-full bg-[var(--ritual-text-secondary,#666)]" />
            <span className="mr-1 h-3.5 w-0.5 rounded-full bg-[var(--ritual-text-primary,#111)]" />
            High
          </span>
        </div>

        <div className="mt-2 h-9 rounded-[8px] bg-[var(--ritual-surface-panel,#f4f4f3)] px-2.5 py-2 text-[9px] text-[var(--ritual-text-secondary,#666)]">
          Start each day with physical activity
        </div>

        <div className="mt-2 px-1">
          <p className="text-[8.5px] text-[var(--ritual-text-muted,#7a7a7a)]">
            Tags
          </p>
          <span className="mt-1 inline-flex rounded-full border border-dashed border-[var(--ritual-border-default,#dad9d7)] px-2 py-0.5 text-[8px] text-[var(--ritual-text-muted,#7a7a7a)]">
            + tag
          </span>
        </div>
      </div>
    </motion.div>
  )
}

function AnimatedRoutinesDemo() {
  const reduceMotion = useReducedMotion()
  const [phase, setPhase] = useState<DemoPhase>("list")

  useEffect(() => {
    if (reduceMotion) return

    let timeouts: number[] = []

    const runSequence = () => {
      setPhase("list")
      timeouts = DEMO_SEQUENCE.map(({ phase: nextPhase, delay }) =>
        window.setTimeout(() => setPhase(nextPhase), delay),
      )
      timeouts.push(window.setTimeout(runSequence, DEMO_LOOP_DURATION))
    }

    runSequence()

    return () => {
      timeouts.forEach((timeout) => window.clearTimeout(timeout))
    }
  }, [reduceMotion])

  const visiblePhase = reduceMotion ? "completion-refined" : phase
  const detailVisible = !["list", "selected"].includes(visiblePhase)
  const selected = visiblePhase !== "list"
  const trigger: TriggerType =
    visiblePhase === "daily" || visiblePhase === "weekly-menu"
      ? "Daily"
      : visiblePhase === "weekly" ||
          visiblePhase === "weekly-expanded" ||
          visiblePhase === "monthly-menu"
        ? "Weekly"
        : visiblePhase === "monthly" ||
            visiblePhase === "monthly-refined" ||
            visiblePhase === "yearly-menu"
          ? "Monthly"
          : visiblePhase === "yearly" ||
              visiblePhase === "yearly-refined" ||
              visiblePhase === "completion-menu"
            ? "Yearly"
            : "On completion"

  return (
    <MenuSurface
      aria-label="Animated routines preview"
      data-demo-phase={visiblePhase}
      className="relative h-[376px] w-full overflow-hidden bg-[var(--ritual-surface-raised,#fff)]"
    >
      <RoutineList
        detailVisible={detailVisible}
        selected={selected}
      />
      <AnimatePresence>
        {detailVisible ? (
          <RoutineDetail phase={visiblePhase} trigger={trigger} />
        ) : null}
      </AnimatePresence>
    </MenuSurface>
  )
}

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
        <div className="mx-auto w-full max-w-[420px]">
          <AnimatedRoutinesDemo />
        </div>
      </div>

      <OnboardingFooter
        left={
          <OnboardingNavButton variant="secondary" onClick={onBack}>
            Back
          </OnboardingNavButton>
        }
        center={
          <OnboardingStepper
            total={SETUP_STEPPER_COUNT}
            activeIndex={5}
          />
        }
        right={
          <OnboardingNavButton onClick={onNext}>
            Next
          </OnboardingNavButton>
        }
      />
    </div>
  )
}
