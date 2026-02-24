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
} from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import type { TableDensity } from '@/app/(dashboard)/activity/activity-client';

const COLUMN_LABELS: Record<string, string> = {
  select: 'Select',
  date: 'Date',
  time: 'Time',
  habit: 'Habit',
  value: 'Value',
  category: 'Category',
  source: 'Source',
  status: 'Status',
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
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="flex h-9 w-9 items-center justify-center bg-white border border-gray-200 text-gray-600 hover:bg-[#F8F8F8] transition-colors"
            aria-label="Column visibility"
          >
            <SlidersHorizontal className="w-[17px] h-[17px]" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={8}
          className="w-[190px] bg-white border border-gray-200 shadow-md p-1 rounded-none"
        >
          {Object.entries(COLUMN_LABELS)
            .filter(([key]) => !REQUIRED_COLUMNS.includes(key))
            .map(([key, label]) => {
              const isVisible = columnVisibility[key] !== false;

              return (
                <label
                  key={key}
                  className="flex items-center gap-2.5 px-3 py-2 hover:bg-[#F8F8F8] cursor-pointer transition-colors"
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
            className="flex h-9 w-9 items-center justify-center bg-white border border-gray-200 text-gray-600 hover:bg-[#F8F8F8] transition-colors"
            aria-label="More actions"
          >
            <Plus className="w-[17px] h-[17px]" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={8}
          className="w-[220px] bg-white border border-gray-200 shadow-md p-1 rounded-none"
        >
          {onQuickSaveView && (
            <DropdownMenuItem
              className="rounded-none"
              onClick={onQuickSaveView}
            >
              <Save className="w-4 h-4 mr-2" />
              Save Current View
            </DropdownMenuItem>
          )}

          {onExportFiltered && (
            <DropdownMenuItem
              className="rounded-none"
              onClick={onExportFiltered}
              disabled={exportDisabled}
            >
              <Download className="w-4 h-4 mr-2" />
              Export Filtered CSV
            </DropdownMenuItem>
          )}

          <DropdownMenuSeparator className="bg-gray-200" />

          <DropdownMenuItem
            className="rounded-none"
            onClick={() => onDensityChange('comfortable')}
          >
            <Rows3 className="w-4 h-4 mr-2" />
            Comfortable Density
            {density === 'comfortable' && <Check className="w-4 h-4 ml-auto" />}
          </DropdownMenuItem>

          <DropdownMenuItem
            className="rounded-none"
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
