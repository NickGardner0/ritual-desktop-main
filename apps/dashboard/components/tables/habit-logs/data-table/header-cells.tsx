'use client';

import React, { useState, useCallback } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@/components/ui/button';
import { ArrowDown, ArrowUp, ChevronDown, Check } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { BrailleSpinner } from '@/components/ui/braille-spinner';
import { DateCell, SourceCell } from '../columns';
import type { TableDensity } from '@/components/habit-logs/types';
import { PINNED_COLUMNS, type ColumnAlign } from './constants';

export function SortableHeaderCell({
  columnId,
  children,
  className,
  style,
}: {
  columnId: string;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const isPinned = PINNED_COLUMNS.has(columnId);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: columnId,
    disabled: isPinned,
  });

  const dragStyle: React.CSSProperties = {
    ...style,
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : undefined,
    zIndex: isDragging ? 40 : (style?.zIndex as number | undefined),
    cursor: isPinned ? 'default' : 'grab',
  };

  return (
    <div
      ref={setNodeRef}
      role="columnheader"
      className={className}
      style={dragStyle}
      {...(isPinned ? {} : { ...attributes, ...listeners })}
    >
      {children}
    </div>
  );
}

export function SortButton({
  column,
  sortColumn,
  sortDirection,
  align,
  onSort,
  hideIndicator = false,
  children,
}: {
  column: string;
  sortColumn: string | null;
  sortDirection: 'asc' | 'desc';
  align: ColumnAlign;
  onSort: (column: string) => void;
  hideIndicator?: boolean;
  children: React.ReactNode;
}) {
  const isActive = sortColumn === column;

  return (
    <Button
      variant="ghost"
      className={cn(
        'flex h-auto w-full items-center gap-1 p-0 text-[14px] font-normal tracking-normal text-neutral-700 hover:bg-transparent hover:text-neutral-900',
        align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start',
      )}
      onClick={() => onSort(column)}
    >
      <span className="truncate">{children}</span>
      {isActive && !hideIndicator ? (
        sortDirection === 'asc' ? (
          <ArrowUp className="w-3 h-3 text-gray-500" />
        ) : (
          <ArrowDown className="w-3 h-3 text-gray-500" />
        )
      ) : null}
    </Button>
  );
}

export function InlineDateEditor({
  date,
  completedAt,
  integrationSource,
  metricType,
  timePrecision,
  density,
  isUpdating,
  onSave,
}: {
  date: string;
  completedAt?: string;
  integrationSource?: string;
  metricType?: string;
  timePrecision?: 'exact' | 'day';
  density: TableDensity;
  isUpdating: boolean;
  onSave: (nextDate: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draftDate, setDraftDate] = useState(date);
  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setDraftDate(date);
    }
  }, [date]);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(event) => event.stopPropagation()}
          className={cn(
            'group inline-flex w-full min-w-0 items-center justify-between gap-2 text-left text-sm text-gray-700 hover:text-gray-900',
            density === 'compact' ? 'h-6' : 'h-7',
          )}
          disabled={isUpdating}
        >
          <span className="min-w-0 truncate block">
            <DateCell
              date={date}
              completed_at={completedAt}
              integration_source={integrationSource}
              metric_type={metricType}
              time_precision={timePrecision}
            />
          </span>
          {isUpdating ? (
            <BrailleSpinner className="text-sm text-gray-500" />
          ) : (
            <ChevronDown
              className={cn(
                'w-3.5 h-3.5 shrink-0 text-gray-400 transition-opacity',
                open ? 'opacity-70' : 'opacity-0 group-hover:opacity-70',
              )}
            />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[220px] p-2"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="space-y-2">
          <input
            type="date"
            value={draftDate}
            onChange={(event) => setDraftDate(event.target.value)}
            className="h-8 w-full rounded-sm border border-black/10 bg-white px-3 text-sm outline-none"
          />
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="h-7 rounded-sm border border-black/10 px-3 text-xs text-neutral-700 hover:bg-neutral-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                if (!draftDate || draftDate === date) {
                  setOpen(false);
                  return;
                }
                onSave(draftDate);
                setOpen(false);
              }}
              disabled={isUpdating || !draftDate}
              className="h-7 rounded-sm border border-neutral-900 bg-neutral-900 px-3 text-xs text-white disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function InlineSourceEditor({
  source,
  habitName,
  sourceOptions,
  density,
  isUpdating,
  onSelect,
}: {
  source?: string;
  habitName?: string;
  sourceOptions: string[];
  density: TableDensity;
  isUpdating: boolean;
  onSelect: (nextSource: string) => void;
}) {
  const currentSource = source || 'manual';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onClick={(event) => event.stopPropagation()}
          className={cn(
            'group inline-flex w-full min-w-0 items-center justify-between gap-2 text-left text-gray-700 hover:text-gray-900',
            density === 'compact' ? 'h-6' : 'h-7',
          )}
          disabled={isUpdating}
        >
          <span className="min-w-0">
            <SourceCell source={currentSource} habitName={habitName} />
          </span>
          {isUpdating ? (
            <BrailleSpinner className="text-sm text-gray-500" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 shrink-0 text-gray-400 opacity-0 transition-opacity group-hover:opacity-70" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-[190px]"
      >
        {sourceOptions.map((option) => (
          <DropdownMenuItem
            key={option}
            onClick={() => {
              if (option !== currentSource) {
                onSelect(option);
              }
            }}
          >
            <span className="flex-1 capitalize text-sm text-gray-900">{option}</span>
            {option === currentSource && <Check className="w-3.5 h-3.5 text-gray-700" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
