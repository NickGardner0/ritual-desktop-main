/**
 * Analytics View Toggle - Lightweight dropdown for switching between chart views
 * 
 * IMPORTANT: This component is split from habit-ticker-view.tsx to avoid
 * pulling in recharts (~500KB) when only the toggle is needed.
 */

'use client';

import React from 'react';

// View Toggle - Dropdown style matching habits filter
interface ViewToggleProps {
  currentView: 'chart' | 'ticker';
  onViewChange: (view: 'chart' | 'ticker') => void;
  darkMode?: boolean;
}

export const AnalyticsViewToggle: React.FC<ViewToggleProps> = ({
  currentView,
  onViewChange,
}) => {
  const [isOpen, setIsOpen] = React.useState(false);
  
  const viewOptions = [
    { value: 'ticker' as const, label: 'Spark' },
    { value: 'chart' as const, label: 'Bar' }
  ];
  
  const currentOption = viewOptions.find(opt => opt.value === currentView);
  
  return (
    <div className="relative">
      <button
        id="view-toggle-dropdown-button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between gap-2 px-3 h-8 bg-white border border-gray-200 text-[13px] text-gray-600 hover:bg-[#F7F7F7] transition-colors"
      >
        <span className="text-sm">{currentOption?.label || 'View'}</span>
        <svg 
          className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      
      {isOpen && (
        <>
          <div 
            className="fixed inset-0" 
            style={{ zIndex: 999 }}
            onClick={() => setIsOpen(false)}
          />
          <div 
            className="absolute left-0 top-full mt-1 bg-white border border-gray-300 shadow-lg z-[1000] min-w-[120px]"
          >
            <div className="p-1">
              {viewOptions.map((option) => (
                <label
                  key={option.value}
                  className="flex items-center gap-2.5 px-3 py-2 hover:bg-[#F3F3F3] cursor-pointer transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={currentView === option.value}
                    onChange={() => {
                      onViewChange(option.value);
                      setIsOpen(false);
                    }}
                    className="analytics-checkbox"
                  />
                  <span className="text-sm text-gray-900">{option.label}</span>
                </label>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
