"use client"

import { Battery, Signal, Wifi } from 'lucide-react'

export function MacWindow({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative max-w-5xl mx-auto w-full rounded-2xl overflow-hidden shadow-2xl">
      {/* Window chrome */}
      <div className="bg-[#1C1C1E] px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex gap-2">
            <div className="w-3 h-3 rounded-full bg-[#FF5F57]"></div>
            <div className="w-3 h-3 rounded-full bg-[#FEBC2E]"></div>
            <div className="w-3 h-3 rounded-full bg-[#28C840]"></div>
          </div>
          <div className="text-xs text-gray-400 ml-2">Finder</div>
        </div>
        <div className="flex items-center gap-2 text-gray-400">
          <Battery className="w-4 h-4" />
          <Wifi className="w-4 h-4" />
          <Signal className="w-4 h-4" />
          <span className="text-xs">Mon Jun 22 9:41 AM</span>
        </div>
      </div>
      
      {/* Window content */}
      <div className="bg-[#1C1C1E]/95 backdrop-blur-xl p-6">
        {children}
      </div>
    </div>
  )
}

