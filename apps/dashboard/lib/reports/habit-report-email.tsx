import type { CSSProperties } from "react";

import type { RitualHabitReportEmailPreview } from "@/lib/reports/types";

const wrapperStyle: CSSProperties = {
  margin: 0,
  backgroundColor: "#f6f5f2",
  fontFamily:
    'var(--ritual-selected-font-family), "SF Pro Text", "Segoe UI", sans-serif',
  color: "#111827",
};

const cardStyle: CSSProperties = {
  maxWidth: "620px",
  margin: "0 auto",
  backgroundColor: "#ffffff",
  border: "1px solid rgba(15, 23, 42, 0.08)",
  borderRadius: "18px",
  padding: "32px",
  boxShadow: "0 12px 32px rgba(15, 23, 42, 0.06)",
};

interface HabitReportEmailTemplateProps {
  preview: RitualHabitReportEmailPreview;
}

function HabitReportEmailCard({
  preview,
}: HabitReportEmailTemplateProps) {
  return (
    <div style={{ padding: "32px 20px" }}>
      <div style={cardStyle}>
        <div
          style={{
            fontSize: "12px",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "#6b7280",
            fontWeight: 600,
          }}
        >
          Ritual Report
        </div>

        <h1
          style={{
            margin: "14px 0 6px",
            fontSize: "28px",
            lineHeight: 1.15,
            fontWeight: 600,
            color: "#111827",
          }}
        >
          {preview.title}
        </h1>

        <p
          style={{
            margin: "0 0 24px",
            fontSize: "15px",
            lineHeight: 1.6,
            color: "#6b7280",
          }}
        >
          {preview.periodLabel || ""}
        </p>

        {preview.introLine ? (
          <p
            style={{
              margin: "0 0 14px",
              fontSize: "15px",
              lineHeight: 1.7,
              color: "#374151",
            }}
          >
            {preview.introLine}
          </p>
        ) : null}

        <p
          style={{
            margin: "0 0 24px",
            fontSize: "15px",
            lineHeight: 1.7,
            color: "#374151",
          }}
        >
          {preview.summary}
        </p>

        <table
          role="presentation"
          cellPadding={0}
          cellSpacing={0}
          width="100%"
          style={{ marginBottom: "24px" }}
        >
          <tbody>
            <tr>
              {preview.metrics.map((metric) => (
                <td key={metric.label} style={{ width: `${100 / preview.metrics.length}%`, paddingRight: "10px", verticalAlign: "top" }}>
                  <div
                    style={{
                      border: "1px solid rgba(15, 23, 42, 0.08)",
                      borderRadius: "14px",
                      background: "#f8f8f7",
                      padding: "16px",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "12px",
                        lineHeight: 1.4,
                        color: "#6b7280",
                        marginBottom: "8px",
                      }}
                    >
                      {metric.label}
                    </div>
                    <div
                      style={{
                        fontSize: "24px",
                        lineHeight: 1.1,
                        fontWeight: 600,
                        color: "#111827",
                      }}
                    >
                      {metric.value}
                      {metric.unit ? ` ${metric.unit}` : ""}
                    </div>
                    {metric.note ? (
                      <div
                        style={{
                          marginTop: "8px",
                          fontSize: "12px",
                          lineHeight: 1.4,
                          color: "#6b7280",
                        }}
                      >
                        {metric.note}
                      </div>
                    ) : null}
                  </div>
                </td>
              ))}
            </tr>
          </tbody>
        </table>

        <div
          style={{
            borderTop: "1px solid rgba(15, 23, 42, 0.08)",
            paddingTop: "20px",
          }}
        >
          <div
            style={{
              marginBottom: "12px",
              fontSize: "13px",
              fontWeight: 600,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "#6b7280",
            }}
          >
            Highlights
          </div>
          <ul style={{ margin: 0, paddingLeft: "18px", color: "#374151" }}>
            {preview.highlights.map((highlight) => (
              <li
                key={highlight}
                style={{
                  marginBottom: "10px",
                  fontSize: "14px",
                  lineHeight: 1.6,
                }}
              >
                {highlight}
              </li>
            ))}
          </ul>
        </div>

        <div style={{ marginTop: "28px" }}>
          <a
            href={preview.ctaUrl || "https://desktop.ritualdb.com/reports"}
            style={{
              display: "inline-block",
              backgroundColor: "#111827",
              color: "#ffffff",
              textDecoration: "none",
              padding: "12px 18px",
              borderRadius: "10px",
              fontSize: "14px",
              fontWeight: 600,
            }}
          >
            {preview.ctaLabel}
          </a>
        </div>
      </div>
    </div>
  );
}

export function HabitReportEmailTemplate({
  preview,
}: HabitReportEmailTemplateProps) {
  return (
    <html>
      <body style={wrapperStyle}>
        <div style={{ display: "none", maxHeight: 0, overflow: "hidden" }}>
          {preview.preheader}
        </div>
        <HabitReportEmailCard preview={preview} />
      </body>
    </html>
  );
}

export function HabitReportEmailPreview({
  preview,
}: HabitReportEmailTemplateProps) {
  return (
    <div style={wrapperStyle}>
      <HabitReportEmailCard preview={preview} />
    </div>
  );
}
