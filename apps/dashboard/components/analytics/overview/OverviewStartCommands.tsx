'use client';

import React from 'react';

export function StartSectionHeader({ title }: { title: string }) {
  return (
    <div className="mb-2.5 flex items-center gap-2 px-2">
      <span className="text-[11px] font-normal uppercase leading-none tracking-normal text-[#85898f]">
        {title}
      </span>
      <div className="h-px flex-1 bg-[rgba(15,23,42,0.075)]" />
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
      className="ritual-snappy-row group flex h-10 w-full items-center justify-between rounded-sm bg-[rgba(17,24,39,0.026)] px-3 text-left focus-visible:outline-none"
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
        <span className="ml-4 shrink-0 rounded-sm bg-[rgba(17,24,39,0.055)] px-1.5 py-0.5 text-[12px] font-normal leading-none text-[#747981]">
          {shortcut}
        </span>
      ) : null}
    </button>
  );
}
