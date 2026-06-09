"use client"

import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

export const ONBOARDING_TEXTURE_BACKGROUND = `
  radial-gradient(58% 52% at 20% 24%, rgba(255,255,255,0.82) 0%, rgba(255,255,255,0) 62%),
  radial-gradient(50% 46% at 73% 32%, rgba(255,255,255,0.64) 0%, rgba(255,255,255,0) 60%),
  radial-gradient(62% 56% at 50% 86%, rgba(255,255,255,0.54) 0%, rgba(255,255,255,0) 64%),
  radial-gradient(46% 50% at 90% 70%, rgba(92,95,103,0.50) 0%, rgba(92,95,103,0) 62%),
  radial-gradient(46% 46% at 9% 76%,  rgba(92,95,103,0.44) 0%, rgba(92,95,103,0) 62%),
  radial-gradient(42% 42% at 37% 56%, rgba(255,255,255,0.44) 0%, rgba(255,255,255,0) 58%),
  linear-gradient(140deg, #b4b6bc 0%, #a2a4ab 100%)
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
  return (
    <section
      className={cn(
        "flex w-full flex-col overflow-hidden rounded-xl border border-[rgba(18,20,28,0.05)] bg-white text-[#14171d] shadow-[0_22px_70px_rgba(18,20,28,0.18)]",
        className,
      )}
      style={{ fontFamily: "var(--ritual-selected-font-family)" }}
    >
      <div
        className={cn(
          "relative flex shrink-0 justify-center overflow-hidden",
          bannerSize === "welcome" ? "h-[360px]" : "h-[262px]",
        )}
        style={{ backgroundImage: ONBOARDING_TEXTURE_BACKGROUND }}
      >
        {banner}
      </div>
      <div className={cn("flex flex-1 flex-col bg-white px-[34px] pb-[30px]", bannerSize === "welcome" ? "pt-[32px]" : "pt-[31px]")}>
        <h1 className="text-[28px] font-medium leading-[1.2] tracking-[-0.01em] text-[#14171d]">
          {title}
        </h1>
        <div className="mt-[18px] max-w-[706px] text-[15px] leading-[1.5] text-[#6b7280]">
          {body}
        </div>
        {afterBody}
        <div className="mt-auto pt-[28px]">{footer}</div>
      </div>
    </section>
  )
}

export function FrostedPreviewPanel({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "absolute left-1/2 top-[36px] h-[255px] w-[550px] -translate-x-1/2 rounded-[14px] border border-[rgba(18,20,28,0.06)] bg-[rgba(255,255,255,0.55)] px-[52px] py-[42px] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_18px_40px_rgba(20,24,40,0.16)] backdrop-blur-[14px]",
        className,
      )}
    >
      {children}
    </div>
  )
}
