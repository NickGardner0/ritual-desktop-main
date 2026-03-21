"use client";

import { cn } from "@/lib/utils";

import Link from "next/link";
import { useState } from "react";
import { MainMenu } from "./main-menu";
import { TeamDropdown } from "./team-dropdown";

export function Sidebar() {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <aside
      className={cn(
        "sidebar-vibrancy h-screen flex-shrink-0 flex-col justify-between pb-4 items-center hidden md:flex",
        isExpanded ? "w-[240px]" : "w-[70px]",
      )}
      style={{ transition: "width 200ms cubic-bezier(0.4, 0, 0.2, 1)" }}
      onMouseEnter={() => setIsExpanded(true)}
      onMouseLeave={() => setIsExpanded(false)}
    >
      {/* Logo Header */}
      <div
        className={cn(
          "sidebar-header absolute top-0 left-0 h-[70px] flex items-center justify-center",
          isExpanded ? "w-full" : "w-[69px]",
        )}
        style={{ transition: "width 200ms cubic-bezier(0.4, 0, 0.2, 1)" }}
      >
        <Link href="/" className="absolute left-1/2 -translate-x-1/2 top-[54%] -translate-y-1/2 transition-none">
          <img 
            src="/images/eclipse.svg" 
            alt="Ritual Logo" 
            className="w-[24px] h-[24px] flex-shrink-0"
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

      {/* Bottom: User Avatar */}
      <div className="flex flex-col items-center w-full gap-2 px-[15px]">
        {/* User avatar / sign out */}
        <TeamDropdown isExpanded={isExpanded} placement="sidebar" />
      </div>
    </aside>
  );
}
