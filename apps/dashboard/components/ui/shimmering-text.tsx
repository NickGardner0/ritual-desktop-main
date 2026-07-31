"use client"

import * as React from "react"
import { motion, type HTMLMotionProps } from "framer-motion"

import { cn } from "@/lib/utils"

export type ShimmeringTextProps = Omit<HTMLMotionProps<"span">, "children"> & {
  text: string
  duration?: number
  wave?: boolean
  color?: string
  shimmeringColor?: string
}

export function ShimmeringText({
  text,
  duration = 1,
  transition,
  wave = false,
  color = "var(--text-primary, #111111)",
  shimmeringColor = "#a1a1aa",
  className,
  ...props
}: ShimmeringTextProps) {
  return (
    <motion.span
      className={cn("relative inline-block", className)}
      style={
        {
          "--shimmering-color": shimmeringColor,
          "--color": color,
          color: "var(--color)",
          perspective: "500px",
        } as React.CSSProperties
      }
      {...props}
    >
      {text.split("").map((char, index) => (
        <motion.span
          key={`${char}-${index}`}
          style={{
            display: "inline-block",
            whiteSpace: "pre",
            transformStyle: "preserve-3d",
          }}
          initial={{
            ...(wave
              ? {
                  scale: 1,
                  rotateY: 0,
                }
              : {}),
            color: "var(--color)",
          }}
          animate={{
            ...(wave
              ? {
                  x: [0, 5, 0],
                  y: [0, -5, 0],
                  scale: [1, 1.1, 1],
                  rotateY: [0, 15, 0],
                }
              : {}),
            color: ["var(--color)", "var(--shimmering-color)", "var(--color)"],
          }}
          transition={{
            duration,
            repeat: Infinity,
            repeatType: "loop",
            repeatDelay: text.length * 0.05,
            delay: (index * duration) / Math.max(text.length, 1),
            ease: "easeInOut",
            ...transition,
          }}
        >
          {char}
        </motion.span>
      ))}
    </motion.span>
  )
}
