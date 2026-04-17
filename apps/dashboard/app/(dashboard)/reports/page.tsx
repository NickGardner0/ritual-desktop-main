import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import {
  CalendarClock,
  CheckCircle2,
  CirclePause,
  Mail,
  Radar,
  Sparkles,
} from "lucide-react";

import { HabitReportEmailPreview } from "@/lib/reports/habit-report-email";
import { buildBackendAuthHeaders } from "@/lib/server/backend-auth";
import {
  ritualHabitReportEmailPreview,
  ritualReportSchedules,
} from "@/lib/reports/mock-data";
import type {
  RitualReportCadence,
  RitualReportRun,
  RitualReportRunStatus,
  RitualReportSchedule,
  RitualReportStatus,
} from "@/lib/reports/types";

export const metadata: Metadata = {
  title: "Reports | Ritual",
  description: "Automated habit reports and scheduled email summaries.",
};

const PYTHON_API_BASE =
  process.env.NEXT_PUBLIC_PYTHON_API_URL || "http://127.0.0.1:8000";

const cadenceOrder: RitualReportCadence[] = ["daily", "weekly", "monthly"];

const statusStyles: Record<RitualReportStatus, string> = {
  scheduled:
    "border-[rgba(21,128,61,0.14)] bg-[rgba(22,163,74,0.08)] text-[#166534]",
  paused:
    "border-[rgba(180,83,9,0.14)] bg-[rgba(245,158,11,0.10)] text-[#92400e]",
  draft:
    "border-[rgba(15,23,42,0.10)] bg-[rgba(15,23,42,0.04)] text-[#475569]",
};

const runStatusStyles: Record<RitualReportRunStatus, string> = {
  queued:
    "border-[rgba(30,64,175,0.12)] bg-[rgba(59,130,246,0.08)] text-[#1d4ed8]",
  processing:
    "border-[rgba(8,145,178,0.12)] bg-[rgba(6,182,212,0.08)] text-[#0f766e]",
  sent: "border-[rgba(21,128,61,0.14)] bg-[rgba(22,163,74,0.08)] text-[#166534]",
  failed:
    "border-[rgba(185,28,28,0.14)] bg-[rgba(239,68,68,0.08)] text-[#b91c1c]",
};

const cadenceCopy: Record<
  RitualReportCadence,
  { title: string; blurb: string; icon: typeof CalendarClock }
> = {
  daily: {
    title: "Daily",
    blurb: "Short recaps with completion, misses, and any unusual habit movement.",
    icon: CalendarClock,
  },
  weekly: {
    title: "Weekly",
    blurb: "The Midday-style default: highlights, trends, streaks, and notable habit shifts.",
    icon: Radar,
  },
  monthly: {
    title: "Monthly",
    blurb: "Longer reflections with progress, consistency, and broader pattern summaries.",
    icon: Sparkles,
  },
};

function getCadenceCount(
  cadence: RitualReportCadence,
  schedules: RitualReportSchedule[],
) {
  return schedules.filter((item) => item.cadence === cadence).length;
}

function formatStatus(status: RitualReportStatus) {
  if (status === "scheduled") return "Scheduled";
  if (status === "paused") return "Paused";
  return "Draft";
}

function formatCadence(cadence: RitualReportCadence) {
  return cadence.charAt(0).toUpperCase() + cadence.slice(1);
}

function renderStatusIcon(status: RitualReportStatus) {
  if (status === "scheduled") return <CheckCircle2 className="h-3.5 w-3.5" />;
  if (status === "paused") return <CirclePause className="h-3.5 w-3.5" />;
  return <Sparkles className="h-3.5 w-3.5" />;
}

function formatRunStatus(status: RitualReportRunStatus) {
  if (status === "queued") return "Queued";
  if (status === "processing") return "Processing";
  if (status === "sent") return "Sent";
  return "Failed";
}

function formatRunWindow(run: RitualReportRun) {
  const start = new Date(`${run.periodStart}T00:00:00`);
  const end = new Date(`${run.periodEnd}T00:00:00`);
  const startLabel = start.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const endLabel = end.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  return startLabel === endLabel ? startLabel : `${startLabel} - ${endLabel}`;
}

function formatRunTimestamp(value: string | null) {
  if (!value) return "Pending";
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return "Pending";
  return timestamp.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function ReportsTableRow({ report }: { report: RitualReportSchedule }) {
  return (
    <tr className="border-t border-[rgba(15,23,42,0.06)] align-top">
      <td className="px-4 py-4">
        <div className="text-[15px] font-[540] text-[#111827]">{report.name}</div>
        <div className="mt-1 text-[13px] text-[#6b7280]">{report.timezone}</div>
      </td>
      <td className="px-4 py-4 text-[14px] text-[#111827]">
        {formatCadence(report.cadence)}
      </td>
      <td className="px-4 py-4">
        <div
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-[550] ${statusStyles[report.status]}`}
        >
          {renderStatusIcon(report.status)}
          {formatStatus(report.status)}
        </div>
      </td>
      <td className="px-4 py-4 text-[14px] text-[#111827]">
        {report.deliveryLabel}
      </td>
      <td className="px-4 py-4 text-[14px] text-[#6b7280]">
        {report.recipients.map((recipient) => recipient.email).join(", ")}
      </td>
      <td className="px-4 py-4 text-[14px] text-[#6b7280]">
        {report.sections.length} sections
      </td>
    </tr>
  );
}

async function getScheduleData(): Promise<RitualReportSchedule[]> {
  try {
    const { userId, getToken } = await auth();
    if (!userId) {
      return ritualReportSchedules;
    }

    const token = await getToken();
    const response = await fetch(`${PYTHON_API_BASE}/api/reports/schedules`, {
      method: "GET",
      headers: buildBackendAuthHeaders({ userId, token }),
      cache: "no-store",
    });

    if (!response.ok) {
      return ritualReportSchedules;
    }

    const payload = (await response.json()) as {
      schedules?: Array<{
        id: string;
        name: string;
        cadence: RitualReportCadence;
        status: RitualReportStatus;
        timezone: string;
        delivery_channel?: "email";
        delivery_label: string;
        recipients: Array<{ email: string; label: string }>;
        sections: RitualReportSchedule["sections"];
        last_sent_at?: string | null;
        next_run_at?: string | null;
      }>;
    };

    if (!payload.schedules?.length) {
      return ritualReportSchedules;
    }

    return payload.schedules.map((schedule) => ({
      id: schedule.id,
      name: schedule.name,
      cadence: schedule.cadence,
      status: schedule.status,
      timezone: schedule.timezone,
      deliveryChannel: schedule.delivery_channel || "email",
      deliveryLabel: schedule.delivery_label,
      recipients: schedule.recipients,
      sections: schedule.sections,
      lastSentAt: schedule.last_sent_at || null,
      nextRunAt: schedule.next_run_at || null,
    }));
  } catch {
    return ritualReportSchedules;
  }
}

async function getRunData(): Promise<RitualReportRun[]> {
  try {
    const { userId, getToken } = await auth();
    if (!userId) {
      return [];
    }

    const token = await getToken();
    const response = await fetch(`${PYTHON_API_BASE}/api/reports/runs?limit=8`, {
      method: "GET",
      headers: buildBackendAuthHeaders({ userId, token }),
      cache: "no-store",
    });

    if (!response.ok) {
      return [];
    }

    const payload = (await response.json()) as {
      runs?: Array<{
        id: string;
        schedule_id: string;
        cadence: RitualReportCadence;
        status: RitualReportRunStatus;
        period_start: string;
        period_end: string;
        subject?: string | null;
        generated_at?: string | null;
        sent_at?: string | null;
        created_at?: string | null;
        error_json?: string | null;
      }>;
    };

    if (!payload.runs?.length) {
      return [];
    }

    return payload.runs.map((run) => ({
      id: run.id,
      scheduleId: run.schedule_id,
      cadence: run.cadence,
      status: run.status,
      periodStart: run.period_start,
      periodEnd: run.period_end,
      subject: run.subject || null,
      generatedAt: run.generated_at || null,
      sentAt: run.sent_at || null,
      createdAt: run.created_at || null,
      error: run.error_json || null,
    }));
  } catch {
    return [];
  }
}

export default async function ReportsPage() {
  const [schedules, runs] = await Promise.all([getScheduleData(), getRunData()]);

  return (
    <div className="flex-1 overflow-auto bg-[var(--content-bg)]">
      <div className="mx-auto max-w-7xl px-6 pb-24 pt-8 lg:px-8">
        <div className="mb-8">
          <h1 className="text-[32px] font-[550] tracking-[-0.02em] text-[#111827]">
            Reports
          </h1>
          <p className="mt-2 max-w-3xl text-[15px] leading-7 text-[#6b7280]">
            This will be the control plane for Ritual’s scheduled daily,
            weekly, and monthly habit reports. The UI is scaffolded now, and
            the backend contract is shaped around a future Midday-style
            generation pipeline: schedule, generate, then email.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {cadenceOrder.map((cadence) => {
            const item = cadenceCopy[cadence];
            const Icon = item.icon;
            return (
              <div
                key={cadence}
                className="rounded-[18px] border border-[rgba(15,23,42,0.08)] bg-white/88 p-5 shadow-[0_10px_30px_rgba(15,23,42,0.04)]"
              >
                <div className="flex items-center justify-between">
                  <div className="inline-flex h-10 w-10 items-center justify-center rounded-[12px] bg-[rgba(15,23,42,0.05)] text-[#111827]">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="rounded-full border border-[rgba(15,23,42,0.08)] px-2.5 py-1 text-[12px] font-[550] text-[#6b7280]">
                    {getCadenceCount(cadence, schedules)} configured
                    {getCadenceCount(cadence, schedules) === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="mt-4 text-[18px] font-[550] text-[#111827]">
                  {item.title}
                </div>
                <p className="mt-2 text-[14px] leading-6 text-[#6b7280]">
                  {item.blurb}
                </p>
              </div>
            );
          })}
        </div>

        <div className="mt-8 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-[20px] border border-[rgba(15,23,42,0.08)] bg-white/88 shadow-[0_10px_34px_rgba(15,23,42,0.04)]">
            <div className="flex items-center justify-between border-b border-[rgba(15,23,42,0.06)] px-6 py-5">
              <div>
                <h2 className="text-[20px] font-[550] text-[#111827]">
                  Scheduled reports
                </h2>
                <p className="mt-1 text-[14px] text-[#6b7280]">
                  Placeholder data for the first daily, weekly, and monthly
                  report definitions.
                </p>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(15,23,42,0.08)] bg-[rgba(248,248,247,0.9)] px-3 py-1.5 text-[13px] text-[#6b7280]">
                <Mail className="h-4 w-4" />
                Email delivery
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="text-left text-[12px] uppercase tracking-[0.12em] text-[#6b7280]">
                    <th className="px-4 py-3 font-[600]">Report</th>
                    <th className="px-4 py-3 font-[600]">Cadence</th>
                    <th className="px-4 py-3 font-[600]">Status</th>
                    <th className="px-4 py-3 font-[600]">Delivery</th>
                    <th className="px-4 py-3 font-[600]">Recipient</th>
                    <th className="px-4 py-3 font-[600]">Coverage</th>
                  </tr>
                </thead>
                <tbody>
                  {schedules.map((report) => (
                    <ReportsTableRow key={report.id} report={report} />
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-[20px] border border-[rgba(15,23,42,0.08)] bg-white/88 p-5 shadow-[0_10px_34px_rgba(15,23,42,0.04)]">
            <div className="mb-4">
              <h2 className="text-[20px] font-[550] text-[#111827]">
                Starter email template
              </h2>
              <p className="mt-1 text-[14px] leading-6 text-[#6b7280]">
                This is the first report-email shape for Ritual. It is modeled
                after Midday’s weekly insights flow: generate a summary first,
                then deliver a clean email with a direct CTA back into the app.
              </p>
            </div>

            <div className="overflow-hidden rounded-[18px] border border-[rgba(15,23,42,0.08)] bg-[#f6f5f2]">
              <HabitReportEmailPreview preview={ritualHabitReportEmailPreview} />
            </div>
          </section>
        </div>

        <section className="mt-6 rounded-[20px] border border-[rgba(15,23,42,0.08)] bg-white/88 shadow-[0_10px_34px_rgba(15,23,42,0.04)]">
          <div className="border-b border-[rgba(15,23,42,0.06)] px-6 py-5">
            <h2 className="text-[20px] font-[550] text-[#111827]">
              Recent runs
            </h2>
            <p className="mt-1 text-[14px] text-[#6b7280]">
              Generated summaries and delivery attempts from the new reports
              pipeline.
            </p>
          </div>

          {runs.length === 0 ? (
            <div className="px-6 py-8 text-[14px] text-[#6b7280]">
              No report runs yet. Once a schedule dispatches, generated summaries
              and email delivery attempts will appear here.
            </div>
          ) : (
            <div className="divide-y divide-[rgba(15,23,42,0.06)]">
              {runs.map((run) => (
                <div
                  key={run.id}
                  className="grid gap-3 px-6 py-4 md:grid-cols-[1.2fr_0.8fr_0.8fr_1fr]"
                >
                  <div>
                    <div className="text-[15px] font-[540] text-[#111827]">
                      {run.subject || `${formatCadence(run.cadence)} report`}
                    </div>
                    <div className="mt-1 text-[13px] text-[#6b7280]">
                      {formatRunWindow(run)}
                    </div>
                  </div>

                  <div>
                    <div
                      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[12px] font-[550] ${runStatusStyles[run.status]}`}
                    >
                      {formatRunStatus(run.status)}
                    </div>
                  </div>

                  <div className="text-[14px] text-[#111827]">
                    {formatCadence(run.cadence)}
                  </div>

                  <div className="text-[13px] text-[#6b7280]">
                    {run.status === "sent"
                      ? `Sent ${formatRunTimestamp(run.sentAt)}`
                      : run.status === "failed"
                        ? run.error || "Delivery failed"
                        : formatRunTimestamp(run.createdAt)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
