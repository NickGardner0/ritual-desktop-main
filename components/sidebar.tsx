"use client";

import { cn } from "@/lib/utils";

import Link from "next/link";
import { useState } from "react";
import { MainMenu } from "./main-menu";

export function Sidebar() {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <aside
      className={cn(
        "h-screen flex-shrink-0 flex-col justify-between fixed top-0 pb-4 items-center hidden md:flex z-[1001] transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]",
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
        <Link href="/" className="absolute left-1/2 -translate-x-1/2 top-[58%] -translate-y-1/2 transition-none">
          <img 
            src="/images/new_logo4.svg" 
            alt="Ritual Logo" 
            className="w-[36px] h-[36px] flex-shrink-0"
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
    </aside>
  );
}
