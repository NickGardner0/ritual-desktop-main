import { describe, expect, it } from 'vitest';

import {
  calendarPeriodLabel,
  calendarSelectionSeed,
  calendarVisibleRange,
  defaultTimedSelection,
  miniCalendarWeek,
  rangeContainsDate,
} from '../app/(dashboard)/calendar/calendar-helpers';

describe('calendar view helpers', () => {
  const date = new Date(2026, 8, 4, 12);

  it('builds half-open day, week, and month ranges', () => {
    const day = calendarVisibleRange(date, 'day', 0);
    expect(day.end.getTime() - day.start.getTime()).toBe(24 * 60 * 60 * 1000);

    const week = calendarVisibleRange(date, 'week', 0);
    expect(week.start.getDay()).toBe(0);
    expect(week.end.getTime() - week.start.getTime()).toBe(7 * 24 * 60 * 60 * 1000);

    const month = calendarVisibleRange(date, 'month', 0);
    expect(month.start.getDay()).toBe(0);
    expect(month.end.getDay()).toBe(0);
  });

  it('treats the range end as exclusive', () => {
    const range = calendarVisibleRange(date, 'week', 1);
    expect(rangeContainsDate(range, range.start)).toBe(true);
    expect(rangeContainsDate(range, range.end)).toBe(false);
  });

  it('formats a cross-month week without redundant years', () => {
    const range = calendarVisibleRange(date, 'week', 0);
    expect(calendarPeriodLabel(range, 'week', 'en-US')).toBe('August – September 2026');
  });

  it('seeds new events at the saved workday start and duration', () => {
    const selection = defaultTimedSelection(date, 7 * 60 + 30, 45);
    expect(selection.start.getHours()).toBe(7);
    expect(selection.start.getMinutes()).toBe(30);
    expect(selection.end.getTime() - selection.start.getTime()).toBe(45 * 60 * 1000);
  });

  it('converts a zero-distance click into one snapped event block', () => {
    const start = new Date(2026, 8, 4, 9, 30);
    const seed = calendarSelectionSeed(start, start, false, 30);
    expect(seed.end.getTime() - seed.start.getTime()).toBe(30 * 60 * 1000);
  });

  it('returns the synchronized week highlight for the mini calendar', () => {
    const week = miniCalendarWeek(date, 1);
    expect(week.start.getDay()).toBe(1);
    expect(week.end.getDay()).toBe(0);
  });
});
