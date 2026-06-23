'use client';

import React from 'react';

export function StartSectionHeader({ title }: { title: string }) {
  return (
    <div className="mb-2 flex items-center gap-2 px-1">
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
      className="ritual-snappy-row group flex h-8 w-full items-center justify-between rounded-[5px] px-2 text-left focus-visible:outline-none"
      style={{ '--ritual-snappy-row-hover': 'rgba(15,23,42,0.09)' } as React.CSSProperties}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center text-[#6b7077] transition-none group-hover:text-[#3f444a]">
          <Icon className="h-[15px] w-[15px]" strokeWidth={1.75} />
        </span>
        <span className="truncate text-[15px] font-normal leading-5 text-[#33363b]">
          {label}
        </span>
      </span>
      {shortcut ? (
        <span className="ml-4 shrink-0 text-[12px] font-normal leading-none text-[#8a8e94]">
          {shortcut}
        </span>
      ) : null}
    </button>
  );
}
