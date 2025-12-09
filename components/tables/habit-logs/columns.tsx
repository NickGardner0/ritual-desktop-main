'use client';

import React, { memo } from 'react';
import { format, parseISO } from 'date-fns';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { MoreHorizontal, CheckCircle2, SkipForward, XCircle, Brain, BookOpen, Activity, FlaskConical, Heart, Sparkles, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { HabitLog } from '@/app/(dashboard)/activity/activity-client';

// Category config with icons matching your app's design
const CATEGORY_CONFIG: Record<string, { icon: React.ComponentType<{ className?: string }>; color: string }> = {
  productivity: { icon: Brain, color: 'text-gray-900' },
  fitness: { icon: Activity, color: 'text-gray-900' },
  'fitness & health': { icon: Activity, color: 'text-gray-900' },
  education: { icon: BookOpen, color: 'text-gray-900' },
  learning: { icon: BookOpen, color: 'text-gray-900' },
  experiments: { icon: FlaskConical, color: 'text-gray-900' },
  health: { icon: Heart, color: 'text-gray-900' },
  wellness: { icon: Sparkles, color: 'text-gray-900' },
  custom: { icon: Plus, color: 'text-gray-900' },
  manual: { icon: Plus, color: 'text-gray-900' },
  default: { icon: Plus, color: 'text-gray-900' },
};

const STATUS_CONFIG = {
  completed: {
    icon: CheckCircle2,
    color: 'text-emerald-600',
    bg: 'bg-emerald-50',
    label: 'Completed',
  },
  skipped: {
    icon: SkipForward,
    color: 'text-amber-600',
    bg: 'bg-amber-50',
    label: 'Skipped',
  },
  missed: {
    icon: XCircle,
    color: 'text-red-600',
    bg: 'bg-red-50',
    label: 'Missed',
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
  try {
    const parsed = parseISO(date);
    return (
      <span className="text-sm text-gray-900 font-normal tabular-nums">
        {format(parsed, 'MMM d')}
      </span>
    );
  } catch {
    return <span className="text-sm text-gray-400">—</span>;
  }
});
DateCell.displayName = 'DateCell';

export const TimeCell = memo(({ completedAt }: { completedAt?: string }) => {
  if (!completedAt) {
    return <span className="text-sm text-gray-400">—</span>;
  }
  
  try {
    // Handle different timestamp formats
    let date: Date;
    if (completedAt.includes('T')) {
      date = parseISO(completedAt);
    } else if (completedAt.includes(' ')) {
      date = new Date(completedAt.replace(' ', 'T') + 'Z');
    } else {
      return <span className="text-sm text-gray-400">{completedAt}</span>;
    }
    
    return (
      <span className="text-sm text-gray-900 font-normal tabular-nums">
        {format(date, 'h:mm a')}
      </span>
    );
  } catch {
    return <span className="text-sm text-gray-400">—</span>;
  }
});
TimeCell.displayName = 'TimeCell';

export const HabitCell = memo(({ 
  habitName, 
}: { 
  habitName: string; 
  icon?: string;
}) => (
  <span className="text-sm text-gray-900 truncate">
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

export const CategoryCell = memo(({ category }: { category: string }) => {
  const config = CATEGORY_CONFIG[category.toLowerCase()] || CATEGORY_CONFIG.default;
  const Icon = config.icon;
  
  // Normalize category text: "PRODUCTIVITY" or "productivity" -> "Productivity"
  const normalizedCategory = category
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
  
  return (
    <div className="flex items-center gap-2.5 whitespace-nowrap">
      <Icon className={cn('w-4 h-4 shrink-0', config.color)} />
      <span className="text-sm font-normal text-gray-900">
        {normalizedCategory}
      </span>
    </div>
  );
});
CategoryCell.displayName = 'CategoryCell';

export const StatusCell = memo(({ status }: { status: 'completed' | 'skipped' | 'missed' }) => {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.completed;
  const Icon = config.icon;
  
  return (
    <div className="flex items-center gap-1.5">
      <Icon className={cn('w-4 h-4', config.color)} />
      <span className="text-xs font-normal text-gray-900">
        {config.label}
      </span>
    </div>
  );
});
StatusCell.displayName = 'StatusCell';

export const SourceCell = memo(({ source }: { source?: string }) => {
  const displaySource = source || 'manual';
  
  return (
    <span className="text-sm text-gray-900 font-normal capitalize">
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
  return (
    <div className="flex items-center justify-center">
      <MoreHorizontal className="h-4 w-4 text-gray-400" />
    </div>
  );
});
ActionsCell.displayName = 'ActionsCell';

