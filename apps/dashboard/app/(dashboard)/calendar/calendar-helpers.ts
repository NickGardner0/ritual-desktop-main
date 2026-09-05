import {
  addDays,
  endOfMonth,
  isSameMonth,
  isSameYear,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns';

import type { CalendarView } from '@ritual/shared-contracts';

export type VisibleRange = { start: Date; end: Date };

export function calendarVisibleRange(date: Date, view: CalendarView, weekStartsOn: 0 | 1): VisibleRange {
  if (view === 'month') {
    return {
      start: startOfWeek(startOfMonth(date), { weekStartsOn }),
      end: addDays(startOfWeek(endOfMonth(date), { weekStartsOn }), 7),
    };
  }
  if (view === 'week') {
    return {
      start: startOfWeek(date, { weekStartsOn }),
      end: addDays(startOfWeek(date, { weekStartsOn }), 7),
    };
  }
  return { start: startOfDay(date), end: addDays(startOfDay(date), 1) };
}

export function rangeContainsDate(range: VisibleRange, date: Date) {
  return date >= range.start && date < range.end;
}

export function calendarPeriodLabel(range: VisibleRange, view: CalendarView, locale?: string) {
  const lastVisibleDate = addDays(range.end, -1);
  const month = (value: Date) => value.toLocaleDateString(locale, { month: 'long' });
  if (view === 'day') {
    return range.start.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  }
  if (isSameMonth(range.start, lastVisibleDate)) {
    return range.start.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  }
  if (isSameYear(range.start, lastVisibleDate)) {
    return `${month(range.start)} – ${month(lastVisibleDate)} ${lastVisibleDate.getFullYear()}`;
  }
  return `${month(range.start)} ${range.start.getFullYear()} – ${month(lastVisibleDate)} ${lastVisibleDate.getFullYear()}`;
}

export function defaultTimedSelection(
  date: Date,
  workdayStartMinutes: number,
  defaultDurationMinutes: number,
) {
  const start = new Date(date);
  start.setHours(Math.floor(workdayStartMinutes / 60), workdayStartMinutes % 60, 0, 0);
  return { start, end: new Date(start.getTime() + defaultDurationMinutes * 60_000), allDay: false };
}

export function calendarSelectionSeed(start: Date, end: Date, allDay: boolean, snapMinutes: number) {
  const minimumEnd = allDay
    ? addDays(startOfDay(start), 1)
    : new Date(start.getTime() + snapMinutes * 60_000);
  return {
    start,
    end: end > start ? end : minimumEnd,
    allDay,
  };
}

export function miniCalendarWeek(date: Date, weekStartsOn: 0 | 1) {
  const start = startOfWeek(date, { weekStartsOn });
  return { start, end: addDays(start, 6) };
}
