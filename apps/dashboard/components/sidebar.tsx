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
      <rect x="2.5" y="3.75" width="19" height="16.5" rx="3.5" stroke="currentColor" strokeWidth="1.95" />
      <path d="M9.75 5.35V18.65" stroke="currentColor" strokeWidth="1.95" strokeLinecap="round" />
      <rect x="5.15" y="7" width="2.85" height="1.95" rx="0.975" fill="currentColor" />
      <rect x="5.15" y="11.05" width="2.85" height="1.95" rx="0.975" fill="currentColor" />
      <rect x="5.15" y="15.1" width="2.85" height="1.95" rx="0.975" fill="currentColor" />
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
  const headerHeight = showExpandedChrome ? 52 : 80;
  const navTopPadding = showExpandedChrome ? 52 : 84;

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
        {showExpandedChrome ? (
          <div className="no-drag absolute left-[82px] top-[7px] z-10 flex items-center">
            <button
              type="button"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                handleChromeToggle();
              }}
              className="mr-[28px] flex h-[20px] w-[20px] items-center justify-center rounded-[4px] text-[rgb(128,131,136)] transition-colors hover:text-[#51545a]"
              aria-label={mode === "expanded" ? "Collapse sidebar" : "Expand sidebar"}
              title={mode === "expanded" ? "Collapse sidebar" : "Expand sidebar"}
            >
              <SidebarChromeToggleIcon className="h-[18px] w-[18px]" />
            </button>
            <div className="flex items-center gap-[10px]">
              <button
                type="button"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  if (window.history.length > 1) {
                    router.back();
                  }
                }}
                className="flex h-[18px] w-[18px] items-center justify-center rounded-[4px] text-[rgb(146,149,154)] transition-colors hover:text-[#56595f]"
                aria-label="Go back"
                title="Go back"
              >
                <ChevronLeft className="h-[14px] w-[14px] stroke-[2.15]" />
              </button>
              <button
                type="button"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  router.forward();
                }}
                className="flex h-[18px] w-[18px] items-center justify-center rounded-[4px] text-[rgb(146,149,154)] transition-colors hover:text-[#56595f]"
                aria-label="Go forward"
                title="Go forward"
              >
                <ChevronRight className="h-[14px] w-[14px] stroke-[2.15]" />
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
