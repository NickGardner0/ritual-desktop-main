'use client';

import { formatISO, parseISO } from 'date-fns';
import React, { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import {
  DropdownMenuCheckboxItem,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { Calendar } from '@/components/ui/calendar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { FilterState } from '@/components/habit-logs/types';

export type ArrayFilterKey = 'categories' | 'habits' | 'statuses' | 'sources';

export type AppliedFilterChip = {
  id: string;
  label: string;
  onRemove: () => void;
};

export const STATUS_OPTIONS = [
  { id: 'completed', label: 'Completed' },
  { id: 'skipped', label: 'Skipped' },
  { id: 'missed', label: 'Missed' },
] as const;

export const DATE_PRESET_OPTIONS = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: '90d', label: 'Last 90 days' },
  { id: 'clear', label: 'Clear range' },
] as const;

export function colorFromLabel(label: string) {
  let hash = 0;
  for (let index = 0; index < label.length; index += 1) {
    hash = label.charCodeAt(index) + ((hash << 5) - hash);
  }
  return `hsl(${Math.abs(hash) % 360} 55% 48%)`;
}

export function toLocalDateString(date: Date): string {
  return date.toLocaleDateString('en-CA');
}

function formatDateLabel(value: string) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

export function formatDateRangeLabel(start: string | null, end: string | null) {
  if (!start && !end) return null;
  if (start && end && start === end) return formatDateLabel(start);
  if (start && end) return `${formatDateLabel(start)} - ${formatDateLabel(end)}`;
  if (start) return `From ${formatDateLabel(start)}`;
  return end ? `Until ${formatDateLabel(end)}` : null;
}

export function updateArrayFilter(
  value: string,
  currentValues: string[] | null | undefined,
  onFilterChange: (filters: Partial<FilterState>) => void,
  key: ArrayFilterKey,
) {
  const normalizedValues = currentValues ?? null;
  const nextValues = normalizedValues?.includes(value)
    ? normalizedValues.filter((item) => item !== value).length > 0
      ? normalizedValues.filter((item) => item !== value)
      : null
    : [...(normalizedValues ?? []), value];

  onFilterChange({ [key]: nextValues } as Partial<FilterState>);
}
