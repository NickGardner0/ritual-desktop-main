"use client"

import { motion, useInView } from "framer-motion"
import { useRef } from "react"

interface UnderlineAnimationProps {
  children: React.ReactNode
  className?: string
}

export function UnderlineAnimation({ children, className = "" }: UnderlineAnimationProps) {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true })

  return (
    <span className="relative inline-block" ref={ref}>
      <motion.span
        className="relative z-10"
      >
        {children}
      </motion.span>
      <motion.span
        className="absolute bottom-0 left-0 w-full h-[2px] bg-orange-500"
        initial={{ scaleX: 0, x: "-100%" }}
        animate={isInView ? { 
          scaleX: [0, 1, 1, 1, 0],
          x: ["-100%", "0%", "0%", "0%", "100%"]
        } : { scaleX: 0, x: "-100%" }}
        transition={{
          duration: 2,
          times: [0, 0.4, 0.6, 0.8, 1],
          ease: "easeInOut"
        }}
      />
    </span>
  )
}

