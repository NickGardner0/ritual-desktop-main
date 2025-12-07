'use client';

import React from 'react';
import { Settings2, ChevronDown, Trash2, Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

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
  selectedCount: number;
  onDelete: () => void;
  isDeleting: boolean;
  onClearSelection: () => void;
}

export function HabitLogsActions({
  columnVisibility,
  onColumnVisibilityChange,
  selectedCount,
  onDelete,
  isDeleting,
  onClearSelection,
}: Props) {
  // If rows are selected, show bulk actions
  if (selectedCount > 0) {
    return (
      <AlertDialog>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-600">
            <span className="font-medium text-gray-900">{selectedCount}</span> selected
          </span>
          
          <div className="h-6 w-px bg-gray-300" />
          
          <div className="flex items-center gap-2">
            {/* Export Button */}
            <Button
              variant="outline"
              size="sm"
              className="rounded-none gap-1.5"
              onClick={() => {
                // TODO: Implement export
                console.log('Export selected');
              }}
            >
              <Download className="w-4 h-4" />
              Export
            </Button>
            
            {/* Delete Button */}
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="rounded-none border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 gap-1.5"
              >
                <Trash2 className="w-4 h-4" />
                Delete
              </Button>
            </AlertDialogTrigger>
            
            {/* Clear Selection */}
            <Button
              variant="ghost"
              size="sm"
              className="rounded-none text-gray-500"
              onClick={onClearSelection}
            >
              Clear
            </Button>
          </div>
        </div>

        {/* Delete Confirmation Dialog */}
        <AlertDialogContent className="rounded-none">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedCount} log{selectedCount > 1 ? 's' : ''}?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The selected habit log{selectedCount > 1 ? 's' : ''} will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-none">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDelete}
              className="rounded-none bg-red-600 hover:bg-red-700 text-white"
              disabled={isDeleting}
            >
              {isDeleting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Deleting...
                </>
              ) : (
                'Delete'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  // Default: show column visibility toggle
  return (
    <div className="flex items-center gap-2">
      {/* Column Visibility Dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="rounded-none gap-1.5 border-gray-300"
          >
            <Settings2 className="w-4 h-4" />
            Columns
            <ChevronDown className="w-3.5 h-3.5 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-[180px] rounded-none"
        >
          <DropdownMenuLabel className="text-xs text-gray-500 font-normal">
            Toggle columns
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {Object.entries(COLUMN_LABELS).map(([key, label]) => {
            const isRequired = REQUIRED_COLUMNS.includes(key);
            const isVisible = columnVisibility[key] !== false;
            
            return (
              <DropdownMenuCheckboxItem
                key={key}
                checked={isVisible}
                disabled={isRequired}
                onCheckedChange={(checked) => {
                  onColumnVisibilityChange({
                    ...columnVisibility,
                    [key]: checked,
                  });
                }}
                className={cn(
                  'cursor-pointer',
                  isRequired && 'opacity-50 cursor-not-allowed'
                )}
              >
                {label}
              </DropdownMenuCheckboxItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Add Log Button (placeholder for future) */}
      <Button
        size="sm"
        className="rounded-none bg-gray-900 hover:bg-gray-800"
        onClick={() => {
          // TODO: Open add log modal
          console.log('Add log');
        }}
      >
        + Add Log
      </Button>
    </div>
  );
}

