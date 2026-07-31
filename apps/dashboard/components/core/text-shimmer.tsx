"use client"

/**
 * Midday-style gradient text shimmer (background-clip sweep).
 * Prefer `@/components/ui/shimmering-text` for the per-character Animate UI effect.
 */
import { memo, useMemo, type CSSProperties, type ElementType, type JSX } from "react"
import { motion } from "framer-motion"

import { cn } from "@/lib/utils"

export type TextShimmerProps = {
  children: string
  as?: ElementType
  className?: string
  duration?: number
  spread?: number
}

export const TextShimmer = memo(function TextShimmer({
  children,
  as: Component = "span",
  className,
  duration = 2,
  spread = 2,
}: TextShimmerProps) {
  const MotionComponent = motion.create(Component as keyof JSX.IntrinsicElements)
  const dynamicSpread = useMemo(() => children.length * spread, [children, spread])

  return (
    <MotionComponent
      className={cn(
        "relative inline-block bg-[length:250%_100%,auto] bg-clip-text",
        "text-transparent [-webkit-background-clip:text] [-webkit-text-fill-color:transparent]",
        "[--base-color:#a1a1aa] [--base-gradient-color:#000]",
        "[background-repeat:no-repeat,padding-box] [--bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),var(--base-gradient-color),#0000_calc(50%+var(--spread)))]",
        "dark:[--base-color:#71717a] dark:[--base-gradient-color:#ffffff] dark:[--bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),var(--base-gradient-color),#0000_calc(50%+var(--spread)))]",
        className,
      )}
      initial={{ backgroundPosition: "100% center" }}
      animate={{ backgroundPosition: "0% center" }}
      transition={{
        repeat: Number.POSITIVE_INFINITY,
        duration,
        ease: "linear",
      }}
      style={
        {
          "--spread": `${dynamicSpread}px`,
          backgroundImage: "var(--bg), linear-gradient(var(--base-color), var(--base-color))",
        } as CSSProperties
      }
    >
      {children}
    </MotionComponent>
  )
})
