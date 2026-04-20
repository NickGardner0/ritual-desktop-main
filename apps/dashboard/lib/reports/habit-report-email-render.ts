import "server-only";

import type { RitualHabitReportEmailPreview } from "@/lib/reports/types";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderHabitReportEmail(preview: RitualHabitReportEmailPreview) {
  const metricsHtml = preview.metrics
    .map((metric) => {
      const value = `${escapeHtml(metric.value)}${
        metric.unit ? ` ${escapeHtml(metric.unit)}` : ""
      }`;
      const note = metric.note
        ? `<div style="margin-top:8px;font-size:12px;line-height:1.4;color:#6b7280;">${escapeHtml(metric.note)}</div>`
        : "";

      return `
        <td style="width:${100 / Math.max(preview.metrics.length, 1)}%;padding-right:10px;vertical-align:top;">
          <div style="border:1px solid rgba(15,23,42,0.08);border-radius:14px;background:#f8f8f7;padding:16px;">
            <div style="font-size:12px;line-height:1.4;color:#6b7280;margin-bottom:8px;">${escapeHtml(metric.label)}</div>
            <div style="font-size:24px;line-height:1.1;font-weight:600;color:#111827;">${value}</div>
            ${note}
          </div>
        </td>
      `;
    })
    .join("");

  const highlightsHtml = preview.highlights
    .map(
      (highlight) => `
        <li style="margin-bottom:10px;font-size:14px;line-height:1.6;">${escapeHtml(highlight)}</li>
      `,
    )
    .join("");

  const ctaUrl = escapeHtml(
    preview.ctaUrl || "https://desktop.ritualdb.com/reports",
  );

  return `<!DOCTYPE html>
<html>
  <body style="margin:0;background-color:#f6f5f2;font-family:var(--ritual-selected-font-family), 'SF Pro Text', 'Segoe UI', sans-serif;color:#111827;">
    <div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(preview.preheader)}</div>
    <div style="padding:32px 20px;">
      <div style="max-width:620px;margin:0 auto;background-color:#ffffff;border:1px solid rgba(15,23,42,0.08);border-radius:18px;padding:32px;box-shadow:0 12px 32px rgba(15,23,42,0.06);">
        <div style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#6b7280;font-weight:600;">Ritual Report</div>
        <h1 style="margin:14px 0 6px;font-size:28px;line-height:1.15;font-weight:600;color:#111827;">${escapeHtml(preview.title)}</h1>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#6b7280;">${escapeHtml(preview.periodLabel || "")}</p>
        ${
          preview.introLine
            ? `<p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:#374151;">${escapeHtml(preview.introLine)}</p>`
            : ""
        }
        <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#374151;">${escapeHtml(preview.summary)}</p>
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:24px;">
          <tbody>
            <tr>
              ${metricsHtml}
            </tr>
          </tbody>
        </table>
        <div style="border-top:1px solid rgba(15,23,42,0.08);padding-top:20px;">
          <div style="margin-bottom:12px;font-size:13px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#6b7280;">Highlights</div>
          <ul style="margin:0;padding-left:18px;color:#374151;">
            ${highlightsHtml}
          </ul>
        </div>
        <div style="margin-top:28px;">
          <a href="${ctaUrl}" style="display:inline-block;background-color:#111827;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:10px;font-size:14px;font-weight:600;">
            ${escapeHtml(preview.ctaLabel)}
          </a>
        </div>
      </div>
    </div>
  </body>
</html>`;
}
