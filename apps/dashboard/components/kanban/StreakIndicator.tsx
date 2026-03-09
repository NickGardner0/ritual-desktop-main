'use client';

import React from 'react';
import { Flame } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StreakIndicatorProps {
  streak: number;
  className?: string;
}

const MILESTONE_STYLES: Record<number, string> = {
  7: 'text-orange-500',
  30: 'text-orange-600',
  100: 'text-amber-600',
};

export function StreakIndicator({ streak, className }: StreakIndicatorProps) {
  if (streak <= 0) return null;

  const milestone = [100, 30, 7].find((m) => streak >= m);
  const colorClass = milestone ? MILESTONE_STYLES[milestone] : 'text-orange-500';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-xs',
        colorClass,
        className
      )}
      title={`${streak} day streak`}
    >
      <Flame className="h-3 w-3" aria-hidden />
      <span>{streak}</span>
    </span>
  );
}
