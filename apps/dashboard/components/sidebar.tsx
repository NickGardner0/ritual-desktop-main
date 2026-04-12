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
      {/* Logo Header — sits below the macOS traffic lights (close/minimize/zoom).
          The 52px height matches the unified toolbar region so the logo aligns
          with the Search bar and nav tabs in the content area. */}
      <div
        data-tauri-drag-region
        className="sidebar-header tauri-drag-region absolute top-0 left-0 z-[2] h-[52px] w-[70px] flex items-center justify-center"
      >
        <Link href="/" className="no-drag flex h-full w-full items-center justify-center pt-[18px] transition-none">
          <img
            src="/images/eclipse.svg"
            alt="Ritual Logo"
            className="w-[24px] h-[24px] flex-shrink-0"
          />
        </Link>
      </div>

      {/* Main Navigation — top padding accounts for 52px header */}
      <div className="flex flex-col w-full pt-[52px] flex-1">
        <MainMenu 
          isExpanded={isExpanded} 
          onCloseSidebar={() => setIsExpanded(false)}
        />
      </div>

      {/* Bottom: User Avatar */}
      <div className="flex flex-col items-center w-full gap-2 px-[15px]">
        {/* User avatar / sign out */}
        <TeamDropdown isExpanded={isExpanded} placement="sidebar" />
      </div>
    </aside>
  );
}
