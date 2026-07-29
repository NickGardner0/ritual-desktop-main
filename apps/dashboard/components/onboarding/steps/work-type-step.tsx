"use client"

import { useState } from "react"
import type { LucideIcon } from "lucide-react"
import {
  BriefcaseBusiness,
  Brain,
  BookOpen,
  Code2,
  Dumbbell,
  HeartPulse,
  LineChart,
  ListChecks,
  Moon,
  PackagePlus,
  Pill,
  Rocket,
  Salad,
  Sparkles,
  Target,
} from "lucide-react"

import {
  OnboardingChip,
  OnboardingFooter,
  OnboardingNavButton,
  OnboardingStepHeader,
  OnboardingStepper,
  SETUP_STEPPER_COUNT,
} from "@/components/onboarding/perplexity-onboarding-shell"

const TRACKING_INTERESTS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: "health", label: "Health", icon: HeartPulse },
  { id: "learning", label: "Learning", icon: BookOpen },
  { id: "productivity", label: "Productivity", icon: Sparkles },
  { id: "work", label: "Work", icon: BriefcaseBusiness },
  { id: "sleep", label: "Sleep", icon: Moon },
  { id: "side_projects", label: "Side Projects", icon: Rocket },
  { id: "coding", label: "Coding", icon: Code2 },
  { id: "finance", label: "Finance", icon: LineChart },
  { id: "drugs", label: "Drugs", icon: Pill },
  { id: "goals", label: "Goals", icon: Target },
  { id: "fitness", label: "Fitness", icon: Dumbbell },
  { id: "nutrition", label: "Nutrition", icon: Salad },
  { id: "mood", label: "Mood", icon: Brain },
  { id: "supplements", label: "Supplements", icon: PackagePlus },
  { id: "habits", label: "Habits", icon: ListChecks },
]

export function WorkTypeStep({
  onBack,
  onNext,
}: {
  onBack: () => void
  onNext: () => void
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [other, setOther] = useState("")

  function toggleSelection(id: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  return (
    <div className="px-onboarding-step-enter flex h-full flex-col">
      <OnboardingStepHeader
        title="What would you like to track"
        subtitle="This helps Ritual make recommendations and suggestions"
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-8 pt-6">
        <div className="grid grid-cols-2 gap-2.5">
          {TRACKING_INTERESTS.map((item) => {
            const Icon = item.icon
            return (
              <OnboardingChip
                key={item.id}
                label={item.label}
                selected={selected.has(item.id)}
                onClick={() => toggleSelection(item.id)}
                icon={<Icon className="h-[18px] w-[18px]" strokeWidth={1.65} />}
              />
            )
          })}
          <label className="flex h-[42px] w-full items-center gap-3 rounded-md border border-[var(--px-onboarding-border)] bg-[var(--px-onboarding-chip)] px-3 transition-colors hover:bg-[var(--px-onboarding-chip-hover)] focus-within:ring-2 focus-within:ring-[hsl(var(--ring))] focus-within:ring-offset-1">
            <input
              value={other}
              onChange={(event) => {
                const value = event.target.value
                setOther(value)
                setSelected((current) => {
                  const next = new Set(current)
                  if (value.trim()) {
                    next.add("other")
                  } else {
                    next.delete("other")
                  }
                  return next
                })
              }}
              placeholder="Other..."
              className="w-full bg-transparent text-[15px] font-normal text-[var(--px-onboarding-ink)] outline-none placeholder:text-[#a9a6a0]"
            />
          </label>
        </div>
      </div>

      <OnboardingFooter
        left={<OnboardingNavButton variant="secondary" onClick={onBack}>Back</OnboardingNavButton>}
        center={<OnboardingStepper total={SETUP_STEPPER_COUNT} activeIndex={1} />}
        right={<OnboardingNavButton onClick={onNext}>Next</OnboardingNavButton>}
      />
    </div>
  )
}
