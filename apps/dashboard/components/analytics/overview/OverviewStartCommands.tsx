'use client';

import React from 'react';

export function StartSectionHeader({ title }: { title: string }) {
  return (
    <div className="mb-2 flex items-center gap-2 px-1">
      <span className="text-[11px] font-medium uppercase leading-none tracking-normal text-[#8f9399]">
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
      className="group flex h-7 w-full items-center justify-between rounded-sm px-2 text-left transition-none hover:bg-[var(--row-hover)] focus-visible:bg-[var(--row-hover)] focus-visible:outline-none"
    >
      <span className="flex min-w-0 items-center gap-2">
        <Icon className="h-4 w-4 shrink-0 text-[#8f9399] transition-none group-hover:text-[#62666d]" strokeWidth={2} />
        <span className="truncate text-[14px] font-medium leading-none text-[#3f4247]">
          {label}
        </span>
      </span>
      {shortcut ? (
        <span className="ml-4 shrink-0 text-[12px] font-medium leading-none text-[#8f9399]">
          {shortcut}
        </span>
      ) : null}
    </button>
  );
}
