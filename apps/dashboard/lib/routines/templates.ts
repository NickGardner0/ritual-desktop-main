import type { WorkflowKind } from '@/lib/workflows/types';

import type { RoutineDataSourceKey, ScheduleDraft } from './model';
import { defaultScheduleDraft } from './model';

export type RoutineTemplateCategory = 'suggested' | 'sleep' | 'fitness' | 'focus' | 'reading' | 'coding' | 'reviews';

export const ROUTINE_TEMPLATE_CATEGORIES: Array<{ id: RoutineTemplateCategory; label: string }> = [
  { id: 'suggested', label: 'Suggested' },
  { id: 'sleep', label: 'Sleep' },
  { id: 'fitness', label: 'Fitness' },
  { id: 'focus', label: 'Focus' },
  { id: 'reading', label: 'Reading' },
  { id: 'coding', label: 'Coding' },
  { id: 'reviews', label: 'Reviews' },
];

export type RoutineTemplate = {
  id: string;
  title: string;
  description: string;
  categories: RoutineTemplateCategory[];
  icon: string;
  workflowKind: WorkflowKind;
  dataSources: RoutineDataSourceKey[];
  schedule: Partial<ScheduleDraft>;
  instructions: string;
};

export function templateScheduleDraft(template: RoutineTemplate): ScheduleDraft {
  return { ...defaultScheduleDraft(), ...template.schedule };
}

export const ROUTINE_TEMPLATES: RoutineTemplate[] = [
  {
    id: 'morning_readiness_brief',
    title: 'Morning Readiness Brief',
    description: 'Compares last night’s sleep to your 30-day baseline and suggests how hard to train today.',
    categories: ['suggested', 'sleep', 'fitness'],
    icon: 'sunrise',
    workflowKind: 'morning_brief',
    dataSources: ['sleep', 'workouts'],
    schedule: { frequency: 'daily', interval: 1, hour: 7, minute: 30 },
    instructions:
      'Summarize last night’s sleep against my 30-day baseline: total time, bedtime, and wake time. '
      + 'Call it out plainly if I slept short or went to bed late — don’t soften it. '
      + 'Then look at my recent workouts and tell me how hard to train today: push, maintain, or back off. '
      + 'One recommendation, with the single number that justifies it. Keep the whole brief under 150 words.',
  },
  {
    id: 'weekly_training_review',
    title: 'Weekly Training Review',
    description: 'Volume, consistency, and streaks for the week, with one concrete change for next week.',
    categories: ['suggested', 'fitness', 'reviews'],
    icon: 'dumbbell',
    workflowKind: 'shutdown_review',
    dataSources: ['workouts', 'steps'],
    schedule: { frequency: 'weekly', interval: 1, weekdays: [6], hour: 18, minute: 0 },
    instructions:
      'Review my training week: total workout volume, how many days I trained versus planned, and where my streaks stand. '
      + 'Compare against the previous two weeks so I can see the trend, and include daily steps as a floor signal. '
      + 'End with exactly one concrete suggestion for next week — a specific day and a specific change, not “be more consistent”.',
  },
  {
    id: 'screen_time_reality_check',
    title: 'Screen Time Reality Check',
    description: 'Today’s screen time versus your weekly average, the biggest sink, and what it cost you.',
    categories: ['suggested', 'focus'],
    icon: 'monitor-smartphone',
    workflowKind: 'distraction_spiral',
    dataSources: ['screen_time', 'sleep', 'steps'],
    schedule: { frequency: 'daily', interval: 1, hour: 21, minute: 0 },
    instructions:
      'Compare today’s total screen time to my weekly average and name the single biggest sink by app. '
      + 'Be blunt about whether today was better or worse than usual. '
      + 'If my sleep or steps moved on days with heavy screen time this week, point at the correlation with the actual numbers. '
      + 'No lectures — just the facts and one thing to do differently tomorrow.',
  },
  {
    id: 'deep_work_ledger',
    title: 'Deep Work Ledger',
    description: 'Coding hours, longest focus block, and your interruption pattern versus the trailing two weeks.',
    categories: ['focus', 'coding'],
    icon: 'code',
    workflowKind: 'daily_narrative',
    dataSources: ['coding', 'screen_time'],
    schedule: { frequency: 'weekly', interval: 1, weekdays: [0, 1, 2, 3, 4], hour: 17, minute: 30 },
    instructions:
      'Log today’s deep work: total coding hours, my longest unbroken focus block, and how often I got pulled away. '
      + 'Compare against my trailing two weeks — am I protecting focus better or worse? '
      + 'Name the app or pattern that broke up my longest session. '
      + 'Keep it ledger-style: numbers first, one line of interpretation at the end.',
  },
  {
    id: 'reading_momentum',
    title: 'Reading Momentum',
    description: 'Weekly pages and minutes, pace toward your current book, and a nudge if the streak is slipping.',
    categories: ['reading'],
    icon: 'book-open',
    workflowKind: 'daily_narrative',
    dataSources: ['reading'],
    schedule: { frequency: 'weekly', interval: 1, weekdays: [4], hour: 17, minute: 0 },
    instructions:
      'Sum up my reading this week: total minutes and pages, which days I read, and how that compares to my recent average. '
      + 'At my current pace, estimate when I’ll finish the book I’m reading. '
      + 'If my streak is about to break or already broke, say so gently and suggest the easiest slot this weekend to get it back. '
      + 'Keep it short and warm — this one’s encouragement, not an audit.',
  },
  {
    id: 'monthly_life_report',
    title: 'Monthly Life Report',
    description: 'A cross-metric month in review: three highlights, three concerns, one experiment to run.',
    categories: ['suggested', 'reviews'],
    icon: 'calendar-range',
    workflowKind: 'daily_narrative',
    dataSources: ['sleep', 'workouts', 'steps', 'screen_time', 'coding', 'reading'],
    schedule: { frequency: 'monthly', interval: 1, day: 1, hour: 9, minute: 0 },
    instructions:
      'Write my month in review across everything Ritual tracks: sleep, workouts, steps, screen time, coding, and reading. '
      + 'Give me exactly three highlights (with the numbers that earn the spot), three concerns (with the trend that worries you), '
      + 'and one experiment worth running next month — something specific and measurable I could set up in Experiments. '
      + 'Compare the month to the previous one where it changes the story. This is the one report I keep, so make it worth keeping.',
  },
  {
    id: 'anomaly_watch',
    title: 'Anomaly Watch',
    description: 'Scans every metric for a >2σ deviation from baseline. Quiet when nothing is notable.',
    categories: ['suggested'],
    icon: 'radar',
    workflowKind: 'daily_narrative',
    dataSources: ['sleep', 'workouts', 'steps', 'screen_time', 'coding', 'reading'],
    schedule: { frequency: 'daily', interval: 1, hour: 8, minute: 0 },
    instructions:
      'Scan yesterday’s metrics against their 30-day baselines and only flag deviations bigger than two standard deviations — '
      + 'in either direction. For each anomaly: the metric, yesterday’s value, the baseline, and one plausible cause from the rest of my data. '
      + 'If nothing crossed the threshold, say exactly “Nothing notable — all metrics within normal range.” and stop. '
      + 'Never pad a quiet day into a report.',
  },
];

export function templatesForCategory(category: RoutineTemplateCategory): RoutineTemplate[] {
  return ROUTINE_TEMPLATES.filter((template) => template.categories.includes(category));
}

export function templateById(id: string | null | undefined): RoutineTemplate | null {
  if (!id) return null;
  return ROUTINE_TEMPLATES.find((template) => template.id === id) || null;
}
