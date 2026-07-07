process.env.TZ = 'America/New_York';

import test from 'node:test';
import assert from 'node:assert/strict';

import { describeSchedule, formatScheduleTime, nextOccurrences } from '../lib/routines/schedule-engine.mjs';

function local(year, month, day, hour = 0, minute = 0) {
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

function ymdhm(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

test('daily: next run is today when the time has not passed', () => {
  const dates = nextOccurrences({
    triggerType: 'daily',
    config: { interval: 1, hour: 17, minute: 0 },
    from: local(2026, 7, 7, 9, 0),
    count: 3,
  });
  assert.deepEqual(dates.map(ymdhm), ['2026-07-07 17:00', '2026-07-08 17:00', '2026-07-09 17:00']);
});

test('daily: next run rolls to tomorrow when the time has passed', () => {
  const dates = nextOccurrences({
    triggerType: 'daily',
    config: { interval: 1, hour: 7, minute: 30 },
    from: local(2026, 7, 7, 9, 0),
    count: 2,
  });
  assert.deepEqual(dates.map(ymdhm), ['2026-07-08 07:30', '2026-07-09 07:30']);
});

test('daily: interval > 1 stays phase-locked to firstRun', () => {
  const dates = nextOccurrences({
    triggerType: 'daily',
    config: { interval: 3, hour: 9, minute: 0 },
    firstRunAt: local(2026, 7, 1, 9, 0),
    from: local(2026, 7, 7, 12, 0),
    count: 3,
  });
  // Anchored 7/1: series is 7/1, 7/4, 7/7, 7/10... 7/7 09:00 already passed.
  assert.deepEqual(dates.map(ymdhm), ['2026-07-10 09:00', '2026-07-13 09:00', '2026-07-16 09:00']);
});

test('daily: wall-clock time is stable across the spring DST transition', () => {
  // US DST begins 2026-03-08 in America/New_York.
  const dates = nextOccurrences({
    triggerType: 'daily',
    config: { interval: 1, hour: 9, minute: 0 },
    from: local(2026, 3, 7, 10, 0),
    count: 3,
  });
  assert.deepEqual(dates.map(ymdhm), ['2026-03-08 09:00', '2026-03-09 09:00', '2026-03-10 09:00']);
  // Offsets differ around the transition, but local time stays 9:00.
  assert.notEqual(dates[0].getTimezoneOffset(), local(2026, 3, 7).getTimezoneOffset());
});

test('daily: wall-clock time is stable across the fall DST transition', () => {
  // US DST ends 2026-11-01 in America/New_York.
  const dates = nextOccurrences({
    triggerType: 'daily',
    config: { interval: 1, hour: 8, minute: 0 },
    from: local(2026, 10, 31, 12, 0),
    count: 2,
  });
  assert.deepEqual(dates.map(ymdhm), ['2026-11-01 08:00', '2026-11-02 08:00']);
});

test('weekly: selected weekdays in order (0 = Monday)', () => {
  // 2026-07-07 is a Tuesday.
  const dates = nextOccurrences({
    triggerType: 'weekly',
    config: { interval: 1, weekdays: [0, 2], hour: 18, minute: 0 },
    from: local(2026, 7, 7, 9, 0),
    count: 4,
  });
  // Mon=0, Wed=2 → Wed 7/8, Mon 7/13, Wed 7/15, Mon 7/20.
  assert.deepEqual(dates.map(ymdhm), ['2026-07-08 18:00', '2026-07-13 18:00', '2026-07-15 18:00', '2026-07-20 18:00']);
});

test('weekly: defaults to the anchor weekday when none selected', () => {
  const dates = nextOccurrences({
    triggerType: 'weekly',
    config: { interval: 1, hour: 17, minute: 0 },
    from: local(2026, 7, 7, 18, 0), // Tuesday, after 17:00
    count: 2,
  });
  assert.deepEqual(dates.map(ymdhm), ['2026-07-14 17:00', '2026-07-21 17:00']);
});

test('weekly: every 2 weeks keeps week phase from firstRun', () => {
  const dates = nextOccurrences({
    triggerType: 'weekly',
    config: { interval: 2, weekdays: [4], hour: 17, minute: 0 }, // Fridays
    firstRunAt: local(2026, 7, 3, 17, 0), // Friday in week of 6/29
    from: local(2026, 7, 7, 0, 0),
    count: 3,
  });
  // Weeks of 6/29, 7/13, 7/27 → Fridays 7/17? No: week of 6/29 Friday is 7/3 (past),
  // next matching weeks are 7/13 (Fri 7/17) and 7/27 (Fri 7/31).
  assert.deepEqual(dates.map(ymdhm), ['2026-07-17 17:00', '2026-07-31 17:00', '2026-08-14 17:00']);
});

test('monthly: day-of-month with month-end clamping (Jan 31 → Feb 28)', () => {
  const dates = nextOccurrences({
    triggerType: 'monthly',
    config: { interval: 1, day: 31, hour: 9, minute: 0 },
    from: local(2026, 1, 15, 0, 0),
    count: 4,
  });
  // 2026 is not a leap year.
  assert.deepEqual(dates.map(ymdhm), ['2026-01-31 09:00', '2026-02-28 09:00', '2026-03-31 09:00', '2026-04-30 09:00']);
});

test('monthly: "first" and "last" day keywords', () => {
  const firsts = nextOccurrences({
    triggerType: 'monthly',
    config: { interval: 1, day: 'first', hour: 9, minute: 0 },
    from: local(2026, 7, 7, 0, 0),
    count: 2,
  });
  assert.deepEqual(firsts.map(ymdhm), ['2026-08-01 09:00', '2026-09-01 09:00']);

  const lasts = nextOccurrences({
    triggerType: 'monthly',
    config: { interval: 1, day: 'last', hour: 21, minute: 30 },
    from: local(2026, 7, 7, 0, 0),
    count: 2,
  });
  assert.deepEqual(lasts.map(ymdhm), ['2026-07-31 21:30', '2026-08-31 21:30']);
});

test('monthly: nth weekday mode (second Tuesday)', () => {
  const dates = nextOccurrences({
    triggerType: 'monthly',
    config: { interval: 1, mode: 'nth_weekday', ordinal: 2, weekday: 1, hour: 10, minute: 0 },
    from: local(2026, 7, 1, 0, 0),
    count: 2,
  });
  // Second Tuesday: July 14 2026, August 11 2026.
  assert.deepEqual(dates.map(ymdhm), ['2026-07-14 10:00', '2026-08-11 10:00']);
});

test('monthly: interval > 1 steps whole months', () => {
  const dates = nextOccurrences({
    triggerType: 'monthly',
    config: { interval: 3, day: 15, hour: 9, minute: 0 },
    firstRunAt: local(2026, 1, 15, 9, 0),
    from: local(2026, 2, 1, 0, 0),
    count: 3,
  });
  assert.deepEqual(dates.map(ymdhm), ['2026-04-15 09:00', '2026-07-15 09:00', '2026-10-15 09:00']);
});

test('yearly: fixed date, and Feb 29 clamps on non-leap years', () => {
  const may = nextOccurrences({
    triggerType: 'yearly',
    config: { interval: 1, month: 5, day: 26, hour: 9, minute: 0 },
    from: local(2026, 7, 7, 0, 0),
    count: 3,
  });
  assert.deepEqual(may.map(ymdhm), ['2027-05-26 09:00', '2028-05-26 09:00', '2029-05-26 09:00']);

  const leap = nextOccurrences({
    triggerType: 'yearly',
    config: { interval: 1, month: 2, day: 29, hour: 9, minute: 0 },
    from: local(2027, 1, 1, 0, 0),
    count: 3,
  });
  assert.deepEqual(leap.map(ymdhm), ['2027-02-28 09:00', '2028-02-29 09:00', '2029-02-28 09:00']);
});

test('firstRun in the future delays the first occurrence', () => {
  const dates = nextOccurrences({
    triggerType: 'daily',
    config: { interval: 1, hour: 9, minute: 0 },
    firstRunAt: local(2026, 8, 1, 0, 0),
    from: local(2026, 7, 7, 0, 0),
    count: 2,
  });
  assert.deepEqual(dates.map(ymdhm), ['2026-08-01 09:00', '2026-08-02 09:00']);
});

test('ends date truncates the series', () => {
  const dates = nextOccurrences({
    triggerType: 'daily',
    config: { interval: 1, hour: 9, minute: 0 },
    from: local(2026, 7, 7, 0, 0),
    endsAt: local(2026, 7, 9, 23, 59),
    count: 6,
  });
  assert.deepEqual(dates.map(ymdhm), ['2026-07-07 09:00', '2026-07-08 09:00', '2026-07-09 09:00']);
});

test('ends date before the first occurrence yields nothing', () => {
  const dates = nextOccurrences({
    triggerType: 'weekly',
    config: { interval: 1, weekdays: [0], hour: 9, minute: 0 },
    from: local(2026, 7, 7, 0, 0),
    endsAt: local(2026, 7, 8, 0, 0),
    count: 3,
  });
  assert.deepEqual(dates, []);
});

test('on_completion chains from the last completion', () => {
  const dates = nextOccurrences({
    triggerType: 'on_completion',
    config: { interval: 2, unit: 'weeks' },
    lastCompletedAt: local(2026, 7, 1, 10, 0),
    from: local(2026, 7, 7, 0, 0),
    count: 2,
  });
  assert.deepEqual(dates.map(ymdhm), ['2026-07-15 10:00', '2026-07-29 10:00']);
});

test('on_completion months clamp at month end', () => {
  const dates = nextOccurrences({
    triggerType: 'on_completion',
    config: { interval: 1, unit: 'months' },
    lastCompletedAt: local(2026, 1, 31, 9, 0),
    from: local(2026, 2, 1, 0, 0),
    count: 2,
  });
  assert.deepEqual(dates.map(ymdhm), ['2026-02-28 09:00', '2026-03-28 09:00']);
});

test('count is bounded and defaults are safe', () => {
  const dates = nextOccurrences({
    triggerType: 'daily',
    config: {},
    from: local(2026, 7, 7, 0, 0),
    count: 500,
  });
  assert.equal(dates.length, 24);
  assert.equal(dates[0].getHours(), 9);
});

test('describeSchedule covers each frequency', () => {
  assert.equal(describeSchedule('daily', { interval: 1, hour: 17, minute: 0 }), 'Every day at 5:00 PM');
  assert.equal(describeSchedule('daily', { interval: 2, hour: 7, minute: 30 }), 'Every 2 days at 7:30 AM');
  assert.equal(describeSchedule('weekly', { interval: 1, weekdays: [0, 1, 2, 3, 4], hour: 9, minute: 0 }), 'Every weekday at 9:00 AM');
  assert.equal(describeSchedule('weekly', { interval: 1, weekdays: [0, 2], hour: 9, minute: 0 }), 'Every Mon, Wed at 9:00 AM');
  assert.equal(describeSchedule('weekly', { interval: 2, weekdays: [0, 2], hour: 9, minute: 0 }), 'Every 2 weeks on Mon, Wed at 9:00 AM');
  assert.equal(describeSchedule('monthly', { interval: 1, day: 1, hour: 9, minute: 0 }), 'Monthly on the 1st at 9:00 AM');
  assert.equal(describeSchedule('monthly', { interval: 2, day: 'last', hour: 21, minute: 0 }), 'Every 2 months on the last day at 9:00 PM');
  assert.equal(describeSchedule('monthly', { interval: 1, mode: 'nth_weekday', ordinal: 2, weekday: 1, hour: 10, minute: 0 }), 'Monthly on the second Tuesday at 10:00 AM');
  assert.equal(describeSchedule('yearly', { interval: 1, month: 5, day: 26, hour: 9, minute: 0 }), 'Yearly on May 26 at 9:00 AM');
  assert.equal(describeSchedule('on_completion', { interval: 1, unit: 'weeks' }), '1 week after completion');
  assert.equal(describeSchedule('on_completion', { interval: 3, unit: 'days' }), '3 days after completion');
});

test('formatScheduleTime formats 12-hour boundaries', () => {
  assert.equal(formatScheduleTime({ hour: 0, minute: 0 }), '12:00 AM');
  assert.equal(formatScheduleTime({ hour: 12, minute: 5 }), '12:05 PM');
  assert.equal(formatScheduleTime({ hour: 23, minute: 59 }), '11:59 PM');
});
