'use client';

import React from 'react';
import { cn } from '@/lib/utils';

export interface RangeOption {
  value: string;
  label: string;
}

interface RangeSegmentedControlProps {
  value: string;
  onValueChange: (value: string) => void;
  options: RangeOption[];
  className?: string;
}

export function RangeSegmentedControl({
  value,
  onValueChange,
  options,
  className,
}: RangeSegmentedControlProps) {
  return (
    <div
      role="tablist"
      aria-label="Range presets"
      className={cn(
        'inline-flex h-8 max-w-full items-center gap-1 overflow-x-auto border border-gray-300 bg-white p-0.5',
        className
      )}
    >
      {options.map((option) => {
        const selected = value === option.value;

        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onValueChange(option.value)}
            className={cn(
              'h-full shrink-0 whitespace-nowrap rounded-sm px-2.5 text-[11px] font-medium leading-none transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gray-400 focus-visible:ring-inset',
              selected
                ? 'bg-gray-100 text-gray-900'
                : 'text-gray-600 hover:bg-[#F3F3F3] hover:text-gray-900 focus:bg-[#F3F3F3]'
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export default RangeSegmentedControl;
