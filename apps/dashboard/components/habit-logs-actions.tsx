'use client';

import React from 'react';
import {
  SlidersHorizontal,
  Plus,
  Download,
  Rows3,
  Check,
  Save,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@ritual/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import type { TableDensity } from '@/components/habit-logs/types';

const COLUMN_LABELS: Record<string, string> = {
  select: 'Select',
  date: 'Date',
  time: 'Time',
  habit: 'Habit',
  value: 'Value',
  category: 'Category',
  source: 'Source',
  notes: 'Notes',
  actions: 'Actions',
};

const REQUIRED_COLUMNS = ['select', 'habit', 'actions'];

interface Props {
  columnVisibility: Record<string, boolean>;
  onColumnVisibilityChange: (visibility: Record<string, boolean>) => void;
  onExportFiltered?: () => void;
  exportDisabled?: boolean;
  density: TableDensity;
  onDensityChange: (density: TableDensity) => void;
  onQuickSaveView?: () => void;
}

export function HabitLogsActions({
  columnVisibility,
  onColumnVisibilityChange,
  onExportFiltered,
  exportDisabled = false,
  density,
  onDensityChange,
  onQuickSaveView,
}: Props) {
  return (
    <div className="flex items-center gap-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="flex h-8 w-8 items-center justify-center rounded-sm border border-black/10 bg-white text-neutral-600 shadow-[0_1px_0_rgba(15,23,42,0.02)] transition-colors hover:bg-neutral-50 hover:text-neutral-900"
            aria-label="Column visibility"
          >
            <SlidersHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={8}
          className="w-[200px]"
        >
          {Object.entries(COLUMN_LABELS)
            .filter(([key]) => !REQUIRED_COLUMNS.includes(key))
            .map(([key, label]) => {
              const isVisible = columnVisibility[key] !== false;

              return (
                <label
                  key={key}
                  className="ritual-menu-row cursor-pointer gap-2.5"
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

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="flex h-8 w-8 items-center justify-center rounded-sm border border-black/10 bg-white text-neutral-600 shadow-[0_1px_0_rgba(15,23,42,0.02)] transition-colors hover:bg-neutral-50 hover:text-neutral-900"
            aria-label="More actions"
          >
            <Plus className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={8}
          className="w-[220px]"
        >
          {onQuickSaveView && (
            <DropdownMenuItem
              onClick={onQuickSaveView}
            >
              <Save className="w-4 h-4 mr-2" />
              Save Current View
            </DropdownMenuItem>
          )}

          {onExportFiltered && (
            <DropdownMenuItem
              onClick={onExportFiltered}
              disabled={exportDisabled}
            >
              <Download className="w-4 h-4 mr-2" />
              Export Filtered CSV
            </DropdownMenuItem>
          )}

          <DropdownMenuSeparator />

          <DropdownMenuItem
            onClick={() => onDensityChange('comfortable')}
          >
            <Rows3 className="w-4 h-4 mr-2" />
            Comfortable Density
            {density === 'comfortable' && <Check className="w-4 h-4 ml-auto" />}
          </DropdownMenuItem>

          <DropdownMenuItem
            onClick={() => onDensityChange('compact')}
          >
            <Rows3 className="w-4 h-4 mr-2" />
            Compact Density
            {density === 'compact' && <Check className="w-4 h-4 ml-auto" />}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
