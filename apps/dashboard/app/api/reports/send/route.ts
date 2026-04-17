import { NextRequest, NextResponse } from "next/server";

import { renderHabitReportEmail } from "@/lib/reports/habit-report-email";
import type { RitualHabitReportEmailPreview } from "@/lib/reports/types";

export const maxDuration = 30;

const RESEND_API_URL = "https://api.resend.com/emails";

function normalizePreview(input: Record<string, unknown>): RitualHabitReportEmailPreview {
  const metrics = Array.isArray(input.metrics)
    ? input.metrics.map((metric) => {
        const item = metric as Record<string, unknown>;
        return {
          label: String(item.label ?? ""),
          value: String(item.value ?? ""),
          unit: item.unit ? String(item.unit) : undefined,
          note: item.note ? String(item.note) : undefined,
        };
      })
    : [];

  const highlights = Array.isArray(input.highlights)
    ? input.highlights.map((item) => String(item))
    : [];

  return {
    subject: String(input.subject ?? ""),
    preheader: String(input.preheader ?? ""),
    title: String(input.title ?? ""),
    periodLabel:
      input.periodLabel || input.period_label
        ? String(input.periodLabel ?? input.period_label ?? "")
        : undefined,
    introLine:
      input.introLine || input.intro_line
        ? String(input.introLine ?? input.intro_line ?? "")
        : undefined,
    summary: String(input.summary ?? ""),
    metrics,
    highlights,
    ctaLabel: String(input.ctaLabel ?? input.cta_label ?? "Open Ritual"),
    ctaUrl: String(
      input.ctaUrl ??
        input.cta_url ??
        process.env.DASHBOARD_BASE_URL ??
        "https://desktop.ritualdb.com/reports",
    ),
  };
}

function buildPlainText(preview: RitualHabitReportEmailPreview) {
  const metricLines = preview.metrics.map(
    (metric) =>
      `- ${metric.label}: ${metric.value}${metric.unit ? ` ${metric.unit}` : ""}${metric.note ? ` (${metric.note})` : ""}`,
  );
  const highlightLines = preview.highlights.map((item) => `- ${item}`);

  return [
    preview.title,
    "",
    preview.periodLabel,
    "",
    preview.introLine,
    "",
    preview.summary,
    "",
    "Highlights",
    ...highlightLines,
    "",
    "Metrics",
    ...metricLines,
    "",
    `${preview.ctaLabel}: ${preview.ctaUrl}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function POST(req: NextRequest) {
  const expectedToken = process.env.INTERNAL_BACKEND_TOKEN?.trim() || "";
  const incomingToken = req.headers.get("x-backend-token")?.trim() || "";
  if (!expectedToken || incomingToken !== expectedToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const resendApiKey = process.env.RESEND_API_KEY?.trim() || "";
  if (!resendApiKey) {
    return NextResponse.json({ error: "RESEND_API_KEY is not configured" }, { status: 503 });
  }

  const from = process.env.REPORTS_FROM_EMAIL?.trim() || "Ritual <reports@ritualdb.com>";

  const body = (await req.json()) as {
    recipientEmail?: string;
    preview?: Record<string, unknown>;
  };

  const recipientEmail = body.recipientEmail?.trim();
  if (!recipientEmail) {
    return NextResponse.json({ error: "recipientEmail is required" }, { status: 400 });
  }
  if (!body.preview) {
    return NextResponse.json({ error: "preview is required" }, { status: 400 });
  }

  const preview = normalizePreview(body.preview);
  const html = renderHabitReportEmail(preview);
  const text = buildPlainText(preview);

  const resendResponse = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [recipientEmail],
      subject: preview.subject,
      html,
      text,
    }),
    cache: "no-store",
  });

  const data = await resendResponse.json().catch(() => ({}));
  if (!resendResponse.ok) {
    return NextResponse.json(
      { error: data?.message || data?.error || "Resend delivery failed" },
      { status: resendResponse.status },
    );
  }

  return NextResponse.json({
    ok: true,
    messageId: data?.id || null,
  });
}
