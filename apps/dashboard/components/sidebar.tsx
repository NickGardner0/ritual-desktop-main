"use client";

import { cn } from "@/lib/utils";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useState, useRef, useCallback, useEffect } from "react";
import { MainMenu } from "./main-menu";
import { TeamDropdown } from "./team-dropdown";

const CommandPalette = dynamic(
  () => import("./habit-selector"),
  { ssr: false }
);

export function Sidebar({ initialSearchOpen = false }: { initialSearchOpen?: boolean }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (initialSearchOpen) setIsExpanded(true);
  }, [initialSearchOpen]);

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
        "sidebar-vibrancy relative h-screen flex-shrink-0 flex-col justify-between pb-3 items-stretch overflow-hidden hidden md:flex",
        isExpanded ? "w-[248px]" : "w-[82px]",
      )}
      style={{ transition: "width 200ms cubic-bezier(0.4, 0, 0.2, 1)" }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div
        data-tauri-drag-region
        className="sidebar-header tauri-drag-region absolute inset-x-0 top-0 z-[2]"
      >
        <div
          className={cn(
            "flex h-full flex-col",
            isExpanded ? "px-3 pt-[40px] pb-4" : "items-center px-0 pt-[40px] pb-3",
          )}
        >
          <Link
            href="/"
            className={cn(
              "no-drag group flex items-center rounded-[14px] transition-colors duration-200",
              isExpanded
                ? "h-[46px] justify-start gap-3 px-3 hover:bg-[rgba(255,255,255,0.44)]"
                : "h-[46px] w-[46px] justify-center hover:bg-[rgba(255,255,255,0.40)]",
            )}
          >
            <div className="flex h-[28px] w-[28px] items-center justify-center">
              <img
                src="/images/eclipse.svg"
                alt="Ritual Logo"
                className="h-[24px] w-[24px] flex-shrink-0"
              />
            </div>
            {isExpanded && (
              <div className="min-w-0">
                <div className="text-[15px] font-[560] leading-[1.1] text-[#171717]">
                  Ritual
                </div>
                <div className="mt-0.5 text-[11px] font-[440] leading-[1.1] text-[#6d6a63]">
                  Personal operating system
                </div>
              </div>
            )}
          </Link>

          <div className="no-drag mt-3">
            <CommandPalette
              initialOpen={initialSearchOpen}
              compact={!isExpanded}
              className={cn(
                "border border-[rgba(16,24,40,0.08)] bg-[rgba(255,255,255,0.62)] text-[#5f5b53] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] hover:bg-[rgba(255,255,255,0.76)]",
                isExpanded
                  ? "h-10 w-full justify-start rounded-[12px] px-3 text-[13px]"
                  : "mx-auto h-10 w-10 justify-center rounded-[12px] px-0",
              )}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-col w-full flex-1 pt-[142px]">
        <MainMenu
          isExpanded={isExpanded}
          onCloseSidebar={() => setIsExpanded(false)}
        />
      </div>

      <div className="w-full px-3 pt-2">
        <div
          className={cn(
            "border-t border-[rgba(16,24,40,0.06)] pt-3",
            isExpanded ? "" : "flex justify-center",
          )}
        >
          <div
            className={cn(
              "rounded-[14px] border border-[rgba(16,24,40,0.05)] bg-[rgba(255,255,255,0.42)] shadow-[inset_0_1px_0_rgba(255,255,255,0.58)]",
              isExpanded ? "px-2.5 py-2.5" : "flex h-[52px] w-[52px] items-center justify-center p-0",
            )}
          >
            <TeamDropdown isExpanded={isExpanded} placement="sidebar" />
          </div>
        </div>
      </div>
    </aside>
  );
}
