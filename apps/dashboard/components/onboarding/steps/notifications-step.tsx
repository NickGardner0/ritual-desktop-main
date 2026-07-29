"use client"

import { Brain, Focus, Moon, Smartphone, TrendingDown, TrendingUp } from "lucide-react"

import {
  OnboardingFooter,
  OnboardingNavButton,
  OnboardingStepHeader,
  OnboardingStepper,
  SETUP_STEPPER_COUNT,
} from "@/components/onboarding/perplexity-onboarding-shell"

const FOCUS_BARS = [36, 52, 44, 66, 58, 82, 74]

export function NotificationsStep({
  onBack,
  onNext,
}: {
  onBack: () => void
  onNext: () => void
}) {
  return (
    <div className="px-onboarding-step-enter flex h-full flex-col">
      <OnboardingStepHeader
        title="Analytics"
        subtitle="See trends, correlations, and patterns across every part of your life."
      />

      <div className="flex min-h-0 flex-1 items-center px-8 pb-2 pt-5">
        <div className="w-full rounded-[16px] border border-[var(--px-onboarding-border)] bg-[var(--px-onboarding-recessed)] p-4">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-[10px] border border-[var(--px-onboarding-border)] bg-[var(--px-onboarding-chip)] p-2.5">
              <Moon className="h-3.5 w-3.5 text-[var(--px-onboarding-muted)]" strokeWidth={1.7} />
              <p className="mt-2 text-[16px] text-[var(--px-onboarding-ink)]">7h 42m</p>
              <p className="mt-0.5 flex items-center gap-1 text-[10px] text-[var(--px-onboarding-muted)]">
                <TrendingUp className="h-3 w-3" strokeWidth={1.7} />
                Sleep +34m
              </p>
            </div>
            <div className="rounded-[10px] border border-[var(--px-onboarding-border)] bg-[var(--px-onboarding-chip)] p-2.5">
              <Focus className="h-3.5 w-3.5 text-[var(--px-onboarding-muted)]" strokeWidth={1.7} />
              <p className="mt-2 text-[16px] text-[var(--px-onboarding-ink)]">4h 18m</p>
              <p className="mt-0.5 flex items-center gap-1 text-[10px] text-[var(--px-onboarding-muted)]">
                <TrendingUp className="h-3 w-3" strokeWidth={1.7} />
                Focus +12%
              </p>
            </div>
            <div className="rounded-[10px] border border-[var(--px-onboarding-border)] bg-[var(--px-onboarding-chip)] p-2.5">
              <Smartphone className="h-3.5 w-3.5 text-[var(--px-onboarding-muted)]" strokeWidth={1.7} />
              <p className="mt-2 text-[16px] text-[var(--px-onboarding-ink)]">3h 06m</p>
              <p className="mt-0.5 flex items-center gap-1 text-[10px] text-[var(--px-onboarding-muted)]">
                <TrendingDown className="h-3 w-3" strokeWidth={1.7} />
                Screen time -18%
              </p>
            </div>
          </div>

          <div className="mt-2.5 rounded-[10px] border border-[var(--px-onboarding-border)] bg-[var(--px-onboarding-chip)] p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[13px] text-[var(--px-onboarding-ink)]">Focus trend</p>
                <p className="mt-0.5 text-[10px] text-[var(--px-onboarding-muted)]">
                  Last 7 days
                </p>
              </div>
              <span className="text-[11px] text-[var(--px-onboarding-muted)]">+12%</span>
            </div>
            <div className="mt-3 flex h-[76px] items-end gap-2">
              {FOCUS_BARS.map((height, index) => (
                <div key={index} className="flex h-full flex-1 items-end">
                  <div
                    className="w-full rounded-t-[3px] bg-[var(--px-onboarding-ink)]"
                    style={{ height: `${height}%`, opacity: 0.42 + index * 0.08 }}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="mt-2.5 flex items-start gap-2.5 rounded-[10px] border border-[var(--px-onboarding-border)] bg-[var(--px-onboarding-chip)] p-3">
            <Brain className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.7} />
            <div>
              <p className="text-[12px] font-medium text-[var(--px-onboarding-ink)]">
                Pattern found
              </p>
              <p className="mt-0.5 text-[11px] leading-[1.4] text-[var(--px-onboarding-muted)]">
                Earlier sleep was linked to 21% more focus the next day.
              </p>
            </div>
          </div>
        </div>
      </div>

      <OnboardingFooter
        left={<OnboardingNavButton variant="secondary" onClick={onBack}>Back</OnboardingNavButton>}
        center={<OnboardingStepper total={SETUP_STEPPER_COUNT} activeIndex={6} />}
        right={<OnboardingNavButton onClick={onNext}>Next</OnboardingNavButton>}
      />
    </div>
  )
}
