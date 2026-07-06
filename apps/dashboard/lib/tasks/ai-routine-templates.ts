import type { RoutineCreateInput } from './types';
import type { WorkflowDefinition, WorkflowDefinitionCreateInput, WorkflowKind } from '@/lib/workflows/types';

export type AiRoutineTemplate = {
  id: string;
  title: string;
  description: string;
  category: RoutineTemplateCategory;
  sourceIcon: string;
  workflowKind: WorkflowKind;
  cadence: 'daily' | 'weekly';
  hour: number;
  minute: number;
  weekdays: number[];
  tags: string[];
  config: Record<string, unknown>;
};

export type RoutineTemplateCategory =
  | 'Suggested'
  | 'Calendar'
  | 'Inbox'
  | 'Docs'
  | 'Code'
  | 'Founders'
  | 'Engineering'
  | 'Marketing'
  | 'Health'
  | 'Experiments'
  | 'AI';

export const ROUTINE_TEMPLATE_CATEGORIES: RoutineTemplateCategory[] = [
  'Suggested',
  'Calendar',
  'Inbox',
  'Docs',
  'Code',
  'Founders',
  'Engineering',
  'Marketing',
  'Health',
  'Experiments',
  'AI',
];

export const AI_ROUTINE_TEMPLATES: AiRoutineTemplate[] = [
  {
    id: 'daily_activity_summary',
    title: 'Daily Activity Summary',
    description: 'Summarizes the day from tasks, logs, calendar, computer activity, and habit signals.',
    category: 'Suggested',
    sourceIcon: 'Sparkles',
    workflowKind: 'daily_narrative',
    cadence: 'daily',
    hour: 17,
    minute: 15,
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    tags: ['ai', 'daily-summary'],
    config: {
      publish_inbox_card: true,
      publish_artifact: true,
      include_activity_summary: true,
      include_habit_overview: true,
      include_computer_time: true,
    },
  },
  {
    id: 'yesterdays_work_summary',
    title: "Yesterday's Work Summary",
    description: "Creates a concise morning brief from yesterday's focus blocks, active apps, and unfinished work.",
    category: 'AI',
    sourceIcon: 'History',
    workflowKind: 'morning_brief',
    cadence: 'daily',
    hour: 8,
    minute: 15,
    weekdays: [0, 1, 2, 3, 4],
    tags: ['ai', 'work-summary'],
    config: {
      include_activity_summary: true,
      include_computer_time: true,
      include_calendar: true,
      focus_on_yesterday: true,
    },
  },
  {
    id: 'weekly_work_review',
    title: 'Weekly Work Review',
    description: 'Summarizes priorities, habit drift, calendar load, and loose ends before the next week starts.',
    category: 'Suggested',
    sourceIcon: 'Calendar',
    workflowKind: 'shutdown_review',
    cadence: 'weekly',
    hour: 16,
    minute: 0,
    weekdays: [4],
    tags: ['ai', 'review'],
    config: {
      include_activity_summary: true,
      include_habit_overview: true,
      include_computer_time: true,
      include_weekly_context: true,
    },
  },
  {
    id: 'experiment_check_in',
    title: 'Experiment Check-In',
    description: 'Reviews active experiments, metrics, and next actions on a regular cadence.',
    category: 'Experiments',
    sourceIcon: 'FlaskConical',
    workflowKind: 'morning_brief',
    cadence: 'weekly',
    hour: 10,
    minute: 0,
    weekdays: [2],
    tags: ['ai', 'experiments'],
    config: {
      include_calendar: true,
      include_streaks: true,
      include_experiments: true,
      include_metric_deltas: true,
    },
  },
  {
    id: 'recovery_review',
    title: 'Recovery Review',
    description: 'Checks sleep, biometrics, workload, and friction signals before planning the day.',
    category: 'Health',
    sourceIcon: 'HeartPulse',
    workflowKind: 'morning_brief',
    cadence: 'daily',
    hour: 8,
    minute: 30,
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    tags: ['ai', 'health'],
    config: {
      include_biometrics: true,
      include_streaks: true,
      include_recovery_context: true,
    },
  },
  {
    id: 'weekly_focus_block_scheduler',
    title: 'Weekly Focus Block Scheduler',
    description: 'Looks for fragmented workdays and drafts protected focus blocks.',
    category: 'Calendar',
    sourceIcon: 'CalendarClock',
    workflowKind: 'distraction_spiral',
    cadence: 'weekly',
    hour: 9,
    minute: 15,
    weekdays: [0],
    tags: ['ai', 'focus'],
    config: {
      publish_inbox_card: true,
      publish_artifact: true,
      suggest_focus_block: true,
      schedule_focus_blocks: true,
    },
  },
  {
    id: 'metrics_anomaly_scanner',
    title: 'Metrics Anomaly Scanner',
    description: 'Surfaces unusual movement in habits, biometrics, screen time, and finance-adjacent metrics.',
    category: 'AI',
    sourceIcon: 'Radar',
    workflowKind: 'daily_narrative',
    cadence: 'daily',
    hour: 12,
    minute: 0,
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    tags: ['ai', 'metrics'],
    config: {
      publish_inbox_card: true,
      publish_artifact: true,
      scan_metric_anomalies: true,
    },
  },
  {
    id: 'screen_time_review',
    title: 'Screen Time Review',
    description: 'Reviews computer and device time patterns with specific course-correction prompts.',
    category: 'Health',
    sourceIcon: 'MonitorCheck',
    workflowKind: 'shutdown_review',
    cadence: 'daily',
    hour: 17,
    minute: 30,
    weekdays: [0, 1, 2, 3, 4],
    tags: ['ai', 'screen-time'],
    config: {
      include_activity_summary: true,
      include_computer_time: true,
      include_screen_time: true,
      suggest_reflection_prompt: true,
    },
  },
  {
    id: 'drop_the_ball_monitor',
    title: "Don't Let Me Drop the Ball",
    description: 'Scans for commitments that have gone quiet and queues a recovery prompt.',
    category: 'Inbox',
    sourceIcon: 'Inbox',
    workflowKind: 'daily_narrative',
    cadence: 'daily',
    hour: 15,
    minute: 0,
    weekdays: [0, 1, 2, 3, 4],
    tags: ['ai', 'follow-up'],
    config: {
      publish_inbox_card: true,
      publish_artifact: true,
      detect_stale_commitments: true,
      suggest_recovery_prompt: true,
    },
  },
  {
    id: 'calendar_energy_conflict_review',
    title: 'Calendar + Energy Conflict Review',
    description: 'Finds calendar load that conflicts with recovery, deep work, or expected energy patterns.',
    category: 'Calendar',
    sourceIcon: 'CalendarSearch',
    workflowKind: 'morning_brief',
    cadence: 'daily',
    hour: 7,
    minute: 45,
    weekdays: [0, 1, 2, 3, 4],
    tags: ['ai', 'calendar', 'energy'],
    config: {
      include_calendar: true,
      include_biometrics: true,
      detect_energy_conflicts: true,
      suggest_calendar_adjustments: true,
    },
  },
  {
    id: 'draft_important_email_responses',
    title: 'Draft Responses to Important Emails',
    description: 'Scans important inbox threads and drafts responses for review before sending.',
    category: 'Inbox',
    sourceIcon: 'MailPlus',
    workflowKind: 'daily_narrative',
    cadence: 'daily',
    hour: 11,
    minute: 0,
    weekdays: [0, 1, 2, 3, 4],
    tags: ['ai', 'inbox'],
    config: {
      publish_inbox_card: true,
      scan_important_email: true,
      draft_responses: true,
      require_user_review: true,
    },
  },
  {
    id: 'linkedin_content_generator',
    title: 'LinkedIn Content Generator',
    description: 'Turns recent artifacts, wins, and observations into a short draft content queue.',
    category: 'Marketing',
    sourceIcon: 'PenLine',
    workflowKind: 'daily_narrative',
    cadence: 'weekly',
    hour: 13,
    minute: 30,
    weekdays: [2],
    tags: ['ai', 'marketing'],
    config: {
      publish_artifact: true,
      summarize_recent_work: true,
      draft_social_posts: true,
    },
  },
  {
    id: 'code_review_digest',
    title: 'Pull Request Follow-Up',
    description: 'Finds unresolved review threads, stale PRs, and code follow-ups before they drift.',
    category: 'Code',
    sourceIcon: 'GitPullRequest',
    workflowKind: 'shutdown_review',
    cadence: 'weekly',
    hour: 15,
    minute: 0,
    weekdays: [4],
    tags: ['ai', 'engineering'],
    config: {
      include_code_activity: true,
      include_recent_artifacts: true,
      detect_follow_ups: true,
    },
  },
  {
    id: 'docs_follow_up_sweep',
    title: 'Docs Follow-Up Sweep',
    description: 'Reviews recent docs, specs, and notes for promised edits and missing next actions.',
    category: 'Docs',
    sourceIcon: 'Sparkles',
    workflowKind: 'daily_narrative',
    cadence: 'weekly',
    hour: 10,
    minute: 30,
    weekdays: [1],
    tags: ['ai', 'docs'],
    config: {
      include_recent_artifacts: true,
      scan_docs_for_commitments: true,
      detect_follow_ups: true,
    },
  },
  {
    id: 'engineering_change_digest',
    title: 'Engineering Change Digest',
    description: 'Summarizes shipped code, open risks, and follow-up work for an engineering review.',
    category: 'Engineering',
    sourceIcon: 'GitPullRequest',
    workflowKind: 'shutdown_review',
    cadence: 'weekly',
    hour: 15,
    minute: 30,
    weekdays: [4],
    tags: ['ai', 'engineering'],
    config: {
      include_code_activity: true,
      include_recent_artifacts: true,
      detect_follow_ups: true,
      include_weekly_context: true,
    },
  },
  {
    id: 'founder_weekly_signal',
    title: 'Founder Weekly Signal',
    description: 'Condenses product, customer, metrics, and calendar signals into a founder-facing review.',
    category: 'Founders',
    sourceIcon: 'BriefcaseBusiness',
    workflowKind: 'shutdown_review',
    cadence: 'weekly',
    hour: 14,
    minute: 0,
    weekdays: [4],
    tags: ['ai', 'founder'],
    config: {
      include_metric_deltas: true,
      include_calendar: true,
      include_weekly_context: true,
      detect_stale_commitments: true,
    },
  },
];

export function workflowRoutineInput(definition: WorkflowDefinition, template?: AiRoutineTemplate): RoutineCreateInput {
  const weekdays = definition.schedule.send_weekdays || [];
  const isDaily = weekdays.length === 0 || weekdays.length === 7;
  return {
    title: template?.title || definition.name,
    description: template?.description || `${definition.name} generated by Ritual Intelligence.`,
    status: 'scheduled',
    kind: 'ai_workflow',
    trigger_type: isDaily ? 'daily' : 'weekly',
    trigger_config: isDaily
      ? {
          interval: 1,
          hour: definition.schedule.send_hour_local,
          minute: definition.schedule.send_minute_local,
        }
      : {
          interval: 1,
          weekdays,
          hour: definition.schedule.send_hour_local,
          minute: definition.schedule.send_minute_local,
        },
    timezone: definition.schedule.timezone,
    priority: 'medium',
    tags: template?.tags || ['ai'],
    ai_workflow_definition_id: definition.id,
  };
}

export function workflowPayloadForTemplate(template: AiRoutineTemplate, timezone: string): WorkflowDefinitionCreateInput {
  return {
    kind: template.workflowKind,
    name: template.title,
    definition_family: 'routine',
    trigger_type: 'schedule',
    signal_kind: null,
    status: 'scheduled',
    schedule: {
      timezone,
      cadence: template.cadence,
      send_hour_local: template.hour,
      send_minute_local: template.minute,
      send_weekdays: template.weekdays,
    },
    delivery: { channel: 'in_app', publish: true, inbox: true },
    config: {
      ...template.config,
      ai_routine_template_key: template.id,
      ai_routine_template_title: template.title,
    },
  };
}
