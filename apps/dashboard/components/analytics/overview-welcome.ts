import type { OverviewWidgetMetrics } from '@/hooks/use-overview-widget-metrics';

export type WelcomeInsight = {
  key: string;
  before: string;
  link: string;
  after: string;
  href: string;
};

export const WELCOME_TICK_DURATION_MS = 6000;

export function getTimeBasedGreeting(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function formatHours(hours: number | null): string | null {
  if (hours === null || !Number.isFinite(hours) || hours <= 0) return null;
  if (hours >= 10) return `${Math.round(hours)}h`;
  return `${hours.toFixed(1)}h`;
}

function pluralize(count: number, singular: string, plural?: string): string {
  if (count === 1) return singular;
  return plural ?? `${singular}s`;
}

export function buildWelcomeInsights(metrics: OverviewWidgetMetrics): WelcomeInsight[] {
  const insights: WelcomeInsight[] = [];

  if (metrics.today.logCount === 0) {
    insights.push({
      key: 'today',
      href: '/dashboard',
      before: '',
      link: '',
      after: "You haven't logged anything yet today.",
    });
  } else if (metrics.today.topHabitName) {
    insights.push({
      key: 'today',
      href: '/dashboard',
      before: "You've logged ",
      link: `${metrics.today.logCount} ${pluralize(metrics.today.logCount, 'habit')}`,
      after: ` today, most often ${metrics.today.topHabitName}.`,
    });
  } else {
    insights.push({
      key: 'today',
      href: '/dashboard',
      before: "You've logged ",
      link: `${metrics.today.logCount} ${pluralize(metrics.today.logCount, 'habit')}`,
      after: ' today.',
    });
  }

  if (metrics.streak.days > 0) {
    insights.push({
      key: 'streak',
      href: '/dashboard',
      before: "You're on a ",
      link: `${metrics.streak.days}-day streak`,
      after: '.',
    });
  } else {
    insights.push({
      key: 'streak',
      href: '/dashboard',
      before: '',
      link: '',
      after: 'Log any habit today to start a streak.',
    });
  }

  if (metrics.week.thisWeekCount > 0 && metrics.week.deltaPct !== null) {
    const sign = metrics.week.deltaPct > 0 ? '+' : '';
    const comparison =
      metrics.week.deltaPct === 0
        ? 'the same as last week'
        : `${sign}${metrics.week.deltaPct}% vs last week`;
    insights.push({
      key: 'week',
      href: '/dashboard?view=metrics',
      before: 'This week you have ',
      link: `${metrics.week.thisWeekCount} ${pluralize(metrics.week.thisWeekCount, 'log')}`,
      after: `, ${comparison}.`,
    });
  }

  const sleepHours = formatHours(metrics.sleep.lastNightHours);
  if (sleepHours) {
    const avg = formatHours(metrics.sleep.sevenDayAvgHours);
    insights.push({
      key: 'sleep',
      href: '/dashboard?view=metrics',
      before: 'You slept ',
      link: sleepHours,
      after: avg && avg !== sleepHours ? ` last night, against a 7-day average of ${avg}.` : ' last night.',
    });
  }

  const computerHours = formatHours(metrics.computerTime.yesterdayHours);
  if (computerHours) {
    insights.push({
      key: 'computer',
      href: '/integrations',
      before: 'You spent ',
      link: computerHours,
      after: ' on your computer yesterday.',
    });
  }

  return insights;
}
