"use client"

import { useState } from "react"
import type { LucideIcon } from "lucide-react"
import {
  BatteryCharging,
  BriefcaseBusiness,
  CalendarRange,
  Clock3,
  Focus,
  HeartPulse,
  Moon,
  Network,
  Pill,
  Repeat2,
  Smile,
  Sparkles,
  Target,
  WalletCards,
} from "lucide-react"

import {
  OnboardingChip,
  OnboardingFooter,
  OnboardingNavButton,
  OnboardingStepHeader,
  OnboardingStepper,
  SETUP_STEPPER_COUNT,
} from "@/components/onboarding/perplexity-onboarding-shell"

const INSIGHT_GOALS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: "sleep", label: "Sleep improvements", icon: Moon },
  { id: "focus", label: "Best focus times", icon: Focus },
  { id: "mood", label: "Mood influences", icon: Smile },
  { id: "goals", label: "Goal progress", icon: Target },
  { id: "habits", label: "Habits that stick", icon: Repeat2 },
  { id: "health", label: "Health changes", icon: HeartPulse },
  { id: "energy", label: "Activity and energy", icon: BatteryCharging },
  { id: "spending", label: "Spending patterns", icon: WalletCards },
  { id: "weekly", label: "Weekly patterns", icon: CalendarRange },
  { id: "correlations", label: "Hidden correlations", icon: Network },
  { id: "timeline", label: "Daily timeline", icon: Clock3 },
  { id: "work", label: "Work patterns", icon: BriefcaseBusiness },
  { id: "substances", label: "Substance use", icon: Pill },
  { id: "suggestions", label: "Personalized insights", icon: Sparkles },
]

export function TasksStep({
  onBack,
  onNext,
}: {
  onBack: () => void
  onNext: () => void
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(["weekly"]))

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="px-onboarding-step-enter flex h-full flex-col">
      <OnboardingStepHeader
        title="What would you like Ritual to help you understand?"
        subtitle="Choose a few to personalize your insights."
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-8 pt-6">
        <div className="grid grid-cols-2 gap-2.5">
          {INSIGHT_GOALS.map((item) => {
            const Icon = item.icon
            return (
              <OnboardingChip
                key={item.id}
                label={item.label}
                selected={selected.has(item.id)}
                onClick={() => toggle(item.id)}
                icon={<Icon className="h-[18px] w-[18px]" strokeWidth={1.65} />}
              />
            )
          })}
        </div>
      </div>

      <OnboardingFooter
        left={<OnboardingNavButton variant="secondary" onClick={onBack}>Back</OnboardingNavButton>}
        center={<OnboardingStepper total={SETUP_STEPPER_COUNT} activeIndex={3} />}
        right={<OnboardingNavButton onClick={onNext}>Next</OnboardingNavButton>}
      />
    </div>
  )
}
