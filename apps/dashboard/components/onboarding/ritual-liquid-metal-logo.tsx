"use client"

import { useEffect, useState } from "react"
import { LiquidMetal } from "@paper-design/shaders-react"

import { cn } from "@/lib/utils"

const RITUAL_MASK_URL = "/onboarding/ritual-liquid-metal-mask.svg"

export function RitualLiquidMetalLogo({ className }: { className?: string }) {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)")
    const syncPreference = () => setPrefersReducedMotion(mediaQuery.matches)

    syncPreference()
    mediaQuery.addEventListener("change", syncPreference)

    return () => mediaQuery.removeEventListener("change", syncPreference)
  }, [])

  return (
    <LiquidMetal
      aria-hidden="true"
      speed={prefersReducedMotion ? 0 : 0.38}
      softness={0.12}
      repetition={1.6}
      shiftRed={0.14}
      shiftBlue={0.14}
      distortion={0.08}
      contour={0.44}
      scale={0.6}
      rotation={0}
      shape="diamond"
      angle={70}
      image={RITUAL_MASK_URL}
      colorBack="#00000000"
      colorTint="#F2F5FF"
      maxPixelCount={224_000}
      className={cn("h-[200px] w-[280px]", className)}
      style={{
        filter: "contrast(124%) brightness(97%) saturate(100%)",
        mixBlendMode: "multiply",
      }}
    />
  )
}
