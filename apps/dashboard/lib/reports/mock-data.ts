import type {
  RitualHabitReportEmailPreview,
  RitualReportSchedule,
  RitualReportSection,
} from "@/lib/reports/types";

const dailySections: RitualReportSection[] = [
  "highlights",
  "consistency",
  "missed-habits",
  "computer-activity",
];

const weeklySections: RitualReportSection[] = [
  "highlights",
  "consistency",
  "streaks",
  "top-habits",
  "computer-activity",
  "wearables",
];

const monthlySections: RitualReportSection[] = [
  "highlights",
  "consistency",
  "streaks",
  "top-habits",
  "missed-habits",
  "computer-activity",
  "wearables",
];

export const ritualReportSchedules: RitualReportSchedule[] = [
  {
    id: "weekly-owner-summary",
    name: "Weekly Habit Summary",
    cadence: "weekly",
    status: "scheduled",
    timezone: "America/New_York",
    deliveryChannel: "email",
    deliveryLabel: "Mondays at 7:00 AM",
    recipients: [{ email: "owner@ritual.app", label: "Primary inbox" }],
    sections: weeklySections,
    lastSentAt: "2026-04-13T11:00:00Z",
    nextRunAt: "2026-04-20T11:00:00Z",
  },
  {
    id: "monthly-reflection",
    name: "Monthly Reflection",
    cadence: "monthly",
    status: "draft",
    timezone: "America/New_York",
    deliveryChannel: "email",
    deliveryLabel: "1st day of each month at 8:30 AM",
    recipients: [{ email: "owner@ritual.app", label: "Primary inbox" }],
    sections: monthlySections,
    lastSentAt: null,
    nextRunAt: null,
  },
  {
    id: "daily-recap",
    name: "Daily Recap",
    cadence: "daily",
    status: "paused",
    timezone: "America/New_York",
    deliveryChannel: "email",
    deliveryLabel: "Every day at 8:00 PM",
    recipients: [{ email: "owner@ritual.app", label: "Primary inbox" }],
    sections: dailySections,
    lastSentAt: "2026-04-15T00:00:00Z",
    nextRunAt: null,
  },
];

export const ritualHabitReportEmailPreview: RitualHabitReportEmailPreview = {
  subject: "Your weekly Ritual report is ready",
  preheader:
    "Highlights, consistency trends, and the habits that defined your week.",
  title: "Weekly Habit Summary",
  periodLabel: "Apr 8 - Apr 14",
  introLine:
    "Hi Nick, here's what your habits looked like across Apr 8 - Apr 14.",
  summary:
    "You were most consistent with Sleep Duration, Daily Walk, and Reading. Computer Time remained elevated on two days, but your overall week stayed balanced and readable.",
  ctaLabel: "Open Ritual",
  ctaUrl: "https://desktop.ritualdb.com/reports",
  metrics: [
    { label: "Tracked habits", value: "13", note: "Across all active habits" },
    { label: "Completion rate", value: "82%", note: "Up 6% from last week" },
    { label: "Top streak", value: "7 days", note: "Daily Walk" },
  ],
  highlights: [
    "Daily Walk was logged every day this week.",
    "Reading volume increased by 18% week over week.",
    "Computer Time spiked on Tuesday and Thursday afternoon.",
  ],
};
