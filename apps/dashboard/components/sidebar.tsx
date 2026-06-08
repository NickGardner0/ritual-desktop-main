"use client";

import { cn } from "@/lib/utils";

import Link from "next/link";
import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
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
      <g fill="none" stroke="currentColor" strokeWidth="2">
        <rect width="20" height="18" x="2" y="3" rx="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M9 3v18" />
      </g>
    </svg>
  );
}

export function Sidebar() {
  const router = useRouter();
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
  const showExpandedChrome = mode === "expanded";
  const showSidebarLogo = mode !== "expanded";

  // Only attach hover handlers in hover mode
  const hoverProps =
    mode === "hover"
      ? { onMouseEnter: handleMouseEnter, onMouseLeave: handleMouseLeave }
      : {};

  const width = isExpanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH;
  const headerWidth = showExpandedChrome ? EXPANDED_WIDTH : COLLAPSED_WIDTH;
  const headerHeight = showExpandedChrome ? 44 : 80;
  const navTopPadding = showExpandedChrome ? 78 : 84;

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
        className="sidebar-header tauri-drag-region absolute top-0 left-0 z-[2] flex items-center"
        style={{ width: headerWidth, height: headerHeight }}
      >
        {showExpandedChrome ? (
          <div className="no-drag absolute inset-y-0 left-[82px] z-10 flex items-center">
            <button
              type="button"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                handleChromeToggle();
              }}
              className="titlebar-icon-button mr-[22px] flex h-7 w-7 items-center justify-center rounded-md text-[rgba(17,24,39,0.46)] transition-colors hover:bg-[rgba(255,255,255,0.48)] hover:text-[rgba(17,24,39,0.78)]"
              aria-label={mode === "expanded" ? "Collapse sidebar" : "Expand sidebar"}
              title={mode === "expanded" ? "Collapse sidebar" : "Expand sidebar"}
            >
              <SidebarChromeToggleIcon className="h-[16px] w-[16px]" />
            </button>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  if (window.history.length > 1) {
                    router.back();
                  }
                }}
                className="titlebar-icon-button flex h-7 w-7 items-center justify-center rounded-md text-[rgba(17,24,39,0.42)] transition-colors hover:bg-[rgba(255,255,255,0.48)] hover:text-[rgba(17,24,39,0.76)]"
                aria-label="Go back"
                title="Go back"
              >
                <ChevronLeft className="h-4 w-4 stroke-[2.05]" />
              </button>
              <button
                type="button"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  router.forward();
                }}
                className="titlebar-icon-button flex h-7 w-7 items-center justify-center rounded-md text-[rgba(17,24,39,0.42)] transition-colors hover:bg-[rgba(255,255,255,0.48)] hover:text-[rgba(17,24,39,0.76)]"
                aria-label="Go forward"
                title="Go forward"
              >
                <ChevronRight className="h-4 w-4 stroke-[2.05]" />
              </button>
            </div>
          </div>
        ) : null}
        {showSidebarLogo ? (
          <Link href="/" className="no-drag flex h-full w-full items-start justify-start pl-[24px] pt-[22px] transition-none">
            <img
              src="/images/eclipse.svg"
              alt="Ritual Logo"
              className="h-[24px] w-[24px] flex-shrink-0 opacity-[0.74]"
            />
          </Link>
        ) : (
          <div className="no-drag relative h-full w-full" />
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
