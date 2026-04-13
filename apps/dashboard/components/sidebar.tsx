"use client";

import { cn } from "@/lib/utils";

import Link from "next/link";
import { useState, useRef, useCallback } from "react";
import { MainMenu } from "./main-menu";
import { TeamDropdown } from "./team-dropdown";

export function Sidebar() {
  const [isExpanded, setIsExpanded] = useState(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => setIsExpanded(true), 50);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => setIsExpanded(false), 100);
  }, []);

  return (
    <aside
      className={cn(
        "sidebar-vibrancy relative h-screen flex-shrink-0 flex-col justify-between pb-4 items-stretch overflow-hidden hidden md:flex",
        isExpanded ? "w-[240px]" : "w-[70px]",
      )}
      style={{ transition: "width 200ms cubic-bezier(0.4, 0, 0.2, 1)" }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Logo Header — keep a taller reserved band so the logo sits cleanly
          below the macOS traffic lights without overlap. */}
      <div
        data-tauri-drag-region
        className="sidebar-header tauri-drag-region absolute top-0 left-0 z-[2] h-[70px] w-[70px] flex items-center justify-center"
      >
        <Link href="/" className="no-drag flex h-full w-full items-start justify-center pt-[20px] transition-none">
          <img
            src="/images/eclipse.svg"
            alt="Ritual Logo"
            className="w-[22px] h-[22px] flex-shrink-0"
          />
        </Link>
      </div>

      {/* Main Navigation — top padding accounts for taller logo/header band */}
      <div className="flex flex-col w-full pt-[70px] flex-1">
        <MainMenu 
          isExpanded={isExpanded} 
          onCloseSidebar={() => setIsExpanded(false)}
        />
      </div>

      {/* Bottom: User Avatar */}
      <div className="flex flex-col items-center w-full gap-2 px-[15px]">
        <TeamDropdown isExpanded={isExpanded} placement="sidebar" />
      </div>
    </aside>
  );
}
