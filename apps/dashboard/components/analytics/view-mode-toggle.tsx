/**
 * ViewModeToggle - Centered segmented tab bar
 * Switches between Chat, Overview, and Metrics views
 *
 * Matches Claude desktop app's centered tab pattern with:
 * - Clean segmented control
 * - Clear selected state
 * - Smooth transitions
 */

'use client';

import React from 'react';
import { cn } from '@/lib/utils';

export type ViewMode = 'chat' | 'overview' | 'metrics';

const TABS: { value: ViewMode; label: string }[] = [
  { value: 'chat', label: 'Chat' },
  { value: 'overview', label: 'Overview' },
  { value: 'metrics', label: 'Metrics' },
];

interface ViewModeToggleProps {
  currentView: ViewMode;
  onViewChange: (view: ViewMode) => void;
  className?: string;
}

export const ViewModeToggle: React.FC<ViewModeToggleProps> = ({
  currentView,
  onViewChange,
  className,
}) => {
  return (
    <div
      className={cn(
        "titlebar-segmented-control inline-flex h-7 items-center gap-0.5 rounded-sm bg-black/[0.035] p-[2px]",
        className
      )}
      role="tablist"
      aria-label="View mode"
    >
      {TABS.map((tab) => (
        <button
          key={tab.value}
          role="tab"
          aria-selected={currentView === tab.value}
          aria-controls={`${tab.value}-panel`}
          onClick={() => onViewChange(tab.value)}
          className={cn(
            "h-6 rounded-sm px-3 text-[12px] leading-none transition-colors duration-150",
            "focus:outline-none focus-visible:ring-1 focus-visible:ring-[rgba(15,23,42,0.22)] focus-visible:ring-offset-0",
            currentView === tab.value
              ? "bg-white/80 text-[#27251E] font-medium shadow-[0_1px_2px_rgba(15,23,42,0.08),inset_0_1px_0_rgba(255,255,255,0.78)]"
              : "bg-transparent text-[rgba(39,37,30,0.68)] font-normal hover:bg-white/40 hover:text-[#27251E]"
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
};
