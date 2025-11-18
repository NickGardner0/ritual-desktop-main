"use client";

import { cn } from "@/lib/utils";

import Link from "next/link";
import { useState } from "react";
import { MainMenu } from "./main-menu";
import { Button } from "@/components/ui/button";
import { Terminal } from "lucide-react";


interface SidebarProps {
  onToggleChat?: () => void;
  isChatOpen?: boolean;
}

export function Sidebar({ onToggleChat, isChatOpen = false }: SidebarProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <aside
      className={cn(
        "h-screen flex-shrink-0 flex-col justify-between fixed top-0 pb-4 items-center hidden md:flex z-50 transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]",
        "bg-background border-r border-gray-300",
        isExpanded ? "w-[240px]" : "w-[70px]",
      )}
      onMouseEnter={() => setIsExpanded(true)}
      onMouseLeave={() => setIsExpanded(false)}
    >
      {/* Logo Header */}
      <div
        className={cn(
          "absolute top-0 left-0 h-[70px] flex items-center justify-center bg-background border-b border-gray-300 transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]",
          isExpanded ? "w-full" : "w-[69px]",
        )}
      >
        <Link href="/" className="absolute left-[4px] top-[60%] -translate-y-1/2 transition-none">
          <img 
            src="/images/ritual-logo1.svg" 
            alt="Ritual Logo" 
            className="w-[57px] h-[57px]"
          />
        </Link>
      </div>

      {/* Main Navigation */}
      <div className="flex flex-col w-full pt-[70px] flex-1">
        <MainMenu 
          isExpanded={isExpanded} 
          onCloseSidebar={() => setIsExpanded(false)}
        />
      </div>

      {/* AI Chat Toggle Button - Bottom of Sidebar */}
      <div className="absolute bottom-4 left-[15px]">
        <button
          onClick={onToggleChat}
          className={cn(
            "w-10 h-10 flex items-center justify-center transition-colors duration-200",
            isChatOpen 
              ? "text-gray-900" 
              : "text-gray-600 hover:text-gray-900"
          )}
        >
          <Terminal className="w-5 h-5" />
        </button>
      </div>
    </aside>
  );
}
