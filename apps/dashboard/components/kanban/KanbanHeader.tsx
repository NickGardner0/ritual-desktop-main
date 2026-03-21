'use client';

import React from 'react';
import { Plus } from 'lucide-react';

interface KanbanHeaderProps {
  boardTitle: string;
  onReset: () => void;
  onAddColumn: () => void;
}

export function KanbanHeader({
  boardTitle,
  onReset,
  onAddColumn,
}: KanbanHeaderProps) {
  return (
    <header className="border-b border-[#f4f4f5] bg-white px-6 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[15px] font-semibold tracking-[-0.01em] text-[#18181b]">
          {boardTitle}
        </h1>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onReset}
            className="rounded-md border border-[#e4e4e7] bg-white px-3 py-[5px] text-[12px] text-[#71717a] transition-colors hover:bg-[#f4f4f5] hover:text-[#18181b]"
          >
            Reset board
          </button>
          <button
            type="button"
            onClick={onAddColumn}
            className="flex items-center gap-1.5 rounded-md bg-[#18181b] px-3 py-[5px] text-[12px] font-medium text-white transition-opacity hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" />
            Add column
          </button>
        </div>
      </div>
    </header>
  );
}
