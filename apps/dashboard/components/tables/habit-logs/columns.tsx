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
import type { HabitLog } from '@/app/(dashboard)/activity/activity-client';

const CATEGORY_CONFIG: Record<string, { swatchClass: string }> = {
  productivity: { swatchClass: 'bg-sky-400' },
  fitness: { swatchClass: 'bg-emerald-400' },
  'fitness & health': { swatchClass: 'bg-emerald-400' },
  education: { swatchClass: 'bg-indigo-400' },
  learning: { swatchClass: 'bg-indigo-400' },
  experiments: { swatchClass: 'bg-violet-400' },
  health: { swatchClass: 'bg-rose-400' },
  wellness: { swatchClass: 'bg-teal-400' },
  custom: { swatchClass: 'bg-amber-400' },
  manual: { swatchClass: 'bg-amber-400' },
  default: { swatchClass: 'bg-gray-400' },
};

const STATUS_CONFIG = {
  completed: {
    label: 'Completed',
    dotClass: 'bg-emerald-500',
  },
  skipped: {
    label: 'Skipped',
    dotClass: 'bg-amber-500',
  },
  missed: {
    label: 'Missed',
    dotClass: 'bg-rose-500',
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
      className="rounded-none border-gray-400 data-[state=checked]:bg-gray-900 data-[state=checked]:border-gray-900"
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
    <span className={isValidDate ? 'text-sm text-gray-900 font-normal tabular-nums whitespace-nowrap' : 'text-sm text-gray-400 whitespace-nowrap'}>
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
      const date = parseISO(completedAt);
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
    <span className={isFormattedTime ? 'text-sm text-gray-900 font-normal tabular-nums whitespace-nowrap' : 'text-sm text-gray-400 whitespace-nowrap'}>
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
  <span className="text-sm text-gray-900 truncate block">
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
        <span className="text-sm text-gray-900 font-normal tabular-nums">
          {hours.toFixed(1)} Hours
        </span>
      );
    } else {
      return (
        <span className="text-sm text-gray-900 font-normal tabular-nums">
          {Math.round(minutes)} Minutes
        </span>
      );
    }
  }
  
  if (amount !== undefined && amount > 0) {
    const unit = unitType || '';
    return (
      <span className="text-sm text-gray-900 font-normal tabular-nums">
        {amount.toFixed(amount < 10 ? 1 : 0)} {unit}
      </span>
    );
  }
  
  return <span className="text-sm text-gray-400">—</span>;
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
  const config = CATEGORY_CONFIG[category.toLowerCase()] || CATEGORY_CONFIG.default;
  
  // Normalize category text: "PRODUCTIVITY" or "productivity" -> "Productivity"
  const normalizedCategory = category
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
  
  return (
    <div className="flex items-center gap-2 whitespace-nowrap min-w-0">
      <span className={cn('w-2.5 h-2.5 shrink-0', config.swatchClass)} />
      <span className="text-sm font-normal text-gray-900 truncate block">
        {normalizedCategory}
      </span>
    </div>
  );
});
CategoryCell.displayName = 'CategoryCell';

export const StatusCell = memo(({ status }: { status: 'completed' | 'skipped' | 'missed' }) => {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.completed;
  
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className={cn('w-2 h-2 shrink-0', config.dotClass)} />
      <span className="text-sm font-normal text-gray-900 truncate">
        {config.label}
      </span>
    </div>
  );
});
StatusCell.displayName = 'StatusCell';

export const SourceCell = memo(({ source }: { source?: string }) => {
  const displaySource = source || 'manual';
  
  return (
    <span className="text-sm text-gray-900 font-normal capitalize truncate block min-w-0">
      {displaySource}
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
        <span className="text-sm text-gray-900 font-normal truncate max-w-[150px] block cursor-help">
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
          className="h-7 w-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 border border-transparent hover:border-gray-300 text-gray-400 hover:text-gray-700 transition-opacity flex items-center justify-center"
          aria-label="Log actions"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[200px] rounded-none border-gray-300">
        <DropdownMenuItem
          className="rounded-none"
          onClick={() => copyToClipboard(log.habit_name)}
        >
          <Copy className="w-3.5 h-3.5 mr-2" />
          Copy habit name
        </DropdownMenuItem>
        <DropdownMenuItem
          className="rounded-none"
          onClick={() => copyToClipboard(formatLogValue(log))}
        >
          <Copy className="w-3.5 h-3.5 mr-2" />
          Copy value
        </DropdownMenuItem>
        {log.notes && log.notes !== 'none' && (
          <DropdownMenuItem
            className="rounded-none"
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
