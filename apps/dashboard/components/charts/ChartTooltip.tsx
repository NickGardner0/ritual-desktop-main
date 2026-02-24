'use client';

import React from 'react';

interface ExpandedChartTooltipProps {
  active?: boolean;
  payload?: any[];
  unit?: string;
  dateKey?: string;
  valueKey?: string;
}

function formatTooltipDate(rawDate: unknown): string {
  if (typeof rawDate === 'number') {
    return new Date(rawDate).toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
      year: new Date(rawDate).getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
    });
  }

  if (typeof rawDate === 'string' || rawDate instanceof Date) {
    const parsed = new Date(rawDate);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString([], {
        month: 'short',
        day: 'numeric',
        year: parsed.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
      });
    }
  }

  return 'Data point';
}

function formatValue(value: unknown): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '--';

  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: Math.abs(numeric) < 10 ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(numeric);
}

export function ExpandedChartTooltip({
  active,
  payload,
  unit,
  dateKey = 't',
  valueKey = 'value',
}: ExpandedChartTooltipProps) {
  if (!active || !payload?.length) return null;

  const point = payload[0]?.payload ?? {};
  const rawValue = point?.[valueKey] ?? payload[0]?.value;
  const rawDate = point?.[dateKey];

  return (
    <div className="border border-border/70 bg-background px-2 py-1.5">
      <div className="text-[10px] text-muted-foreground">{formatTooltipDate(rawDate)}</div>
      <div className="mt-0.5 whitespace-nowrap text-[13px] font-semibold tabular-nums text-foreground">
        {formatValue(rawValue)}
        {unit ? <span className="ml-1 text-[11px] font-medium text-muted-foreground">{unit}</span> : null}
      </div>
    </div>
  );
}

export default ExpandedChartTooltip;
