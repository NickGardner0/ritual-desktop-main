/**
 * Analytics View Toggle - Lightweight dropdown for switching between chart views
 * 
 * IMPORTANT: This component is split from habit-ticker-view.tsx to avoid
 * pulling in recharts (~500KB) when only the toggle is needed.
 */

'use client';

import React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

// View Toggle - Dropdown style matching habits filter
interface ViewToggleProps {
  currentView: 'chart' | 'ticker';
  onViewChange: (view: 'chart' | 'ticker') => void;
  darkMode?: boolean;
  buttonClassName?: string;
}

export const AnalyticsViewToggle: React.FC<ViewToggleProps> = ({
  currentView,
  onViewChange,
  buttonClassName,
}) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const [dropdownPosition, setDropdownPosition] = React.useState({ top: 0, left: 0, minWidth: 120 });
  
  const viewOptions = [
    { value: 'ticker' as const, label: 'Spark' },
    { value: 'chart' as const, label: 'Bar' }
  ];
  
  const currentOption = viewOptions.find(opt => opt.value === currentView);

  React.useEffect(() => {
    if (!isOpen || !buttonRef.current || typeof window === 'undefined') return;

    const updatePosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      setDropdownPosition({
        top: rect.bottom + 4,
        left: rect.left,
        minWidth: Math.max(Math.round(rect.width), 120),
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen]);
  
  return (
    <div className="relative">
      <button
        id="view-toggle-dropdown-button"
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex h-8 items-center justify-between gap-2 border border-gray-300 bg-white px-3 text-[13px] text-gray-600 shadow-sm transition-colors hover:bg-[#F3F3F3] hover:text-black rounded-sm",
          buttonClassName,
        )}
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
      
      {isOpen && typeof document !== 'undefined' && createPortal(
        <>
          <div
            className="fixed inset-0"
            style={{ zIndex: 999 }}
            onClick={() => setIsOpen(false)}
          />
          <div
            className="fixed border border-gray-300 bg-white shadow-lg rounded-sm"
            style={{
              zIndex: 1000,
              top: dropdownPosition.top,
              left: dropdownPosition.left,
              minWidth: `${dropdownPosition.minWidth}px`,
            }}
          >
            <div className="p-1">
              {viewOptions.map((option) => (
                <label
                  key={option.value}
                  className="flex cursor-pointer items-center gap-2.5 px-3 py-2 transition-colors hover:bg-[#F3F3F3]"
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
        </>,
        document.body
      )}
    </div>
  );
};
