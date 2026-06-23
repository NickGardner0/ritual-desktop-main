'use client';

import React from 'react';

export function StartSectionHeader({ title }: { title: string }) {
  return (
    <div className="mb-px flex items-center gap-1 px-0">
      <span className="text-[10px] font-normal uppercase leading-none tracking-normal text-[#8f9399]">
        {title}
      </span>
      <div className="h-px flex-1 bg-[rgba(15,23,42,0.055)]" />
    </div>
  );
}

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
      className="group flex h-[21px] w-full items-center justify-between rounded-[3px] px-0.5 text-left transition-none hover:bg-[var(--row-hover)] focus-visible:bg-[var(--row-hover)] focus-visible:outline-none"
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="flex h-3 w-3 shrink-0 items-center justify-center text-[#52575f] transition-none group-hover:text-[#2f3338]">
          <Icon className="h-[9.5px] w-[9.5px]" strokeWidth={1.6} />
        </span>
        <span className="truncate text-[11.5px] font-normal leading-[15px] text-[#2f3237]">
          {label}
        </span>
      </span>
      {shortcut ? (
        <span className="ml-3 shrink-0 text-[8.5px] font-[400] leading-none text-[#8f9399]">
          {shortcut}
        </span>
      ) : null}
    </button>
  );
}
