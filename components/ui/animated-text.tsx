"use client"

import React from 'react'
import { motion } from 'framer-motion'

interface AnimatedTextProps {
  text: string
  className?: string
}

export function InstantText({ text, className = "" }: AnimatedTextProps) {
  const words = text.split(" ")

  return (
    <motion.span
      className={`inline-block ${className}`}
      initial="hidden"
      animate="visible"
      variants={{
        visible: {
          transition: {
            staggerChildren: 0.005,
          },
        },
      }}
    >
      {words.map((word, index) => (
        <motion.span
          key={index}
          className="inline-block"
          variants={{
            hidden: { opacity: 0 },
            visible: { opacity: 1 },
          }}
          transition={{ duration: 0.05, delay: index * 0.005 }}
        >
          {word}{" "}
        </motion.span>
      ))}
    </motion.span>
  )
}

