"use client"

import * as React from "react"

export function BorderBeam({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative inline-flex">
      <div 
        className="absolute -inset-[1px] rounded-full bg-gradient-to-r from-[#27333a]/50 to-[#3a4a55]/50 dark:from-[#27333a]/30 dark:to-[#3a4a55]/30"
        style={{
          filter: 'blur(1px)',
          animation: 'glow 2s ease-in-out infinite',
        }}
      />
      {children}
    </div>
  )
}
