"use client";

import { cn } from "@/lib/utils";

import Link from "next/link";
import { useState, useRef, useCallback, useEffect } from "react";
import { MainMenu } from "./main-menu";
import { TeamDropdown } from "./team-dropdown";
import CommandPalette from "./habit-selector";
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
      <rect x="2.5" y="3.75" width="19" height="16.5" rx="3.5" stroke="currentColor" strokeWidth="1.95" />
      <path d="M9.75 5.35V18.65" stroke="currentColor" strokeWidth="1.95" strokeLinecap="round" />
      <rect x="5.15" y="7" width="2.85" height="1.95" rx="0.975" fill="currentColor" />
      <rect x="5.15" y="11.05" width="2.85" height="1.95" rx="0.975" fill="currentColor" />
      <rect x="5.15" y="15.1" width="2.85" height="1.95" rx="0.975" fill="currentColor" />
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
  const isFixedExpanded = mode === "expanded";

  // Only attach hover handlers in hover mode
  const hoverProps =
    mode === "hover"
      ? { onMouseEnter: handleMouseEnter, onMouseLeave: handleMouseLeave }
      : {};

  const width = isExpanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH;
  const showChromeToggle = isFixedExpanded;
  const headerWidth = isFixedExpanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH;
  const headerHeight = isFixedExpanded ? 126 : 80;
  const navTopPadding = isFixedExpanded ? 130 : 84;

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
        className="sidebar-header tauri-drag-region absolute top-0 left-0 z-[2] flex items-start"
        style={{ width: headerWidth, height: headerHeight }}
      >
        {showChromeToggle ? (
          <button
            type="button"
            onClick={handleChromeToggle}
            className="no-drag absolute left-[68px] top-[8px] flex h-[20px] w-[20px] items-center justify-center rounded-[4px] text-[rgb(78,79,82)] transition-colors hover:text-[#1f1d19]"
            aria-label={mode === "expanded" ? "Collapse sidebar" : "Expand sidebar"}
            title={mode === "expanded" ? "Collapse sidebar" : "Expand sidebar"}
          >
            <SidebarChromeToggleIcon className="h-[19px] w-[19px]" />
          </button>
        ) : null}
        {isFixedExpanded ? (
          <div className="no-drag flex w-full flex-col px-3 pt-[34px]">
            <CommandPalette
              className="h-9 w-full justify-between rounded-[12px] border border-gray-200/90 bg-white/90 px-3 py-1.5 text-[13px] text-gray-600 shadow-none hover:bg-white"
            />
            <Link
              href="/"
              className="mt-3 flex items-center gap-2.5 px-1 text-[#201f1b] transition-opacity hover:opacity-85"
            >
              <img
                src="/images/eclipse.svg"
                alt="Ritual Logo"
                className="h-[18px] w-[18px] flex-shrink-0"
              />
              <span className="text-[14px] font-[600] tracking-[-0.01em]">Ritual</span>
            </Link>
          </div>
        ) : (
          <Link href="/" className="no-drag flex h-full w-full items-start justify-center pt-[31px] transition-none">
            <img
              src="/images/eclipse.svg"
              alt="Ritual Logo"
              className="w-[22px] h-[22px] flex-shrink-0"
            />
          </Link>
        )}
      </div>

      {/* Main Navigation — top padding accounts for the dedicated titlebar lane above the logo. */}
      <div className="flex flex-col w-full flex-1" style={{ paddingTop: navTopPadding }}>
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
