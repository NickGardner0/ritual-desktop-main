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
          bannerSize === "welcome" ? "h-[360px]" : "h-[200px]",
        )}
        style={{ backgroundImage: ONBOARDING_TEXTURE_BACKGROUND }}
      >
        {banner}
      </div>
      <div className={cn("flex flex-1 flex-col bg-white px-7 pb-6", bannerSize === "welcome" ? "pt-[32px]" : "pt-6")}>
        <h1 className={cn("font-medium leading-[1.18] tracking-[-0.01em] text-[#14171d]", bannerSize === "welcome" ? "text-[28px]" : "text-[23px]")}>
          {title}
        </h1>
        <div className="mt-3 max-w-[610px] text-[13.5px] leading-[1.45] text-[#737373]">
          {body}
        </div>
        {afterBody}
        <div className="mt-auto pt-5">{footer}</div>
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
        "absolute left-1/2 top-5 h-[178px] w-[430px] -translate-x-1/2 rounded-[12px] border border-[#e8e8e6] bg-white px-8 py-7 shadow-[0_14px_36px_rgba(20,24,40,0.10)]",
        className,
      )}
    >
      {children}
    </div>
  )
}
