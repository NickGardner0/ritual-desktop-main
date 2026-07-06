'use client';

import React from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DEFAULT_ENERGY_BUDGET } from '@/types/kanban';

interface EnergyBudgetBarProps {
  used: number;
  budget?: number;
  className?: string;
}

export function EnergyBudgetBar({
  used,
  budget = DEFAULT_ENERGY_BUDGET,
  className,
}: EnergyBudgetBarProps) {
  const pct = Math.min(100, (used / budget) * 100);
  const isOver = used > budget;

  const barColor = isOver
    ? 'bg-destructive'
    : pct >= 80
      ? 'bg-amber-500'
      : pct >= 50
        ? 'bg-amber-400'
        : 'bg-green-500';

  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground uppercase tracking-wide">
          Energy Budget
        </span>
        <span
          className={cn(
            'font-medium',
            isOver ? 'text-destructive' : 'text-muted-foreground'
          )}
        >
          {used} / {budget}
          {isOver && (
            <AlertCircle
              className="ml-1 inline-block h-3 w-3"
              aria-label="Over budget"
            />
          )}
        </span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={budget}
      >
        <div
          className={cn('h-full transition-all duration-200', barColor)}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  );
}
