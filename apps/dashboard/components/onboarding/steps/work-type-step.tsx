"use client"

import { useState } from "react"
import type { LucideIcon } from "lucide-react"
import {
  Briefcase,
  BriefcaseBusiness,
  BookOpen,
  Code2,
  GraduationCap,
  HeartPulse,
  LineChart,
  Package,
  Scale,
  Settings2,
  ShoppingBag,
  Users,
  Wrench,
} from "lucide-react"

import {
  OnboardingChip,
  OnboardingFooter,
  OnboardingNavButton,
  OnboardingStepHeader,
  OnboardingStepper,
  SETUP_STEPPER_COUNT,
} from "@/components/onboarding/perplexity-onboarding-shell"

const WORK_TYPES: { id: string; label: string; icon: LucideIcon }[] = [
  { id: "business_owner", label: "Business Owner", icon: Briefcase },
  { id: "software_engineering", label: "Software Engineering", icon: Code2 },
  { id: "finance", label: "Finance", icon: LineChart },
  { id: "product", label: "Product", icon: Package },
  { id: "marketing", label: "Marketing", icon: ShoppingBag },
  { id: "consulting", label: "Consulting", icon: Users },
  { id: "operations", label: "Operations", icon: Settings2 },
  { id: "sales", label: "Sales", icon: BriefcaseBusiness },
  { id: "engineering", label: "Engineering", icon: Wrench },
  { id: "healthcare", label: "Healthcare", icon: HeartPulse },
  { id: "legal", label: "Legal", icon: Scale },
  { id: "student", label: "Student", icon: GraduationCap },
  { id: "educator", label: "Educator", icon: BookOpen },
]

export function WorkTypeStep({
  onBack,
  onNext,
}: {
  onBack: () => void
  onNext: () => void
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const [other, setOther] = useState("")

  return (
    <div className="px-onboarding-step-enter flex h-full flex-col">
      <OnboardingStepHeader
        title="What type of work do you do?"
        subtitle="This helps Computer suggest useful tasks to take off your plate."
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-6">
        <div className="grid grid-cols-2 gap-2.5">
          {WORK_TYPES.map((item) => {
            const Icon = item.icon
            return (
              <OnboardingChip
                key={item.id}
                label={item.label}
                selected={selected === item.id}
                onClick={() => setSelected(item.id)}
                icon={<Icon className="h-4 w-4" strokeWidth={1.75} />}
              />
            )
          })}
          <label className="flex h-11 w-full items-center gap-2.5 rounded-[10px] border border-[var(--px-onboarding-border)] bg-white px-3">
            <input
              value={other}
              onChange={(event) => {
                setOther(event.target.value)
                setSelected("other")
              }}
              placeholder="Other..."
              className="w-full bg-transparent text-[13px] font-medium text-[var(--px-onboarding-ink)] outline-none placeholder:text-[#b0b0ab]"
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
