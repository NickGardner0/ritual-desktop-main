"use client"

import { motion, AnimatePresence } from "framer-motion"
import { useState, useEffect } from "react"

interface TextTransitionProps {
  text: string
  alternateText: string
  className?: string
  initialDelay?: number
  switchInterval?: number
}

export function TextTransition({ 
  text, 
  alternateText, 
  className = "",
  initialDelay = 2500,
  switchInterval = 6000
}: TextTransitionProps) {
  const [currentText, setCurrentText] = useState(text)
  const [isVisible, setIsVisible] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(false)
      setTimeout(() => {
        setCurrentText(prev => prev === text ? alternateText : text)
        setIsVisible(true)
      }, 500) // Half a second for the fade out
    }, initialDelay)

    const interval = setInterval(() => {
      setIsVisible(false)
      setTimeout(() => {
        setCurrentText(prev => prev === text ? alternateText : text)
        setIsVisible(true)
      }, 500)
    }, switchInterval)

    return () => {
      clearTimeout(timer)
      clearInterval(interval)
    }
  }, [text, alternateText, initialDelay, switchInterval])

  return (
    <div className={`relative inline-block ${className}`}>
      <AnimatePresence mode="wait">
        <motion.span
          key={currentText}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.5, ease: "easeInOut" }}
          className="inline-block"
        >
          {currentText}
        </motion.span>
      </AnimatePresence>
    </div>
  )
} 