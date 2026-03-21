'use client';

import React from 'react';

interface ExpandedChartTooltipProps {
  active?: boolean;
  payload?: any[];
  unit?: string;
  compareLabel?: string;
  compareUnit?: string;
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

function formatClockTime(rawValue: unknown): string | null {
  if (!rawValue) return null;

  if (typeof rawValue === 'number') {
    const parsed = new Date(rawValue);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
    return null;
  }

  if (rawValue instanceof Date) {
    if (!Number.isNaN(rawValue.getTime())) {
      return rawValue.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
    return null;
  }

  if (typeof rawValue !== 'string') return null;
  const text = rawValue.trim();
  if (!text) return null;

  // Keep already-formatted clock strings as-is.
  if (/^\d{1,2}:\d{2}\s?[ap]m$/iu.test(text)) {
    return text.replace(/\s+/u, '');
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  const clockMatch = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/u);
  if (clockMatch) {
    const hour = Number(clockMatch[1]);
    const minute = Number(clockMatch[2]);
    if (Number.isFinite(hour) && Number.isFinite(minute) && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      const period = hour >= 12 ? 'pm' : 'am';
      const hour12 = hour % 12 || 12;
      return `${hour12}:${minute.toString().padStart(2, '0')}${period}`;
    }
  }

  return text;
}

function toOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatUnitLabel(unit: string | undefined): string | undefined {
  if (!unit) return unit;
  const normalized = unit.trim().toLowerCase();
  if (normalized === 'milligram' || normalized === 'milligrams' || normalized === 'mg') {
    return 'mg';
  }
  return unit;
}

function formatCompareLabel(label: string | undefined): string {
  if (!label) return 'Compare';
  const firstWord = label.trim().split(/\s+/u)[0];
  return firstWord || 'Compare';
}

export function ExpandedChartTooltip({
  active,
  payload,
  unit,
  compareLabel,
  compareUnit,
  dateKey = 't',
  valueKey = 'value',
}: ExpandedChartTooltipProps) {
  if (!active || !payload?.length) return null;

  const point = payload[0]?.payload ?? {};
  const primaryEntry = payload.find((entry: any) => entry?.dataKey === valueKey) ?? payload[0];
  const compareEntry = payload.find((entry: any) => entry?.dataKey === 'compareValue');
  const rawValue = point?.[valueKey] ?? primaryEntry?.value;
  const rawCompareValue = point?.compareValue ?? compareEntry?.value;
  const rawDate = point?.[dateKey];
  const compareNumericValue = toOptionalNumber(rawCompareValue);
  const hasCompareValue = compareNumericValue !== null;
  const primaryUnit = formatUnitLabel(unit);
  const compareDisplayUnit = formatUnitLabel(compareUnit || unit);
  const compareDisplayLabel = formatCompareLabel(compareLabel);
  const hasSleepMetadata = Boolean(
    point?.sleepOnset
    || point?.sleep_onset
    || point?.sleepEnd
    || point?.sleep_end
    || point?.sleep_start
  );

  const sleepTime = formatClockTime(point?.sleepOnset ?? point?.sleep_onset ?? point?.sleep_start);
  const wakeTime = formatClockTime(
    point?.sleepEnd
    ?? point?.sleep_end
    ?? point?.wake_time
    ?? point?.time
  );
  const tooltipWidthClass = hasSleepMetadata ? 'w-[168px]' : 'w-[138px]';

  return (
    <div
      className={`${tooltipWidthClass} rounded-sm border border-white/45 bg-[rgba(248,249,251,0.56)] px-2.5 py-2 shadow-[0_8px_20px_rgba(15,23,42,0.16)] backdrop-blur-md`}
    >
      <div className="mb-1 text-[11px] text-[rgba(39,37,30,0.62)]">{formatTooltipDate(rawDate)}</div>

      <div className="space-y-1 text-[11px] leading-4">
        <div className="flex items-center justify-between">
          <span className="text-[rgba(39,37,30,0.88)]">Value</span>
          <span className="pl-3 text-right tabular-nums whitespace-nowrap text-[rgba(39,37,30,0.72)]">
            {formatValue(rawValue)}
            {primaryUnit ? <span className="ml-1">{primaryUnit}</span> : null}
          </span>
        </div>

        {hasCompareValue ? (
          <div className="flex items-center justify-between">
            <span className="text-[rgba(39,37,30,0.88)]">{compareDisplayLabel}</span>
            <span className="pl-3 text-right tabular-nums whitespace-nowrap text-[rgba(39,37,30,0.72)]">
              {formatValue(compareNumericValue)}
              {compareDisplayUnit ? <span className="ml-1">{compareDisplayUnit}</span> : null}
            </span>
          </div>
        ) : null}

        {hasSleepMetadata ? (
          <>
            <div className="flex items-center justify-between">
              <span className="text-[rgba(39,37,30,0.88)]">Sleep Time</span>
              <span className="pl-3 text-right tabular-nums whitespace-nowrap text-[rgba(39,37,30,0.72)]">{sleepTime || '--'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[rgba(39,37,30,0.88)]">Wake Up</span>
              <span className="pl-3 text-right tabular-nums whitespace-nowrap text-[rgba(39,37,30,0.72)]">{wakeTime || '--'}</span>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

export default ExpandedChartTooltip;
