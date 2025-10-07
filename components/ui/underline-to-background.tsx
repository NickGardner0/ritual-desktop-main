"use client"

import { motion } from "framer-motion"

interface UnderlineToBackgroundProps {
  children: React.ReactNode
}

export function UnderlineToBackground({ children }: UnderlineToBackgroundProps) {
  return (
    <motion.span
      className="relative inline-block"
      initial="hidden"
      animate="visible"
      whileHover="visible"
    >
      <span className="relative z-10">{children}</span>
      <motion.span
        className="absolute left-0 bottom-0 w-full bg-orange-500/10"
        variants={{
          hidden: { 
            height: "2px",
            opacity: 0
          },
          visible: { 
            height: "100%",
            opacity: 1,
            transition: {
              height: { duration: 0.3 },
              opacity: { duration: 0.2 }
            }
          }
        }}
      />
    </motion.span>
  )
}

