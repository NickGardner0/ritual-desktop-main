"use client";

import { cn } from "@/lib/utils";

import Link from "next/link";
import { useState, useRef, useCallback } from "react";
import { MainMenu } from "./main-menu";
import { TeamDropdown } from "./team-dropdown";
import { useSidebarMode } from "@/contexts/SidebarModeContext";
import { PanelLeft } from "lucide-react";

const COLLAPSED_WIDTH = 70;
const EXPANDED_WIDTH = 190;

export function Sidebar() {
  const { mode } = useSidebarMode();
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

  // hidden mode: render nothing (toggle button is in DashboardLayout)
  if (mode === "hidden") return null;

  // Determine visual expansion state based on mode
  const isExpanded =
    mode === "expanded" ? true : mode === "hover" ? isHovered : false;

  // Only attach hover handlers in hover mode
  const hoverProps =
    mode === "hover"
      ? { onMouseEnter: handleMouseEnter, onMouseLeave: handleMouseLeave }
      : {};

  const width = isExpanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH;

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
        className="sidebar-header tauri-drag-region absolute top-0 left-0 z-[2] h-[80px] w-[70px] flex items-center justify-center"
      >
        <Link href="/" className="no-drag flex h-full w-full items-start justify-center pt-[31px] transition-none">
          <img
            src="/images/eclipse.svg"
            alt="Ritual Logo"
            className="w-[22px] h-[22px] flex-shrink-0"
          />
        </Link>
      </div>

      {/* Main Navigation — top padding accounts for the dedicated titlebar lane above the logo. */}
      <div className="flex flex-col w-full pt-[80px] flex-1">
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

/** Titlebar toggle button positioned beside the macOS traffic lights. */
export function SidebarToggleButton() {
  const { mode, toggleVisibility } = useSidebarMode();
  const isHidden = mode === "hidden";

  return (
    <button
      type="button"
      onClick={toggleVisibility}
      className={cn(
        "fixed top-[6px] left-[88px] z-[100] no-drag flex h-[22px] w-[22px] items-center justify-center rounded-[6px] border border-[rgba(17,24,39,0.10)] bg-[rgba(255,255,255,0.78)] text-[#7a7a72] transition-colors hover:bg-[rgba(255,255,255,0.96)] hover:text-[#27251E]",
        !isHidden && "border-transparent bg-transparent hover:bg-[rgba(17,24,39,0.05)]",
      )}
      title={isHidden ? "Show sidebar" : "Hide sidebar"}
      aria-label={isHidden ? "Show sidebar" : "Hide sidebar"}
    >
      <PanelLeft className="h-[18px] w-[18px]" strokeWidth={2.2} />
    </button>
  );
}
