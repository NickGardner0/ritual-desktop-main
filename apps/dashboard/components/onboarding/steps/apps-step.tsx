"use client"

import { useEffect, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { ChevronLeft, Ellipsis, Plus, Repeat2 } from "lucide-react"
import {
  MenuList,
  MenuRow,
  MenuSeparator,
  MenuSurface,
} from "@ritual/ui/menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ritual/ui/select"

import {
  OnboardingFooter,
  OnboardingNavButton,
  OnboardingStepHeader,
  OnboardingStepper,
  SETUP_STEPPER_COUNT,
} from "@/components/onboarding/perplexity-onboarding-shell"
import { Switch } from "@/components/ui/switch"

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

type ScheduleRow = {
  label: string
  value: string
}

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

const TRIGGER_OPTIONS: TriggerType[] = [
  "Daily",
  "Weekly",
  "Monthly",
  "Yearly",
  "On completion",
]

const VIEW_TRANSITION = {
  duration: 0.24,
  ease: [0.2, 0, 0, 1] as const,
}

function RoutineList({ selected }: { selected: boolean }) {
  return (
    <motion.section
      key="routine-list"
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -12 }}
      transition={VIEW_TRANSITION}
      className="absolute inset-0 flex flex-col bg-[var(--surface-floating,#fff)]"
    >
      <div className="flex h-10 shrink-0 items-center px-3">
        <span className="text-[13px] font-normal text-[var(--text-muted,#7a7a7a)]">
          Routines
        </span>
        <button
          type="button"
          aria-label="Add routine"
          className="ml-auto grid h-7 w-7 place-items-center rounded-[8px] text-[var(--icon-muted,#888)] outline-none hover:bg-[var(--row-hover)] focus-visible:ring-2 focus-visible:ring-[var(--ritual-focus-ring)]"
        >
          <Plus className="h-4 w-4" strokeWidth={1.7} />
        </button>
      </div>

      <MenuSeparator className="!m-0" />

      <MenuList className="min-h-0 flex-1 overflow-hidden p-1">
        {ROUTINES.map((routine, index) => {
          const active = selected && index === 1

          return (
            <MenuRow
              key={routine.title}
              data-selected={active ? "true" : undefined}
              className="h-[34px] min-h-[34px] gap-2 px-2 py-0 text-[13px]"
            >
              <Repeat2
                className="h-3.5 w-3.5 shrink-0 text-[var(--icon-muted,#888)]"
                strokeWidth={1.55}
              />
              <span
                className={
                  active
                    ? "min-w-0 flex-1 truncate font-medium text-[var(--text-primary,#111)]"
                    : "min-w-0 flex-1 truncate font-normal text-[var(--text-primary,#111)]"
                }
              >
                {routine.title}
              </span>
              <span className="max-w-[146px] shrink-0 truncate text-right font-normal text-[var(--text-muted,#7a7a7a)]">
                {routine.schedule}
              </span>
            </MenuRow>
          )
        })}
      </MenuList>

      <MenuSeparator className="!m-0" />

      <button
        type="button"
        className="flex h-[34px] shrink-0 items-center px-3 text-left text-[13px] font-normal text-[var(--text-muted,#7a7a7a)] outline-none hover:bg-[var(--row-hover)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ritual-focus-ring)]"
      >
        Add Routine
      </button>
    </motion.section>
  )
}

function getScheduleRows(
  trigger: TriggerType,
  phase: DemoPhase,
): ScheduleRow[] {
  if (trigger === "Daily") {
    return [
      { label: "Every", value: "1 day" },
      { label: "First run", value: "Select date" },
      { label: "Ends", value: "Select date" },
    ]
  }

  if (trigger === "Weekly") {
    return [
      { label: "Every", value: "1 week" },
      { label: "On", value: "Tuesday" },
      ...(phase === "weekly-expanded"
        ? [{ label: "And on", value: "Monday" }]
        : []),
      { label: "First run", value: "Select date" },
      { label: "Ends", value: "Select date" },
    ]
  }

  if (trigger === "Monthly") {
    return [
      { label: "Every", value: "1 month" },
      {
        label: "On the",
        value: phase === "monthly-refined" ? "First Sunday" : "26th day",
      },
      { label: "First run", value: "Select date" },
      { label: "Ends", value: "Select date" },
    ]
  }

  if (trigger === "Yearly") {
    return [
      {
        label: "Every",
        value: phase === "yearly-refined" ? "2 years" : "1 year",
      },
      {
        label: "On the",
        value:
          phase === "yearly-refined"
            ? "5th Monday in March"
            : "26th day in May",
      },
      { label: "First run", value: "Select date" },
      { label: "Ends", value: "Select date" },
    ]
  }

  return [
    {
      label: "Repeat",
      value:
        phase === "completion-refined"
          ? "2 days after completion"
          : "1 week after completion",
    },
  ]
}

function ScheduleRows({
  phase,
  trigger,
}: {
  phase: DemoPhase
  trigger: TriggerType
}) {
  const rows = getScheduleRows(trigger, phase)

  return (
    <AnimatePresence initial={false} mode="wait">
      <motion.div
        key={`${trigger}-${phase}`}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.16, ease: [0.2, 0, 0, 1] }}
      >
        {rows.map((row) => (
          <MenuRow
            key={row.label}
            className="h-[34px] min-h-[34px] justify-between px-3 py-0 text-[13px]"
          >
            <span className="text-[var(--text-primary,#111)]">
              {row.label}
            </span>
            <span className="max-w-[210px] truncate text-right text-[var(--text-muted,#7a7a7a)]">
              {row.value}
            </span>
          </MenuRow>
        ))}
      </motion.div>
    </AnimatePresence>
  )
}

function RoutineDetail({
  phase,
  trigger,
  paused,
  onPausedChange,
}: {
  phase: DemoPhase
  trigger: TriggerType
  paused: boolean
  onPausedChange: (checked: boolean) => void
}) {
  const showMenu =
    phase === "weekly-menu" ||
    phase === "monthly-menu" ||
    phase === "yearly-menu" ||
    phase === "completion-menu"
  const menuTarget: TriggerType =
    phase === "weekly-menu"
      ? "Weekly"
      : phase === "monthly-menu"
        ? "Monthly"
        : phase === "yearly-menu"
          ? "Yearly"
          : "On completion"

  return (
    <motion.section
      key="routine-detail"
      initial={{ opacity: 0, x: 18 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 18 }}
      transition={VIEW_TRANSITION}
      className="absolute inset-0 flex flex-col bg-[var(--surface-floating,#fff)]"
    >
      <div className="relative flex h-10 shrink-0 items-center justify-center px-3">
        <button
          type="button"
          aria-label="Back to routines"
          className="absolute left-2 grid h-7 w-7 place-items-center rounded-[8px] text-[var(--icon-muted,#888)] outline-none hover:bg-[var(--row-hover)] focus-visible:ring-2 focus-visible:ring-[var(--ritual-focus-ring)]"
        >
          <ChevronLeft className="h-4 w-4" strokeWidth={1.7} />
        </button>
        <span className="text-[13px] font-normal text-[var(--text-muted,#7a7a7a)]">
          Routine
        </span>
        <button
          type="button"
          aria-label="More routine options"
          className="absolute right-2 grid h-7 w-7 place-items-center rounded-[8px] text-[var(--icon-muted,#888)] outline-none hover:bg-[var(--row-hover)] focus-visible:ring-2 focus-visible:ring-[var(--ritual-focus-ring)]"
        >
          <Ellipsis className="h-4 w-4" strokeWidth={1.7} />
        </button>
      </div>

      <MenuSeparator className="!m-0" />

      <div className="flex h-11 shrink-0 items-center px-3 text-[16px] font-medium tracking-[-0.015em] text-[var(--text-primary,#111)]">
        <span className="truncate">Daily morning exercise</span>
        {phase === "daily" ? (
          <motion.span
            aria-hidden="true"
            className="ml-px h-4 w-px shrink-0 bg-[var(--text-primary,#111)]"
            animate={{ opacity: [1, 1, 0, 0] }}
            transition={{ duration: 0.9, repeat: Infinity }}
          />
        ) : null}
      </div>

      <MenuSeparator className="!m-0" />

      <MenuList className="min-h-0 flex-1 overflow-visible p-1">
        <MenuRow className="h-[34px] min-h-[34px] justify-between px-3 py-0 text-[13px]">
          <span className="text-[var(--text-primary,#111)]">Trigger</span>
          <Select
            value={trigger}
            open={showMenu}
            onOpenChange={() => undefined}
            onValueChange={() => undefined}
          >
            <SelectTrigger
              density="compact"
              aria-label="Routine trigger"
              className="h-7 w-[154px] rounded-[8px] border-[var(--border-subtle)] bg-[var(--surface-raised,#fff)] px-2 text-[13px] shadow-none focus:ring-2 focus:ring-[var(--ritual-focus-ring)] focus:ring-offset-0"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent
              align="end"
              className="rounded-[var(--radius-floating)] border-[var(--border-floating)] bg-[var(--surface-floating)] shadow-[var(--shadow-popover)]"
            >
              {TRIGGER_OPTIONS.map((option) => (
                <SelectItem
                  key={option}
                  value={option}
                  className={
                    showMenu && option === menuTarget
                      ? "bg-[var(--row-hover)]"
                      : undefined
                  }
                >
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </MenuRow>

        <MenuRow className="h-[34px] min-h-[34px] justify-between px-3 py-0 text-[13px]">
          <span className="text-[var(--text-primary,#111)]">Paused</span>
          <Switch
            checked={paused}
            onCheckedChange={onPausedChange}
            aria-label="Pause routine"
            className="data-[state=checked]:bg-[var(--ritual-interactive-primary,#27251e)] data-[state=unchecked]:bg-[#d4d4d8]"
          />
        </MenuRow>

        <MenuSeparator className="!m-0" />

        <ScheduleRows phase={phase} trigger={trigger} />
      </MenuList>
    </motion.section>
  )
}

function AnimatedRoutinesDemo() {
  const reduceMotion = useReducedMotion()
  const [phase, setPhase] = useState<DemoPhase>("list")
  const [paused, setPaused] = useState(false)

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
  const selected = visiblePhase === "selected"
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
      className="relative h-[352px] w-full max-w-[360px] overflow-hidden"
    >
      <AnimatePresence initial={false} mode="wait">
        {detailVisible ? (
          <RoutineDetail
            phase={visiblePhase}
            trigger={trigger}
            paused={paused}
            onPausedChange={setPaused}
          />
        ) : (
          <RoutineList selected={selected} />
        )}
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

      <div className="flex min-h-0 flex-1 items-center justify-center px-8 pb-2 pt-5">
        <AnimatedRoutinesDemo />
      </div>

      <OnboardingFooter
        left={
          <OnboardingNavButton variant="secondary" onClick={onBack}>
            Back
          </OnboardingNavButton>
        }
        center={
          <OnboardingStepper total={SETUP_STEPPER_COUNT} activeIndex={5} />
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
