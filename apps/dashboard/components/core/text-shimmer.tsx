"use client"

import { memo, useMemo, type CSSProperties } from "react"
import { motion } from "framer-motion"

import { cn } from "@/lib/utils"

type TextShimmerProps = {
  children: string
  className?: string
  duration?: number
  spread?: number
}

export const TextShimmer = memo(function TextShimmer({
  children,
  className,
  duration = 2,
  spread = 2,
}: TextShimmerProps) {
  const dynamicSpread = useMemo(() => children.length * spread, [children, spread])

  return (
    <motion.span
      className={cn(
        "relative inline-block bg-[length:250%_100%,auto] bg-clip-text",
        "text-transparent [--base-color:#a1a1aa] [--base-gradient-color:#111111]",
        "[background-repeat:no-repeat,padding-box] [--bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),var(--base-gradient-color),#0000_calc(50%+var(--spread)))]",
        className,
      )}
      initial={{ backgroundPosition: "100% center" }}
      animate={{ backgroundPosition: "0% center" }}
      transition={{
        repeat: Infinity,
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
    </motion.span>
  )
})
