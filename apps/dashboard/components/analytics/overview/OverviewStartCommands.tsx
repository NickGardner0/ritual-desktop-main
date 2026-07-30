'use client';

import React from 'react';

export function StartCommand({
  icon: Icon,
  label,
  shortcut,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  shortcut?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="ritual-snappy-row group flex h-9 w-full items-center justify-between rounded-sm bg-[rgba(39,37,30,0.011)] px-3 text-left [--ritual-snappy-row-active:rgba(39,37,30,0.032)] [--ritual-snappy-row-hover:rgba(39,37,30,0.024)] focus-visible:outline-none"
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center text-[#6b7077] transition-none group-hover:text-[#3f444a]">
          <Icon className="h-[15px] w-[15px]" strokeWidth={1.75} />
        </span>
        <span className="truncate text-sm font-normal leading-[18px] text-[#33363b]">
          {label}
        </span>
      </span>
      {shortcut ? (
        <span className="ml-4 shrink-0 rounded-sm bg-[rgba(39,37,30,0.045)] px-1.5 py-0.5 text-[12px] font-normal leading-none text-[#747981]">
          {shortcut}
        </span>
      ) : null}
    </button>
  );
}
