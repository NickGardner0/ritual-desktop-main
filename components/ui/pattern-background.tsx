"use client"

import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'

export function PatternBackground() {
  const { theme, resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  
  // After mounting, we have access to the theme
  useEffect(() => {
    setMounted(true)
  }, [])
  
  const isDarkMode = mounted && (theme === 'dark' || resolvedTheme === 'dark')
  
  return (
    <div className="absolute inset-0 z-0 overflow-hidden">
      {/* Background base */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#f7f7f7] to-white dark:from-[#171923] dark:to-[#101218]" />
      
      {/* Subtle radial gradient overlay */}
      <div 
        className="absolute inset-0"
        style={{
          background: isDarkMode
            ? 'radial-gradient(circle at center, rgba(24, 26, 32, 0.5) 0%, rgb(16, 18, 24) 100%)'
            : 'radial-gradient(circle at center, rgba(250, 250, 250, 0.5) 0%, white 100%)',
          mixBlendMode: 'normal'
        }}
    />
    </div>
  )
}

