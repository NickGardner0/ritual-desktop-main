"use client"

import { useCallback, useEffect, useState } from "react"

import {
  PerplexityOnboardingShell,
  SETUP_SUBSTEPS,
  type SetupSubstep,
} from "@/components/onboarding/perplexity-onboarding-shell"
import { AppsStep } from "@/components/onboarding/steps/apps-step"
import { IntroStep } from "@/components/onboarding/steps/intro-step"
import { NotificationsStep } from "@/components/onboarding/steps/notifications-step"
import { PermissionsStep } from "@/components/onboarding/steps/permissions-step"
import { ProductDemoStep } from "@/components/onboarding/steps/product-demo-step"
import { ScheduleStep } from "@/components/onboarding/steps/schedule-step"
import { TasksStep } from "@/components/onboarding/steps/tasks-step"
import { WorkTypeStep } from "@/components/onboarding/steps/work-type-step"

const SETUP_SUBSTEP_KEY = "ritual:onboarding-setup-substep"

function readPersistedSubstep(): SetupSubstep {
  if (typeof window === "undefined") return "intro"
  const raw = window.localStorage.getItem(SETUP_SUBSTEP_KEY)
  if (raw && (SETUP_SUBSTEPS as readonly string[]).includes(raw)) {
    return raw as SetupSubstep
  }
  return "intro"
}

function persistSubstep(substep: SetupSubstep) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(SETUP_SUBSTEP_KEY, substep)
}

export function clearSetupSubstep() {
  if (typeof window === "undefined") return
  window.localStorage.removeItem(SETUP_SUBSTEP_KEY)
}

export function SetupWizard({
  busy,
  userId,
  onFinish,
}: {
  busy?: boolean
  userId?: string | null
  onFinish: () => void
}) {
  const [substep, setSubstep] = useState<SetupSubstep>("intro")
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    const restored = readPersistedSubstep()
    queueMicrotask(() => {
      setSubstep(restored)
      setHydrated(true)
    })
  }, [])

  const goTo = useCallback((next: SetupSubstep) => {
    persistSubstep(next)
    setSubstep(next)
  }, [])

  const goNext = useCallback(() => {
    const index = SETUP_SUBSTEPS.indexOf(substep)
    const next = SETUP_SUBSTEPS[Math.min(index + 1, SETUP_SUBSTEPS.length - 1)]
    goTo(next)
  }, [goTo, substep])

  const goBack = useCallback(() => {
    const index = SETUP_SUBSTEPS.indexOf(substep)
    const prev = SETUP_SUBSTEPS[Math.max(index - 1, 0)]
    goTo(prev)
  }, [goTo, substep])

  const skipToPermissions = useCallback(() => {
    goTo("permissions")
  }, [goTo])

  if (!hydrated) {
    return (
      <PerplexityOnboardingShell>
        <div className="flex h-full items-center justify-center text-[13px] text-[var(--px-onboarding-muted)]">
          Loading…
        </div>
      </PerplexityOnboardingShell>
    )
  }

  return (
    <PerplexityOnboardingShell>
      {substep === "intro" ? (
        <IntroStep onSkip={skipToPermissions} onContinue={goNext} />
      ) : null}
      {substep === "work_type" ? (
        <WorkTypeStep onBack={goBack} onNext={goNext} />
      ) : null}
      {substep === "product_demo" ? (
        <ProductDemoStep onBack={goBack} onNext={goNext} />
      ) : null}
      {substep === "tasks" ? (
        <TasksStep onBack={goBack} onNext={goNext} />
      ) : null}
      {substep === "schedule" ? (
        <ScheduleStep onBack={goBack} onNext={goNext} />
      ) : null}
      {substep === "apps" ? (
        <AppsStep onBack={goBack} onNext={goNext} />
      ) : null}
      {substep === "notifications" ? (
        <NotificationsStep onBack={goBack} onNext={goNext} />
      ) : null}
      {substep === "permissions" ? (
        <PermissionsStep
          busy={busy}
          userId={userId}
          onBack={goBack}
          onFinish={onFinish}
        />
      ) : null}
    </PerplexityOnboardingShell>
  )
}
