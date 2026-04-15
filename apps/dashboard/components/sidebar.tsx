"use client";

import { cn } from "@/lib/utils";

import Link from "next/link";
import { useState, useRef, useCallback, useEffect } from "react";
import { MainMenu } from "./main-menu";
import { TeamDropdown } from "./team-dropdown";
import { useSidebarMode } from "@/contexts/SidebarModeContext";

const COLLAPSED_WIDTH = 76;
const EXPANDED_WIDTH = 202;

function SidebarChromeToggleIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect x="2.75" y="4" width="18.5" height="16" rx="3.25" stroke="currentColor" strokeWidth="1.75" />
      <path d="M9.6 5.5V18.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <rect x="5.1" y="7.05" width="2.55" height="1.75" rx="0.875" fill="currentColor" />
      <rect x="5.1" y="11.1" width="2.55" height="1.75" rx="0.875" fill="currentColor" />
      <rect x="5.1" y="15.15" width="2.55" height="1.75" rx="0.875" fill="currentColor" />
    </svg>
  );
}

export function Sidebar() {
  const { mode, setMode } = useSidebarMode();
  const [isHovered, setIsHovered] = useState(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => setIsHovered(true), 50);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => setIsHovered(false), 100);
  }, []);

  // Determine visual expansion state based on mode
  const isExpanded =
    mode === "expanded" ? true : mode === "hover" ? isHovered : false;

  // Only attach hover handlers in hover mode
  const hoverProps =
    mode === "hover"
      ? { onMouseEnter: handleMouseEnter, onMouseLeave: handleMouseLeave }
      : {};

  const width = isExpanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH;
  const showChromeToggle = mode === "expanded";

  const handleChromeToggle = useCallback(() => {
    setIsHovered(false);
    setMode(mode === "expanded" ? "compact" : "expanded");
  }, [mode, setMode]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.style.setProperty('--ritual-sidebar-current-width', `${width}px`);

    return () => {
      document.documentElement.style.setProperty('--ritual-sidebar-current-width', `${COLLAPSED_WIDTH}px`);
    };
  }, [width]);

  return (
    <aside
      className={cn(
        "sidebar-vibrancy relative h-screen flex-shrink-0 flex-col justify-between pb-4 items-stretch overflow-hidden hidden md:flex",
      )}
      style={{
        width,
        transition: "width 200ms cubic-bezier(0.4, 0, 0.2, 1)",
      }}
      {...hoverProps}
    >
      {/* Logo Header — keep a taller reserved band so the logo sits cleanly
          below the macOS traffic lights without overlap. */}
      <div
        data-tauri-drag-region
        className="sidebar-header tauri-drag-region absolute top-0 left-0 z-[2] h-[80px] flex items-center justify-center"
        style={{ width: COLLAPSED_WIDTH }}
      >
        {showChromeToggle ? (
          <button
            type="button"
            onClick={handleChromeToggle}
            className="no-drag absolute left-[58px] top-[11px] flex h-[18px] w-[18px] items-center justify-center rounded-[4px] text-[rgb(97,98,100)] transition-colors hover:text-[#2f2c25]"
            aria-label={mode === "expanded" ? "Collapse sidebar" : "Expand sidebar"}
            title={mode === "expanded" ? "Collapse sidebar" : "Expand sidebar"}
          >
            <SidebarChromeToggleIcon className="h-[17px] w-[17px]" />
          </button>
        ) : null}
        <Link href="/" className="no-drag flex h-full w-full items-start justify-center pt-[31px] transition-none">
          <img
            src="/images/eclipse.svg"
            alt="Ritual Logo"
            className="w-[22px] h-[22px] flex-shrink-0"
          />
        </Link>
      </div>

      {/* Main Navigation — top padding accounts for the dedicated titlebar lane above the logo. */}
      <div className="flex flex-col w-full pt-[84px] flex-1">
        <MainMenu
          isExpanded={isExpanded}
          onCloseSidebar={() => setIsHovered(false)}
        />
      </div>

      {/* Bottom: User Avatar */}
      <div className="flex flex-col items-center w-full gap-2 px-[15px]">
        <TeamDropdown isExpanded={isExpanded} placement="sidebar" />
      </div>
    </aside>
  );
}
