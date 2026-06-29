import type { Routine, RoutineTriggerType } from './types';

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAY_LONG_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function asNumber(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function interval(config: Record<string, unknown>): number {
  return Math.max(1, Math.floor(asNumber(config.interval, 1)));
}

function timeParts(config: Record<string, unknown>): { hour: number; minute: number } {
  return {
    hour: Math.max(0, Math.min(23, Math.floor(asNumber(config.hour, 9)))),
    minute: Math.max(0, Math.min(59, Math.floor(asNumber(config.minute, 0)))),
  };
}

function localCandidate(date: Date, config: Record<string, unknown>): Date {
  const { hour, minute } = timeParts(config);
  const candidate = new Date(date);
  candidate.setHours(hour, minute, 0, 0);
  return candidate;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  const originalDay = next.getDate();
  next.setDate(1);
  next.setMonth(next.getMonth() + months);
  const daysInMonth = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(originalDay, daysInMonth));
  return next;
}

function toMondayIndex(jsDay: number): number {
  return (jsDay + 6) % 7;
}

function localWeekStart(date: Date): Date {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - toMondayIndex(start.getDay()));
  return start;
}

function nthWeekdayDay(year: number, month: number, ordinal: number, weekday: number): number {
  const first = new Date(year, month, 1);
  const firstWeekday = toMondayIndex(first.getDay());
  const offset = (weekday - firstWeekday + 7) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  let day = 1 + offset + (Math.max(1, Math.min(5, ordinal)) - 1) * 7;
  if (day > daysInMonth) day -= 7;
  return day;
}

function monthlyCandidate(date: Date, config: Record<string, unknown>): Date {
  const { hour, minute } = timeParts(config);
  const mode = String(config.mode || 'day_of_month');
  const candidate = new Date(date);
  const daysInMonth = new Date(candidate.getFullYear(), candidate.getMonth() + 1, 0).getDate();
  const day = mode === 'nth_weekday'
    ? nthWeekdayDay(
        candidate.getFullYear(),
        candidate.getMonth(),
        Math.floor(asNumber(config.ordinal, 1)),
        Math.floor(asNumber(config.weekday, 0)),
      )
    : Math.max(1, Math.min(daysInMonth, Math.floor(asNumber(config.day ?? config.dayOfMonth, 1))));
  candidate.setDate(day);
  candidate.setHours(hour, minute, 0, 0);
  return candidate;
}

function yearlyCandidate(date: Date, config: Record<string, unknown>): Date {
  const { hour, minute } = timeParts(config);
  const mode = String(config.mode || 'day_of_month');
  const month = Math.max(0, Math.min(11, Math.floor(asNumber(config.month, 1)) - 1));
  const year = date.getFullYear();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const day = mode === 'nth_weekday'
    ? nthWeekdayDay(year, month, Math.floor(asNumber(config.ordinal, 1)), Math.floor(asNumber(config.weekday, 0)))
    : Math.max(1, Math.min(daysInMonth, Math.floor(asNumber(config.day ?? config.dayOfMonth, 1))));
  return new Date(year, month, day, hour, minute, 0, 0);
}

export function nextRoutineDates({
  triggerType,
  config,
  reference = new Date(),
  firstRunAt,
  endsAt,
  lastCompletedAt,
  count = 6,
}: {
  triggerType: RoutineTriggerType;
  config: Record<string, unknown>;
  reference?: Date;
  firstRunAt?: Date | null;
  endsAt?: Date | null;
  lastCompletedAt?: Date | null;
  count?: number;
}): Date[] {
  const results: Date[] = [];
  let cursor = new Date(reference);
  const first = firstRunAt ? new Date(firstRunAt) : null;
  const end = endsAt ? new Date(endsAt) : null;
  let completion = lastCompletedAt ? new Date(lastCompletedAt) : null;

  for (let index = 0; index < Math.max(1, Math.min(count, 24)); index += 1) {
    let candidate: Date | null = null;
    const base = first && first > cursor ? first : cursor;
    const step = interval(config);

    if (triggerType === 'daily') {
      candidate = localCandidate(first || base, config);
      while (candidate <= cursor) candidate = addDays(candidate, step);
    } else if (triggerType === 'weekly') {
      const weekdays = Array.isArray(config.weekdays) && config.weekdays.length
        ? config.weekdays.map((day) => Math.max(0, Math.min(6, Math.floor(Number(day)))))
        : [toMondayIndex((first || base).getDay())];
      const anchorWeekStart = localWeekStart(first || cursor);
      let scan = new Date(base);
      for (let tries = 0; tries < 371; tries += 1) {
        const candidateDay = toMondayIndex(scan.getDay());
        const candidateForDay = localCandidate(scan, config);
        const weekDelta = Math.floor((localWeekStart(scan).getTime() - anchorWeekStart.getTime()) / (7 * 24 * 60 * 60 * 1000));
        if (weekDelta % step === 0 && weekdays.includes(candidateDay) && candidateForDay > cursor) {
          candidate = candidateForDay;
          break;
        }
        scan = addDays(scan, 1);
      }
    } else if (triggerType === 'monthly') {
      let scan = new Date(base.getFullYear(), base.getMonth(), 1);
      for (let tries = 0; tries < 240; tries += 1) {
        const monthCandidate = monthlyCandidate(scan, config);
        if (monthCandidate > cursor) {
          candidate = monthCandidate;
          break;
        }
        scan = addMonths(scan, step);
      }
    } else if (triggerType === 'yearly') {
      let scan = new Date(base.getFullYear(), 0, 1);
      for (let tries = 0; tries < 80; tries += 1) {
        const yearCandidate = yearlyCandidate(scan, config);
        if (yearCandidate > cursor) {
          candidate = yearCandidate;
          break;
        }
        scan = new Date(scan.getFullYear() + step, 0, 1);
      }
    } else {
      const unit = String(config.unit || 'days');
      const source = completion || first || cursor;
      if (unit.startsWith('week')) candidate = addDays(source, step * 7);
      else if (unit.startsWith('month')) candidate = addMonths(source, step);
      else candidate = addDays(source, step);
      completion = candidate;
    }

    if (!candidate || (end && candidate > end)) break;
    results.push(candidate);
    cursor = new Date(candidate.getTime() + 1000);
  }

  return results;
}

export function summarizeRecurrence(triggerType: RoutineTriggerType, config: Record<string, unknown>): string {
  const step = interval(config);
  if (triggerType === 'daily') return step === 1 ? 'Every day' : `Every ${step} days`;
  if (triggerType === 'weekly') {
    const weekdays = Array.isArray(config.weekdays) ? config.weekdays.map(Number) : [];
    if (step === 1 && weekdays.join(',') === '0,1,2,3,4') return 'Every weekday';
    if (weekdays.length) {
      const labels = weekdays.map((day) => WEEKDAY_LABELS[day]).filter(Boolean);
      return step === 1 ? `Every ${labels.join(' and ')}` : `Every ${step} weeks on ${labels.join(', ')}`;
    }
    return step === 1 ? 'Every week' : `Every ${step} weeks`;
  }
  if (triggerType === 'monthly') {
    if (config.mode === 'nth_weekday') {
      const weekday = WEEKDAY_LONG_LABELS[Math.floor(asNumber(config.weekday, 0))] || 'weekday';
      return step === 1 ? `Every month on the ${config.ordinal || 1} ${weekday}` : `Every ${step} months`;
    }
    const day = Math.floor(asNumber(config.day ?? config.dayOfMonth, 1));
    return step === 1 ? `Every month on the ${day}` : `Every ${step} months on the ${day}`;
  }
  if (triggerType === 'yearly') return step === 1 ? 'Every year' : `Every ${step} years`;
  const unit = String(config.unit || 'days');
  const singular = unit.endsWith('s') ? unit.slice(0, -1) : unit;
  return `${step} ${step === 1 ? singular : unit} after completion`;
}

export function routinePreview(routine: Pick<Routine, 'trigger_type' | 'trigger_config' | 'first_run_at' | 'ends_at' | 'last_run_at'>): {
  summary: string;
  dates: Date[];
} {
  return {
    summary: summarizeRecurrence(routine.trigger_type, routine.trigger_config || {}),
    dates: nextRoutineDates({
      triggerType: routine.trigger_type,
      config: routine.trigger_config || {},
      firstRunAt: routine.first_run_at ? new Date(routine.first_run_at) : null,
      endsAt: routine.ends_at ? new Date(routine.ends_at) : null,
      lastCompletedAt: routine.last_run_at ? new Date(routine.last_run_at) : null,
    }),
  };
}
