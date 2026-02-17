/**
 * ViewModeToggle - Midday-style segmented control
 * Switches between Overview and Metrics views
 * 
 * Matches Midday's clean, minimal toggle design with:
 * - Subtle background container
 * - Clear selected state with white background
 * - Smooth transitions
 */

'use client';

import React from 'react';
import { cn } from '@/lib/utils';

export type ViewMode = 'overview' | 'metrics';

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
        "inline-flex items-center",
        className
      )}
      role="tablist"
      aria-label="View mode"
    >
      <button
        role="tab"
        aria-selected={currentView === 'overview'}
        aria-controls="overview-panel"
        onClick={() => onViewChange('overview')}
        className={cn(
          "h-8 px-3 text-[13px] font-normal border border-gray-200 transition-colors",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-1",
          currentView === 'overview'
            ? "bg-[#F7F7F7] text-black border-gray-300"
            : "bg-white text-gray-600 hover:text-black hover:bg-[#F7F7F7]"
        )}
      >
        Overview
      </button>
      <button
        role="tab"
        aria-selected={currentView === 'metrics'}
        aria-controls="metrics-panel"
        onClick={() => onViewChange('metrics')}
        className={cn(
          "h-8 px-3 text-[13px] font-normal border border-gray-200 border-l-0 transition-colors",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-1",
          currentView === 'metrics'
            ? "bg-[#F7F7F7] text-black border-gray-300"
            : "bg-white text-gray-600 hover:text-black hover:bg-[#F7F7F7]"
        )}
      >
        Metrics
      </button>
    </div>
  );
};
