import type { WorkflowKind } from '@/lib/workflows/types';

import type { RoutineDataSourceKey, ScheduleDraft } from './model';
import { defaultScheduleDraft } from './model';

export type RoutineTemplateCategory =
  | 'suggested'
  | 'calendar'
  | 'inbox'
  | 'docs'
  | 'code'
  | 'founders'
  | 'engineering'
  | 'marketing';

export const ROUTINE_TEMPLATE_CATEGORIES: Array<{ id: RoutineTemplateCategory; label: string }> = [
  { id: 'suggested', label: 'Suggested' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'inbox', label: 'Inbox' },
  { id: 'docs', label: 'Docs' },
  { id: 'code', label: 'Code' },
  { id: 'founders', label: 'Founders' },
  { id: 'engineering', label: 'Engineering' },
  { id: 'marketing', label: 'Marketing' },
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
  scheduleLabel: string;
  instructions: string;
};

export function templateScheduleDraft(template: RoutineTemplate): ScheduleDraft {
  return { ...defaultScheduleDraft(), ...template.schedule };
}

export const ROUTINE_TEMPLATES: RoutineTemplate[] = [
  {
    id: 'dont_drop_ball',
    title: "Don't Let Me Drop the Ball",
    description:
      'A daily safety net that checks for overdue tasks, anything waiting on you, and what deserves your attention.',
    categories: ['suggested', 'inbox'],
    icon: 'sparkles',
    workflowKind: 'daily_narrative',
    dataSources: ['calendar', 'screen_time'],
    schedule: { frequency: 'daily', interval: 1, hour: 8, minute: 0 },
    scheduleLabel: 'Daily at 8:00 AM',
    instructions:
      "Check my overdue and Today tasks each morning. Flag anything that's slipping, anyone waiting on me, and what deserves my attention first today.",
  },
  {
    id: 'weekly_focus',
    title: 'Weekly Focus Block Scheduler',
    description:
      'Every Sunday evening, scans the upcoming week and blocks a 60-minute focus session on the busiest days.',
    categories: ['suggested', 'calendar'],
    icon: 'calendar-range',
    workflowKind: 'shutdown_review',
    dataSources: ['calendar', 'coding'],
    schedule: { frequency: 'weekly', interval: 1, weekdays: [6], hour: 18, minute: 0 },
    scheduleLabel: 'Weekly on Sunday at 6:00 PM',
    instructions:
      'Look at my Upcoming tasks for the week ahead and suggest a 60-minute focus block on each day that has a high-priority task due.',
  },
  {
    id: 'followup_drafts',
    title: 'Draft Follow-Up Tasks',
    description:
      "End your day with tomorrow's follow-ups already queued up. Reviews what got done and what's still open.",
    categories: ['suggested', 'docs'],
    icon: 'book-open',
    workflowKind: 'daily_narrative',
    dataSources: ['calendar', 'screen_time'],
    schedule: { frequency: 'daily', interval: 1, hour: 17, minute: 0 },
    scheduleLabel: 'Daily at 5:00 PM',
    instructions:
      "Review today's completed and remaining tasks. Draft any obvious follow-up tasks for tomorrow and add them to my Inbox.",
  },
  {
    id: 'content_ideas',
    title: 'Weekly Content Ideas',
    description:
      'Generates a small batch of content or marketing task drafts based on your recent project activity.',
    categories: ['suggested', 'marketing'],
    icon: 'sparkles',
    workflowKind: 'daily_narrative',
    dataSources: ['coding', 'screen_time'],
    schedule: { frequency: 'weekly', interval: 1, weekdays: [4], hour: 9, minute: 0 },
    scheduleLabel: 'Weekly on Friday at 9:00 AM',
    instructions:
      'Based on my recent project activity and priorities, draft 3 content or marketing task ideas for next week.',
  },
  {
    id: 'inbox_sweep',
    title: 'Inbox Zero Sweep',
    description:
      'Reviews everything sitting in your Inbox and suggests whether it belongs in Today, Upcoming, or Anytime.',
    categories: ['inbox'],
    icon: 'sparkles',
    workflowKind: 'daily_narrative',
    dataSources: ['calendar'],
    schedule: { frequency: 'daily', interval: 1, hour: 18, minute: 0 },
    scheduleLabel: 'Daily at 6:00 PM',
    instructions:
      'Go through my Inbox items and suggest whether each one belongs in Today, Upcoming, or Anytime, and why.',
  },
  {
    id: 'meeting_prep',
    title: 'Meeting Prep Digest',
    description: "Pulls together anything you need to finish before tomorrow's meetings and blocks.",
    categories: ['calendar'],
    icon: 'calendar-range',
    workflowKind: 'daily_narrative',
    dataSources: ['calendar'],
    schedule: { frequency: 'daily', interval: 1, hour: 16, minute: 0 },
    scheduleLabel: 'Daily at 4:00 PM',
    instructions:
      "Check tomorrow's scheduled tasks and events and list anything I should prepare or finish beforehand.",
  },
  {
    id: 'project_recap',
    title: 'Project Notes Recap',
    description: 'Summarizes notes and recent progress across your active projects into one short digest.',
    categories: ['docs', 'founders'],
    icon: 'book-open',
    workflowKind: 'daily_narrative',
    dataSources: ['coding', 'reading'],
    schedule: { frequency: 'weekly', interval: 1, weekdays: [0], hour: 9, minute: 0 },
    scheduleLabel: 'Weekly on Monday at 9:00 AM',
    instructions:
      'Summarize the notes and recent progress across my active projects into a short recap I can skim.',
  },
  {
    id: 'review_queue',
    title: 'Code Review Queue Check',
    description:
      'Checks your engineering tasks for anything blocked on review, merge, or waiting on someone else.',
    categories: ['code', 'engineering'],
    icon: 'code',
    workflowKind: 'daily_narrative',
    dataSources: ['coding'],
    schedule: { frequency: 'daily', interval: 1, hour: 11, minute: 0 },
    scheduleLabel: 'Daily at 11:00 AM',
    instructions:
      'Review my work tasks tagged engineering and flag anything blocked on review or waiting on someone else.',
  },
  {
    id: 'founder_checkin',
    title: 'Weekly Founder Check-in',
    description: 'A Monday morning pulse check on launch tasks, blockers, and the top priorities for the week.',
    categories: ['founders'],
    icon: 'radar',
    workflowKind: 'daily_narrative',
    dataSources: ['calendar', 'coding'],
    schedule: { frequency: 'weekly', interval: 1, weekdays: [0], hour: 8, minute: 0 },
    scheduleLabel: 'Weekly on Monday at 8:00 AM',
    instructions:
      'Summarize progress on my launch-related projects and highlight the top 3 priorities for this week.',
  },
  {
    id: 'standup_summary',
    title: 'Daily Standup Summary',
    description: "Prepares a quick summary of yesterday's progress and today's plan across your work tasks.",
    categories: ['engineering'],
    icon: 'code',
    workflowKind: 'daily_narrative',
    dataSources: ['calendar', 'coding'],
    schedule: { frequency: 'daily', interval: 1, hour: 9, minute: 0 },
    scheduleLabel: 'Daily at 9:00 AM',
    instructions: "Summarize what I completed yesterday and what's planned for today across my work tasks.",
  },
];

export function templatesForCategory(category: RoutineTemplateCategory): RoutineTemplate[] {
  return ROUTINE_TEMPLATES.filter((template) => template.categories.includes(category));
}

export function templateById(id: string | null | undefined): RoutineTemplate | null {
  if (!id) return null;
  return ROUTINE_TEMPLATES.find((template) => template.id === id) || null;
}
