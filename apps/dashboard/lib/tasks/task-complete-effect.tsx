'use client';

import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { ShimmeringText } from '@/components/ui/shimmering-text';

/** One fast graphite sweep, then a 160ms collapse. Total hold is short on purpose. */
export const TASK_COMPLETE_SHIMMER_S = 0.28;
export const TASK_COMPLETE_EXIT_MS = 160;
export const TASK_COMPLETE_HOLD_MS = Math.round(TASK_COMPLETE_SHIMMER_S * 1000) + TASK_COMPLETE_EXIT_MS;
export const TASK_COMPLETE_REDUCED_MOTION_HOLD_MS = 80;

export function taskCompleteHoldMs(): number {
  if (typeof window === 'undefined') return TASK_COMPLETE_HOLD_MS;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? TASK_COMPLETE_REDUCED_MOTION_HOLD_MS
    : TASK_COMPLETE_HOLD_MS;
}

export function TaskCompleteShell({
  completing,
  className,
  children,
}: {
  completing: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn(completing && 'ritual-task-completing', className)}>
      {children}
    </div>
  );
}

export function TaskCompleteTitle({
  title,
  className,
}: {
  title: string;
  className?: string;
}) {
  return (
    <ShimmeringText
      text={title}
      duration={TASK_COMPLETE_SHIMMER_S}
      delay={0}
      repeat={false}
      startOnView={false}
      once
      spread={2.2}
      color="var(--text-muted)"
      shimmerColor="var(--text-primary)"
      className={className}
    />
  );
}
