import { differenceInDays, format, parseISO, subDays } from 'date-fns';
import { computeMeaningfulPercentChange } from '@/lib/analytics-change';
import { COMPUTER_HABIT_DISPLAY_NAME } from '@/lib/computer-time-habit';

export type MetricHabitLike = {
  habit_id: string;
  habit_name: string;
  category?: string;
  unit_type?: string;
  [key: string]: any;
};

export type MetricSummaryLike = {
  unit?: string;
  total_value?: number;
  current_value?: number;
  days_with_data?: number;
  [key: string]: any;
};

export type MetricDailyRow = {
  date?: string;
  day?: string;
  daily_value?: number;
  value?: number;
  total_amount?: number;
  unit?: string;
  total_duration_seconds?: number;
  completed_count?: number;
  entries?: any[];
  sleep_onset?: string | null;
  sleep_end?: string | null;
  time?: string | null;
  completed_at?: string | null;
  active_hours?: number;
  events_count?: number;
  apps_count?: number;
};

export type MetricCardChartPoint = {
  date: string;
  shortDate: string;
  value: number;
  rawDate: Date;
  upValue?: number | null;
  downValue?: number | null;
};

export type MetricCardData = {
  habitName: string;
  currentValue: number;
  unit: string;
  change?: number;
  absoluteChange: number;
  chartData: MetricCardChartPoint[];
  isPositive: boolean;
  higherIsBetter: boolean | null;
  total: number;
  average: number;
  daysWithData: number;
  trendCurrentValue: number;
  trendPreviousValue: number;
  min?: number;
  max?: number;
  events?: number;
  activeDays?: number;
};

export type MetricsBarDatum = {
  habitId: string;
  name: string;
  avg: number;
  unit: string;
  change?: number;
  changeLabel?: string;
  higherIsBetter: boolean | null;
  daysWithData: number;
  category: string;
};

export function getMetricCategoryForHabit(habitName: string, dbCategory?: string): string {
  const name = habitName.toLowerCase();

  if (
    name.includes('sleep') ||
    name.includes('heart') ||
    name.includes('step') ||
    name.includes('walk') ||
    name.includes('workout') ||
    name.includes('exercise') ||
    name.includes('calorie') ||
    name.includes('weight') ||
    name.includes('water') ||
    name.includes('hydrat') ||
    name.includes('running') ||
    name.includes('yoga') ||
    name.includes('stretch') ||
    name.includes('recovery') ||
    name.includes('hrv') ||
    name.includes('resting') ||
    name.includes('strain')
  ) return 'health';

  if (
    name.includes('screen time') ||
    name.includes('computer') ||
    name.includes('social media') ||
    name.includes('phone') ||
    name.includes('digital')
  ) return 'digital';

  if (
    name.includes('coding') ||
    name.includes('deep work') ||
    name.includes('focus') ||
    name.includes('reading') ||
    name.includes('read') ||
    name.includes('journal') ||
    name.includes('meditat') ||
    name.includes('study') ||
    name.includes('writing') ||
    name.includes('planning') ||
    name.includes('time block')
  ) return 'productivity';

  if (
    name.includes('nicotine') ||
    name.includes('caffeine') ||
    name.includes('alcohol') ||
    name.includes('fasting') ||
    name.includes('cold') ||
    name.includes('supplement') ||
    name.includes('nootropic') ||
    name.includes('experiment') ||
    name.includes('tobacco') ||
    name.includes('sugar')
  ) return 'experiments';

  const cat = (dbCategory || '').toLowerCase();
  if (cat.includes('fitness') || cat.includes('health') || cat.includes('wellness')) return 'health';
  if (cat.includes('productivity') || cat.includes('education') || cat.includes('learning')) return 'productivity';
  if (cat.includes('experiment')) return 'experiments';

  return 'experiments';
}

export function mapDailyBreakdownRows(habitId: string, rows: any[]): MetricDailyRow[] {
  return rows.map((point: any) => {
    const entries = Array.isArray(point?.entries) ? point.entries : [];
    const sleepEntry = entries.find((entry: any) => entry?.sleep_start || entry?.sleep_end || entry?.time) || entries[0];

    return {
      habit_id: habitId,
      date: point.date,
      daily_value: Number(point.value ?? point.total_amount ?? 0),
      unit: point.unit,
      total_amount: Number(point.total_amount ?? point.value ?? 0),
      total_duration_seconds: Number(point.total_duration_seconds ?? 0),
      completed_count: entries.length || (Number(point.value || point.total_amount || 0) > 0 ? 1 : 0),
      entries,
      sleep_onset: point.sleep_onset ?? sleepEntry?.sleep_start ?? null,
      sleep_end: point.sleep_end ?? sleepEntry?.sleep_end ?? null,
      time: point.time ?? sleepEntry?.time ?? null,
      completed_at: point.completed_at ?? null,
    };
  });
}

export function inferHigherIsBetter(habitName: string, unit?: string): boolean | null {
  const name = habitName.toLowerCase();
  const u = (unit || '').toLowerCase();

  if (name.includes('nicotine') || name.includes('tobacco') || name.includes('smoking')) return false;
  if (name.includes('alcohol') || name.includes('drinking') || name.includes('drinks')) return false;
  if (name.includes('screen time')) return false;
  if (name.includes('social media') && !name.includes('post')) return false;
  if (name.includes('junk food') || name.includes('fast food')) return false;
  if (name.includes('sugar') && !name.includes('blood')) return false;
  if (name.includes('procrastinat')) return false;
  if (name.includes('caffeine') || name.includes('coffee')) return false;
  if (name.includes('stress')) return false;
  if (name.includes('anxiety')) return false;
  if (name.includes('idle') || name.includes('sedentary') || name.includes('sitting')) return false;

  if (name.includes('sleep') && (u.includes('hour') || u.includes('min'))) return true;
  if (name.includes('workout') || name.includes('exercise') || name.includes('training')) return true;
  if (name.includes('step') || name.includes('walk') || name.includes('run')) return true;
  if (name.includes('reading') || name.includes('read')) return true;
  if (name.includes('meditat')) return true;
  if (name.includes('water') || name.includes('hydrat')) return true;
  if (name.includes('coding') || name.includes('deep work') || name.includes('focus')) return true;
  if (name.includes('journal')) return true;
  if (name.includes('stretching') || name.includes('yoga')) return true;
  if (name.includes('savings') || name.includes('income')) return true;
  if (name.includes('gratitude')) return true;

  return null;
}

function toMetricChartData(rows: MetricDailyRow[]): MetricCardChartPoint[] {
  const chartData = rows
    .map((log) => {
      const date = log.date ? parseISO(log.date) : new Date();
      return {
        date: format(date, 'MMM dd'),
        shortDate: format(date, 'M/d'),
        value: Number(log.daily_value ?? log.value ?? log.total_amount ?? 0),
        rawDate: date,
      };
    })
    .sort((a, b) => a.rawDate.getTime() - b.rawDate.getTime());

  return chartData.map((point, index, arr) => {
    const prevValue = index > 0 ? arr[index - 1].value : point.value;
    return {
      ...point,
      upValue: point.value >= prevValue ? point.value : null,
      downValue: point.value < prevValue ? point.value : null,
    };
  });
}

export function buildHabitMetricCardData({
  habit,
  logs,
  summary,
  isWideRange,
}: {
  habit: MetricHabitLike | null | undefined;
  logs: MetricDailyRow[];
  summary?: MetricSummaryLike;
  isWideRange: boolean;
}): MetricCardData | null {
  if (!habit) return null;

  const chartData = toMetricChartData(logs);
  const safeSummary = summary || {};
  const localTotal = chartData.reduce((sum, d) => sum + d.value, 0);
  const localAverage = chartData.length > 0 ? localTotal / chartData.length : 0;
  const totalValue = Number(safeSummary.total_value ?? localTotal);
  const daysWithData = Number(safeSummary.days_with_data ?? chartData.length);

  let latestValue: number;
  let previousValue: number;
  let currentValue: number;

  if (isWideRange && chartData.length > 0) {
    const now = new Date();
    const thirtyDaysAgo = subDays(now, 30);
    const sixtyDaysAgo = subDays(now, 60);

    const recentDays = chartData.filter((d) => d.rawDate >= thirtyDaysAgo);
    const priorDays = chartData.filter((d) => d.rawDate >= sixtyDaysAgo && d.rawDate < thirtyDaysAgo);

    const recentNonZero = recentDays.filter((d) => d.value > 0);
    const priorNonZero = priorDays.filter((d) => d.value > 0);

    latestValue = recentNonZero.length > 0
      ? recentNonZero.reduce((sum, d) => sum + d.value, 0) / recentNonZero.length
      : 0;
    previousValue = priorNonZero.length > 0
      ? priorNonZero.reduce((sum, d) => sum + d.value, 0) / priorNonZero.length
      : 0;
    currentValue = latestValue || Number(safeSummary.current_value ?? localAverage ?? 0);
  } else {
    const nonZeroDays = chartData.filter((d) => d.value > 0);
    const latestDay = nonZeroDays.length > 0 ? nonZeroDays[nonZeroDays.length - 1] : null;
    const previousDay = nonZeroDays.length > 1 ? nonZeroDays[nonZeroDays.length - 2] : null;

    latestValue = latestDay ? Number(latestDay.value) : 0;
    previousValue = previousDay ? Number(previousDay.value) : 0;
    currentValue = latestValue || Number(safeSummary.current_value ?? localAverage ?? 0);
  }

  const habitUnit = safeSummary.unit || habit.unit_type || habit.unit || 'count';
  let change = computeMeaningfulPercentChange(latestValue, previousValue, habitUnit);
  let absoluteChange = latestValue - previousValue;

  if (change !== undefined && !Number.isFinite(change)) change = 0;
  if (!Number.isFinite(absoluteChange)) absoluteChange = 0;

  return {
    habitName: habit.habit_name,
    currentValue,
    unit: habitUnit,
    change,
    absoluteChange,
    chartData,
    isPositive: (change ?? 0) >= 0,
    higherIsBetter: inferHigherIsBetter(habit.habit_name, habitUnit),
    total: totalValue,
    average: localAverage,
    daysWithData,
    trendCurrentValue: latestValue || currentValue,
    trendPreviousValue: previousValue,
  };
}

export function buildComputerActivityMetricCardData({
  rows,
  isWideRange,
}: {
  rows: MetricDailyRow[];
  isWideRange: boolean;
}): MetricCardData | null {
  if (!rows.length) return null;

  const chartData = rows.map((row) => {
    const date = parseISO(String(row.day));
    return {
      date: format(date, 'MMM dd'),
      shortDate: format(date, 'M/d'),
      value: Number(row.active_hours || 0),
      rawDate: date,
    };
  });

  const values = chartData.map((d) => Number(d.value || 0));
  const total = values.reduce((sum, value) => sum + value, 0);
  const average = values.length > 0 ? total / values.length : 0;

  let latestValue: number;
  let previousValue: number;

  if (isWideRange && chartData.length > 0) {
    const now = new Date();
    const thirtyDaysAgo = subDays(now, 30);
    const sixtyDaysAgo = subDays(now, 60);

    const recentDays = chartData.filter((d) => d.rawDate >= thirtyDaysAgo && d.value > 0);
    const priorDays = chartData.filter((d) => d.rawDate >= sixtyDaysAgo && d.rawDate < thirtyDaysAgo && d.value > 0);

    latestValue = recentDays.length > 0
      ? recentDays.reduce((sum, d) => sum + d.value, 0) / recentDays.length
      : 0;
    previousValue = priorDays.length > 0
      ? priorDays.reduce((sum, d) => sum + d.value, 0) / priorDays.length
      : 0;
  } else {
    const nonZeroDays = chartData.filter((d) => d.value > 0);
    const latestDay = nonZeroDays.length > 0 ? nonZeroDays[nonZeroDays.length - 1] : null;
    const previousDay = nonZeroDays.length > 1 ? nonZeroDays[nonZeroDays.length - 2] : null;
    latestValue = latestDay ? Number(latestDay.value) : 0;
    previousValue = previousDay ? Number(previousDay.value) : 0;
  }

  const change = computeMeaningfulPercentChange(latestValue, previousValue, 'hours');
  const absoluteChange = latestValue - previousValue;

  return {
    habitName: COMPUTER_HABIT_DISPLAY_NAME,
    currentValue: latestValue || average,
    unit: 'hours',
    change,
    absoluteChange: Number.isFinite(absoluteChange) ? absoluteChange : 0,
    chartData,
    isPositive: (change ?? 0) >= 0,
    higherIsBetter: null,
    total,
    average,
    daysWithData: values.filter((value) => value > 0).length,
    min: values.length > 0 ? Math.min(...values) : 0,
    max: values.length > 0 ? Math.max(...values) : 0,
    events: rows.reduce((sum, row) => sum + Number(row.events_count || 0), 0),
    activeDays: values.filter((value) => value > 0).length,
    trendCurrentValue: latestValue || average,
    trendPreviousValue: previousValue,
  };
}

export function buildMetricsBarData({
  habits,
  analyticsDataByHabit,
  summaryByHabit,
  rangeFrom,
  rangeTo,
  computerActivityDaily,
}: {
  habits: MetricHabitLike[];
  analyticsDataByHabit: Record<string, MetricDailyRow[]>;
  summaryByHabit: Record<string, MetricSummaryLike>;
  rangeFrom: Date;
  rangeTo: Date;
  computerActivityDaily: MetricDailyRow[];
}): MetricsBarDatum[] {
  const barData = habits
    .map((habit) => {
      const logs = analyticsDataByHabit[habit.habit_id] || [];
      const unit = summaryByHabit[habit.habit_id]?.unit || habit.unit_type || 'count';
      const higherIsBetter = inferHigherIsBetter(habit.habit_name, unit);

      const rangeLogs = logs.filter((log) => {
        if (!log.date) return false;
        const date = parseISO(log.date);
        return date >= rangeFrom && date <= rangeTo;
      });
      if (rangeLogs.length === 0) return null;

      const values = rangeLogs
        .map((log) => Number(log.daily_value ?? log.value ?? log.total_amount ?? 0))
        .filter((value) => value > 0);
      if (values.length === 0) return null;

      const useAverage = habit.habit_name.toLowerCase().includes('heart rate');
      const total = values.reduce((sum, value) => sum + value, 0);
      const displayVal = useAverage ? total / values.length : total;

      const midPoint = new Date((rangeFrom.getTime() + rangeTo.getTime()) / 2);
      const firstHalf = rangeLogs.filter((log) => parseISO(String(log.date)) < midPoint);
      const secondHalf = rangeLogs.filter((log) => parseISO(String(log.date)) >= midPoint);
      const firstValues = firstHalf
        .map((log) => Number(log.daily_value ?? log.value ?? log.total_amount ?? 0))
        .filter((value) => value > 0);
      const secondValues = secondHalf
        .map((log) => Number(log.daily_value ?? log.value ?? log.total_amount ?? 0))
        .filter((value) => value > 0);

      const firstSum = firstValues.reduce((sum, value) => sum + value, 0);
      const secondSum = secondValues.reduce((sum, value) => sum + value, 0);
      const firstCompare = useAverage && firstValues.length > 0 ? firstSum / firstValues.length : firstSum;
      const secondCompare = useAverage && secondValues.length > 0 ? secondSum / secondValues.length : secondSum;
      const change = computeMeaningfulPercentChange(secondCompare, firstCompare, unit);

      return {
        habitId: habit.habit_id,
        name: habit.habit_name,
        avg: displayVal,
        unit,
        change,
        changeLabel: change === undefined ? 'New' : undefined,
        higherIsBetter,
        daysWithData: values.length,
        category: getMetricCategoryForHabit(habit.habit_name, habit.category),
      };
    })
    .filter((value): value is NonNullable<typeof value> => value !== null);

  if (computerActivityDaily.length > 0) {
    const compLogs = computerActivityDaily.filter((row) => {
      const date = parseISO(String(row.day));
      return date >= rangeFrom && date <= rangeTo;
    });
    const compValues = compLogs.map((row) => Number(row.active_hours || 0)).filter((value) => value > 0);
    if (compValues.length > 0) {
      const compTotal = compValues.reduce((sum, value) => sum + value, 0);
      const midPoint = new Date((rangeFrom.getTime() + rangeTo.getTime()) / 2);
      const compFirst = compLogs
        .filter((row) => parseISO(String(row.day)) < midPoint)
        .map((row) => Number(row.active_hours || 0))
        .filter((value) => value > 0);
      const compSecond = compLogs
        .filter((row) => parseISO(String(row.day)) >= midPoint)
        .map((row) => Number(row.active_hours || 0))
        .filter((value) => value > 0);
      const compFirstTotal = compFirst.reduce((sum, value) => sum + value, 0);
      const compSecondTotal = compSecond.reduce((sum, value) => sum + value, 0);
      const compChange = computeMeaningfulPercentChange(compSecondTotal, compFirstTotal, 'hours');
      barData.push({
        habitId: '__computer_activity__',
        name: COMPUTER_HABIT_DISPLAY_NAME,
        avg: compTotal,
        unit: 'Hours',
        change: compChange,
        changeLabel: compChange === undefined ? 'New' : undefined,
        higherIsBetter: null,
        daysWithData: compValues.length,
        category: 'digital',
      });
    }
  }

  return barData;
}

export function buildMetricStreakData(
  barData: MetricsBarDatum[],
  analyticsDataByHabit: Record<string, MetricDailyRow[]>,
): Array<{ name: string; streak: number }> {
  return barData
    .map((metric) => {
      const logs = analyticsDataByHabit[metric.habitId] || [];
      let streak = 0;
      if (logs.length > 0) {
        const sortedDates = logs
          .map((log) => log.date)
          .filter(Boolean)
          .sort()
          .reverse();
        if (sortedDates.length > 0) {
          streak = 1;
          for (let i = 1; i < sortedDates.length; i += 1) {
            const current = parseISO(String(sortedDates[i - 1]));
            const previous = parseISO(String(sortedDates[i]));
            const diff = differenceInDays(current, previous);
            if (diff <= 1) streak += 1;
            else break;
          }
        }
      }
      return { name: metric.name, streak };
    })
    .sort((left, right) => right.streak - left.streak);
}

export function formatMetricBarValue(value: number, unit: string): string {
  const lowerUnit = unit.toLowerCase();
  const shortUnit = lowerUnit === 'milligrams' ? 'mg' : unit;
  const formatted = value >= 1000
    ? Math.round(value).toLocaleString()
    : value >= 10
      ? value.toFixed(1)
      : value.toFixed(2);
  return `${formatted} ${shortUnit}`.trim();
}
