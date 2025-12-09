'use client';

import React from 'react';
import { SlidersHorizontal } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';

// Column labels for visibility toggle
const COLUMN_LABELS: Record<string, string> = {
  select: 'Select',
  date: 'Date',
  time: 'Time',
  habit: 'Habit',
  value: 'Value',
  category: 'Category',
  status: 'Status',
  source: 'Source',
  notes: 'Notes',
  actions: 'Actions',
};

// Columns that cannot be hidden
const REQUIRED_COLUMNS = ['select', 'habit', 'actions'];

interface Props {
  columnVisibility: Record<string, boolean>;
  onColumnVisibilityChange: (visibility: Record<string, boolean>) => void;
}

export function HabitLogsActions({
  columnVisibility,
  onColumnVisibilityChange,
}: Props) {
  return (
    <div className="flex items-center gap-2">
      {/* Column Visibility Dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="flex items-center justify-center p-2 bg-white border border-gray-300 text-gray-600 hover:bg-[#F5F5F5] transition-colors"
          >
            <SlidersHorizontal className="w-4 h-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-[180px] bg-white border border-gray-300 shadow-xl p-1"
        >
          {Object.entries(COLUMN_LABELS)
            .filter(([key]) => !REQUIRED_COLUMNS.includes(key))
            .map(([key, label]) => {
              const isVisible = columnVisibility[key] !== false;
              
              return (
                <label
                  key={key}
                  className="flex items-center gap-2.5 px-3 py-2 hover:bg-[#F3F3F3] cursor-pointer transition-colors"
                >
                  <Checkbox
                    checked={isVisible}
                    onCheckedChange={(checked) => {
                      onColumnVisibilityChange({
                        ...columnVisibility,
                        [key]: checked as boolean,
                      });
                    }}
                    className="rounded-none border-gray-300 data-[state=checked]:bg-gray-900 data-[state=checked]:border-gray-900"
                  />
                  <span className="text-sm text-gray-900">{label}</span>
                </label>
              );
            })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

