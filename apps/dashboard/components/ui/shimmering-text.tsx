"use client"

import { cn } from "@/lib/utils"
import { motion, type Transition } from "framer-motion"

export type ShimmeringTextProps = {
  text: string
  className?: string
  duration?: number
  /** Highlight / “lit” letter color */
  shimmeringColor?: string
  /** Resting letter color */
  color?: string
  spread?: number
  zDistance?: number
  xDistance?: number
  yDistance?: number
  scaleDistance?: number
  rotateYDistance?: number
  transition?: Transition
}

/**
 * Letter-by-letter shimmer wave (Animate UI / Motion Primitives style).
 * Uses concrete colors so Framer Motion can interpolate each character.
 */
export function ShimmeringText({
  text,
  className,
  duration = 1,
  color = "#a1a1aa",
  shimmeringColor = "#111111",
  spread = 1,
  zDistance = 8,
  xDistance = 1.5,
  yDistance = -1.5,
  scaleDistance = 1.05,
  rotateYDistance = 8,
  transition,
}: ShimmeringTextProps) {
  const characters = Array.from(text)

  return (
    <span
      className={cn(
        "relative inline-block whitespace-nowrap [perspective:500px]",
        className,
      )}
      style={{ color }}
      aria-label={text}
    >
      {characters.map((char, index) => {
        const delay = (index * duration * (1 / spread)) / Math.max(characters.length, 1)

        return (
          <motion.span
            key={`${index}-${char}`}
            className="inline-block whitespace-pre [transform-style:preserve-3d]"
            initial={{
              translateZ: 0,
              scale: 1,
              rotateY: 0,
              color,
            }}
            animate={{
              translateZ: [0, zDistance, 0],
              translateX: [0, xDistance, 0],
              translateY: [0, yDistance, 0],
              scale: [1, scaleDistance, 1],
              rotateY: [0, rotateYDistance, 0],
              color: [color, shimmeringColor, color],
            }}
            transition={{
              duration,
              repeat: Infinity,
              repeatDelay: (characters.length * 0.04) / spread,
              delay,
              ease: "easeInOut",
              ...transition,
            }}
          >
            {char}
          </motion.span>
        )
      })}
    </span>
  )
}
