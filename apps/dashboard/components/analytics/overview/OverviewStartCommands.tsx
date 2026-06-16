'use client';

import React from 'react';

export function StartSectionHeader({ title }: { title: string }) {
  return (
    <div className="mb-2 flex items-center gap-2 px-1">
      <span className="text-[11px] font-medium uppercase leading-none tracking-normal text-[#9a9da3]">
        {title}
      </span>
      <div className="h-px flex-1 bg-[#e3e4e6]" />
    </div>
  );
}

export function StartCommand({
  icon: Icon,
  label,
  shortcut,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  shortcut?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex h-9 w-full items-center justify-between rounded-sm px-2 text-left transition-colors hover:bg-[#f3f4f5]"
    >
      <span className="flex min-w-0 items-center gap-2">
        <Icon className="h-4 w-4 shrink-0 text-[#9a9da3] transition-colors group-hover:text-[#6f737a]" />
        <span className="truncate text-[14px] font-medium leading-none text-[#5f636a]">
          {label}
        </span>
      </span>
      {shortcut ? (
        <span className="ml-4 shrink-0 text-[12px] font-medium leading-none text-[#9a9da3]">
          {shortcut}
        </span>
      ) : null}
    </button>
  );
}
