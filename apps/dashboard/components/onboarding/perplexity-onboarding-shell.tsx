"use client"

import type { ButtonHTMLAttributes, ReactNode } from "react"

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

export const SETUP_STEPPER_COUNT = 7

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
          "relative flex h-[min(720px,calc(100vh-32px))] w-[min(480px,calc(100vw-32px))] flex-col overflow-hidden rounded-[28px] bg-[var(--px-onboarding-cream)] shadow-[0_24px_80px_rgba(0,0,0,0.28)]",
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
    <header className={cn("shrink-0 px-8 pt-9 text-center", className)}>
      <h1 className="px-onboarding-title text-[26px] leading-[1.2]">{title}</h1>
      {subtitle ? (
        <p className="mx-auto mt-2.5 max-w-[360px] text-[14px] leading-[1.45] text-[var(--px-onboarding-muted)]">
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
    <div className={cn("flex items-center justify-center gap-1.5", className)} aria-hidden="true">
      {Array.from({ length: total }, (_, index) => {
        const active = index === activeIndex
        return (
          <span
            key={index}
            className={cn(
              "rounded-full transition-all duration-200",
              active
                ? "h-[6px] w-[18px] bg-[var(--px-onboarding-ink)]"
                : "h-[6px] w-[6px] bg-[#d4d4d0]",
            )}
          />
        )
      })}
    </div>
  )
}

type NavButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary"
}

export function OnboardingNavButton({
  children,
  variant = "primary",
  className,
  ...props
}: NavButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-9 min-w-[72px] items-center justify-center rounded-[8px] px-3.5 text-[13px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bdbdb8] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--px-onboarding-cream)] disabled:opacity-50",
        variant === "primary"
          ? "bg-[var(--px-onboarding-ink)] text-white hover:bg-[#2a2a2a]"
          : "border border-[var(--px-onboarding-border)] bg-white text-[var(--px-onboarding-ink)] hover:bg-[#f4f3ee]",
        className,
      )}
      {...props}
    >
      {children}
    </button>
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
        "mt-auto flex shrink-0 items-center justify-between gap-3 px-6 pb-6 pt-4",
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
      className={cn(
        "flex h-11 w-full items-center gap-2.5 rounded-[10px] border px-3 text-left text-[13px] font-medium text-[var(--px-onboarding-ink)] transition-colors duration-100",
        selected
          ? "border-[#d8d7d1] bg-[var(--px-onboarding-chip-hover)]"
          : "border-[var(--px-onboarding-border)] bg-[var(--px-onboarding-chip)] hover:bg-[var(--px-onboarding-chip-hover)]",
        className,
      )}
    >
      {icon ? <span className="grid h-5 w-5 shrink-0 place-items-center text-[var(--px-onboarding-ink)]">{icon}</span> : null}
      <span className="truncate">{label}</span>
    </button>
  )
}
