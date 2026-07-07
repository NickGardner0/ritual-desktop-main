'use client';

import { useEffect, useState } from 'react';

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** One shared ticking clock for all live relative times (no per-row intervals). */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function clockTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
}

function monthDay(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

/** "in 25m", "in 2h", "Mon 8:00 AM", "Jul 15, 9:00 AM" — for upcoming instants. */
export function formatUpcoming(value: string | Date | null | undefined, now: Date): string {
  const date = toDate(value);
  if (!date) return '';
  const delta = date.getTime() - now.getTime();
  if (delta <= 0) return 'now';
  if (delta < MINUTE) return 'in under a minute';
  if (delta < HOUR) return `in ${Math.round(delta / MINUTE)}m`;
  if (delta < 12 * HOUR) return `in ${Math.round(delta / HOUR)}h`;
  if (delta < 7 * DAY) return `${WEEKDAY_SHORT[date.getDay()]} ${clockTime(date)}`;
  return `${monthDay(date)}, ${clockTime(date)}`;
}

/** "just now", "3m ago", "3h ago", "yesterday", "Jul 5" — for past instants. */
export function formatAgo(value: string | Date | null | undefined, now: Date): string {
  const date = toDate(value);
  if (!date) return '';
  const delta = now.getTime() - date.getTime();
  if (delta < MINUTE) return 'just now';
  if (delta < HOUR) return `${Math.round(delta / MINUTE)}m ago`;
  if (delta < 24 * HOUR) return `${Math.round(delta / HOUR)}h ago`;
  if (delta < 2 * DAY) return 'yesterday';
  if (delta < 7 * DAY) return `${Math.round(delta / DAY)}d ago`;
  return monthDay(date);
}

export function formatAbsolute(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

/** Short date for occurrence previews: "7/8" this year, "5/26/2027" otherwise. */
export function formatOccurrence(date: Date, now: Date): string {
  const sameYear = date.getFullYear() === now.getFullYear();
  return sameYear
    ? `${date.getMonth() + 1}/${date.getDate()}`
    : `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

/** "Today", "Yesterday", or "July 5" — sticky day-group headers. */
export function dayGroupLabel(value: string | Date, now: Date): string {
  const date = toDate(value);
  if (!date) return '';
  const startOf = (input: Date) => new Date(input.getFullYear(), input.getMonth(), input.getDate()).getTime();
  const dayDelta = Math.round((startOf(now) - startOf(date)) / DAY);
  if (dayDelta === 0) return 'Today';
  if (dayDelta === 1) return 'Yesterday';
  return new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric' }).format(date);
}

export function formatDuration(startedAt: string | null, finishedAt: string | null): string {
  const start = toDate(startedAt);
  const end = toDate(finishedAt);
  if (!start || !end) return '';
  const ms = Math.max(0, end.getTime() - start.getTime());
  if (ms < 1000) return '<1s';
  if (ms < MINUTE) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / MINUTE)}m ${Math.round((ms % MINUTE) / 1000)}s`;
}
