import { formatISO } from 'date-fns';

/**
 * Format seconds to hours and minutes display
 */
export function secondsToHoursAndMinutes(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return '0m';
}

/**
 * Format hour for display (12h or 24h format)
 */
export function formatHour(hour: number, timeFormat: 12 | 24 = 12): string {
  if (timeFormat === 24) {
    return `${hour.toString().padStart(2, '0')}:00`;
  }
  if (hour === 0) return '12 AM';
  if (hour === 12) return '12 PM';
  if (hour < 12) return `${hour} AM`;
  return `${hour - 12} PM`;
}

/**
 * Check if a date is in the selected range
 */
export function checkIsInRange(
  date: Date,
  isDragging: boolean,
  localRange: [string | null, string | null],
  range: [string, string] | null
): boolean {
  if (isDragging && localRange[0] && localRange[1]) {
    const start = new Date(localRange[0]);
    const end = new Date(localRange[1]);
    const minDate = new Date(Math.min(start.getTime(), end.getTime()));
    const maxDate = new Date(Math.max(start.getTime(), end.getTime()));
    return date > minDate && date < maxDate;
  }
  if (!isDragging && range && range.length === 2) {
    const start = new Date(range[0]);
    const end = new Date(range[1]);
    const minDate = new Date(Math.min(start.getTime(), end.getTime()));
    const maxDate = new Date(Math.max(start.getTime(), end.getTime()));
    return date > minDate && date < maxDate;
  }
  return false;
}

/**
 * Check if date is the first in selected range
 */
export function checkIsFirstSelectedDate(
  date: Date,
  isDragging: boolean,
  localRange: [string | null, string | null],
  range: [string, string] | null
): boolean {
  const formattedDate = formatISO(date, { representation: 'date' });
  if (isDragging && localRange[0]) {
    const start = new Date(localRange[0]);
    const end = localRange[1] ? new Date(localRange[1]) : start;
    const firstDate = new Date(Math.min(start.getTime(), end.getTime()));
    return formattedDate === formatISO(firstDate, { representation: 'date' });
  }
  if (!isDragging && range && range.length === 2) {
    const start = new Date(range[0]);
    const end = new Date(range[1]);
    const firstDate = new Date(Math.min(start.getTime(), end.getTime()));
    return formattedDate === formatISO(firstDate, { representation: 'date' });
  }
  return false;
}

/**
 * Check if date is the last in selected range
 */
export function checkIsLastSelectedDate(
  date: Date,
  isDragging: boolean,
  localRange: [string | null, string | null],
  range: [string, string] | null
): boolean {
  const formattedDate = formatISO(date, { representation: 'date' });
  if (isDragging && localRange[0] && localRange[1]) {
    const start = new Date(localRange[0]);
    const end = new Date(localRange[1]);
    const lastDate = new Date(Math.max(start.getTime(), end.getTime()));
    return formattedDate === formatISO(lastDate, { representation: 'date' });
  }
  if (!isDragging && range && range.length === 2) {
    const start = new Date(range[0]);
    const end = new Date(range[1]);
    const lastDate = new Date(Math.max(start.getTime(), end.getTime()));
    return formattedDate === formatISO(lastDate, { representation: 'date' });
  }
  return false;
}
