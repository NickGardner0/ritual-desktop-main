"use client"

import { motion, useInView } from "framer-motion"
import { useRef } from "react"

interface FadeTextProps {
  text: string
  className?: string
}

export function FadeText({ text, className = "" }: FadeTextProps) {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true })

  return (
    <motion.span
      ref={ref}
      className={`inline-block ${className}`}
      initial={{ color: "#111827" }}
      animate={isInView ? { color: "#9CA3AF" } : { color: "#111827" }}
      transition={{
        duration: 1.5,
        delay: 0.5,
        ease: "easeInOut"
      }}
    >
      {text}
    </motion.span>
  )
}

