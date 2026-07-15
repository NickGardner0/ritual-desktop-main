"use client"

import { useMemo, useState } from "react"
import { Search } from "lucide-react"

import {
  OnboardingFooter,
  OnboardingNavButton,
  OnboardingStepHeader,
  OnboardingStepper,
  SETUP_STEPPER_COUNT,
} from "@/components/onboarding/perplexity-onboarding-shell"
import { cn } from "@/lib/utils"

const APPS: { id: string; label: string; color: string; initial: string }[] = [
  { id: "gmail", label: "Gmail", color: "#EA4335", initial: "G" },
  { id: "outlook", label: "Outlook", color: "#0078D4", initial: "O" },
  { id: "slack", label: "Slack", color: "#4A154B", initial: "S" },
  { id: "notion", label: "Notion", color: "#111111", initial: "N" },
  { id: "hubspot", label: "HubSpot", color: "#FF7A59", initial: "H" },
  { id: "stripe", label: "Stripe", color: "#635BFF", initial: "S" },
  { id: "vercel", label: "Vercel", color: "#000000", initial: "V" },
  { id: "linear", label: "Linear", color: "#5E6AD2", initial: "L" },
  { id: "github", label: "GitHub", color: "#24292F", initial: "G" },
  { id: "figma", label: "Figma", color: "#F24E1E", initial: "F" },
  { id: "calendar", label: "Google Calendar", color: "#4285F4", initial: "C" },
  { id: "sheets", label: "Google Sheets", color: "#0F9D58", initial: "S" },
  { id: "asana", label: "Asana", color: "#F06A6A", initial: "A" },
  { id: "jira", label: "Jira", color: "#0052CC", initial: "J" },
  { id: "salesforce", label: "Salesforce", color: "#00A1E0", initial: "S" },
  { id: "zoom", label: "Zoom", color: "#2D8CFF", initial: "Z" },
]

export function AppsStep({
  onBack,
  onNext,
}: {
  onBack: () => void
  onNext: () => void
}) {
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<Set<string>>(new Set(["gmail", "slack"]))

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return APPS
    return APPS.filter((app) => app.label.toLowerCase().includes(normalized))
  }, [query])

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
        title="What apps do you work in?"
        subtitle="Connecting your apps helps Computer do more for you."
      />

      <div className="min-h-0 flex-1 px-8 pt-5">
        <label className="flex h-10 items-center gap-2.5 rounded-[8px] border border-[var(--px-onboarding-border)] bg-[var(--px-onboarding-cream)] px-3.5">
          <Search className="h-[18px] w-[18px] shrink-0 text-[#85827d]" strokeWidth={1.7} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search 400+ apps"
            className="w-full bg-transparent text-[15px] text-[var(--px-onboarding-ink)] outline-none placeholder:text-[#a4a19b]"
          />
        </label>

        <div className="mt-4 max-h-[410px] overflow-y-auto pb-1">
          <div className="grid grid-cols-2 gap-2.5">
            {filtered.map((app) => {
              const isSelected = selected.has(app.id)
              return (
                <button
                  key={app.id}
                  type="button"
                  onClick={() => toggle(app.id)}
                  className={cn(
                    "flex h-[42px] items-center gap-3 rounded-[8px] border px-3 text-left text-[15px] font-normal transition-colors duration-100",
                    isSelected
                      ? "border-[#d7d3cc] bg-[var(--px-onboarding-chip-hover)]"
                      : "border-[var(--px-onboarding-border)] bg-[var(--px-onboarding-chip)] hover:bg-[var(--px-onboarding-chip-hover)]",
                  )}
                >
                  <span
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-[6px] text-[11px] font-semibold text-white"
                    style={{ backgroundColor: app.color }}
                  >
                    {app.initial}
                  </span>
                  <span className="truncate">{app.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <OnboardingFooter
        left={<OnboardingNavButton variant="secondary" onClick={onBack}>Back</OnboardingNavButton>}
        center={<OnboardingStepper total={SETUP_STEPPER_COUNT} activeIndex={5} />}
        right={<OnboardingNavButton onClick={onNext}>Next</OnboardingNavButton>}
      />
    </div>
  )
}
