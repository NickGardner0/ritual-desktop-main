export type RitualReportCadence = "daily" | "weekly" | "monthly";

export type RitualReportStatus = "draft" | "scheduled" | "paused";
export type RitualReportRunStatus = "queued" | "processing" | "sent" | "failed";

export type RitualReportDeliveryChannel = "email";

export type RitualReportSection =
  | "highlights"
  | "consistency"
  | "streaks"
  | "top-habits"
  | "missed-habits"
  | "computer-activity"
  | "wearables";

export interface RitualReportRecipient {
  email: string;
  label: string;
}

export interface RitualReportSchedule {
  id: string;
  name: string;
  cadence: RitualReportCadence;
  status: RitualReportStatus;
  timezone: string;
  deliveryChannel: RitualReportDeliveryChannel;
  deliveryLabel: string;
  recipients: RitualReportRecipient[];
  sections: RitualReportSection[];
  lastSentAt: string | null;
  nextRunAt: string | null;
}

export interface RitualHabitReportMetric {
  label: string;
  value: string;
  unit?: string;
  note?: string;
}

export interface RitualHabitReportEmailPreview {
  subject: string;
  preheader: string;
  title: string;
  introLine?: string;
  summary: string;
  periodLabel?: string;
  ctaLabel: string;
  ctaUrl?: string;
  metrics: RitualHabitReportMetric[];
  highlights: string[];
}

export interface RitualReportRun {
  id: string;
  scheduleId: string;
  cadence: RitualReportCadence;
  status: RitualReportRunStatus;
  periodStart: string;
  periodEnd: string;
  subject: string | null;
  generatedAt: string | null;
  sentAt: string | null;
  createdAt: string | null;
  error: string | null;
}
