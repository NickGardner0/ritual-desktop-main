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
        'inline-flex h-[31px] max-w-full items-center overflow-x-auto rounded-sm border border-[rgba(39,37,30,0.07)] bg-white p-[3px]',
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
              'h-[25px] min-w-[32px] shrink-0 whitespace-nowrap rounded-[3px] px-2 text-[11.5px] font-medium leading-[16px] tracking-[-0.4px] transition-all focus-visible:z-10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gray-400 focus-visible:ring-inset',
              selected
                ? 'bg-[rgba(39,37,30,0.06)] text-[#27251E]'
                : 'text-[rgba(39,37,30,0.5)] hover:bg-[rgba(39,37,30,0.02)] hover:text-[#27251E]'
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
