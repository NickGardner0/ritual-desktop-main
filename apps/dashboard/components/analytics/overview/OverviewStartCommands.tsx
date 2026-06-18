'use client';

import React from 'react';

export function StartSectionHeader({ title }: { title: string }) {
  return (
    <div className="mb-2 flex items-center gap-2 px-1">
      <span className="text-[11px] font-normal uppercase leading-none tracking-normal text-[#8f9399]">
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
      className="group flex h-[30px] w-full items-center justify-between rounded-sm px-2 text-left transition-none hover:bg-[var(--row-hover)] focus-visible:bg-[var(--row-hover)] focus-visible:outline-none"
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="flex h-5 w-5 shrink-0 -translate-y-px items-center justify-center text-[#62666d] transition-none group-hover:text-[#3f4247]">
          <Icon className="h-[15px] w-[15px]" strokeWidth={1.85} />
        </span>
        <span className="truncate text-[14px] font-normal leading-[18px] text-[#27292d]">
          {label}
        </span>
      </span>
      {shortcut ? (
        <span className="ml-4 shrink-0 text-[12px] font-normal leading-none text-[#8f9399]">
          {shortcut}
        </span>
      ) : null}
    </button>
  );
}
