"use client"

import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

export const ONBOARDING_TEXTURE_BACKGROUND = `
  linear-gradient(#fafaf9, #fafaf9)
`

type OnboardingWindowProps = {
  banner: ReactNode
  title: string
  body: ReactNode
  footer: ReactNode
  bannerSize?: "standard" | "welcome"
  afterBody?: ReactNode
  className?: string
}

export function OnboardingWindow({
  banner,
  title,
  body,
  footer,
  bannerSize = "standard",
  afterBody,
  className,
}: OnboardingWindowProps) {
  const isWelcome = bannerSize === "welcome"

  return (
    <section
      className={cn(
        "flex w-full flex-col overflow-hidden rounded-xl bg-white text-[#14171d] shadow-[0_18px_54px_rgba(18,20,28,0.16)]",
        className,
      )}
      style={{ fontFamily: "var(--ritual-selected-font-family)" }}
    >
      <div
        className={cn(
          "relative flex shrink-0 justify-center overflow-hidden",
          isWelcome ? "h-[360px]" : "h-[276px]",
        )}
        style={{ backgroundImage: ONBOARDING_TEXTURE_BACKGROUND }}
      >
        {banner}
      </div>
      <div className={cn("flex flex-1 flex-col bg-white", isWelcome ? "px-7 pb-6 pt-[32px]" : "px-6 pb-5 pt-5")}>
        <h1 className={cn("font-medium leading-[1.14] tracking-[-0.01em] text-[#14171d]", isWelcome ? "text-[28px]" : "text-[23px]")}>
          {title}
        </h1>
        <div className={cn("text-[#737373]", isWelcome ? "mt-3 max-w-[610px] text-[13.5px] leading-[1.45]" : "mt-2.5 max-w-[570px] text-[15px] leading-[1.42]")}>
          {body}
        </div>
        {afterBody}
        <div className={cn(isWelcome ? "mt-auto pt-5" : "mt-auto pt-4")}>{footer}</div>
      </div>
    </section>
  )
}
