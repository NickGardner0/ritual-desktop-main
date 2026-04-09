'use client';

import React, { memo } from 'react';
import { format, parseISO } from 'date-fns';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  MoreHorizontal,
  Copy,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  getCategoryFillClass,
  normalizeCategoryLabel,
} from '@/lib/category-token';
import { formatSourceLabel } from '@/lib/source-label';
import type { HabitLog } from '@/app/(dashboard)/activity/logs-client';

const STATUS_CONFIG = {
  completed: {
    label: 'Completed',
    dotClass: 'bg-emerald-500',
    badgeClass: 'bg-emerald-50 text-emerald-700 ring-emerald-200/80',
  },
  skipped: {
    label: 'Skipped',
    dotClass: 'bg-amber-500',
    badgeClass: 'bg-amber-50 text-amber-700 ring-amber-200/80',
  },
  missed: {
    label: 'Missed',
    dotClass: 'bg-rose-500',
    badgeClass: 'bg-rose-50 text-rose-700 ring-rose-200/80',
  },
};

// Cell Components (Memoized for performance)

export const SelectCell = memo(({
  checked,
  onChange,
  onShiftClick,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  onShiftClick?: () => void;
}) => (
  <div
    onClick={(e) => {
      if (e.shiftKey && onShiftClick) {
        e.preventDefault();
        e.stopPropagation();
        onShiftClick();
      }
    }}
    className="flex items-center justify-center"
  >
    <Checkbox
      checked={checked}
      onCheckedChange={onChange}
      className="rounded-none border-black/15 data-[state=checked]:border-neutral-900 data-[state=checked]:bg-neutral-900"
    />
  </div>
));
SelectCell.displayName = 'SelectCell';

export const DateCell = memo(({ date }: { date: string }) => {
  let displayDate = '—';
  let isValidDate = false;

  try {
    const parsed = parseISO(date);
    displayDate = format(parsed, 'MMM d');
    isValidDate = true;
  } catch {
    // Ignore parse failures and render fallback text.
  }

  return (
    <span
      className={
        isValidDate
          ? 'whitespace-nowrap text-[13px] font-normal tabular-nums text-neutral-900'
          : 'whitespace-nowrap text-[13px] text-neutral-400'
      }
    >
      {displayDate}
    </span>
  );
});
DateCell.displayName = 'DateCell';

export const TimeCell = memo(({ completedAt }: { completedAt?: string }) => {
  let displayTime = '—';
  let isFormattedTime = false;

  try {
    if (!completedAt) {
      displayTime = '—';
    } else if (completedAt.includes('T')) {
      const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/.test(completedAt);
      const normalized = hasTimezone ? completedAt : `${completedAt}Z`;
      const date = parseISO(normalized);
      if (Number.isFinite(date.getTime())) {
        displayTime = format(date, 'h:mm a');
        isFormattedTime = true;
      }
    } else if (completedAt.includes(' ')) {
      const date = new Date(completedAt.replace(' ', 'T') + 'Z');
      if (Number.isFinite(date.getTime())) {
        displayTime = format(date, 'h:mm a');
        isFormattedTime = true;
      }
    } else {
      displayTime = completedAt;
    }
  } catch {
    displayTime = '—';
    isFormattedTime = false;
  }

  return (
    <span
      className={
        isFormattedTime
          ? 'whitespace-nowrap text-[13px] tabular-nums text-neutral-700'
          : 'whitespace-nowrap text-[13px] text-neutral-400'
      }
    >
      {displayTime}
    </span>
  );
});
TimeCell.displayName = 'TimeCell';

export const HabitCell = memo(({ 
  habitName, 
}: { 
  habitName: string; 
  icon?: string;
}) => (
  <span className="block truncate text-[14px] font-normal text-neutral-900">
    {habitName}
  </span>
));
HabitCell.displayName = 'HabitCell';

export const ValueCell = memo(({ 
  duration, 
  amount, 
  unitType 
}: { 
  duration?: number; 
  amount?: number;
  unitType?: string;
}) => {
  // Format value based on what's available
  if (duration && duration > 0) {
    const hours = duration / 3600;
    const minutes = duration / 60;
    
    if (hours >= 1) {
      return (
        <span className="block max-w-full truncate whitespace-nowrap text-[14px] font-normal tabular-nums text-neutral-900">
          {hours.toFixed(1)} Hours
        </span>
      );
    } else {
      return (
        <span className="block max-w-full truncate whitespace-nowrap text-[14px] font-normal tabular-nums text-neutral-900">
          {Math.round(minutes)} Minutes
        </span>
      );
    }
  }
  
  if (amount !== undefined && amount > 0) {
    const unit = unitType || '';
    return (
      <span className="block max-w-full truncate whitespace-nowrap text-[14px] font-normal tabular-nums text-neutral-900">
        {amount.toFixed(amount < 10 ? 1 : 0)} {unit}
      </span>
    );
  }
  
  return <span className="block max-w-full truncate whitespace-nowrap text-[14px] text-neutral-400">—</span>;
});
ValueCell.displayName = 'ValueCell';

function formatLogValue(log: HabitLog): string {
  if (log.duration && log.duration > 0) {
    const hours = log.duration / 3600;
    if (hours >= 1) return `${hours.toFixed(1)} Hours`;
    return `${Math.round(log.duration / 60)} Minutes`;
  }

  if (log.amount !== undefined && log.amount > 0) {
    const amountString = log.amount.toFixed(log.amount < 10 ? 1 : 0);
    return `${amountString} ${log.unit_type || ''}`.trim();
  }

  return '—';
}

export const CategoryCell = memo(({ category }: { category: string }) => {
  const normalizedCategory = normalizeCategoryLabel(category);

  return (
    <div className="flex min-w-0 items-center gap-2">
      <span
        className={cn(
          'inline-block h-3 w-3 shrink-0 rounded-none',
          getCategoryFillClass(category),
        )}
        style={{ marginTop: '-1px' }}
      />
      <span className="block truncate text-[14px] font-normal leading-none text-neutral-900">
        {normalizedCategory}
      </span>
    </div>
  );
});
CategoryCell.displayName = 'CategoryCell';

export const StatusCell = memo(({ status }: { status: 'completed' | 'skipped' | 'missed' }) => {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.completed;
  
  return (
    <div className="flex min-w-0 items-center">
      <span
        className={cn(
          'inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[12px] font-normal ring-1 ring-inset',
          config.badgeClass,
        )}
      >
        <span className={cn('h-1.5 w-1.5 rounded-full', config.dotClass)} />
        {config.label}
      </span>
    </div>
  );
});
StatusCell.displayName = 'StatusCell';

export const SourceCell = memo(({ source, habitName }: { source?: string; habitName?: string }) => {
  const displaySource = source || 'manual';

  return (
    <span className="block min-w-0 truncate text-[14px] font-normal text-neutral-900">
      {formatSourceLabel(displaySource, habitName)}
    </span>
  );
});
SourceCell.displayName = 'SourceCell';

export const NotesCell = memo(({ notes }: { notes?: string }) => {
  if (!notes || notes === 'none') {
    return <span className="text-sm text-gray-400">—</span>;
  }
  
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="block max-w-[150px] cursor-help truncate text-[14px] text-neutral-700">
          {notes}
        </span>
      </TooltipTrigger>
      <TooltipContent 
        side="top" 
        className="max-w-[300px] text-xs"
      >
        {notes}
      </TooltipContent>
    </Tooltip>
  );
});
NotesCell.displayName = 'NotesCell';

export const ActionsCell = memo(({ log }: { log: HabitLog }) => {
  const copyToClipboard = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch (error) {
      console.error('Failed to copy log value:', error);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-7 w-7 items-center justify-center text-neutral-600 transition-colors hover:text-neutral-900 focus-visible:text-neutral-900"
          aria-label="Log actions"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-[200px] rounded-sm border border-black/10 bg-white p-1 shadow-[0_18px_30px_-24px_rgba(15,23,42,0.35)]"
      >
        <DropdownMenuItem
          className="rounded-sm"
          onClick={() => copyToClipboard(log.habit_name)}
        >
          <Copy className="w-3.5 h-3.5 mr-2" />
          Copy habit name
        </DropdownMenuItem>
        <DropdownMenuItem
          className="rounded-sm"
          onClick={() => copyToClipboard(formatLogValue(log))}
        >
          <Copy className="w-3.5 h-3.5 mr-2" />
          Copy value
        </DropdownMenuItem>
        {log.notes && log.notes !== 'none' && (
          <DropdownMenuItem
            className="rounded-sm"
            onClick={() => copyToClipboard(log.notes || '')}
          >
            <Copy className="w-3.5 h-3.5 mr-2" />
            Copy notes
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
ActionsCell.displayName = 'ActionsCell';
