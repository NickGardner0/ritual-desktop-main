"use client"

import React, { useMemo, useRef, type CSSProperties } from "react"
import {
  motion,
  useInView,
  useReducedMotion,
  type UseInViewOptions,
} from "framer-motion"

import { cn } from "@/lib/utils"

export type ShimmeringTextProps = {
  /** Text to display with shimmer effect */
  text: string
  /** Animation duration in seconds */
  duration?: number
  /** Delay before starting animation */
  delay?: number
  /** Whether to repeat the animation */
  repeat?: boolean
  /** Pause duration between repeats in seconds */
  repeatDelay?: number
  /** Custom className */
  className?: string
  /** Whether to start animation when component enters viewport */
  startOnView?: boolean
  /** Whether to animate only once */
  once?: boolean
  /** Margin for in-view detection (rootMargin) */
  inViewMargin?: UseInViewOptions["margin"]
  /** Shimmer spread multiplier */
  spread?: number
  /** Base text color */
  color?: string
  /** Shimmer gradient color */
  shimmerColor?: string
}

/**
 * ElevenLabs UI Shimmering Text — gradient background-clip shimmer via Motion.
 * @see https://ui.elevenlabs.io/docs/components/shimmering-text
 */
export function ShimmeringText({
  text,
  duration = 2,
  delay = 0,
  repeat = true,
  repeatDelay = 0.5,
  className,
  startOnView = true,
  once = false,
  inViewMargin,
  spread = 2,
  color,
  shimmerColor,
}: ShimmeringTextProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const isInView = useInView(ref, { once, margin: inViewMargin })
  const prefersReducedMotion = useReducedMotion()

  const dynamicSpread = useMemo(() => text.length * spread, [text, spread])

  const shouldAnimate = !prefersReducedMotion && (!startOnView || isInView)

  return (
    <motion.span
      ref={ref}
      className={cn(
        "relative inline-block bg-[length:250%_100%,auto] bg-clip-text text-transparent",
        "[-webkit-background-clip:text] [-webkit-text-fill-color:transparent]",
        "[--base-color:var(--text-muted,#7a7a7a)] [--shimmer-color:var(--text-primary,#111111)]",
        "[background-repeat:no-repeat,padding-box]",
        "[--shimmer-bg:linear-gradient(90deg,transparent_calc(50%-var(--spread)),var(--shimmer-color),transparent_calc(50%+var(--spread)))]",
        className,
      )}
      style={
        {
          "--spread": `${dynamicSpread}px`,
          ...(color ? { "--base-color": color } : null),
          ...(shimmerColor ? { "--shimmer-color": shimmerColor } : null),
          backgroundImage:
            "var(--shimmer-bg), linear-gradient(var(--base-color), var(--base-color))",
        } as CSSProperties
      }
      initial={
        prefersReducedMotion
          ? { opacity: 1, backgroundPosition: "0% center" }
          : {
              backgroundPosition: "100% center",
              // Skip fade-in when mounting for an immediate complete action.
              opacity: startOnView ? 0 : 1,
            }
      }
      animate={
        shouldAnimate
          ? {
              backgroundPosition: "0% center",
              opacity: 1,
            }
          : prefersReducedMotion
            ? { opacity: 1, backgroundPosition: "0% center" }
            : { opacity: startOnView ? 0 : 1 }
      }
      transition={{
        backgroundPosition: {
          repeat: repeat ? Number.POSITIVE_INFINITY : 0,
          duration,
          delay,
          repeatDelay,
          ease: "linear",
        },
        opacity: {
          duration: 0.3,
          delay,
        },
      }}
    >
      {text}
    </motion.span>
  )
}
