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
        "inline-flex items-center gap-0.5 rounded-sm bg-[#F0F0F0]/60 p-0.5",
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
            "h-7 px-3 text-[13px] rounded-sm transition-all duration-150",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-1",
            currentView === tab.value
              ? "bg-white text-black font-medium shadow-sm"
              : "bg-transparent text-gray-700 font-normal hover:text-gray-900"
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
};
