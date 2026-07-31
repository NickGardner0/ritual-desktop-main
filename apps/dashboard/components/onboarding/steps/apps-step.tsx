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
  | "detail"
  | "trigger-menu"
  | "monthly"
  | "completion-menu"
  | "completion"

type TriggerType = "Weekly" | "Monthly" | "On completion"

const ROUTINES = [
  { title: "Grocery shopping", schedule: "Every Wed and Sun" },
  { title: "Daily morning exercise", schedule: "Every day" },
  { title: "Weekly grocery shopping", schedule: "Every Sunday" },
  { title: "Monthly budget review", schedule: "Every month on the 1st" },
  { title: "Weekday work planning", schedule: "Every weekday" },
  { title: "Oil change maintenance", schedule: "3 months after completion" },
] as const

const DEMO_SEQUENCE: Array<{ phase: DemoPhase; delay: number }> = [
  { phase: "selected", delay: 600 },
  { phase: "detail", delay: 1150 },
  { phase: "trigger-menu", delay: 2350 },
  { phase: "monthly", delay: 3350 },
  { phase: "completion-menu", delay: 4700 },
  { phase: "completion", delay: 5700 },
  { phase: "list", delay: 7600 },
]

const TRIGGER_OPTIONS = [
  "Daily",
  "Weekly",
  "Monthly",
  "Yearly",
  "On completion",
] as const

const PANEL_TRANSITION = {
  duration: 0.42,
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
      animate={{ width: detailVisible ? "39%" : "100%" }}
      transition={PANEL_TRANSITION}
    >
      <div className="flex h-11 items-center px-4">
        <p className="text-[17px] font-medium tracking-[-0.02em] text-[var(--ritual-text-primary,#111)]">
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
              className="relative flex h-[33px] items-center overflow-hidden rounded-md px-2"
              animate={{
                backgroundColor: active
                  ? "var(--ritual-surface-panel, #f4f4f3)"
                  : "rgba(255,255,255,0)",
              }}
              transition={{ duration: 0.18 }}
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
  target: "Monthly" | "On completion"
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -4, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -3, scale: 0.98 }}
      transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
      className="absolute right-0 top-6 z-50 w-[92px] overflow-hidden rounded-md border border-[var(--ritual-border-default,#dad9d7)] bg-[var(--ritual-surface-raised,#fff)] p-1 shadow-[var(--shadow-popover)]"
    >
      {TRIGGER_OPTIONS.map((option) => (
        <div
          key={option}
          className={
            option === target
              ? "rounded-[5px] bg-[var(--ritual-surface-panel,#f4f4f3)] px-2 py-1 text-[8.5px] font-medium text-[var(--ritual-text-primary,#111)]"
              : "px-2 py-1 text-[8.5px] text-[var(--ritual-text-secondary,#666)]"
          }
        >
          {option}
        </div>
      ))}
    </motion.div>
  )
}

function ScheduleFields({ trigger }: { trigger: TriggerType }) {
  return (
    <AnimatePresence initial={false} mode="wait">
      <motion.div
        key={trigger}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -5 }}
        transition={{ duration: 0.24, ease: [0.2, 0, 0, 1] }}
      >
        {trigger === "Weekly" ? (
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
                  <ValueChip>26th</ValueChip>
                  day
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
                  <ValueChip>2</ValueChip>
                  weeks
                </span>
              }
            />
            <FieldRow label="" value="after completion" last />
          </>
        )}
      </motion.div>
    </AnimatePresence>
  )
}

function ValueChip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-[5px] bg-[var(--ritual-surface-raised,#fff)] px-1.5 py-0.5 text-[8.5px] text-[var(--ritual-text-primary,#111)] shadow-[inset_0_0_0_1px_var(--ritual-border-subtle,rgba(15,23,42,.052))]">
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
          ? "flex min-h-5 items-center justify-between"
          : "flex min-h-5 items-center justify-between border-b border-[var(--ritual-border-subtle,rgba(15,23,42,.052))]"
      }
    >
      <span className="text-[9px] text-[var(--ritual-text-secondary,#666)]">
        {label}
      </span>
      <span className="text-[8.5px] text-[var(--ritual-text-muted,#7a7a7a)]">
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
    phase === "trigger-menu" || phase === "completion-menu"
  const menuTarget =
    phase === "completion-menu" ? "On completion" : "Monthly"

  return (
    <motion.div
      initial={{ x: 72 }}
      animate={{ x: 0 }}
      exit={{ x: 72 }}
      transition={PANEL_TRANSITION}
      className="absolute inset-y-0 right-0 z-20 w-[61%] border-l border-[var(--ritual-border-default,#dad9d7)] bg-[#fbfbfa]"
    >
      <div className="relative flex h-7 items-center justify-center border-b border-[var(--ritual-border-subtle,rgba(15,23,42,.052))] px-3">
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

      <div className="px-3 pb-2 pt-2">
        <h3 className="truncate text-[15px] font-medium tracking-[-0.02em] text-[var(--ritual-text-primary,#111)]">
          Daily morning exercise
        </h3>

        <div className="mt-1.5 rounded-md bg-[var(--ritual-surface-panel,#f4f4f3)] px-2.5">
          <div className="flex h-6 items-center justify-between border-b border-[var(--ritual-border-subtle,rgba(15,23,42,.052))]">
            <span className="text-[9px] text-[var(--ritual-text-secondary,#666)]">
              Trigger
            </span>
            <span className="relative">
              <span className="flex items-center gap-1 rounded-md bg-[var(--ritual-surface-raised,#fff)] px-2 py-1 text-[8.5px] font-medium text-[var(--ritual-text-primary,#111)] shadow-[inset_0_0_0_1px_var(--ritual-border-subtle,rgba(15,23,42,.052))]">
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
          <div className="flex h-6 items-center justify-between">
            <span className="text-[9px] text-[var(--ritual-text-secondary,#666)]">
              Paused
            </span>
            <Toggle />
          </div>
        </div>

        <div className="mt-1.5 rounded-md bg-[var(--ritual-surface-panel,#f4f4f3)] px-2.5">
          <ScheduleFields trigger={trigger} />
        </div>

        <div className="mt-1.5 px-1 text-[8px] leading-[1.35] text-[var(--ritual-text-muted,#7a7a7a)]">
          <p>Last: Jul 29</p>
          <p className="truncate">
            {trigger === "On completion"
              ? "If completed today → next Aug 13"
              : "Next: Jul 31, Aug 2, Aug 4, Aug 6…"}
          </p>
        </div>

        <div className="mt-1.5 flex h-6 items-center justify-between rounded-md bg-[var(--ritual-surface-panel,#f4f4f3)] px-2.5">
          <span className="text-[9px] text-[var(--ritual-text-secondary,#666)]">
            Priority
          </span>
          <span className="flex items-end gap-0.5 text-[8.5px] font-medium text-[var(--ritual-text-primary,#111)]">
            <span className="h-1.5 w-0.5 rounded-full bg-[var(--ritual-text-muted,#7a7a7a)]" />
            <span className="h-2.5 w-0.5 rounded-full bg-[var(--ritual-text-secondary,#666)]" />
            <span className="mr-1 h-3.5 w-0.5 rounded-full bg-[var(--ritual-text-primary,#111)]" />
            High
          </span>
        </div>

        <div className="mt-1.5 h-8 rounded-md bg-[var(--ritual-surface-panel,#f4f4f3)] px-2.5 py-1.5 text-[8.5px] text-[var(--ritual-text-secondary,#666)]">
          Start each day with physical activity
        </div>

        <div className="mt-1.5 px-1">
          <p className="text-[8px] text-[var(--ritual-text-muted,#7a7a7a)]">
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
      timeouts.push(window.setTimeout(runSequence, 8600))
    }

    runSequence()

    return () => {
      timeouts.forEach((timeout) => window.clearTimeout(timeout))
    }
  }, [reduceMotion])

  const visiblePhase = reduceMotion ? "completion" : phase
  const detailVisible = !["list", "selected"].includes(visiblePhase)
  const selected = visiblePhase !== "list"
  const trigger: TriggerType =
    visiblePhase === "completion"
      ? "On completion"
      : visiblePhase === "monthly" ||
          visiblePhase === "completion-menu"
        ? "Monthly"
        : "Weekly"

  return (
    <MenuSurface
      aria-label="Animated routines preview"
      data-demo-phase={visiblePhase}
      className="relative h-[344px] w-full overflow-hidden bg-[var(--ritual-surface-raised,#fff)]"
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
        <div className="mx-auto w-full max-w-[430px]">
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
