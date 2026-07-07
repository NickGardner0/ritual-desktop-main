// Pure schedule engine for Routines.
//
// Conventions (shared with the backend routine model):
// - trigger types: daily | weekly | monthly | yearly | on_completion
// - config keys: interval, hour, minute, weekdays (0 = Monday .. 6 = Sunday),
//   day (1-31 | 'first' | 'last'), mode ('day_of_month' | 'nth_weekday'),
//   ordinal, weekday, month (1-12), unit ('days' | 'weeks' | 'months')
// - all math is local-time; hour/minute are re-applied after date arithmetic so
//   occurrences stay on the wall-clock time across DST transitions.

const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAY_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ORDINAL_LABEL = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', 5: 'last' };
const MAX_OCCURRENCES = 24;

function toNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function intervalOf(config) {
  return Math.max(1, Math.floor(toNumber(config.interval, 1)));
}

function timeOf(config) {
  return {
    hour: Math.max(0, Math.min(23, Math.floor(toNumber(config.hour, 9)))),
    minute: Math.max(0, Math.min(59, Math.floor(toNumber(config.minute, 0)))),
  };
}

function atTime(date, config) {
  const { hour, minute } = timeOf(config);
  const result = new Date(date);
  result.setHours(hour, minute, 0, 0);
  return result;
}

function startOfDay(date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function addMonthsClamped(date, months) {
  const result = new Date(date);
  const day = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  result.setDate(Math.min(day, daysInMonth(result.getFullYear(), result.getMonth())));
  return result;
}

function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/** JS Sunday-first weekday -> Monday-first index (0 = Monday). */
function mondayIndex(jsDay) {
  return (jsDay + 6) % 7;
}

function startOfWeek(date) {
  return addDays(startOfDay(date), -mondayIndex(date.getDay()));
}

function normalizedWeekdays(config, anchor) {
  const raw = Array.isArray(config.weekdays) ? config.weekdays : [];
  const days = raw
    .map((day) => Math.floor(Number(day)))
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
  if (days.length) return [...new Set(days)].sort((a, b) => a - b);
  return [mondayIndex(anchor.getDay())];
}

/** Day of month for the ordinal-th `weekday` (0 = Monday); ordinal 5 = last. */
function nthWeekdayOfMonth(year, monthIndex, ordinal, weekday) {
  const boundedOrdinal = Math.max(1, Math.min(5, Math.floor(toNumber(ordinal, 1))));
  const boundedWeekday = Math.max(0, Math.min(6, Math.floor(toNumber(weekday, 0))));
  const firstWeekday = mondayIndex(new Date(year, monthIndex, 1).getDay());
  const offset = (boundedWeekday - firstWeekday + 7) % 7;
  const total = daysInMonth(year, monthIndex);
  let day = 1 + offset + (boundedOrdinal - 1) * 7;
  while (day > total) day -= 7;
  return day;
}

function resolvedDayOfMonth(config, year, monthIndex) {
  const total = daysInMonth(year, monthIndex);
  const raw = config.day ?? config.dayOfMonth;
  if (raw === 'first') return 1;
  if (raw === 'last') return total;
  return Math.max(1, Math.min(total, Math.floor(toNumber(raw, 1))));
}

function monthOccurrence(year, monthIndex, config) {
  const day = String(config.mode || 'day_of_month') === 'nth_weekday'
    ? nthWeekdayOfMonth(year, monthIndex, config.ordinal, config.weekday)
    : resolvedDayOfMonth(config, year, monthIndex);
  const { hour, minute } = timeOf(config);
  return new Date(year, monthIndex, day, hour, minute, 0, 0);
}

function unitOf(config) {
  const unit = String(config.unit || 'days');
  if (unit.startsWith('week')) return 'weeks';
  if (unit.startsWith('month')) return 'months';
  return 'days';
}

/**
 * Compute the next occurrences of a schedule.
 *
 * @param {object} args
 * @param {'daily'|'weekly'|'monthly'|'yearly'|'on_completion'} args.triggerType
 * @param {Record<string, unknown>} args.config
 * @param {Date} [args.from] reference instant; occurrences are strictly after it
 * @param {Date|null} [args.firstRunAt] no occurrence before this instant; also anchors the cycle
 * @param {Date|null} [args.endsAt] no occurrence after this instant
 * @param {Date|null} [args.lastCompletedAt] anchors on_completion chains
 * @param {number} [args.count]
 * @returns {Date[]}
 */
export function nextOccurrences({
  triggerType,
  config = {},
  from = new Date(),
  firstRunAt = null,
  endsAt = null,
  lastCompletedAt = null,
  count = 6,
}) {
  const wanted = Math.max(1, Math.min(Math.floor(count), MAX_OCCURRENCES));
  const first = firstRunAt ? new Date(firstRunAt) : null;
  const end = endsAt ? new Date(endsAt) : null;
  const floor = first && first.getTime() > from.getTime()
    ? new Date(first.getTime() - 1)
    : new Date(from);
  const step = intervalOf(config);
  const results = [];
  const push = (candidate) => {
    if (end && candidate.getTime() > end.getTime()) return false;
    results.push(candidate);
    return true;
  };

  if (triggerType === 'daily') {
    const anchor = startOfDay(first || floor);
    let candidate = atTime(anchor, config);
    for (let guard = 0; guard < 40000 && results.length < wanted; guard += 1) {
      if (candidate.getTime() > floor.getTime()) {
        if (!push(candidate)) break;
      }
      candidate = atTime(addDays(candidate, step), config);
    }
    return results;
  }

  if (triggerType === 'weekly') {
    const anchorWeek = startOfWeek(first || floor);
    const weekdays = normalizedWeekdays(config, first || floor);
    let week = new Date(anchorWeek);
    for (let guard = 0; guard < 6000 && results.length < wanted; guard += 1) {
      for (const day of weekdays) {
        if (results.length >= wanted) break;
        const candidate = atTime(addDays(week, day), config);
        if (candidate.getTime() > floor.getTime()) {
          if (!push(candidate)) return results;
        }
      }
      week = addDays(week, step * 7);
    }
    return results;
  }

  if (triggerType === 'monthly') {
    const anchor = first || floor;
    let year = anchor.getFullYear();
    let monthIndex = anchor.getMonth();
    for (let guard = 0; guard < 2400 && results.length < wanted; guard += 1) {
      const candidate = monthOccurrence(year, monthIndex, config);
      if (candidate.getTime() > floor.getTime()) {
        if (!push(candidate)) break;
      }
      monthIndex += step;
      year += Math.floor(monthIndex / 12);
      monthIndex %= 12;
    }
    return results;
  }

  if (triggerType === 'yearly') {
    const anchor = first || floor;
    const monthIndex = Math.max(0, Math.min(11, Math.floor(toNumber(config.month, 1)) - 1));
    let year = anchor.getFullYear();
    for (let guard = 0; guard < 200 && results.length < wanted; guard += 1) {
      const candidate = monthOccurrence(year, monthIndex, config);
      if (candidate.getTime() > floor.getTime()) {
        if (!push(candidate)) break;
      }
      year += step;
    }
    return results;
  }

  // on_completion: chain from the last completion (or first run / now).
  let source = lastCompletedAt ? new Date(lastCompletedAt) : (first || floor);
  const unit = unitOf(config);
  for (let guard = 0; guard < MAX_OCCURRENCES && results.length < wanted; guard += 1) {
    const candidate = unit === 'weeks'
      ? addDays(source, step * 7)
      : unit === 'months'
        ? addMonthsClamped(source, step)
        : addDays(source, step);
    if (!push(candidate)) break;
    source = candidate;
  }
  return results;
}

/** "5:00 PM" */
export function formatScheduleTime(config) {
  const { hour, minute } = timeOf(config);
  const period = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour}:${String(minute).padStart(2, '0')} ${period}`;
}

function ordinalSuffix(day) {
  const mod100 = day % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${day}th`;
  const mod10 = day % 10;
  if (mod10 === 1) return `${day}st`;
  if (mod10 === 2) return `${day}nd`;
  if (mod10 === 3) return `${day}rd`;
  return `${day}th`;
}

function describeDayOfMonth(config) {
  const raw = config.day ?? config.dayOfMonth;
  if (raw === 'first') return 'the first day';
  if (raw === 'last') return 'the last day';
  return `the ${ordinalSuffix(Math.max(1, Math.min(31, Math.floor(toNumber(raw, 1)))))}`;
}

function describeMonthlyAnchor(config) {
  if (String(config.mode || 'day_of_month') === 'nth_weekday') {
    const ordinal = Math.max(1, Math.min(5, Math.floor(toNumber(config.ordinal, 1))));
    const weekday = WEEKDAY_LONG[Math.max(0, Math.min(6, Math.floor(toNumber(config.weekday, 0))))];
    return `the ${ORDINAL_LABEL[ordinal]} ${weekday}`;
  }
  return describeDayOfMonth(config);
}

/**
 * Human description of a schedule, e.g. "Every day at 5:00 PM",
 * "Every 2 weeks on Mon, Wed at 9:00 AM", "Yearly on May 26 at 9:00 AM".
 *
 * @param {'daily'|'weekly'|'monthly'|'yearly'|'on_completion'} triggerType
 * @param {Record<string, unknown>} config
 * @returns {string}
 */
export function describeSchedule(triggerType, config = {}) {
  const step = intervalOf(config);
  const time = formatScheduleTime(config);

  if (triggerType === 'daily') {
    return `${step === 1 ? 'Every day' : `Every ${step} days`} at ${time}`;
  }

  if (triggerType === 'weekly') {
    const raw = Array.isArray(config.weekdays) ? config.weekdays.map(Number).filter((day) => day >= 0 && day <= 6) : [];
    const days = [...new Set(raw)].sort((a, b) => a - b);
    if (step === 1 && days.join(',') === '0,1,2,3,4') return `Every weekday at ${time}`;
    const labels = days.map((day) => WEEKDAY_SHORT[day]).join(', ');
    if (!labels) return `${step === 1 ? 'Every week' : `Every ${step} weeks`} at ${time}`;
    return `${step === 1 ? 'Every' : `Every ${step} weeks on`} ${labels} at ${time}`;
  }

  if (triggerType === 'monthly') {
    const anchor = describeMonthlyAnchor(config);
    return `${step === 1 ? 'Monthly' : `Every ${step} months`} on ${anchor} at ${time}`;
  }

  if (triggerType === 'yearly') {
    const monthIndex = Math.max(0, Math.min(11, Math.floor(toNumber(config.month, 1)) - 1));
    const month = MONTH_LONG[monthIndex];
    const anchor = String(config.mode || 'day_of_month') === 'nth_weekday'
      ? `the ${ORDINAL_LABEL[Math.max(1, Math.min(5, Math.floor(toNumber(config.ordinal, 1))))]} ${WEEKDAY_LONG[Math.max(0, Math.min(6, Math.floor(toNumber(config.weekday, 0))))]} of ${month}`
      : `${month} ${Math.max(1, Math.min(31, Math.floor(toNumber(config.day ?? config.dayOfMonth, 1))))}`;
    return `${step === 1 ? 'Yearly' : `Every ${step} years`} on ${anchor} at ${time}`;
  }

  const unit = unitOf(config);
  const singular = unit.slice(0, -1);
  return `${step} ${step === 1 ? singular : unit} after completion`;
}
