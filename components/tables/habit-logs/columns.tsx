'use client';

import React, { memo, useCallback } from 'react';
import { format, parseISO } from 'date-fns';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { MoreHorizontal, CheckCircle2, SkipForward, XCircle, Pencil, Trash2, Eye, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { HabitLog } from '@/app/(dashboard)/activity/activity-client';

// Category colors matching your app's design
const CATEGORY_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  productivity: { bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500' },
  fitness: { bg: 'bg-green-50', text: 'text-green-700', dot: 'bg-green-500' },
  education: { bg: 'bg-purple-50', text: 'text-purple-700', dot: 'bg-purple-500' },
  experiments: { bg: 'bg-orange-50', text: 'text-orange-700', dot: 'bg-orange-500' },
  health: { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  wellness: { bg: 'bg-teal-50', text: 'text-teal-700', dot: 'bg-teal-500' },
  default: { bg: 'bg-gray-50', text: 'text-gray-700', dot: 'bg-gray-500' },
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
      <span className="text-sm text-gray-900 font-medium tabular-nums">
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
      <span className="text-sm text-gray-600 tabular-nums">
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
  icon 
}: { 
  habitName: string; 
  icon?: string;
}) => (
  <div className="flex items-center gap-2 min-w-0">
    {icon && <span className="text-base flex-shrink-0">{icon}</span>}
    <span className="text-sm text-gray-900 font-medium truncate">
      {habitName}
    </span>
  </div>
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
        <span className="text-sm text-gray-900 font-medium tabular-nums">
          {hours.toFixed(1)} hrs
        </span>
      );
    } else {
      return (
        <span className="text-sm text-gray-900 font-medium tabular-nums">
          {Math.round(minutes)} min
        </span>
      );
    }
  }
  
  if (amount !== undefined && amount > 0) {
    const unit = unitType || '';
    return (
      <span className="text-sm text-gray-900 font-medium tabular-nums">
        {amount.toFixed(amount < 10 ? 1 : 0)} {unit}
      </span>
    );
  }
  
  return <span className="text-sm text-gray-400">—</span>;
});
ValueCell.displayName = 'ValueCell';

export const CategoryCell = memo(({ category }: { category: string }) => {
  const colors = CATEGORY_COLORS[category.toLowerCase()] || CATEGORY_COLORS.default;
  
  return (
    <div className="flex items-center gap-2">
      <div className={cn('w-2 h-2 rounded-full', colors.dot)} />
      <span className={cn('text-xs font-medium capitalize', colors.text)}>
        {category}
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
      <span className={cn('text-xs font-medium', config.color)}>
        {config.label}
      </span>
    </div>
  );
});
StatusCell.displayName = 'StatusCell';

export const SourceCell = memo(({ source }: { source?: string }) => {
  const displaySource = source || 'manual';
  const isManual = displaySource.toLowerCase() === 'manual';
  
  return (
    <Badge 
      variant="secondary" 
      className={cn(
        "text-[10px] font-medium rounded-none capitalize",
        isManual 
          ? "bg-gray-100 text-gray-600" 
          : "bg-teal-50 text-teal-700"
      )}
    >
      {displaySource}
    </Badge>
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
        <span className="text-sm text-gray-600 truncate max-w-[150px] block cursor-help">
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

export const ActionsCell = memo(({
  log,
  onView,
  onEdit,
  onDelete,
  onCopyId,
}: {
  log: HabitLog;
  onView?: (id: string) => void;
  onEdit?: (id: string) => void;
  onDelete?: (id: string) => void;
  onCopyId?: (id: string) => void;
}) => {
  const handleView = useCallback(() => onView?.(log.id), [log.id, onView]);
  const handleEdit = useCallback(() => onEdit?.(log.id), [log.id, onEdit]);
  const handleDelete = useCallback(() => onDelete?.(log.id), [log.id, onDelete]);
  const handleCopyId = useCallback(() => onCopyId?.(log.id), [log.id, onCopyId]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button 
          variant="ghost" 
          className="h-8 w-8 p-0 hover:bg-gray-100"
        >
          <span className="sr-only">Open menu</span>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[160px] rounded-none">
        <DropdownMenuItem onClick={handleView} className="cursor-pointer">
          <Eye className="mr-2 h-4 w-4" />
          View details
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleEdit} className="cursor-pointer">
          <Pencil className="mr-2 h-4 w-4" />
          Edit
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleCopyId} className="cursor-pointer">
          <Copy className="mr-2 h-4 w-4" />
          Copy ID
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem 
          onClick={handleDelete} 
          className="cursor-pointer text-red-600 focus:text-red-600"
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
ActionsCell.displayName = 'ActionsCell';

