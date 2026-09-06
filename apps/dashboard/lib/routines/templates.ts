import type { WorkflowKind } from '@/lib/workflows/types';

import type { AgentTier, RoutineDataSourceKey, ScheduleDraft } from './model';
import { defaultScheduleDraft } from './model';

export type RoutineTemplateCategory =
  | 'suggested'
  | 'productivity'
  | 'screen-time'
  | 'sleep'
  | 'fitness'
  | 'learning'
  | 'health'
  | 'experiments';

export const ROUTINE_TEMPLATE_CATEGORIES: Array<{ id: RoutineTemplateCategory; label: string }> = [
  { id: 'suggested', label: 'Suggested' },
  { id: 'productivity', label: 'Productivity' },
  { id: 'screen-time', label: 'Screen Time' },
  { id: 'sleep', label: 'Sleep' },
  { id: 'fitness', label: 'Fitness' },
  { id: 'learning', label: 'Learning' },
  { id: 'health', label: 'Health' },
  { id: 'experiments', label: 'Experiments' },
];

export type RoutineTemplate = {
  id: string;
  title: string;
  description: string;
  categories: RoutineTemplateCategory[];
  icon: string;
  workflowKind: WorkflowKind;
  agentTier?: AgentTier;
  dataSources: RoutineDataSourceKey[];
  schedule: Partial<ScheduleDraft>;
  scheduleLabel: string;
  instructions: string;
};

export function templateScheduleDraft(template: RoutineTemplate): ScheduleDraft {
  return { ...defaultScheduleDraft(), ...template.schedule };
}

export const ROUTINE_TEMPLATES: RoutineTemplate[] = [
  {
    id: 'daily_activity_summary',
    title: 'Daily Activity Summary',
    description: 'A concise daily readout of movement, screen time, focused work, habits, and recovery signals.',
    categories: ['suggested', 'productivity', 'health'],
    icon: 'sparkles',
    workflowKind: 'daily_narrative',
    dataSources: ['sleep', 'workouts', 'steps', 'screen_time', 'coding', 'reading', 'calendar'],
    schedule: { frequency: 'daily', interval: 1, hour: 20, minute: 0 },
    scheduleLabel: 'Daily at 8:00 PM',
    instructions:
      'Summarize my day across movement, workouts, sleep and recovery, screen time, focused computer work, learning habits, and calendar load. Highlight the two most useful numbers and one pattern worth watching.',
  },
  {
    id: 'weekly_personal_trends',
    title: 'Weekly Personal Trends',
    description: 'Compares this week with your recent baseline and surfaces the changes that matter most.',
    categories: ['suggested', 'health', 'experiments'],
    icon: 'radar',
    workflowKind: 'shutdown_review',
    dataSources: ['sleep', 'workouts', 'steps', 'screen_time', 'coding', 'reading', 'calendar'],
    schedule: { frequency: 'weekly', interval: 1, weekdays: [6], hour: 18, minute: 0 },
    scheduleLabel: 'Weekly on Sunday at 6:00 PM',
    instructions:
      'Compare this week with my recent baseline across sleep, activity, workouts, screen time, focused work, learning, and calendar load. Identify meaningful changes, possible relationships between metrics, and one question to investigate next week.',
  },
  {
    id: 'sleep_recovery_review',
    title: 'Sleep & Recovery Review',
    description: 'Connects last night\'s sleep and recovery signals with recent activity and workload.',
    categories: ['suggested', 'sleep', 'health'],
    icon: 'sunrise',
    workflowKind: 'morning_brief',
    dataSources: ['sleep', 'workouts', 'steps'],
    schedule: { frequency: 'daily', interval: 1, hour: 8, minute: 0 },
    scheduleLabel: 'Daily at 8:00 AM',
    instructions:
      'Review my latest sleep and recovery signals alongside recent workouts and activity. Tell me what is notably above or below my baseline and whether today looks better suited to recovery, normal activity, or a harder effort.',
  },
  {
    id: 'screen_time_reality_check',
    title: 'Screen Time Reality Check',
    description: 'Shows where device time went and separates focused use from likely distraction.',
    categories: ['suggested', 'productivity', 'screen-time'],
    icon: 'monitor-smartphone',
    workflowKind: 'shutdown_review',
    dataSources: ['screen_time', 'coding'],
    schedule: { frequency: 'weekly', interval: 1, weekdays: [4], hour: 17, minute: 0 },
    scheduleLabel: 'Weekly on Friday at 5:00 PM',
    instructions:
      'Review my screen time and computer activity for the week. Separate focused or productive use from likely distraction, name the apps or periods driving the change, and compare the pattern with my recent baseline.',
  },
  {
    id: 'workout_consistency_review',
    title: 'Workout Consistency Review',
    description: 'Tracks workout frequency, movement, and recovery so training patterns are easy to see.',
    categories: ['suggested', 'fitness', 'health'],
    icon: 'dumbbell',
    workflowKind: 'shutdown_review',
    dataSources: ['workouts', 'steps', 'sleep'],
    schedule: { frequency: 'weekly', interval: 1, weekdays: [6], hour: 17, minute: 0 },
    scheduleLabel: 'Weekly on Sunday at 5:00 PM',
    instructions:
      'Review my workout frequency, active days, steps, and recovery this week. Compare them with my recent pattern and call out consistency, unusually hard or easy days, and any recovery tradeoffs.',
  },
  {
    id: 'weekly_experiment_checkin',
    title: 'Weekly Experiment Check-In',
    description: 'Reviews the metrics behind your current behavior experiment and whether the signal is changing.',
    categories: ['suggested', 'experiments'],
    icon: 'radar',
    workflowKind: 'daily_narrative',
    dataSources: ['sleep', 'workouts', 'steps', 'screen_time', 'reading'],
    schedule: { frequency: 'weekly', interval: 1, weekdays: [2], hour: 10, minute: 0 },
    scheduleLabel: 'Weekly on Wednesday at 10:00 AM',
    instructions:
      'Review the measurable signals related to my current habit experiment. Compare recent results with the prior period, distinguish signal from normal variation, and suggest whether I should continue, adjust, or stop the experiment.',
  },
  {
    id: 'focus_distraction_balance',
    title: 'Focus vs. Distraction',
    description: 'Compares focused computer time with distracting apps and fragmented calendar days.',
    categories: ['productivity', 'screen-time'],
    icon: 'monitor-smartphone',
    workflowKind: 'shutdown_review',
    dataSources: ['screen_time', 'coding', 'calendar'],
    schedule: { frequency: 'weekly', interval: 1, weekdays: [4], hour: 16, minute: 30 },
    scheduleLabel: 'Weekly on Friday at 4:30 PM',
    instructions:
      'Compare my focused computer time with distracting app use and calendar fragmentation this week. Identify the days and time periods where focus was strongest or weakest and the conditions that may have contributed.',
  },
  {
    id: 'weekly_work_rhythm',
    title: 'Weekly Work Rhythm',
    description: 'Finds when you do your best focused work and how meetings affect that rhythm.',
    categories: ['productivity'],
    icon: 'calendar-range',
    workflowKind: 'shutdown_review',
    dataSources: ['coding', 'screen_time', 'calendar'],
    schedule: { frequency: 'weekly', interval: 1, weekdays: [4], hour: 17, minute: 30 },
    scheduleLabel: 'Weekly on Friday at 5:30 PM',
    instructions:
      'Analyze my focused computer activity, total screen time, and calendar load across the week. Identify my most productive windows, the days most affected by meetings or context switching, and a realistic schedule adjustment for next week.',
  },
  {
    id: 'evening_screen_time',
    title: 'Evening Screen Time Review',
    description: 'Measures late-day device use and whether it is drifting beyond your normal pattern.',
    categories: ['screen-time', 'sleep'],
    icon: 'monitor-smartphone',
    workflowKind: 'shutdown_review',
    dataSources: ['screen_time', 'sleep'],
    schedule: { frequency: 'daily', interval: 1, hour: 21, minute: 30 },
    scheduleLabel: 'Daily at 9:30 PM',
    instructions:
      'Review my evening screen time and compare it with my normal pattern. Flag unusually late or heavy use, name the apps contributing most, and note whether recent sleep appears to move with the pattern.',
  },
  {
    id: 'app_use_drift',
    title: 'App Use Drift Alert',
    description: 'Flags apps or websites whose usage is rising meaningfully from your baseline.',
    categories: ['screen-time', 'productivity'],
    icon: 'radar',
    workflowKind: 'daily_narrative',
    dataSources: ['screen_time', 'coding'],
    schedule: { frequency: 'weekly', interval: 1, weekdays: [4], hour: 18, minute: 0 },
    scheduleLabel: 'Weekly on Friday at 6:00 PM',
    instructions:
      'Compare this week\'s app and website usage with my recent baseline. Flag only meaningful increases or decreases, distinguish focused tools from distraction, and tell me which change is most worth paying attention to.',
  },
  {
    id: 'sleep_consistency',
    title: 'Sleep Consistency Report',
    description: 'Tracks sleep regularity, duration, and recovery changes across the week.',
    categories: ['sleep', 'health'],
    icon: 'sunrise',
    workflowKind: 'morning_brief',
    dataSources: ['sleep'],
    schedule: { frequency: 'weekly', interval: 1, weekdays: [6], hour: 9, minute: 0 },
    scheduleLabel: 'Weekly on Sunday at 9:00 AM',
    instructions:
      'Analyze my sleep consistency and recovery over the past week. Compare duration and biometric signals with my recent baseline, identify the most unusual nights, and describe the clearest pattern without overclaiming causation.',
  },
  {
    id: 'recovery_workload_balance',
    title: 'Recovery vs. Workload',
    description: 'Compares sleep and recovery with recent workouts and overall movement.',
    categories: ['sleep', 'fitness', 'health'],
    icon: 'dumbbell',
    workflowKind: 'morning_brief',
    dataSources: ['sleep', 'workouts', 'steps'],
    schedule: { frequency: 'daily', interval: 1, hour: 8, minute: 30 },
    scheduleLabel: 'Daily at 8:30 AM',
    instructions:
      'Compare my latest sleep and recovery signals with recent workouts and daily movement. Highlight possible under-recovery or inactivity, using my own baseline rather than generic targets.',
  },
  {
    id: 'activity_step_trend',
    title: 'Activity & Step Trend',
    description: 'Summarizes active days, movement consistency, and meaningful changes in activity.',
    categories: ['fitness', 'health'],
    icon: 'dumbbell',
    workflowKind: 'shutdown_review',
    dataSources: ['workouts', 'steps'],
    schedule: { frequency: 'weekly', interval: 1, weekdays: [5], hour: 18, minute: 0 },
    scheduleLabel: 'Weekly on Saturday at 6:00 PM',
    instructions:
      'Summarize my workouts, active days, and step patterns this week. Compare them with the previous period, highlight the largest changes, and identify whether activity was consistent or concentrated into only a few days.',
  },
  {
    id: 'learning_time_review',
    title: 'Learning Time Review',
    description: 'Measures time spent reading and learning against the rest of your digital activity.',
    categories: ['learning', 'productivity'],
    icon: 'book-open',
    workflowKind: 'shutdown_review',
    dataSources: ['reading', 'screen_time'],
    schedule: { frequency: 'weekly', interval: 1, weekdays: [6], hour: 18, minute: 30 },
    scheduleLabel: 'Weekly on Sunday at 6:30 PM',
    instructions:
      'Review my reading and learning activity for the week alongside overall screen time. Show whether learning time is growing, stable, or slipping and identify the days where I made the most consistent progress.',
  },
  {
    id: 'reading_momentum',
    title: 'Reading Momentum',
    description: 'Tracks reading consistency and highlights when your learning habit is gaining or losing momentum.',
    categories: ['learning'],
    icon: 'book-open',
    workflowKind: 'daily_narrative',
    dataSources: ['reading'],
    schedule: { frequency: 'weekly', interval: 1, weekdays: [6], hour: 19, minute: 0 },
    scheduleLabel: 'Weekly on Sunday at 7:00 PM',
    instructions:
      'Review my reading or learning habit over the past week. Report consistency and streak momentum, compare it with the prior period, and suggest one small adjustment based on the days I followed through most reliably.',
  },
  {
    id: 'health_baseline_pulse',
    title: 'Monthly Health Baseline',
    description: 'A monthly comparison of sleep, recovery, movement, and workout patterns.',
    categories: ['health'],
    icon: 'radar',
    workflowKind: 'daily_narrative',
    agentTier: 'max',
    dataSources: ['sleep', 'workouts', 'steps'],
    schedule: { frequency: 'monthly', interval: 1, day: 1, hour: 9, minute: 0 },
    scheduleLabel: 'Monthly on the 1st at 9:00 AM',
    instructions:
      'Compare my sleep, recovery, workouts, and movement over the past month with my longer-term baseline. Highlight sustained changes rather than one-off spikes and list the metrics I should continue watching next month.',
  },
  {
    id: 'before_after_experiment',
    title: 'Before & After Experiment Review',
    description: 'Compares a behavior change with your prior baseline across the metrics it may influence.',
    categories: ['experiments'],
    icon: 'radar',
    workflowKind: 'daily_narrative',
    agentTier: 'max',
    dataSources: ['sleep', 'workouts', 'steps', 'screen_time', 'reading'],
    schedule: { frequency: 'weekly', interval: 1, weekdays: [6], hour: 16, minute: 0 },
    scheduleLabel: 'Weekly on Sunday at 4:00 PM',
    instructions:
      'Compare the period since I started my current behavior change with the preceding baseline. Review the relevant sleep, activity, screen time, and habit signals, call out confounders or missing data, and summarize whether the evidence is promising, neutral, or negative.',
  },
];

export function templatesForCategory(category: RoutineTemplateCategory): RoutineTemplate[] {
  return ROUTINE_TEMPLATES.filter((template) => template.categories.includes(category));
}

export function templateById(id: string | null | undefined): RoutineTemplate | null {
  if (!id) return null;
  return ROUTINE_TEMPLATES.find((template) => template.id === id) || null;
}
