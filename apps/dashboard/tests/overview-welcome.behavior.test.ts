import { describe, expect, it } from 'vitest';

import {
  buildWelcomeInsights,
  getTimeBasedGreeting,
} from '../components/analytics/overview-welcome';
import type { OverviewWidgetMetrics } from '../hooks/use-overview-widget-metrics';

function metrics(overrides: Partial<{
  today: OverviewWidgetMetrics['today'];
  week: OverviewWidgetMetrics['week'];
  streak: OverviewWidgetMetrics['streak'];
  mostTracked: OverviewWidgetMetrics['mostTracked'];
  sleep: OverviewWidgetMetrics['sleep'];
  computerTime: OverviewWidgetMetrics['computerTime'];
}> = {}): OverviewWidgetMetrics {
  return {
    today: { logCount: 0, topHabitName: null },
    week: { thisWeekCount: 0, lastWeekCount: 0, deltaPct: null, dailyCounts: [0, 0, 0, 0, 0, 0, 0] },
    streak: { days: 0 },
    mostTracked: { habitName: null, count: 0 },
    sleep: { lastNightHours: null, sevenDayAvgHours: null, dailySeries: [0, 0, 0, 0, 0, 0, 0] },
    computerTime: { yesterdayHours: null, sevenDayHours: null, dailySeries: [0, 0, 0, 0, 0, 0, 0] },
    isLoading: false,
    ...overrides,
  };
}

describe('Index welcome greeting', () => {
  it('uses Midday hour windows for morning, afternoon, and evening', () => {
    expect(getTimeBasedGreeting(new Date('2026-08-31T04:59:00'))).toBe('Good evening');
    expect(getTimeBasedGreeting(new Date('2026-08-31T05:00:00'))).toBe('Good morning');
    expect(getTimeBasedGreeting(new Date('2026-08-31T11:59:00'))).toBe('Good morning');
    expect(getTimeBasedGreeting(new Date('2026-08-31T12:00:00'))).toBe('Good afternoon');
    expect(getTimeBasedGreeting(new Date('2026-08-31T16:59:00'))).toBe('Good afternoon');
    expect(getTimeBasedGreeting(new Date('2026-08-31T17:00:00'))).toBe('Good evening');
    expect(getTimeBasedGreeting(new Date('2026-08-31T23:30:00'))).toBe('Good evening');
  });

  it('always returns at least two insights so the hover tabs can render', () => {
    const empty = buildWelcomeInsights(metrics());
    expect(empty).toHaveLength(2);
    expect(empty.map((insight) => insight.key)).toEqual(['today', 'streak']);
    expect(empty[0].after).toMatch(/haven.t logged anything yet today/i);
    expect(empty[1].after).toMatch(/start a streak/i);
  });

  it('builds Ritual copy from today, streak, week, sleep, and computer metrics', () => {
    const insights = buildWelcomeInsights(
      metrics({
        today: { logCount: 3, topHabitName: 'Lift' },
        streak: { days: 12 },
        week: { thisWeekCount: 18, lastWeekCount: 12, deltaPct: 50, dailyCounts: [1, 2, 3, 2, 4, 3, 3] },
        sleep: { lastNightHours: 7.4, sevenDayAvgHours: 7.1, dailySeries: [7, 7, 7, 7, 7, 7, 7.4] },
        computerTime: { yesterdayHours: 5.2, sevenDayHours: 30, dailySeries: [4, 5, 5, 4, 4, 5, 5.2] },
      }),
    );

    expect(insights.map((insight) => insight.key)).toEqual(['today', 'streak', 'week', 'sleep', 'computer']);
    expect(insights[0].link).toBe('3 habits');
    expect(insights[0].after).toContain('Lift');
    expect(insights[1].link).toBe('12-day streak');
    expect(insights[2].after).toContain('+50% vs last week');
    expect(insights[3].link).toBe('7.4h');
    expect(insights[4].href).toBe('/integrations');
  });
});
