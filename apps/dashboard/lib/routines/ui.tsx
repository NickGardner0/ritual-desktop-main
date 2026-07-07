'use client';

import React from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  BookOpen,
  CalendarRange,
  Code,
  Dumbbell,
  Footprints,
  Loader2,
  MonitorSmartphone,
  Moon,
  Radar,
  Sparkles,
  Sunrise,
} from 'lucide-react';

import { cn } from '@/lib/utils';

import type { RoutineDataSourceKey } from './model';

// Status colors for this surface (match the greens/ambers already used by the
// Tasks/Routines shell; red mirrors the shadcn destructive token family).
export const ROUTINE_STATUS_COLORS = {
  success: '#167046',
  failure: '#b3261e',
  warning: '#b45309',
  neutral: '#8a929c',
} as const;

const ICONS: Record<string, LucideIcon> = {
  'sunrise': Sunrise,
  'dumbbell': Dumbbell,
  'monitor-smartphone': MonitorSmartphone,
  'code': Code,
  'book-open': BookOpen,
  'calendar-range': CalendarRange,
  'radar': Radar,
  'sparkles': Sparkles,
};

export function routineIcon(key: string | null | undefined): LucideIcon {
  return (key && ICONS[key]) || Sparkles;
}

/** Renders the lucide icon for a routine icon key (keys map to a static set). */
export function RoutineIcon({ name, className }: { name: string | null | undefined; className?: string }) {
  return React.createElement(routineIcon(name), { className });
}

const DATA_SOURCE_ICONS: Record<RoutineDataSourceKey, LucideIcon> = {
  sleep: Moon,
  workouts: Dumbbell,
  steps: Footprints,
  screen_time: MonitorSmartphone,
  coding: Code,
  reading: BookOpen,
  calendar: CalendarRange,
};

export function dataSourceIcon(key: string): LucideIcon | null {
  return DATA_SOURCE_ICONS[key as RoutineDataSourceKey] || null;
}

export type RunStatusKind = 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped';

export function RunStatusDot({ status, className }: { status: RunStatusKind; className?: string }) {
  if (status === 'running') {
    return <Loader2 className={cn('h-3.5 w-3.5 animate-spin text-[#69727d]', className)} aria-label="Running" />;
  }
  const color = status === 'succeeded'
    ? ROUTINE_STATUS_COLORS.success
    : status === 'failed'
      ? ROUTINE_STATUS_COLORS.failure
      : ROUTINE_STATUS_COLORS.neutral;
  return (
    <span
      aria-label={status}
      className={cn('inline-block h-2 w-2 shrink-0 rounded-full', className)}
      style={{ backgroundColor: color, opacity: status === 'skipped' || status === 'queued' ? 0.55 : 1 }}
    />
  );
}

export function PausedPill({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center rounded-full border border-[rgba(15,23,42,0.10)] bg-white/70 px-2 text-[11px] font-[640] text-[#6a717b]',
        className,
      )}
    >
      Paused
    </span>
  );
}

export function DataSourceIcons({ sources, className }: { sources: string[]; className?: string }) {
  const icons = sources
    .map((key) => ({ key, Icon: dataSourceIcon(key) }))
    .filter((entry): entry is { key: string; Icon: LucideIcon } => Boolean(entry.Icon));
  if (!icons.length) return null;
  return (
    <span className={cn('flex items-center gap-1.5', className)}>
      {icons.map(({ key, Icon }) => (
        <Icon key={key} className="h-3.5 w-3.5 text-[#8a929c]" aria-label={key.replace(/_/g, ' ')} />
      ))}
    </span>
  );
}
