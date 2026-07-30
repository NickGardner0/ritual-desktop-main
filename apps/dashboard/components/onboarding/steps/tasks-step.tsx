"use client"

import type { LucideIcon } from "lucide-react"
import {
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  HeartPulse,
  Images,
} from "lucide-react"

import { CompactFileScanner } from "@/components/onboarding/compact-file-scanner"
import {
  OnboardingFooter,
  OnboardingNavButton,
  OnboardingStepHeader,
  OnboardingStepper,
  SETUP_STEPPER_COUNT,
} from "@/components/onboarding/perplexity-onboarding-shell"

const IMPORT_SOURCES: {
  label: string
  detail: string
  icon: LucideIcon
}[] = [
  { label: "Apple Health", detail: "XML export", icon: HeartPulse },
  { label: "Spreadsheets", detail: "CSV or XLSX", icon: FileSpreadsheet },
  { label: "Screenshots", detail: "PNG or JPG", icon: Images },
  { label: "Notes & journals", detail: "TXT or Markdown", icon: FileText },
]

export function TasksStep({
  onBack,
  onNext,
}: {
  onBack: () => void
  onNext: () => void
}) {
  return (
    <div className="px-onboarding-step-enter flex h-full flex-col">
      <OnboardingStepHeader
        title="Import your data"
        subtitle="Bring existing health, habit, and activity history into Ritual in a few clicks."
      />

      <div className="flex min-h-0 flex-1 items-center px-8 pb-2 pt-5">
        <div className="w-full rounded-[16px] border border-[var(--px-onboarding-border)] bg-[var(--px-onboarding-recessed)] p-4">
          <CompactFileScanner />

          <div className="mt-3 grid grid-cols-2 gap-2.5">
            {IMPORT_SOURCES.map((source) => {
              const Icon = source.icon
              return (
                <div
                  key={source.label}
                  className="flex min-h-[58px] items-center gap-2.5 rounded-[10px] border border-[var(--px-onboarding-border)] bg-[var(--px-onboarding-chip)] px-3"
                >
                  <Icon className="h-4 w-4 shrink-0" strokeWidth={1.65} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-[var(--px-onboarding-ink)]">
                      {source.label}
                    </span>
                    <span className="block truncate text-[11px] text-[var(--px-onboarding-muted)]">
                      {source.detail}
                    </span>
                  </span>
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[var(--px-onboarding-muted)]" strokeWidth={1.7} />
                </div>
              )
            })}
          </div>
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
