"use client";

import { cn } from "@/lib/utils";

import Link from "next/link";
import { useState } from "react";
import { MainMenu } from "./main-menu";
import { TeamDropdown } from "./team-dropdown";
import { MessageSquare } from "lucide-react";

interface SidebarProps {
  onFeedbackClick?: () => void;
}

export function Sidebar({ onFeedbackClick }: SidebarProps) {
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

      {/* Bottom: Feedback + User Avatar */}
      <div className="flex flex-col items-center w-full gap-2 px-[15px]">
        {/* Feedback button */}
        {onFeedbackClick && (
          <button
            onClick={onFeedbackClick}
            className={cn(
              "flex items-center h-[32px] text-gray-500 hover:text-gray-900 transition-colors",
              isExpanded ? "w-full gap-2 px-1" : "justify-center w-[32px]",
            )}
            title="Feedback"
          >
            <MessageSquare className="w-4 h-4 flex-shrink-0" />
            {isExpanded && (
              <span className="text-sm whitespace-nowrap overflow-hidden">Feedback</span>
            )}
          </button>
        )}
        {/* User avatar / sign out */}
        <TeamDropdown isExpanded={isExpanded} placement="sidebar" />
      </div>
    </aside>
  );
}
