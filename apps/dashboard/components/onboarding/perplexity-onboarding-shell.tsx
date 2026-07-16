"use client"

import type { ReactNode } from "react"
import { Button, type ButtonProps } from "@ritual/ui/button"

import { cn } from "@/lib/utils"

export const SETUP_SUBSTEPS = [
  "intro",
  "work_type",
  "product_demo",
  "tasks",
  "schedule",
  "apps",
  "notifications",
  "permissions",
] as const

export type SetupSubstep = (typeof SETUP_SUBSTEPS)[number]

export const SETUP_STEPPER_COUNT = 8

type PerplexityOnboardingShellProps = {
  children: ReactNode
  className?: string
  contentClassName?: string
}

export function PerplexityOnboardingShell({
  children,
  className,
  contentClassName,
}: PerplexityOnboardingShellProps) {
  return (
    <div
      className={cn(
        "px-onboarding flex h-screen w-screen items-center justify-center overflow-hidden bg-[var(--px-onboarding-stage)]",
        className,
      )}
    >
      <div data-tauri-drag-region className="fixed left-0 right-0 top-0 z-50 h-8" />
      <div
        className={cn(
          "relative flex h-[min(680px,calc(100vh-48px))] w-[min(516px,calc(100vw-48px))] flex-col overflow-hidden rounded-[12px] border border-black/[0.06] bg-[var(--px-onboarding-cream)] shadow-[0_12px_28px_rgba(17,17,17,0.10)]",
          contentClassName,
        )}
      >
        {children}
      </div>
    </div>
  )
}

export function OnboardingStepHeader({
  title,
  subtitle,
  className,
}: {
  title: string
  subtitle?: string
  className?: string
}) {
  return (
    <header className={cn("shrink-0 px-8 pt-12 text-center", className)}>
      <h1 className="px-onboarding-title text-[23px] leading-[1.2]">{title}</h1>
      {subtitle ? (
        <p className="mx-auto mt-3 max-w-[430px] text-[14px] font-normal leading-[1.45] text-[var(--px-onboarding-muted)]">
          {subtitle}
        </p>
      ) : null}
    </header>
  )
}

export function OnboardingStepper({
  total,
  activeIndex,
  className,
}: {
  total: number
  activeIndex: number
  className?: string
}) {
  return (
    <div className={cn("flex items-center justify-center gap-2", className)} aria-hidden="true">
      {Array.from({ length: total }, (_, index) => {
        const active = index === activeIndex
        return (
          <span
            key={index}
            className={cn(
              "rounded-full transition-all duration-200",
              active
                ? "h-[8px] w-[16px] bg-[var(--px-onboarding-ink)]"
                : "h-[8px] w-[8px] bg-[#cbc9c5]",
            )}
          />
        )
      })}
    </div>
  )
}

type NavButtonProps = Omit<ButtonProps, "size" | "variant"> & {
  variant?: "primary" | "secondary"
}

export function OnboardingNavButton({
  children,
  variant = "primary",
  className,
  ...props
}: NavButtonProps) {
  return (
    <Button
      type="button"
      size="sm"
      variant={variant === "primary" ? "brand" : "outline"}
      className={cn(
        "h-8 min-w-[58px] rounded-md px-3 text-[15px] font-normal shadow-none transition-colors duration-150 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-[var(--px-onboarding-cream)]",
        variant === "primary"
          ? "border-[var(--px-onboarding-ink)] bg-[var(--px-onboarding-ink)] text-white hover:bg-[var(--brand-action-hover)]"
          : "border-[var(--px-onboarding-border)] bg-white text-[var(--px-onboarding-ink)] hover:bg-[var(--surface-panel)]",
        className,
      )}
      {...props}
    >
      {children}
    </Button>
  )
}

export function OnboardingFooter({
  left,
  center,
  right,
  className,
}: {
  left?: ReactNode
  center?: ReactNode
  right?: ReactNode
  className?: string
}) {
  return (
    <footer
      className={cn(
        "mt-auto flex shrink-0 items-center justify-between gap-3 px-8 pb-8 pt-4",
        className,
      )}
    >
      <div className="flex min-w-0 shrink-0 items-center justify-start">{left}</div>
      <div className="flex min-w-0 flex-1 items-center justify-center px-2">{center}</div>
      <div className="flex min-w-0 shrink-0 items-center justify-end gap-2">{right}</div>
    </footer>
  )
}

export function OnboardingChip({
  icon,
  label,
  selected,
  onClick,
  className,
}: {
  icon?: ReactNode
  label: string
  selected?: boolean
  onClick?: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "flex h-[42px] w-full items-center gap-3 rounded-md border px-3 text-left text-[15px] font-normal text-[var(--px-onboarding-ink)] transition-colors duration-100 hover:bg-[var(--px-onboarding-chip-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-1",
        selected
          ? "border-[hsl(var(--border))] bg-[var(--px-onboarding-chip-hover)]"
          : "border-[var(--px-onboarding-border)] bg-[var(--px-onboarding-chip)]",
        className,
      )}
    >
      {icon ? <span className="grid h-5 w-5 shrink-0 place-items-center text-[var(--px-onboarding-ink)]">{icon}</span> : null}
      <span className="truncate">{label}</span>
    </button>
  )
}
