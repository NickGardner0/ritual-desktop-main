"use client"

import { useState } from "react"
import type { LucideIcon } from "lucide-react"
import {
  CalendarClock,
  FileText,
  FolderKanban,
  Globe2,
  LineChart,
  Mail,
  Monitor,
  Newspaper,
  PieChart,
  Scale,
  Search,
  Smartphone,
  Table2,
  Workflow,
} from "lucide-react"

import {
  OnboardingChip,
  OnboardingFooter,
  OnboardingNavButton,
  OnboardingStepHeader,
  OnboardingStepper,
  SETUP_STEPPER_COUNT,
} from "@/components/onboarding/perplexity-onboarding-shell"

const TASKS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: "automate", label: "Automate a workflow", icon: Workflow },
  { id: "pre_reads", label: "Draft meeting pre-reads", icon: FileText },
  { id: "market", label: "Research a market", icon: Globe2 },
  { id: "deep_research", label: "Run deep research", icon: Search },
  { id: "schedule", label: "Schedule a recurring task", icon: CalendarClock },
  { id: "inbox", label: "Triage my email inbox", icon: Mail },
  { id: "app", label: "Build an app", icon: Smartphone },
  { id: "spreadsheet", label: "Create a spreadsheet", icon: Table2 },
  { id: "slides", label: "Create a slide deck", icon: Monitor },
  { id: "website", label: "Build a website", icon: FolderKanban },
  { id: "visualize", label: "Visualize my data", icon: PieChart },
  { id: "kpis", label: "Report daily KPIs", icon: LineChart },
  { id: "evaluate", label: "Evaluate a business idea", icon: Scale },
  { id: "digest", label: "Send a daily news digest", icon: Newspaper },
]

export function TasksStep({
  onBack,
  onNext,
}: {
  onBack: () => void
  onNext: () => void
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(["spreadsheet"]))

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
        title="What would you like Computer to work on?"
        subtitle="Choose a few to get started."
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-6">
        <div className="grid grid-cols-2 gap-2.5">
          {TASKS.map((item) => {
            const Icon = item.icon
            return (
              <OnboardingChip
                key={item.id}
                label={item.label}
                selected={selected.has(item.id)}
                onClick={() => toggle(item.id)}
                icon={<Icon className="h-4 w-4" strokeWidth={1.75} />}
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
