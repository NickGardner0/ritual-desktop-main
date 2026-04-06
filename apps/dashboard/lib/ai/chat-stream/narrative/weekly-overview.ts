/**
 * Weekly overview narrative builder and helpers.
 *
 * Extracted from orchestrator.ts to keep the main orchestrator focused on
 * routing while this module owns all weekly-overview formatting, highlight
 * generation, and LLM-powered narrative synthesis.
 */

import OpenAI from 'openai';

// ---------------------------------------------------------------------------
// Local OpenAI helper (mirrors the one in orchestrator.ts)
// ---------------------------------------------------------------------------

function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured');
  }
  return new OpenAI({ apiKey });
}

// ---------------------------------------------------------------------------
// Exported interfaces
// ---------------------------------------------------------------------------

export interface WeeklyOverviewHabitSummary {
  id: string;
  name: string;
  category?: string;
  unit?: string;
  total: number;
  average: number;
  min: number;
  max: number;
  days_with_data: number;
  total_entries: number;
  daily?: Array<{
    date?: string;
    value?: number;
  }>;
}

export interface WeeklyOverviewComputerSummary {
  days_with_data: number;
  total_hours: number;
  average_daily_hours: number;
  min_daily_hours: number;
  max_daily_hours: number;
  daily?: Array<{
    day?: string;
    active_hours?: number;
    events_count?: number;
  }>;
  top_apps?: Array<{
    app_name?: string;
    hours?: number;
    total_events?: number;
  }>;
  top_domains?: Array<{
    domain?: string;
    hours?: number;
    total_events?: number;
  }>;
}

export interface WeeklyOverviewPayload {
  success: boolean;
  date_range?: {
    start?: string;
    end?: string;
    days?: number;
  };
  summary?: {
    habits_with_data?: number;
    total_habits_tracked?: number;
  };
  habits?: WeeklyOverviewHabitSummary[];
  computer_activity?: WeeklyOverviewComputerSummary;
}

// ---------------------------------------------------------------------------
// Private formatting helpers
// ---------------------------------------------------------------------------

function formatWeeklyDate(dateInput?: string): string {
  if (!dateInput) return 'Unknown';
  const date = new Date(`${dateInput}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateInput;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatWeeklyShortDate(dateInput?: string): string {
  if (!dateInput) return 'Unknown';
  const date = new Date(`${dateInput}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateInput;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatWeeklyNumber(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '0';
  return value.toFixed(digits).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

function formatWeeklyValue(value: number, unit?: string): string {
  const normalized = (unit || '').toLowerCase().trim();

  if (normalized === 'hours' || normalized === 'hour' || normalized === 'h') {
    return `${formatWeeklyNumber(value)}h`;
  }
  if (normalized === 'minutes' || normalized === 'minute' || normalized === 'min' || normalized === 'm') {
    return `${formatWeeklyNumber(value)}m`;
  }
  if (normalized === 'milligrams' || normalized === 'milligram' || normalized === 'mg') {
    return `${formatWeeklyNumber(value)}mg`;
  }
  if (normalized === 'grams' || normalized === 'gram' || normalized === 'g') {
    return `${formatWeeklyNumber(value)}g`;
  }
  if (normalized === 'pages' || normalized === 'page') {
    return `${formatWeeklyNumber(value)} pages`;
  }
  if (!normalized || normalized === 'count') {
    return formatWeeklyNumber(value);
  }
  return `${formatWeeklyNumber(value)} ${unit}`;
}

function normalizeWeeklyHabitName(name?: string): string {
  return String(name || '').trim().toLowerCase();
}

function formatWeeklyNameList(names: string[]): string {
  if (names.length <= 1) return names[0] || '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

function normalizeWeeklyUnit(unit?: string): string {
  return String(unit || '').trim().toLowerCase();
}

function getNarrativeDailyValueCeiling(unit?: string): number | null {
  const normalized = normalizeWeeklyUnit(unit);
  if (['hours', 'hour', 'h'].includes(normalized)) return 24;
  if (['minutes', 'minute', 'min', 'm'].includes(normalized)) return 24 * 60;
  return null;
}

function sanitizeWeeklyDailyPoints(
  points: Array<{ date?: string; value?: number }> | undefined,
  unit?: string,
): Array<{ date?: string; value?: number }> {
  const ceiling = getNarrativeDailyValueCeiling(unit);
  return (Array.isArray(points) ? points : [])
    .map((point) => ({
      date: point.date,
      value: Number(point.value || 0),
    }))
    .filter((point) => point.date && Number.isFinite(point.value) && point.value >= 0)
    .filter((point) => (ceiling === null ? true : point.value <= ceiling));
}

function sanitizeWeeklyHabitSummary(habit: WeeklyOverviewHabitSummary): WeeklyOverviewHabitSummary {
  const sanitizedDaily = sanitizeWeeklyDailyPoints(
    Array.isArray(habit.daily)
      ? habit.daily.map((point) => ({ date: point.date, value: point.value }))
      : [],
    habit.unit,
  );

  if (sanitizedDaily.length === 0) {
    return {
      ...habit,
      total: 0,
      average: 0,
      min: 0,
      max: 0,
      days_with_data: 0,
      daily: [],
    };
  }

  const values = sanitizedDaily
    .map((point) => Number(point.value || 0))
    .filter((value) => Number.isFinite(value));
  const total = values.reduce((sum, value) => sum + value, 0);
  const min = values.reduce((best, value) => Math.min(best, value), values[0] || 0);
  const max = values.reduce((best, value) => Math.max(best, value), values[0] || 0);

  return {
    ...habit,
    total,
    average: total / sanitizedDaily.length,
    min,
    max,
    days_with_data: sanitizedDaily.length,
    daily: sanitizedDaily,
  };
}

function getNarrativeHabitSummaries(payload: WeeklyOverviewPayload): WeeklyOverviewHabitSummary[] {
  return (Array.isArray(payload.habits) ? payload.habits : [])
    .map((habit) => sanitizeWeeklyHabitSummary(habit))
    .filter((habit) => (habit.days_with_data || 0) > 0);
}

function findWeeklyPeakPoint(
  points: Array<{ date?: string; value?: number }>,
): { date?: string; value: number } | null {
  const normalizedPoints = [...points]
    .map((point) => ({
      date: point.date,
      value: Number(point.value || 0),
    }))
    .filter((point) => point.date && Number.isFinite(point.value));

  if (normalizedPoints.length === 0) return null;
  return normalizedPoints.reduce((best, point) => (point.value > best.value ? point : best), normalizedPoints[0]);
}

function averageWeeklyValues(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function describeWeeklyShape(
  subject: string,
  points: Array<{ date?: string; value?: number }>,
): string | null {
  const normalizedPoints = [...points]
    .map((point) => ({
      date: point.date,
      value: Number(point.value || 0),
    }))
    .filter((point) => point.date && Number.isFinite(point.value))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  if (normalizedPoints.length < 3) return null;

  const values = normalizedPoints.map((point) => point.value);
  const overallAvg = averageWeeklyValues(values);
  if (!Number.isFinite(overallAvg) || overallAvg <= 0) return null;

  const earlyCutoff = Math.ceil(normalizedPoints.length / 3);
  const lateStart = Math.max(earlyCutoff + 1, Math.floor((normalizedPoints.length * 2) / 3));
  const early = normalizedPoints.slice(0, earlyCutoff);
  const middle = normalizedPoints.slice(earlyCutoff, lateStart);
  const late = normalizedPoints.slice(lateStart);

  if (early.length === 0 || late.length === 0) return null;

  const earlyAvg = averageWeeklyValues(early.map((point) => point.value));
  const middleAvg = averageWeeklyValues(middle.map((point) => point.value));
  const lateAvg = averageWeeklyValues(late.map((point) => point.value));
  const threshold = Math.max(overallAvg * 0.18, 0.5);
  const peak = normalizedPoints.reduce((best, point) => (point.value > best.value ? point : best), normalizedPoints[0]);
  const low = normalizedPoints.reduce((best, point) => (point.value < best.value ? point : best), normalizedPoints[0]);

  if (middle.length > 0 && earlyAvg > middleAvg + threshold && lateAvg > middleAvg + threshold) {
    return `${subject} started relatively strong, dipped in the middle of the week, and recovered by the end, with the low point landing around ${formatWeeklyShortDate(low.date)}.`;
  }
  if (lateAvg > earlyAvg + threshold && lateAvg >= middleAvg + threshold * 0.6) {
    return `${subject} built as the week went on and looked strongest near ${formatWeeklyShortDate(peak.date)}.`;
  }
  if (earlyAvg > lateAvg + threshold && earlyAvg >= middleAvg + threshold * 0.6) {
    return `${subject} was more front-loaded, with the strongest stretch early before easing later in the week.`;
  }
  if (middle.length > 0 && middleAvg > earlyAvg + threshold && middleAvg > lateAvg + threshold) {
    return `${subject} peaked midweek, with the strongest day around ${formatWeeklyShortDate(peak.date)} before settling back down.`;
  }
  if (peak.value - low.value >= threshold * 1.5) {
    return `${subject} stayed uneven across the week, ranging from a low on ${formatWeeklyShortDate(low.date)} to a high on ${formatWeeklyShortDate(peak.date)}.`;
  }

  return `${subject} was fairly steady across the week without a big midweek swing.`;
}

// ---------------------------------------------------------------------------
// Exported builders
// ---------------------------------------------------------------------------

export function buildWeeklyOverviewSynthesisPayload(payload: WeeklyOverviewPayload) {
  const habits = getNarrativeHabitSummaries(payload)
    .map((habit) => ({
      name: habit.name,
      category: habit.category,
      unit: habit.unit,
      total: habit.total,
      average: habit.average,
      min: habit.min,
      max: habit.max,
      days_with_data: habit.days_with_data,
      total_entries: habit.total_entries,
      daily: Array.isArray(habit.daily)
        ? habit.daily.map((row) => ({
            date: row.date,
            value: row.value,
          }))
        : [],
    }));

  const computer = payload.computer_activity
    ? {
        days_with_data: payload.computer_activity.days_with_data,
        total_hours: payload.computer_activity.total_hours,
        average_daily_hours: payload.computer_activity.average_daily_hours,
        min_daily_hours: payload.computer_activity.min_daily_hours,
        max_daily_hours: payload.computer_activity.max_daily_hours,
        daily: Array.isArray(payload.computer_activity.daily)
          ? payload.computer_activity.daily.map((row) => ({
              day: row.day,
              active_hours: row.active_hours,
              events_count: row.events_count,
            }))
          : [],
        top_apps: Array.isArray(payload.computer_activity.top_apps)
          ? payload.computer_activity.top_apps.slice(0, 5)
          : [],
        top_domains: Array.isArray(payload.computer_activity.top_domains)
          ? payload.computer_activity.top_domains.slice(0, 5)
          : [],
      }
    : null;

  return {
    date_range: payload.date_range,
    summary: payload.summary,
    habits,
    computer_activity: computer,
  };
}

export function buildWeeklyOverviewHighlights(payload: WeeklyOverviewPayload): string[] {
  const habitsWithData = getNarrativeHabitSummaries(payload);
  const rangeDays = payload.date_range?.days || 7;
  const computer = payload.computer_activity;

  const sortedByConsistency = [...habitsWithData].sort((a, b) => {
    if ((b.days_with_data || 0) !== (a.days_with_data || 0)) {
      return (b.days_with_data || 0) - (a.days_with_data || 0);
    }
    return (b.total || 0) - (a.total || 0);
  });
  const mostConsistent = sortedByConsistency[0];
  const sleepHabit = habitsWithData.find((habit) => normalizeWeeklyHabitName(habit.name) === 'sleep duration');
  const leadWorkHabit = [...habitsWithData]
    .filter((habit) => normalizeWeeklyHabitName(habit.name) !== 'sleep duration' && Array.isArray(habit.daily) && habit.daily.length > 0)
    .sort((a, b) => {
      if ((b.days_with_data || 0) !== (a.days_with_data || 0)) {
        return (b.days_with_data || 0) - (a.days_with_data || 0);
      }
      return (b.total || 0) - (a.total || 0);
    })[0];
  const topApp = Array.isArray(computer?.top_apps) ? computer?.top_apps?.[0] : undefined;
  const secondApp = Array.isArray(computer?.top_apps) ? computer?.top_apps?.[1] : undefined;
  const topWebsite = Array.isArray(computer?.top_domains) ? computer?.top_domains?.[0] : undefined;
  const secondWebsite = Array.isArray(computer?.top_domains) ? computer?.top_domains?.[1] : undefined;

  const highlights: string[] = [];

  if (mostConsistent) {
    highlights.push(
      `${mostConsistent.name} was the steadiest habit, logged on ${mostConsistent.days_with_data} of ${rangeDays} days.`,
    );
  }

  if (sleepHabit) {
    const peakSleep = findWeeklyPeakPoint(
      Array.isArray(sleepHabit.daily)
        ? sleepHabit.daily.map((point) => ({ date: point.date, value: point.value }))
        : [],
    );
    highlights.push(
      `Sleep averaged ${formatWeeklyValue(sleepHabit.average || 0, sleepHabit.unit)} and was logged on ${sleepHabit.days_with_data} of ${rangeDays} days${peakSleep?.date ? `, with the strongest night on ${formatWeeklyShortDate(peakSleep.date)}` : ''}.`,
    );
  }

  if (leadWorkHabit) {
    const peakWorkPoint = findWeeklyPeakPoint(
      Array.isArray(leadWorkHabit.daily)
        ? leadWorkHabit.daily.map((point) => ({ date: point.date, value: point.value }))
        : [],
    );
    highlights.push(
      `${leadWorkHabit.name} carried the clearest work/effort signal${peakWorkPoint?.date ? `, peaking at ${formatWeeklyValue(peakWorkPoint.value, leadWorkHabit.unit)} on ${formatWeeklyShortDate(peakWorkPoint.date)}` : ''}.`,
    );
  }

  if (computer && computer.total_hours > 0) {
    const peakComputerPoint = findWeeklyPeakPoint(
      Array.isArray(computer.daily)
        ? computer.daily.map((point) => ({ date: point.day, value: point.active_hours }))
        : [],
    );
    const digitalLeaders = [topApp?.app_name, topWebsite?.domain].filter(Boolean).join(' and ');
    highlights.push(
      `Computer use averaged ${formatWeeklyNumber(computer.average_daily_hours)}h/day${peakComputerPoint?.date ? ` and peaked on ${formatWeeklyShortDate(peakComputerPoint.date)} at ${formatWeeklyNumber(peakComputerPoint.value)}h` : ''}${digitalLeaders ? `, with most attention going to ${digitalLeaders}` : ''}.`,
    );
    if (secondApp || secondWebsite) {
      highlights.push(
        `Secondary digital context included ${[secondApp?.app_name, secondWebsite?.domain].filter(Boolean).join(' and ')}.`,
      );
    }
  }

  const lowFrequencyHabits = habitsWithData
    .filter((habit) => (habit.days_with_data || 0) > 0 && (habit.days_with_data || 0) <= Math.max(2, Math.floor(rangeDays / 3)))
    .slice(0, 2);
  if (lowFrequencyHabits.length > 0) {
    highlights.push(
      `Lower-frequency habits in this window were ${lowFrequencyHabits.map((habit) => `${habit.name} (${habit.days_with_data} days)`).join(' and ')}.`,
    );
  }

  return highlights.slice(0, 5);
}

export async function generateWeeklyOverviewNarrative(
  payload: WeeklyOverviewPayload,
  title = 'Weekly Activity Overview',
): Promise<string> {
  const fallback = buildWeeklyOverviewNarrative(payload, title);
  const synthesisPayload = buildWeeklyOverviewSynthesisPayload(payload);
  const highlights = buildWeeklyOverviewHighlights(payload);
  const periodLabel = title.includes('Daily')
    ? 'today'
    : title.includes('Monthly')
      ? 'this month'
      : 'this week';

  try {
    const response = await getOpenAIClient().chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.5,
      max_tokens: 350,
      messages: [
        {
          role: 'system',
          content: [
            'You write high-quality personal activity recaps from structured data.',
            'The user already sees raw tables in a side panel. Your job is to synthesize, interpret, and explain the period cleanly.',
            'Use this exact structure: 1 short opening sentence, then 2 to 4 sections with bold titles on their own lines, then 1 short closing line.',
            'Each section body should usually be 2 short sentences when the evidence supports it, not a long paragraph.',
            'Preferred section titles are: **Rhythm**, **Standout Days**, **Computer Use**, **What Shifted**. Skip a section if the evidence is thin.',
            'Every section must include at least one concrete anchor: a date, number, habit name, app name, or website.',
            'In at least 2 sections, include a secondary concrete detail instead of stopping after the first metric.',
            'Be crisp and specific. Avoid filler, coaching, and abstraction.',
            'Do not use phrases like "notable ebb and flow", "particularly", "overall", "likely", "may have", "suggests", or "illustrates".',
            'Do not moralize. Do not speculate beyond the data. Do not mention tables, payloads, or analytics.',
            'Keep the whole response under 260 words unless the period is monthly, then stay under 320 words.',
          ].join(' '),
        },
        {
          role: 'user',
          content: `Write a useful recap for ${periodLabel}.\n\nAnchoring highlights:\n${highlights.map((line) => `- ${line}`).join('\n')}\n\nStructured overview data:\n${JSON.stringify(synthesisPayload, null, 2)}`,
        },
      ],
    });

    const content = response.choices[0]?.message?.content?.trim();
    return content || fallback;
  } catch (error) {
    console.error('❌ generateWeeklyOverviewNarrative error:', error);
    return fallback;
  }
}

/**
 * Streaming version of generateWeeklyOverviewNarrative.
 * Yields tokens as they arrive from OpenAI instead of waiting for the full response.
 * Falls back to yielding the complete fallback text on error.
 */
export async function* streamWeeklyOverviewNarrative(
  payload: WeeklyOverviewPayload,
  title = 'Weekly Activity Overview',
): AsyncGenerator<string> {
  const fallback = buildWeeklyOverviewNarrative(payload, title);
  const synthesisPayload = buildWeeklyOverviewSynthesisPayload(payload);
  const highlights = buildWeeklyOverviewHighlights(payload);
  const periodLabel = title.includes('Daily')
    ? 'today'
    : title.includes('Monthly')
      ? 'this month'
      : 'this week';

  try {
    const stream = await getOpenAIClient().chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.5,
      max_tokens: 350,
      stream: true,
      messages: [
        {
          role: 'system',
          content: [
            'You write high-quality personal activity recaps from structured data.',
            'The user already sees raw tables in a side panel. Your job is to synthesize, interpret, and explain the period cleanly.',
            'Use this exact structure: 1 short opening sentence, then 2 to 4 sections with bold titles on their own lines, then 1 short closing line.',
            'Each section body should usually be 2 short sentences when the evidence supports it, not a long paragraph.',
            'Preferred section titles are: **Rhythm**, **Standout Days**, **Computer Use**, **What Shifted**. Skip a section if the evidence is thin.',
            'Every section must include at least one concrete anchor: a date, number, habit name, app name, or website.',
            'In at least 2 sections, include a secondary concrete detail instead of stopping after the first metric.',
            'Be crisp and specific. Avoid filler, coaching, and abstraction.',
            'Do not use phrases like "notable ebb and flow", "particularly", "overall", "likely", "may have", "suggests", or "illustrates".',
            'Do not moralize. Do not speculate beyond the data. Do not mention tables, payloads, or analytics.',
            'Keep the whole response under 260 words unless the period is monthly, then stay under 320 words.',
          ].join(' '),
        },
        {
          role: 'user',
          content: `Write a useful recap for ${periodLabel}.\n\nAnchoring highlights:\n${highlights.map((line) => `- ${line}`).join('\n')}\n\nStructured overview data:\n${JSON.stringify(synthesisPayload, null, 2)}`,
        },
      ],
    });

    let hasContent = false;
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        hasContent = true;
        yield delta;
      }
    }

    // If OpenAI returned empty content, yield the fallback
    if (!hasContent) {
      yield fallback;
    }
  } catch (error) {
    console.error('❌ streamWeeklyOverviewNarrative error:', error);
    yield fallback;
  }
}

export function buildWeeklyOverviewNarrative(
  payload: WeeklyOverviewPayload,
  title = 'Weekly Activity Overview',
): string {
  const habitsWithData = getNarrativeHabitSummaries(payload);
  const computer = payload.computer_activity;
  const rangeDays = payload.date_range?.days || 7;
  const periodLabel = title.includes('Daily')
    ? 'Today'
    : title.includes('Monthly')
      ? 'This month'
      : 'This week';

  if (habitsWithData.length === 0 && (!computer || computer.total_hours <= 0)) {
    return `${periodLabel} did not have enough logged activity to form a meaningful summary.`;
  }

  const lines: string[] = [];
  const sortedByConsistency = [...habitsWithData].sort((a, b) => {
    if ((b.days_with_data || 0) !== (a.days_with_data || 0)) {
      return (b.days_with_data || 0) - (a.days_with_data || 0);
    }
    return (b.total || 0) - (a.total || 0);
  });
  const topConsistencyDays = sortedByConsistency[0]?.days_with_data || 0;
  const consistencyLeaders = sortedByConsistency
    .filter((habit) => (habit.days_with_data || 0) === topConsistencyDays)
    .slice(0, 3);
  const mostConsistent = sortedByConsistency[0];
  const sleepHabit = habitsWithData.find((habit) => normalizeWeeklyHabitName(habit.name) === 'sleep duration');
  const leadWorkHabit = [...habitsWithData]
    .filter((habit) => normalizeWeeklyHabitName(habit.name) !== 'sleep duration' && Array.isArray(habit.daily) && habit.daily.length >= 3)
    .sort((a, b) => {
      if ((b.days_with_data || 0) !== (a.days_with_data || 0)) {
        return (b.days_with_data || 0) - (a.days_with_data || 0);
      }
      return (b.total || 0) - (a.total || 0);
    })[0];
  const topApp = Array.isArray(computer?.top_apps) ? computer?.top_apps?.[0] : undefined;
  const topWebsite = Array.isArray(computer?.top_domains) ? computer?.top_domains?.[0] : undefined;
  const occasionalHabits = [...habitsWithData]
    .filter((habit) => (habit.days_with_data || 0) > 0 && (habit.days_with_data || 0) <= Math.max(2, Math.floor(rangeDays / 3)))
    .sort((a, b) => {
      if ((a.days_with_data || 0) !== (b.days_with_data || 0)) {
        return (a.days_with_data || 0) - (b.days_with_data || 0);
      }
      return (b.total_entries || 0) - (a.total_entries || 0);
    })
    .slice(0, 2);

  const openingParts: string[] = [];
  if (consistencyLeaders.length > 1) {
    openingParts.push(
      `${periodLabel} was anchored by ${formatWeeklyNameList(consistencyLeaders.map((habit) => habit.name))}, each logged on ${topConsistencyDays} of ${rangeDays} days.`,
    );
  } else if (mostConsistent) {
    openingParts.push(
      `${periodLabel} was anchored most clearly by ${mostConsistent.name}, which showed up on ${mostConsistent.days_with_data} of ${rangeDays} days.`,
    );
  }
  if (computer && computer.total_hours > 0) {
    openingParts.push(`Computer use averaged ${formatWeeklyNumber(computer.average_daily_hours)}h/day.`);
  }
  if (openingParts.length > 0) {
    lines.push(openingParts.join(' '));
  }

  const rhythmLines: string[] = [];
  if (sleepHabit) {
    const sleepAverage = formatWeeklyValue(sleepHabit.average || 0, sleepHabit.unit);
    if ((sleepHabit.days_with_data || 0) >= Math.max(1, rangeDays - 2)) {
      rhythmLines.push(
        `Sleep averaged ${sleepAverage} across ${sleepHabit.days_with_data} ${sleepHabit.days_with_data === 1 ? 'night' : 'nights'}, which gave the week a fairly stable recovery baseline.`,
      );
    } else {
      rhythmLines.push(
        `Sleep averaged ${sleepAverage} when it was logged, but it only showed up on ${sleepHabit.days_with_data} of ${rangeDays} days, so your recovery picture was thinner than your work tracking.`,
      );
    }

    const sleepShape = describeWeeklyShape(
      'Sleep',
      Array.isArray(sleepHabit.daily)
        ? sleepHabit.daily.map((point) => ({ date: point.date, value: point.value }))
        : [],
    );
    if (sleepShape) {
      rhythmLines.push(sleepShape);
    }
  }

  if (leadWorkHabit) {
    const workShape = describeWeeklyShape(
      leadWorkHabit.name,
      Array.isArray(leadWorkHabit.daily)
        ? leadWorkHabit.daily.map((point) => ({ date: point.date, value: point.value }))
        : [],
    );
    if (workShape) {
      rhythmLines.push(workShape);
    }
  }
  if (rhythmLines.length > 0) {
    lines.push(`**Rhythm**\n${rhythmLines.slice(0, 2).join(' ')}`);
  }

  const computerLines: string[] = [];
  if (computer && computer.total_hours > 0) {
    const computerRange = computer.max_daily_hours - computer.min_daily_hours;
    const computerLine = topApp?.app_name && topWebsite?.domain
      ? `Computer time averaged ${formatWeeklyNumber(computer.average_daily_hours)}h/day, with most of that time concentrated in ${topApp.app_name} and ${topWebsite.domain}.`
      : topApp?.app_name
        ? `Computer time averaged ${formatWeeklyNumber(computer.average_daily_hours)}h/day, and ${topApp.app_name} took the biggest share of that time.`
        : `Computer time averaged ${formatWeeklyNumber(computer.average_daily_hours)}h/day across ${computer.days_with_data || 0} active days.`;
    computerLines.push(computerLine);
    if (computerRange >= 2) {
      computerLines.push(
        `Your digital workload also moved around quite a bit day to day, from ${formatWeeklyNumber(computer.min_daily_hours)}h on the lightest day to ${formatWeeklyNumber(computer.max_daily_hours)}h on the heaviest.`,
      );
    }

    const computerShape = describeWeeklyShape(
      'Computer activity',
      Array.isArray(computer.daily)
        ? computer.daily.map((point) => ({ date: point.day, value: point.active_hours }))
        : [],
    );
    if (computerShape) {
      computerLines.push(computerShape);
    }
  }
  if (computerLines.length > 0) {
    lines.push(`**Computer Use**\n${computerLines.slice(0, 2).join(' ')}`);
  }

  const shiftLines: string[] = [];
  if (occasionalHabits.length > 0) {
    shiftLines.push(
      `The more occasional habits were ${occasionalHabits.map((habit) => `${habit.name} (${habit.days_with_data} ${habit.days_with_data === 1 ? 'day' : 'days'})`).join(' and ')}, so those showed up as situational patterns rather than fixed routines.`,
    );
  }

  if (mostConsistent) {
    const recoveryLagging = sleepHabit
      && normalizeWeeklyHabitName(mostConsistent.name) !== 'sleep duration'
      && (sleepHabit.days_with_data || 0) < (mostConsistent.days_with_data || 0);

    shiftLines.push(
      recoveryLagging
        ? `Overall, the pattern reads as a productive stretch with stronger follow-through on work and learning than on recovery tracking.`
        : `Overall, the week looks structured and repeatable rather than scattered.`,
    );
  }
  if (shiftLines.length > 0) {
    lines.push(`**What Shifted**\n${shiftLines.slice(0, 2).join(' ')}`);
  }

  return lines.slice(0, 4).join('\n\n').trim();
}
