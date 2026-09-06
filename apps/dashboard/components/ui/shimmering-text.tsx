"use client"

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { useInView, useReducedMotion, type UseInViewOptions } from "framer-motion"

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
 * ElevenLabs-style shimmering text.
 *
 * Uses CSS keyframes for the gradient sweep — Framer Motion cannot reliably
 * animate multi-layer `background-position` with `background-clip: text`,
 * which is why Motion-only versions looked like solid grey.
 *
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
  color = "#7a7a7a",
  shimmerColor = "#111111",
}: ShimmeringTextProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const isInView = useInView(ref, { once, margin: inViewMargin })
  const prefersReducedMotion = useReducedMotion()
  const [started, setStarted] = useState(!startOnView)

  const dynamicSpread = useMemo(() => Math.max(text.length * spread, 24), [text, spread])
  const cycleDuration = Math.max(duration + (repeat ? repeatDelay : 0), 0.2)

  useEffect(() => {
    if (!startOnView) {
      setStarted(true)
      return
    }
    if (isInView) setStarted(true)
  }, [isInView, startOnView])

  const shouldAnimate = !prefersReducedMotion && started

  return (
    <span
      ref={ref}
      className={cn("ritual-shimmering-text", className)}
      style={
        {
          "--shimmer-base": color,
          "--shimmer-highlight": shimmerColor,
          "--shimmer-spread": `${dynamicSpread}px`,
          "--shimmer-duration": `${duration}s`,
          "--shimmer-delay": `${delay}s`,
          "--shimmer-cycle": `${cycleDuration}s`,
          "--shimmer-iteration": repeat ? "infinite" : "1",
          animationPlayState: shouldAnimate ? "running" : "paused",
        } as CSSProperties
      }
    >
      {text}
    </span>
  )
}
